import { promises as fs } from 'node:fs'
import { basename, join, relative } from 'node:path'
import {
  ARCHIVE_DIR,
  SNITCH_ROOT,
  exchangesDir,
  framesDir,
  listExchangeFiles,
  mcpFile,
  modelMemoryFile,
  readAppSettings,
  detectWorkspace
} from './paths.mjs'
import { redact, stripPayloads } from './redact.mjs'
import { classifyNotice, makeIncident } from './analyze.mjs'
import { countRun } from './store.mjs'
import { ensureDir, firstLine, hash, safeJson, truncate } from './util.mjs'

const TEXT_LIMIT = 4_000
const DETAIL_LIMIT = 2_500
const ANSWER_LIMIT = 12_000

const COMMAND_TOOLS = new Set([
  'run_command',
  'start_server',
  'stop_server',
  'git_commit',
  'git_restore',
  'run_tests',
  'type_check',
  'lint_check',
  'format_code',
  'deps_check',
  'install_package',
  'check_versions',
  'browser_pilot',
  'fill_form',
  'chaos_check'
])

function clean(text, doRedact, limit = TEXT_LIMIT) {
  const value = stripPayloads(String(text ?? ''))
  return truncate(doRedact ? redact(value) : value, limit)
}

function cleanRaw(text, doRedact) {
  const value = stripPayloads(String(text ?? ''))
  return doRedact ? redact(value) : value
}

function safeUrlHost(value) {
  if (typeof value !== 'string' || value.length === 0) return null
  try {
    const url = new URL(value)
    return url.origin
  } catch {
    return null
  }
}

export function archiveName(startedAt, id) {
  const stamp = new Date(startedAt || Date.now())
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19)
  const safe = String(id ?? 'run').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12) || 'run'
  return `${stamp}-${safe}.json`
}

async function archiveExchange(report, sourceFile, id, startedAt, retention) {
  const dir = join(ARCHIVE_DIR, 'exchanges')
  await ensureDir(dir)
  const target = join(dir, archiveName(startedAt, id))
  try {
    await fs.access(target)
  } catch {
    try {
      await fs.copyFile(sourceFile, target)
    } catch {
      await fs.writeFile(target, JSON.stringify(report, null, 1), 'utf8')
    }
  }
  await pruneArchives(dir, retention?.archives ?? 800)
  return relative(SNITCH_ROOT, target)
}

async function pruneArchives(dir, limit) {
  try {
    const names = await fs.readdir(dir)
    if (names.length <= limit) return
    const files = []
    for (const name of names) {
      const path = join(dir, name)
      const stat = await fs.stat(path).catch(() => null)
      if (stat?.isFile()) files.push({ path, mtime: stat.mtimeMs })
    }
    files.sort((a, b) => a.mtime - b.mtime)
    for (const stale of files.slice(0, Math.max(0, files.length - limit))) {
      await fs.rm(stale.path, { force: true }).catch(() => {})
    }
  } catch {
    // Retention is best effort.
  }
}

/** write_file content can be megabytes; diagnostics only need its shape. */
export function sanitizeArgs(name, raw, doRedact) {
  const parsed = typeof raw === 'string' ? safeJson(raw, null) : raw
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { args: null, argsText: clean(raw, doRedact, 1_500) }
  }
  let value = parsed
  switch (name) {
    case 'write_file':
      value = {
        path: parsed.path,
        contentChars: String(parsed.content ?? '').length,
        contentHead: clean(String(parsed.content ?? ''), doRedact, 240)
      }
      break
    case 'edit_file':
      value = {
        path: parsed.path,
        oldChars: String(parsed.old_string ?? '').length,
        newChars: String(parsed.new_string ?? '').length,
        replaceAll: parsed.replace_all === true,
        newHead: clean(String(parsed.new_string ?? ''), doRedact, 240)
      }
      break
    case 'show_image':
      value = {
        path: parsed.path,
        url: parsed.url,
        alt: parsed.alt,
        caption: parsed.caption
      }
      break
    case 'draw_figure':
      value = {
        title: parsed.title,
        caption: parsed.caption,
        elements: Array.isArray(parsed.elements) ? parsed.elements.length : null,
        results: Array.isArray(parsed.results) ? parsed.results.length : null
      }
      break
    case 'todo_write':
      value = { todos: Array.isArray(parsed.todos) ? parsed.todos.length : null }
      break
    default:
      value = parsed
  }
  const text = cleanRaw(JSON.stringify(value), doRedact)
  return { args: safeJson(text, value), argsText: truncate(text, 1_500) }
}

export function extractFiles(name, args, ok, at) {
  if (!args || typeof args !== 'object') return []
  const path = typeof args.path === 'string' ? args.path : null
  const base = { ok, at, tool: name }
  switch (name) {
    case 'write_file':
      return path ? [{ ...base, path, action: 'write', bytes: args.contentChars ?? null }] : []
    case 'edit_file':
      return path ? [{ ...base, path, action: 'edit', bytes: args.newChars ?? null }] : []
    case 'move_path':
      return args.from && args.to
        ? [{ ...base, path: String(args.to), from: String(args.from), action: 'move' }]
        : []
    case 'delete_path':
      return path ? [{ ...base, path, action: 'delete' }] : []
    case 'backup_file':
      return path ? [{ ...base, path, action: 'backup' }] : []
    case 'download_file':
      return path ? [{ ...base, path, action: 'download' }] : []
    case 'recycle_bin':
      return args.action === 'restore' && args.backup
        ? [{ ...base, path: String(args.backup), action: 'restore' }]
        : []
    case 'snapshot_project':
      return args.action === 'restore'
        ? [{ ...base, path: String(args.name ?? '(снапшот)'), action: 'snapshot-restore' }]
        : [{ ...base, path: '(весь проект)', action: 'snapshot' }]
    default:
      return []
  }
}

function commandText(name, args) {
  if (!args || typeof args !== 'object') return name
  if (typeof args.command === 'string') return args.command
  switch (name) {
    case 'git_commit':
      return `git commit -m ${JSON.stringify(args.message ?? '')}`
    case 'git_restore':
      return `git restore ${args.path ?? args.from ?? ''}`.trim()
    case 'run_tests':
      return `run_tests${args.filter ? ` ${args.filter}` : ''}`
    case 'install_package':
      return `install_package ${args.name ?? args.package ?? ''}`.trim()
    case 'check_versions':
      return 'check_versions'
    case 'stop_server':
      return `stop_server ${args.id ?? args.pid ?? args.port ?? ''}`.trim()
    case 'browser_pilot':
      return `browser_pilot ${args.url ?? ''} (${Array.isArray(args.actions) ? args.actions.length : 0} действий)`
    case 'fill_form':
      return `fill_form ${args.url ?? ''} (${Array.isArray(args.fields) ? args.fields.length : 0} полей)`
    case 'chaos_check':
      return `chaos_check ${args.url ?? ''}`
    default:
      return name
  }
}

export function extractCommand(name, args, step, at, doRedact) {
  if (!COMMAND_TOOLS.has(name)) return null
  const output = clean(`${step.detail ?? ''}`, doRedact, 2_000)
  const summary = String(step.summary ?? '')
  const exitCode = /exit code\s+(-?\d+)/i.exec(summary)?.[1]
  const timedOut = /\btimed?\s?-?out\b|\btimeout\b|тайм-аут/i.test(`${summary}\n${output}`)
  const port = /localhost:(\d{2,5})/i.exec(summary)?.[1]
  return {
    tool: name,
    command: truncate(cleanRaw(commandText(name, args), doRedact), 500),
    cwd: typeof args?.cwd === 'string' ? args.cwd : null,
    ok: step.ok === true,
    exitCode: exitCode === undefined ? null : Number(exitCode),
    timedOut,
    port: port ? Number(port) : null,
    summary: truncate(clean(summary, doRedact, 400), 400),
    outputTail: output.length > 900 ? output.slice(-900) : output,
    at,
    durationMs: step.durationMs ?? null
  }
}

function tagsOf(run) {
  const tags = new Set()
  tags.add(`mode:${run.mode ?? 'unknown'}`)
  if (run.model) tags.add('model')
  if (run.steps.some((step) => step.name.startsWith('mcp__'))) tags.add('mcp')
  if (run.steps.some((step) => step.name === 'web_search' || step.name === 'fetch_url')) tags.add('web')
  if (run.steps.some((step) => step.name === 'draw_figure')) tags.add('figure')
  if (run.files.length > 0) tags.add('files')
  if (run.commands.length > 0) tags.add('commands')
  if (run.notices.some((notice) => /повтор|429|5\d\d/i.test(notice.text))) tags.add('retries')
  if (run.commands.some((command) => command.timedOut)) tags.add('timeout')
  if (run.error) tags.add('error')
  if (run.usage?.contextTokens >= 100_000) tags.add('context')
  return [...tags]
}

function noticeAt(text, startedAt, endedAt) {
  return endedAt && endedAt > startedAt ? endedAt : startedAt
}

export function parseExchange(report, { file, doRedact = true, now = Date.now() } = {}) {
  if (!report || typeof report !== 'object') return null
  const requestId =
    typeof report.requestId === 'string' && report.requestId.length > 0
      ? report.requestId
      : basename(String(file ?? 'exchange'), '.json')
  let startedAt = Number(report.startedAt)
  if (!Number.isFinite(startedAt) || startedAt <= 0) startedAt = now
  let durationMs = Number(report.durationMs)
  if (!Number.isFinite(durationMs) || durationMs < 0) durationMs = 0
  const endedAt = durationMs > 0 ? startedAt + durationMs : startedAt

  const rawSteps = Array.isArray(report.steps) ? report.steps : []
  const span = durationMs > 0 ? durationMs : rawSteps.length * 2_000
  const steps = rawSteps.map((step, index) => {
    const name = typeof step?.name === 'string' ? step.name : 'unknown'
    const { args, argsText } = sanitizeArgs(name, step?.args, doRedact)
    const at = startedAt + Math.round((span * (index + 1)) / (rawSteps.length + 1))
    return {
      index,
      callId: typeof step?.callId === 'string' ? step.callId : `${name}:${index}`,
      step: step?.step ?? index + 1,
      name,
      args,
      argsText,
      ok: step?.ok === true ? true : step?.ok === false ? false : null,
      summary: clean(step?.summary ?? '', doRedact, 500),
      detail: clean(step?.detail ?? '', doRedact, DETAIL_LIMIT),
      warnings: Array.isArray(step?.warnings)
        ? step.warnings.filter((item) => typeof item === 'string').slice(0, 8).map((item) => clean(item, doRedact, 300))
        : [],
      metaKind: typeof step?.metaKind === 'string' ? step.metaKind : null,
      startedAt: at,
      endedAt: at,
      durationMs: null
    }
  })

  const files = steps.flatMap((step) => extractFiles(step.name, step.args, step.ok, step.endedAt))
  const commands = steps
    .map((step) => extractCommand(step.name, step.args, step, step.startedAt, doRedact))
    .filter(Boolean)

  const notices = (Array.isArray(report.notices) ? report.notices : [])
    .filter((text) => typeof text === 'string')
    .map((text) => {
      const cleanText = clean(text, doRedact, 600)
      const { kind, severity } = classifyNotice({ text: cleanText })
      return { text: cleanText, kind, severity, at: noticeAt(cleanText, startedAt, endedAt) }
    })

  const approvals = (Array.isArray(report.approvals) ? report.approvals : [])
    .filter((text) => typeof text === 'string')
    .map((text) => {
      const cleanText = clean(text, doRedact, 500)
      const match = /^(\S+)\s+\((\w+)\):\s*([\s\S]*)$/.exec(cleanText)
      return match
        ? { tool: match[1], risk: match[2], preview: truncate(match[3], 400) }
        : { tool: 'unknown', risk: 'unknown', preview: cleanText }
    })

  const usage = report.usage && typeof report.usage === 'object'
    ? {
        promptTokens: Number(report.usage.promptTokens) || 0,
        completionTokens: Number(report.usage.completionTokens) || 0,
        reasoningTokens: Number(report.usage.reasoningTokens) || 0,
        contextTokens: Number(report.usage.contextTokens) || 0,
        steps: Number(report.usage.steps) || 0,
        saved: report.usage.saved ?? null
      }
    : null

  const answer = clean(report.answer ?? '', doRedact, ANSWER_LIMIT)
  const run = {
    id: requestId,
    requestId,
    source: 'exchange',
    live: false,
    status: report.error ? 'error' : steps.some((step) => step.ok === null) ? 'incomplete' : 'ok',
    startedAt,
    endedAt: durationMs > 0 ? endedAt : null,
    durationMs: durationMs > 0 ? durationMs : null,
    mode: typeof report.mode === 'string' ? report.mode : 'unknown',
    model: typeof report.model === 'string' ? report.model : null,
    provider: typeof report.provider === 'string' ? report.provider : null,
    baseUrlHost: safeUrlHost(report.baseUrl),
    user: clean(report.user ?? '', doRedact, TEXT_LIMIT),
    answer,
    answerChars: String(report.answer ?? '').length,
    reasoningChars: Number(report.reasoningChars) || 0,
    systemPrompt: clean(report.systemPrompt ?? '', doRedact, TEXT_LIMIT),
    systemPromptChars: String(report.systemPrompt ?? '').length,
    historyMessages: Number(report.historyMessages) || 0,
    steps,
    files,
    commands,
    notices,
    approvals,
    todos: Array.isArray(report.todos) ? report.todos.slice(0, 40) : [],
    usage,
    error: report.error ? clean(report.error, doRedact, 2_000) : null,
    frames: [],
    tags: [],
    lastEventAt: durationMs > 0 ? endedAt : startedAt
  }
  run.counts = countRun(run)
  run.tags = tagsOf(run)
  return run
}

function eventBase(run, suffix) {
  return `ex:${run.id}:${suffix}`
}

function publishExchangeEvents(store, run) {
  const when = run.startedAt
  store.addEvent({
    id: eventBase(run, 'start'),
    at: when,
    runId: run.id,
    kind: 'run-start',
    level: 'info',
    title: firstLine(run.user, 160) || 'Запуск агента',
    detail: `${run.mode} · ${run.model ?? 'модель не указана'} · ${run.steps.length} шаг(ов)`,
    approx: true
  })
  run.steps.forEach((step) => {
    store.addEvent({
      id: eventBase(run, `step:${step.index}:start`),
      at: step.startedAt,
      runId: run.id,
      kind: 'step-start',
      level: 'info',
      title: step.name,
      detail: truncate(step.argsText ?? '', 400),
      approx: true
    })
    store.addEvent({
      id: eventBase(run, `step:${step.index}:end`),
      at: step.endedAt,
      runId: run.id,
      kind: 'step-end',
      level: step.ok === false ? 'error' : step.ok === true ? 'success' : 'warning',
      title: step.name,
      detail: truncate(step.summary ?? '', 400),
      approx: true
    })
    if (step.durationMs) {
      // Only live steps have a real duration; file-based steps are marked approx.
    }
  })
  run.files.forEach((file, index) => {
    store.addEvent({
      id: eventBase(run, `file:${index}`),
      at: file.at ?? when,
      runId: run.id,
      kind: 'file',
      level: file.ok === false ? 'error' : 'info',
      title: `${file.action} · ${file.path}`,
      detail: file.from ? `${file.from} → ${file.path}` : '',
      approx: true
    })
  })
  run.commands.forEach((command, index) => {
    store.addEvent({
      id: eventBase(run, `command:${index}`),
      at: command.at ?? when,
      runId: run.id,
      kind: 'command',
      level: command.ok ? 'success' : 'error',
      title: truncate(command.command, 160),
      detail: truncate(command.outputTail ?? '', 600),
      approx: true
    })
  })
  run.notices.forEach((notice, index) => {
    store.addEvent({
      id: eventBase(run, `notice:${index}`),
      at: notice.at ?? when,
      runId: run.id,
      kind: 'notice',
      level: notice.severity === 'critical' ? 'error' : notice.severity === 'warning' ? 'warning' : 'info',
      title: truncate(notice.text, 200),
      detail: notice.text,
      approx: true
    })
  })
  if (run.error) {
    store.addEvent({
      id: eventBase(run, 'error'),
      at: run.endedAt ?? when,
      runId: run.id,
      kind: 'error',
      level: 'error',
      title: 'Ошибка запуска',
      detail: run.error
    })
  }
  store.addEvent({
    id: eventBase(run, 'end'),
    at: run.endedAt ?? when,
    runId: run.id,
    kind: 'run-end',
    level: run.status === 'error' ? 'error' : run.status === 'incomplete' ? 'warning' : 'success',
    title: `Завершено · ${run.steps.length} шаг(ов)`,
    detail: run.usage
      ? `prompt ${run.usage.promptTokens}, completion ${run.usage.completionTokens}, steps ${run.usage.steps}`
      : '',
    approx: true
  })
}

export async function ingestExchangeFiles(store, { userData, doRedact = true, retention, now = Date.now() } = {}) {
  const summary = { newRuns: 0, updatedRuns: 0, events: 0, errors: [], files: 0 }
  if (!userData) return summary
  const files = await listExchangeFiles(userData)
  summary.files = files.length
  for (const file of files) {
    const key = `ex:${file.name}`
    const seen = store.meta.ingested?.[key]
    if (seen && seen.size === file.size && seen.mtimeMs === file.mtimeMs) continue
    let report = null
    try {
      report = JSON.parse(await fs.readFile(file.path, 'utf8'))
    } catch (error) {
      summary.errors.push(`${file.name}: ${error.message}`)
      store.meta.ingested[key] = { size: file.size, mtimeMs: file.mtimeMs, runId: null, at: now, error: true }
      store.addEvent({
        id: `scan-error:${hash(file.name, 10)}:${file.size}`,
        at: now,
        kind: 'scan-error',
        level: 'error',
        title: `Не удалось прочитать ${file.name}`,
        detail: error.message
      })
      continue
    }
    const parsed = parseExchange(report, { file: file.path, doRedact, now: file.mtimeMs || now })
    if (!parsed) {
      summary.errors.push(`${file.name}: пустой отчёт`)
      store.meta.ingested[key] = { size: file.size, mtimeMs: file.mtimeMs, runId: null, at: now, error: true }
      continue
    }
    // A request id can be reused only in an old build; a distant start time is a new run.
    const existingByRequest = store.findRunByRequestId(parsed.requestId)
    if (existingByRequest && Math.abs((existingByRequest.startedAt ?? 0) - parsed.startedAt) > 10 * 60_000) {
      parsed.id = `${parsed.requestId}-${parsed.startedAt}`
    }
    parsed.archiveFile = await archiveExchange(report, file.path, parsed.id, parsed.startedAt, retention)
    const result = store.upsertRun(parsed)
    summary[result.created ? 'newRuns' : 'updatedRuns'] += 1
    publishExchangeEvents(store, result.run)
    store.meta.ingested[key] = {
      size: file.size,
      mtimeMs: file.mtimeMs,
      runId: result.run.id,
      at: now
    }
  }

  // Archived exchanges survive the IDE's 40-report window: rebuild from them too.
  const dir = join(ARCHIVE_DIR, 'exchanges')
  try {
    const names = await fs.readdir(dir)
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const key = `ar:${name}`
      if (store.meta.ingested?.[key]) continue
      const path = join(dir, name)
      const stat = await fs.stat(path).catch(() => null)
      if (!stat?.isFile()) continue
      const report = safeJson(await fs.readFile(path, 'utf8').catch(() => ''), null)
      const parsed = report ? parseExchange(report, { file: path, doRedact, now: stat.mtimeMs }) : null
      if (!parsed) continue
      parsed.archiveFile = relative(SNITCH_ROOT, path)
      const result = store.upsertRun(parsed)
      summary[result.created ? 'newRuns' : 'updatedRuns'] += 1
      publishExchangeEvents(store, result.run)
      store.meta.ingested[key] = { size: stat.size, mtimeMs: stat.mtimeMs, runId: result.run.id, at: now }
    }
  } catch {
    // No archive yet.
  }
  return summary
}

export async function ingestLog(store, { userData, logFile = null, now = Date.now() } = {}) {
  const summary = { lines: 0, errors: 0, warnings: 0, file: logFile }
  if (!logFile) return summary
  let stat = null
  try {
    stat = await fs.stat(logFile)
  } catch {
    return summary
  }
  let offset = Number(store.meta.logOffset) || 0
  if (stat.size < offset) offset = 0
  if (stat.size === offset) return summary
  const handle = await fs.open(logFile, 'r')
  let text = ''
  try {
    const length = stat.size - offset
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, offset)
    text = buffer.toString('utf8')
  } finally {
    await handle.close()
  }
  // Only complete lines are processed; a half-written last line stays for the
  // next scan. The offset advances by the exact bytes consumed.
  const lastNewline = text.lastIndexOf('\n')
  const complete = lastNewline >= 0 ? text.slice(0, lastNewline + 1) : ''
  const lines = complete.split(/\r?\n/)
  lines.pop()
  for (const line of lines) {
    if (line.trim().length === 0) continue
    summary.lines += 1
    const match = /^\[([^\]]+)\]\s+(error|warn|info|debug):\s*([\s\S]*)$/.exec(line)
    if (!match) continue
    const at = Date.parse(match[1]) || now
    const level = match[2]
    const message = truncate(cleanRaw(match[3], true), 4_000)
    const kind = level === 'error' ? 'log-error' : level === 'warn' ? 'log-warn' : 'log'
    store.addEvent({
      id: `log:${level}:${hash(message, 10)}:${Math.floor(at / 60_000)}`,
      at,
      kind,
      level: level === 'error' ? 'error' : level === 'warn' ? 'warning' : 'info',
      title: truncate(message, 200),
      detail: message
    })
    if (level === 'error' || level === 'warn') {
      if (level === 'error') summary.errors += 1
      else summary.warnings += 1
      store.addIncident(
        makeIncident({
          kind: 'log-error',
          severity: level === 'error' ? 'critical' : 'warning',
          title: truncate(message, 200),
          detail: message,
          at,
          evidence: [`строка лога: ${new Date(at).toLocaleString('ru-RU')}`],
          fingerprintExtra: `${level}:${message}`
        })
      )
    }
  }
  const processedBytes = Buffer.byteLength(complete, 'utf8')
  store.setMeta({ logOffset: offset + processedBytes, logFile, logFileSize: stat.size })
  return summary
}

function frameMeta(name) {
  const match = /^(\d{10,})-([a-zA-Z0-9]+)-(.+)\.jpe?g$/i.exec(name)
  if (!match) return null
  return {
    file: name,
    at: Number(match[1]),
    requestIdPrefix: match[2],
    tool: match[3]
  }
}

export async function ingestFrames(store, { userData, now = Date.now() } = {}) {
  const dir = framesDir(userData)
  const summary = { attached: 0, orphans: 0 }
  if (!dir) return summary
  let names = []
  try {
    names = await fs.readdir(dir)
  } catch {
    return summary
  }
  const seen = store.meta.framesSeen ?? {}
  const runs = store.listRuns()
  for (const name of names) {
    if (!/\.jpe?g$/i.test(name) || seen[name]) continue
    const meta = frameMeta(name)
    store.meta.framesSeen[name] = true
    if (!meta) continue
    const candidates = runs.filter((run) => run.requestId?.startsWith(meta.requestIdPrefix))
    const run =
      candidates.sort(
        (a, b) => Math.abs((a.startedAt ?? 0) - meta.at) - Math.abs((b.startedAt ?? 0) - meta.at)
      )[0] ?? null
    if (!run) {
      summary.orphans += 1
      continue
    }
    const frame = { ...meta, requestId: run.requestId }
    const result = store.upsertRun({ ...run, frames: [...(run.frames ?? []), frame] })
    store.addEvent({
      id: `frame:${name}`,
      at: meta.at,
      runId: run.id,
      kind: 'frame',
      level: 'info',
      title: `Кадр: ${meta.tool}`,
      detail: name
    })
    if (result.run) summary.attached += 1
  }
  return summary
}

export async function ingestMcpConfig(store, { userData } = {}) {
  const file = mcpFile(userData)
  if (!file) return null
  const raw = safeJson(await fs.readFile(file, 'utf8').catch(() => ''), null)
  const map = raw?.mcpServers
  if (!map || typeof map !== 'object') return []
  const servers = Object.entries(map).map(([name, config]) => {
    let urlHost = null
    try {
      urlHost = config?.url ? new URL(config.url).host : null
    } catch {
      urlHost = null
    }
    return {
      name,
      transport: config?.transport ?? (config?.url ? 'http' : 'stdio'),
      enabled: config?.enabled !== false,
      trusted: config?.trusted === true,
      command: typeof config?.command === 'string' ? basename(config.command) : null,
      argsCount: Array.isArray(config?.args) ? config.args.length : 0,
      envKeys: config?.env && typeof config.env === 'object' ? Object.keys(config.env) : [],
      urlHost,
      timeoutMs: config?.timeoutMs ?? null,
      defaultRisk: config?.defaultRisk ?? null,
      disabledTools: Array.isArray(config?.disabledTools) ? config.disabledTools.length : 0
    }
  })
  store.setMeta({ mcpServers: servers })
  return servers
}

export async function ingestModelMemory(store, { userData } = {}) {
  const file = modelMemoryFile(userData)
  if (!file) return null
  const raw = safeJson(await fs.readFile(file, 'utf8').catch(() => ''), null)
  if (!raw || typeof raw !== 'object') return null
  const entries = Object.entries(raw.entries ?? {})
    .map(([key, value]) => ({
      key,
      loops: Number(value?.loops) || 0,
      level: value?.level ?? null,
      at: Number(value?.at) || 0
    }))
    .sort((a, b) => b.loops - a.loops || b.at - a.at)
    .slice(0, 50)
  const weak = Object.entries(raw.weak ?? {})
    .map(([key, value]) => ({ key, fails: Number(value?.fails) || 0, at: Number(value?.at) || 0 }))
    .sort((a, b) => b.fails - a.fails || b.at - a.at)
    .slice(0, 50)
  store.setMeta({ modelMemory: { entries, weak } })
  return { entries, weak }
}

export async function ingestSettings(store, { userData, workspace } = {}) {
  const settings = await readAppSettings(userData)
  const detected = await detectWorkspace(userData, workspace)
  store.setMeta({
    settings,
    workspace: detected,
    sources: {
      userData,
      workspace: detected,
      exchangeDir: exchangesDir(userData),
      framesDir: framesDir(userData)
    }
  })
  return settings
}

export async function collectSources(store, options = {}) {
  const started = Date.now()
  const { userData, workspace, doRedact = true, retention } = options
  await ingestSettings(store, { userData, workspace })
  const exchanges = await ingestExchangeFiles(store, { userData, doRedact, retention })
  const log = await ingestLog(store, { userData, logFile: options.logFile, now: started })
  const frames = await ingestFrames(store, { userData, now: started })
  const mcpServers = await ingestMcpConfig(store, { userData })
  await ingestModelMemory(store, { userData })
  const summary = {
    at: started,
    durationMs: Date.now() - started,
    newRuns: exchanges.newRuns,
    updatedRuns: exchanges.updatedRuns,
    logLines: log.lines,
    logErrors: log.errors,
    frames: frames.attached,
    exchangeFiles: exchanges.files,
    errors: exchanges.errors,
    mcpServers: mcpServers?.length ?? 0
  }
  store.setMeta({ lastScan: summary })
  return summary
}
