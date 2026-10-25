import { classifyNotice, makeIncident, recordRunIncidents } from './analyze.mjs'
import { extractCommand, extractFiles, sanitizeArgs } from './ingest.mjs'
import { redact, redactDeep, stripPayloads } from './redact.mjs'
import { countRun } from './store.mjs'
import { firstLine, hash, truncate } from './util.mjs'

const LIVE_WINDOW_MS = 10 * 60_000

function clean(text, doRedact, limit = 2_000) {
  const value = truncate(stripPayloads(String(text ?? '')), limit)
  return doRedact ? redact(value) : value
}

export function noticeText(event) {
  switch (event.kind) {
    case 'rate-limit-retry':
      return `Ограничение частоты (429): повтор ${event.attempt}/${event.maxAttempts} через ${event.seconds} с.`
    case 'server-retry':
      return `Ошибка сервера: повтор ${event.attempt}/${event.maxAttempts} через ${event.seconds} с.`
    case 'text-call-fallback':
      return `Модель вызвала инструмент текстом: ${(event.tools ?? []).join(', ')}.`
    case 'no-tool-calls':
      return 'Ответ звучит как отчёт о работе, но ни один инструмент не запускался.'
    case 'unverified-result':
      return 'Последний инструмент завершился ошибкой, а ответ сообщает об успехе.'
    case 'no-answer':
      return `Модель не написала ответ (${event.reason === 'step-limit' ? 'лимит шагов' : 'пустой шаг'}, шагов ${event.steps}).`
    case 'night-limit':
      return `Ночной автопилот остановлен: ${event.reason === 'tokens' ? 'лимит токенов' : 'лимит времени'}.`
    case 'param-dropped':
      return `Провайдер отверг параметр «${event.param}», запрос повторён без него.`
    case 'image-dropped':
      return 'Модель не принимает изображения — картинки вырезаны из запроса.'
    case 'thinking-loop':
      return `Зацикливание рассуждения: фрагмент повторился ${event.repeats} раз (всего ${event.loops}).`
    case 'thinking-lowered':
      return `Размышления снижены заранее: ${event.from} → ${event.to} (петель ${event.loops}).`
    default:
      return truncate(JSON.stringify(event), 300)
  }
}

function summarizeMeta(meta, doRedact) {
  if (!meta || typeof meta !== 'object') return null
  const kind = typeof meta.kind === 'string' ? meta.kind : 'other'
  switch (kind) {
    case 'image':
      return {
        kind,
        alt: clean(meta.alt, doRedact, 200),
        caption: clean(meta.caption, doRedact, 200),
        bytes: meta.bytes ?? null,
        width: meta.width ?? null,
        height: meta.height ?? null
      }
    case 'figure':
      return {
        kind,
        title: clean(meta.title, doRedact, 160),
        results: Array.isArray(meta.results) ? meta.results.slice(0, 8) : [],
        warnings: Array.isArray(meta.warnings) ? meta.warnings.slice(0, 5) : []
      }
    case 'diff':
      return {
        kind,
        file: meta.file ?? null,
        patch: clean(meta.patch, doRedact, 2_500)
      }
    case 'table':
      return {
        kind,
        title: clean(meta.title, doRedact, 160),
        columns: Array.isArray(meta.columns) ? meta.columns.slice(0, 12) : [],
        rows: Array.isArray(meta.rows) ? meta.rows.slice(0, 5) : []
      }
    case 'diagram':
      return { kind, title: clean(meta.title, doRedact, 160), caption: clean(meta.caption, doRedact, 200) }
    case 'timelapse':
      return {
        kind,
        frames: Array.isArray(meta.frames) ? meta.frames.length : 0,
        intervalSec: meta.intervalSec ?? null
      }
    case 'websearch':
      return {
        kind,
        query: clean(meta.query, doRedact, 200),
        sources: Array.isArray(meta.sources)
          ? meta.sources.slice(0, 8).map((source) => ({
              n: source.n,
              title: clean(source.title, doRedact, 160),
              url: source.url
            }))
          : []
      }
    default:
      return redactDeep({ kind, text: truncate(JSON.stringify(meta), 1_200) }, 0)
  }
}

function newLiveRun(store, requestId, at, options) {
  const settings = store.meta.settings
  const run = {
    id: requestId,
    requestId,
    source: 'live',
    live: true,
    status: 'running',
    startedAt: at,
    endedAt: null,
    durationMs: null,
    mode: 'live',
    model: settings?.model ?? null,
    provider: settings?.providerName ?? null,
    baseUrlHost: settings?.baseUrl ?? null,
    user: '',
    answer: '',
    answerChars: 0,
    reasoningChars: 0,
    systemPrompt: '',
    systemPromptChars: 0,
    historyMessages: 0,
    steps: [],
    files: [],
    commands: [],
    notices: [],
    approvals: [],
    todos: [],
    usage: null,
    error: null,
    frames: [],
    tags: ['live'],
    lastEventAt: at,
    stream: { deltaChars: 0, reasoningChars: 0, preview: '', at }
  }
  run.counts = countRun(run)
  return run
}

function findLiveRun(store, requestId, at) {
  const runs = store.listRuns()
  return (
    runs.find(
      (run) =>
        run.requestId === requestId &&
        (run.live || (run.endedAt && at - run.endedAt < LIVE_WINDOW_MS))
    ) ?? null
  )
}

function addStepEvent(store, run, step, phase, level, detail, at) {
  store.addEvent({
    id: `live:${run.id}:${step.callId}:${phase}`,
    at,
    runId: run.id,
    kind: phase === 'start' ? 'step-start' : 'step-end',
    level,
    title: step.name,
    detail: truncate(detail ?? '', 500)
  })
}

export function handleChatEvent(store, event, { at = Date.now(), doRedact = true } = {}) {
  if (!event || typeof event !== 'object' || typeof event.requestId !== 'string') return null
  const requestId = event.requestId
  let run = findLiveRun(store, requestId, at)
  if (run && !run.live && run.status !== 'running') {
    // The exchange is already on disk and finished: late probe events must not
    // rewrite its result.
    if (!['done', 'error'].includes(event.type)) return { run, ignored: true }
  }
  if (!run) run = newLiveRun(store, requestId, at, { doRedact })
  run.lastEventAt = Math.max(run.lastEventAt ?? 0, at)

  switch (event.type) {
    case 'delta': {
      const text = String(event.text ?? '')
      run.stream = run.stream ?? { deltaChars: 0, reasoningChars: 0, preview: '', at }
      run.stream.deltaChars += text.length
      run.stream.preview = truncate(`${run.stream.preview ?? ''}${text}`, 600)
      run.stream.at = at
      run.answerChars += text.length
      break
    }
    case 'reasoning': {
      const text = String(event.text ?? '')
      run.stream = run.stream ?? { deltaChars: 0, reasoningChars: 0, preview: '', at }
      run.stream.reasoningChars += text.length
      run.stream.at = at
      run.reasoningChars += text.length
      break
    }
    case 'reasoning-rewind':
    case 'text-rewind': {
      const length = Math.max(0, Number(event.length) || 0)
      if (event.type === 'text-rewind') {
        run.answerChars = Math.max(0, run.answerChars - length)
        run.stream.deltaChars = Math.max(0, (run.stream?.deltaChars ?? 0) - length)
      } else {
        run.reasoningChars = Math.max(0, run.reasoningChars - length)
        run.stream.reasoningChars = Math.max(0, (run.stream?.reasoningChars ?? 0) - length)
      }
      break
    }
    case 'tool-start': {
      const callId = event.callId || `call-${run.steps.length + 1}`
      if (run.steps.some((step) => step.callId === callId)) break
      const name = String(event.name ?? 'unknown')
      const { args, argsText } = sanitizeArgs(name, event.args, doRedact)
      const step = {
        index: run.steps.length,
        callId,
        step: event.step ?? run.steps.length + 1,
        name,
        args,
        argsText,
        ok: null,
        summary: '',
        detail: '',
        warnings: [],
        metaKind: null,
        startedAt: at,
        endedAt: null,
        durationMs: null
      }
      run.steps.push(step)
      addStepEvent(store, run, step, 'start', 'info', argsText, at)
      break
    }
    case 'tool-meta': {
      const step = [...run.steps].reverse().find((item) => item.callId === event.callId)
      if (step) {
        const meta = summarizeMeta(event.meta, doRedact)
        step.meta = meta
        step.metaKind = meta?.kind ?? step.metaKind
      }
      break
    }
    case 'tool-result': {
      const step =
        [...run.steps].reverse().find((item) => item.callId === event.callId && item.ok == null) ??
        [...run.steps].reverse().find((item) => item.callId === event.callId)
      if (!step) break
      step.ok = event.ok === true
      step.summary = clean(event.summary, doRedact, 500)
      step.detail = clean(event.detail, doRedact, 2_500)
      step.endedAt = at
      step.durationMs = Math.max(0, at - (step.startedAt ?? at))
      const meta = summarizeMeta(event.meta, doRedact)
      if (meta) {
        step.meta = meta
        step.metaKind = meta.kind
      }
      const files = extractFiles(step.name, step.args, step.ok, step.startedAt)
      for (const file of files) {
        if (!run.files.some((item) => item.path === file.path && item.action === file.action && item.at === file.at)) {
          run.files.push(file)
        }
      }
      const command = extractCommand(
        step.name,
        step.args,
        { ok: step.ok, summary: step.summary, detail: step.detail, durationMs: step.durationMs },
        step.startedAt,
        doRedact
      )
      if (command && !run.commands.some((item) => item.command === command.command && item.at === command.at)) {
        run.commands.push(command)
      }
      addStepEvent(
        store,
        run,
        step,
        'end',
        step.ok ? 'success' : 'error',
        step.summary,
        at
      )
      break
    }
    case 'tool-approval': {
      const request = event.request ?? {}
      const approval = {
        tool: clean(request.toolName, doRedact, 80),
        risk: request.risk ?? 'unknown',
        preview: clean(request.preview, doRedact, 400),
        at
      }
      run.approvals.push(approval)
      store.addEvent({
        id: `live:${run.id}:approval:${hash(`${approval.tool}:${approval.preview}`, 8)}`,
        at,
        runId: run.id,
        kind: 'approval',
        level: 'warning',
        title: `Нужно подтверждение: ${approval.tool}`,
        detail: approval.preview
      })
      break
    }
    case 'notice': {
      const text = noticeText(event)
      const { kind, severity } = classifyNotice({ kind: event.kind, text })
      const notice = {
        kind: event.kind ?? kind,
        text,
        severity,
        at,
        event: redactDeep(event, 0)
      }
      run.notices.push(notice)
      store.addEvent({
        id: `live:${run.id}:notice:${run.notices.length - 1}`,
        at,
        runId: run.id,
        kind: 'notice',
        level: severity === 'critical' ? 'error' : severity === 'warning' ? 'warning' : 'info',
        title: truncate(text, 200),
        detail: text
      })
      break
    }
    case 'steer': {
      run.steered = [...(run.steered ?? []), { text: clean(event.text, doRedact, 1_000), at }]
      store.addEvent({
        id: `live:${run.id}:steer:${run.steered.length - 1}`,
        at,
        runId: run.id,
        kind: 'steer',
        level: 'info',
        title: 'Пользователь вмешался',
        detail: clean(event.text, doRedact, 600)
      })
      break
    }
    case 'paused': {
      run.paused = event.paused === true
      store.addEvent({
        id: `live:${run.id}:paused:${event.paused ? 1 : 0}:${Math.floor(at / 1000)}`,
        at,
        runId: run.id,
        kind: 'pause',
        level: 'info',
        title: event.paused ? 'Пауза' : 'Продолжение'
      })
      break
    }
    case 'todos': {
      run.todos = Array.isArray(event.todos) ? event.todos.slice(0, 40) : []
      break
    }
    case 'processes': {
      store.setMeta({ servers: event.processes ?? [] })
      store.addEvent({
        id: `live:${run.id}:processes:${hash(JSON.stringify(event.processes ?? []), 8)}`,
        at,
        runId: run.id,
        kind: 'processes',
        level: 'info',
        title: 'Фоновые процессы обновлены',
        detail: (event.processes ?? [])
          .map((item) => `${item.running ? '●' : '○'} ${item.command}${item.port ? ` :${item.port}` : ''}`)
          .join('\n')
      })
      break
    }
    case 'user-question': {
      store.addEvent({
        id: `live:${run.id}:question:${hash(event.questionId ?? event.question, 8)}`,
        at,
        runId: run.id,
        kind: 'question',
        level: 'info',
        title: 'Вопрос пользователю',
        detail: clean(event.question, doRedact, 600)
      })
      break
    }
    case 'run-snapshot': {
      run.snapshot = event.name
      store.addEvent({
        id: `live:${run.id}:snapshot`,
        at,
        runId: run.id,
        kind: 'snapshot',
        level: 'info',
        title: `Снапшот проекта: ${event.name}`
      })
      break
    }
    case 'timelapse': {
      store.addEvent({
        id: `live:${run.id}:timelapse`,
        at,
        runId: run.id,
        kind: 'timelapse',
        level: 'info',
        title: `Таймлапс: ${(event.frames ?? []).length} кадров`,
        detail: `интервал ${event.intervalSec ?? '?'} с`
      })
      break
    }
    case 'done': {
      run.usage = {
        promptTokens: Number(event.promptTokens) || 0,
        completionTokens: Number(event.completionTokens) || 0,
        reasoningTokens: Number(event.reasoningTokens) || 0,
        contextTokens: Number(event.contextTokens) || 0,
        steps: Number(event.steps) || 0,
        saved: event.saved ?? null
      }
      run.endedAt = at
      run.durationMs = Math.max(0, at - (run.startedAt ?? at))
      run.live = false
      run.status = run.error ? 'error' : 'ok'
      store.addEvent({
        id: `live:${run.id}:end`,
        at,
        runId: run.id,
        kind: 'run-end',
        level: run.status === 'error' ? 'error' : 'success',
        title: `Завершено · ${run.steps.length} шаг(ов)`,
        detail: `prompt ${run.usage.promptTokens}, completion ${run.usage.completionTokens}`
      })
      break
    }
    case 'error': {
      run.error = clean(event.message, doRedact, 2_000)
      run.endedAt = at
      run.durationMs = Math.max(0, at - (run.startedAt ?? at))
      run.live = false
      run.status = 'error'
      store.addEvent({
        id: `live:${run.id}:error`,
        at,
        runId: run.id,
        kind: 'error',
        level: 'error',
        title: 'Ошибка запуска',
        detail: run.error
      })
      break
    }
    default:
      break
  }

  run.counts = countRun(run)
  const result = store.upsertRun(run)
  if (['tool-result', 'notice', 'done', 'error'].includes(event.type)) {
    recordRunIncidents(store, result.run)
  }
  return { run: result.run }
}

export function applyProbePayload(store, payload, { doRedact = true, terminalFeed = true, port = null } = {}) {
  if (!payload || typeof payload !== 'object') return null
  const at = Number(payload.at) || Date.now()
  const kind = String(payload.kind ?? '')
  store.setProbe({ lastSeen: at, attached: true })

  switch (kind) {
    case 'probe-ready':
    case 'hello': {
      store.setProbe({
        attached: true,
        lastSeen: at,
        port,
        target: payload.href ?? null,
        userAgent: payload.userAgent ?? null,
        version: payload.version ?? null,
        since: at
      })
      store.addEvent({
        id: `probe:${Math.floor(at / 60_000)}`,
        at,
        kind: 'probe',
        level: 'success',
        title: 'Живой зонд подключён',
        detail: payload.href ?? ''
      })
      return { ok: true }
    }
    case 'heartbeat':
      return { ok: true }
    case 'chat-event': {
      const result = handleChatEvent(store, payload.event, { at, doRedact })
      return { ok: true, ...result }
    }
    case 'chat-aggregate': {
      const run = findLiveRun(store, payload.requestId, at)
      if (!run) return { ok: true }
      run.stream = {
        deltaChars: Number(payload.deltaChars) || 0,
        reasoningChars: Number(payload.reasoningChars) || 0,
        preview: clean(payload.preview ?? '', doRedact, 600),
        at
      }
      run.answerChars = Math.max(run.answerChars, run.stream.deltaChars)
      run.reasoningChars = Math.max(run.reasoningChars, run.stream.reasoningChars)
      run.lastEventAt = at
      store.upsertRun(run)
      return { ok: true }
    }
    case 'chat-context': {
      const runs = store.listRuns()
      const run = runs.find((item) => item.requestId === payload.requestId) ?? null
      if (!run) return { ok: true }
      if (!run.user && typeof payload.user === 'string') run.user = clean(payload.user, doRedact, 4_000)
      if (payload.mode && run.mode === 'live') run.mode = String(payload.mode)
      if (typeof payload.title === 'string') run.title = clean(payload.title, doRedact, 160)
      if (payload.thinking && !run.thinking) run.thinking = String(payload.thinking)
      store.upsertRun(run)
      return { ok: true }
    }
    case 'workspace-changed': {
      store.addEvent({
        id: `workspace:${hash((payload.dirs ?? []).join('|'), 8)}:${Math.floor(at / 2_000)}`,
        at,
        kind: 'workspace',
        level: 'info',
        title: 'Файлы изменились',
        detail: (payload.dirs ?? []).slice(0, 12).join('\n')
      })
      return { ok: true }
    }
    case 'mcp': {
      const event = payload.event ?? {}
      const level =
        event.type === 'error' || event.type === 'stderr'
          ? 'warning'
          : event.type === 'ready'
            ? 'success'
            : 'info'
      store.addEvent({
        id: `mcp:${event.type}:${hash(JSON.stringify(event).slice(0, 400), 8)}:${Math.floor(at / 5_000)}`,
        at,
        kind: 'mcp',
        level,
        title: `MCP: ${event.type}${event.name ? ` · ${event.name}` : ''}`,
        detail:
          event.type === 'stderr'
            ? clean(event.line, doRedact, 600)
            : event.type === 'frame'
              ? clean(event.caption ?? '', doRedact, 300)
              : truncate(JSON.stringify(event), 800)
      })
      if (event.type === 'state') store.setMeta({ mcpRuntime: event.states ?? [] })
      return { ok: true }
    }
    case 'terminal': {
      if (!terminalFeed) return { ok: true }
      const text = clean(payload.text, doRedact, 2_000)
      if (!text.trim()) return { ok: true }
      store.addEvent({
        id: `terminal:${hash(text, 10)}:${Math.floor(at / 1_000)}`,
        at,
        kind: 'terminal',
        level: 'info',
        title: 'Терминал агента',
        detail: text
      })
      return { ok: true }
    }
    case 'servers': {
      const next = Array.isArray(payload.processes) ? payload.processes : []
      const previous = store.meta.servers ?? []
      const changed = JSON.stringify(previous) !== JSON.stringify(next)
      store.setMeta({ servers: next })
      if (changed) {
        store.addEvent({
          id: `servers:${hash(JSON.stringify(next), 8)}:${Math.floor(at / 5_000)}`,
          at,
          kind: 'servers',
          level: 'info',
          title: 'Фоновые процессы',
          detail: next
            .map((item) => `${item.running ? '●' : '○'} ${item.command}${item.port ? ` :${item.port}` : ''}`)
            .join('\n')
        })
      }
      return { ok: true }
    }
    case 'settings': {
      if (payload.settings && typeof payload.settings === 'object') {
        const settings = payload.settings
        store.setMeta({
          settings: {
            ...(store.meta.settings ?? {}),
            approvalMode: settings.approvalMode ?? store.meta.settings?.approvalMode,
            model: settings.model ?? store.meta.settings?.model,
            providerName: settings.providerName ?? store.meta.settings?.providerName,
            logLevel: settings.logLevel ?? store.meta.settings?.logLevel,
            uiLanguage: settings.uiLanguage ?? store.meta.settings?.uiLanguage
          }
        })
      }
      return { ok: true }
    }
    case 'renderer-error': {
      const message = clean(payload.message, doRedact, 2_000)
      const stack = clean(payload.stack, doRedact, 3_000)
      store.addEvent({
        id: `renderer-error:${hash(`${message}${stack}`, 10)}:${Math.floor(at / 60_000)}`,
        at,
        kind: 'renderer-error',
        level: 'error',
        title: truncate(message, 200),
        detail: stack || message
      })
      store.addIncident(
        makeIncident({
          kind: 'renderer-error',
          severity: 'critical',
          title: `Ошибка в окне: ${truncate(message, 160)}`,
          detail: stack || message,
          at,
          fingerprintExtra: `${message}:${Math.floor(at / 60_000)}`
        })
      )
      return { ok: true }
    }
    case 'console': {
      const message = clean(payload.text, doRedact, 2_000)
      const level = payload.level === 'error' ? 'error' : 'warning'
      store.addEvent({
        id: `console:${hash(message, 10)}:${Math.floor(at / 30_000)}`,
        at,
        kind: 'console',
        level,
        title: `Консоль: ${truncate(message, 160)}`,
        detail: `${payload.url ?? ''}${payload.line ? `:${payload.line}` : ''}\n${message}`
      })
      if (level === 'error') {
        store.addIncident(
          makeIncident({
            kind: 'renderer-error',
            severity: 'warning',
            title: `Ошибка консоли: ${truncate(message, 160)}`,
            detail: message,
            at,
            fingerprintExtra: `${message}:${Math.floor(at / 300_000)}`
          })
        )
      }
      return { ok: true }
    }
    case 'network': {
      const url = clean(payload.url, doRedact, 500)
      const status = payload.status ?? null
      const failed = payload.failed === true
      store.addEvent({
        id: `network:${hash(`${url}:${status ?? 'failed'}:${payload.method ?? ''}`, 10)}:${Math.floor(at / 60_000)}`,
        at,
        kind: 'network',
        level: 'warning',
        title: failed ? `Сеть: ${truncate(url, 160)}` : `HTTP ${status}: ${truncate(url, 160)}`,
        detail: `${payload.method ?? 'GET'} ${url}${status ? ` → ${status}` : ''}${
          payload.durationMs ? ` (${Math.round(payload.durationMs)} мс)` : ''
        }`
      })
      store.addIncident(
        makeIncident({
          kind: 'network-request',
          severity: 'warning',
          title: failed ? `Не удался запрос: ${truncate(url, 140)}` : `HTTP ${status}: ${truncate(url, 140)}`,
          detail: `${payload.method ?? 'GET'} ${url}`,
          at,
          fingerprintExtra: `${url}:${status ?? 'failed'}:${Math.floor(at / 300_000)}`
        })
      )
      return { ok: true }
    }
    case 'probe-lost': {
      store.setProbe({ attached: false, reason: payload.reason ?? 'зонд отключился' })
      return { ok: true }
    }
    default:
      return { ok: false, error: `unknown payload kind: ${kind}` }
  }
}
