import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { app } from 'electron'
import OpenAI from 'openai'
import type { ArenaContestant, ArenaEvent, ArenaStyle, ChatEvent } from '@shared/ipc'
import { runAgent, agentBusy, abortChat } from './agent'
import { createProjectSnapshot, restoreProjectSnapshot } from './tools-project'
import { activeProvider, getApiKey, getSettings, providerById } from './store'
import { THINKING_LEVELS } from '@shared/reasoning'
import { getWorkspaceRoot, IGNORED_NAMES } from './workspace'
import { stopAllBackground } from './proc'

/**
 * The Arena: several agent contestants solve the same task one after another,
 * each starting from the same clean base state, on its own model and with its
 * own creativity. After every run the workspace is rolled back, so the
 * contestants never contaminate each other. Tests score each result, a model
 * judge ranks them, and the human picks the champion whose snapshot is applied
 * to the workspace.
 */

const STYLE_TEMPERATURE: Record<ArenaStyle, number> = {
  careful: 0.15,
  balanced: 0.5,
  bold: 1.0
}

const TEST_TIMEOUT_MS = 240_000

interface ArenaRun {
  id: string
  task: string
  status: 'running' | 'ready' | 'error'
  activeId: number | null
  baseName: string
  contestants: Array<ArenaContestant & { snapshot: string }>
  judge?: { status: 'running' | 'done' | 'failed'; winnerId: number | null; reason: string }
  error?: string
  canceled: boolean
}

let arena: ArenaRun | null = null
let emit: ((event: ArenaEvent) => void) | null = null

export function arenaActive(): boolean {
  return arena !== null
}

function snapshotDirOf(workspaceRoot: string, snapshotName: string): string {
  return join(app.getPath('userData'), 'snapshots', basename(workspaceRoot), snapshotName)
}

function sendState(): void {
  if (!arena || !emit) return
  const { contestants, ...rest } = arena
  emit({
    kind: 'state',
    state: {
      ...rest,
      contestants: contestants.map(({ snapshot, ...visible }) => visible)
    }
  })
}

function sendChat(runId: string, event: ChatEvent): void {
  emit?.({ kind: 'chat', runId, event })
}

function ignoredNames(): Set<string> {
  return new Set([...IGNORED_NAMES, ...getSettings().files.excludeGlobs])
}

/**
 * Full reset to a snapshot: restore copies the files over, and everything a
 * contestant added on top has to go — otherwise the next contestant inherits
 * leftovers and this is not a fair race. Excluded folders (node_modules, .git,
 * …) are never touched.
 */
function resetToBase(workspaceRoot: string, baseName: string): void {
  restoreProjectSnapshot(workspaceRoot, baseName)
  const baseDir = snapshotDirOf(workspaceRoot, baseName)
  const keep = new Set(listRelative(baseDir))
  const ignored = ignoredNames()
  const prune = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.name === '.DS_Store') continue
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        prune(full, rel)
        try {
          if (readdirSync(full).length === 0) rmSync(full, { recursive: true, force: true })
        } catch {
          // A non-empty or locked directory stays; harmless.
        }
      } else if (!keep.has(rel)) {
        try {
          rmSync(full, { force: true })
        } catch {
          // A locked file stays; the next reset retries.
        }
      }
    }
  }
  prune(workspaceRoot, '')
}

function sameFile(a: string, b: string): boolean {
  try {
    return readFileSync(a).equals(readFileSync(b))
  } catch {
    return false
  }
}

/** Counts files that differ between the base state and a contestant's result. */
function diffAgainstBase(baseDir: string, contestDir: string): number {
  let changed = 0
  const walk = (dir: string, prefix: string, other: string, otherExists: boolean): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const full = join(dir, entry.name)
      const twin = join(other, entry.name)
      if (entry.isDirectory()) {
        if (otherExists && existsSync(twin)) walk(full, rel, twin, true)
        else changed += countFiles(full)
      } else if (!otherExists || !existsSync(twin)) {
        changed += 1
      } else if (!sameFile(full, twin)) {
        changed += 1
      }
    }
  }
  walk(baseDir, '', contestDir, true)
  // Files the contestant added (present in the result, absent in the base).
  const back = (dir: string, prefix: string, other: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const full = join(dir, entry.name)
      const twin = join(other, entry.name)
      if (entry.isDirectory()) back(full, rel, twin)
      else if (!existsSync(twin)) changed += 1
    }
  }
  back(contestDir, '', baseDir)
  return changed
}

function countFiles(dir: string): number {
  let n = 0
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) n += countFiles(join(dir, entry.name))
      else n += 1
    }
  } catch {
    // Unreadable trees count as nothing.
  }
  return n
}

function listRelative(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  const walk = (cur: string, prefix: string): void => {
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(join(cur, entry.name), rel)
      else out.push(rel)
    }
  }
  walk(dir, '')
  return out
}

/** Runs the project test script when there is one; anything else is a skip. */
function runTests(workspaceRoot: string): Promise<ArenaContestant['tests']> {
  return new Promise((resolve) => {
    const pkg = join(workspaceRoot, 'package.json')
    if (!existsSync(pkg)) return resolve('skipped')
    let script: string | undefined
    try {
      const parsed = JSON.parse(readFileSync(pkg, 'utf8')) as { scripts?: Record<string, string> }
      script = parsed.scripts?.test
    } catch {
      return resolve('skipped')
    }
    if (!script || /watch/i.test(script)) return resolve('skipped')
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    execFile(
      npm,
      ['test', '--silent'],
      { cwd: workspaceRoot, timeout: TEST_TIMEOUT_MS, windowsHide: true },
      (error) => resolve(error ? 'fail' : 'pass')
    )
  })
}

/** Changed files of a contestant against the base, as a short list for the judge. */
function changedFileList(baseDir: string, contestDir: string): string[] {
  const base = new Set(listRelative(baseDir))
  const lines: string[] = []
  for (const rel of listRelative(contestDir)) {
    if (!base.has(rel)) lines.push(`+ ${rel}`)
    else if (!sameFile(join(baseDir, rel.split('/').join(sep())), join(contestDir, rel.split('/').join(sep())))) {
      lines.push(`~ ${rel}`)
    }
  }
  for (const rel of base) {
    const twin = join(contestDir, rel.split('/').join(sep()))
    if (!existsSync(twin)) lines.push(`- ${rel}`)
  }
  return lines
}

function sep(): string {
  return process.platform === 'win32' ? '\\' : '/'
}

/** Real code of the changed files, capped, so the judge reviews the diff itself. */
function diffExcerpts(baseDir: string, contestDir: string): string {
  const parts: string[] = []
  let budget = 7000
  for (const mark of changedFileList(baseDir, contestDir).slice(0, 8)) {
    const rel = mark.slice(2)
    const twin = join(contestDir, rel.split('/').join(sep()))
    if (!existsSync(twin)) {
      parts.push(`=== ${rel} (deleted) ===`)
      continue
    }
    const head = readFileSync(twin, 'utf8').split('\n').slice(0, 60).join('\n')
    if (budget - head.length < 0) break
    budget -= head.length
    parts.push(`=== ${rel} ===\n${head}`)
  }
  return parts.join('\n')
}

/** The model judge: ranks the finished contestants; the human still decides. */
async function judgeRuns(task: string): Promise<void> {
  if (!arena || !arena.baseName) return
  arena.judge = { status: 'running', winnerId: null, reason: '' }
  sendState()
  const workspaceRoot = getWorkspaceRoot()
  try {
    const settings = getSettings()
    const provider = activeProvider(settings)
    const apiKey = getApiKey(provider.id)
    const model = provider.model
    if (!provider.baseUrl || !model || !apiKey) throw new Error('no-connection')
    const client = new OpenAI({ baseURL: provider.baseUrl, apiKey, maxRetries: 0 })
    const baseDir = snapshotDirOf(workspaceRoot ?? '', arena.baseName)
    const lines = arena.contestants
      .filter((c) => c.snapshot)
      .map((c) => {
        const contestDir = snapshotDirOf(workspaceRoot ?? '', c.snapshot)
        return `Кандидат #${c.id} (модель ${c.model}, температура ${c.temperature}, тесты: ${c.tests}, файлов изменено: ${c.files}):\nизменённые файлы: ${changedFileList(baseDir, contestDir).join(', ') || 'нет'}\nитоговое сообщение: ${c.summary.slice(-1500) || '(пусто)'}`
      })
    // The judge reads the actual changed code, not only the summaries: with no
    // eyes it can still tell a correct implementation from a bluff.
    const code = arena.contestants
      .filter((c) => c.snapshot)
      .map((c) => {
        const contestDir = snapshotDirOf(workspaceRoot ?? '', c.snapshot)
        return `--- Код кандидата #${c.id} ---\n${diffExcerpts(baseDir, contestDir) || '(нет изменений)'}`
      })
      .join('\n')
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Ты — судья турнира ИИ-агентов: старший архитектор, владеющий всеми инженерными скиллами (фронтенд, бэкенд, дизайн-системы, тестирование, безопасность). У тебя нет глаз — ты оцениваешь ТОЛЬКО по коду и структуре изменений: выполнены ли требования задачи, корректен ли код и запустится ли он, согласованы ли разметка и стили, не обманывает ли итоговое сообщение, соразмерен ли объём изменений задаче. Пройденные тесты кандидата весят больше всего. Ответь ТОЛЬКО JSON вида {"winner": <номер кандидата>, "reason": "<2-3 предложения по-русски: что именно у победителя лучше по коду>"'
        },
        { role: 'user', content: `Задача: ${task}\n\nСводки:\n\n${lines.join('\n\n')}\n\n${code}` }
      ]
    })
    const raw = completion.choices[0]?.message?.content ?? ''
    const match = raw.match(/\{[\s\S]*\}/)
    const parsed = match ? (JSON.parse(match[0]) as { winner?: number; reason?: string }) : null
    const winner = parsed?.winner
    arena.judge = {
      status: 'done',
      winnerId: typeof winner === 'number' ? winner : null,
      reason: parsed?.reason ?? raw.slice(0, 400)
    }
  } catch (error) {
    arena.judge = {
      status: 'failed',
      winnerId: null,
      reason: error instanceof Error ? error.message : String(error)
    }
  }
  sendState()
}

export async function startArena(
  task: string,
  attachments: import('@shared/attachments').AttachmentRef[],
  entrants: Array<{
    providerId: string
    model: string
    style: ArenaStyle
    temperature?: number
    thinking?: string
    topP?: number
    maxSteps?: number
    prompt?: string
  }>,
  forward: (event: ArenaEvent) => void
): Promise<{ ok: boolean; error?: string }> {
  if (arena) return { ok: false, error: 'arena-running' }
  if (agentBusy()) return { ok: false, error: 'agent-busy' }
  const workspaceRoot = getWorkspaceRoot()
  if (!workspaceRoot) return { ok: false, error: 'no-workspace' }
  const trimmed = task.trim()
  if (trimmed.length === 0) return { ok: false, error: 'empty-task' }
  if (entrants.length < 2) return { ok: false, error: 'need-two' }
  for (const entrant of entrants) {
    if (!providerById(entrant.providerId)) return { ok: false, error: 'unknown-provider' }
    if (!entrant.model.trim()) return { ok: false, error: 'no-model' }
    const thinking = entrant.thinking
    if (thinking !== undefined && !THINKING_LEVELS.includes(thinking as never)) {
      return { ok: false, error: 'bad-thinking' }
    }
    const temperature = entrant.temperature
    if (temperature !== undefined && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) {
      return { ok: false, error: 'bad-temperature' }
    }
    if (entrant.topP !== undefined && (!Number.isFinite(entrant.topP) || entrant.topP < 0.05 || entrant.topP > 1)) {
      return { ok: false, error: 'bad-topp' }
    }
    if (entrant.maxSteps !== undefined && (!Number.isFinite(entrant.maxSteps) || entrant.maxSteps < 1 || entrant.maxSteps > 500)) {
      return { ok: false, error: 'bad-steps' }
    }
    if (entrant.prompt !== undefined && entrant.prompt.length > 2000) {
      return { ok: false, error: 'bad-prompt' }
    }
  }

  // A leftover server from an earlier session would answer on the port a
  // contestant later picks and masquerade as their work.
  stopAllBackground()

  emit = forward
  const id = `arena-${Date.now().toString(36)}`
  arena = {
    id,
    task: trimmed,
    status: 'running',
    activeId: null,
    baseName: '',
    canceled: false,
    contestants: entrants.map((entrant, index) => ({
      id: index + 1,
      style: entrant.style,
      providerId: entrant.providerId,
      model: entrant.model,
      temperature:
        entrant.temperature !== undefined
          ? Math.min(2, Math.max(0, entrant.temperature))
          : STYLE_TEMPERATURE[entrant.style],
      thinking: (entrant.thinking as ArenaContestant['thinking'] | undefined) ?? 'off',
      topP: entrant.topP ?? 0,
      maxSteps: entrant.maxSteps ?? 0,
      prompt: entrant.prompt ?? '',
      status: 'pending',
      steps: 0,
      files: 0,
      tests: 'unknown',
      summary: '',
      snapshot: ''
    }))
  }
  sendState()

  const base = await createProjectSnapshot(workspaceRoot, new AbortController().signal)
  if (!base.ok) {
    arena.status = 'error'
    arena.error = base.error
    sendState()
    return { ok: false, error: base.error }
  }
  arena.baseName = base.name
  const baseDir = snapshotDirOf(workspaceRoot, base.name)

  const messages = [
    { role: 'user' as const, content: trimmed, attachments: attachments.length > 0 ? attachments : undefined }
  ]
  let abortedMidway = false

  try {
    for (const contestant of arena.contestants) {
      if (arena.canceled) {
        abortedMidway = true
        break
      }
      arena.activeId = contestant.id
      contestant.status = 'running'
      sendState()

      // Everyone starts from the very same base state.
      resetToBase(workspaceRoot, base.name)

      const runId = `${id}-c${contestant.id}`
      try {
        await runAgent(
          {
            requestId: runId,
            mode: 'agent',
            messages,
            context: {},
            night: true,
            arena: {
              providerId: contestant.providerId,
              model: contestant.model,
              temperature: contestant.temperature,
              thinking: contestant.thinking,
              topP: contestant.topP,
              maxSteps: contestant.maxSteps,
              prompt: contestant.prompt
            }
          },
          (event) => {
            if (event.type === 'tool-start') contestant.steps += 1
            if (event.type === 'delta') {
              contestant.summary = (contestant.summary + event.text).slice(-3000)
            }
            if (event.type === 'error') contestant.status = 'failed'
            sendChat(runId, event)
          },
          {
            // Night runs never ask; the stubs only exist for the type.
            requestApproval: async () => ({ decision: 'allow' }),
            askUser: async () => ''
          }
        )
        if ((contestant.status as string) !== 'failed') contestant.status = 'done'
      } catch {
        contestant.status = 'failed'
      }

      // The contestant's servers must not outlive their run: the next
      // contestant (and the preview) would otherwise see them.
      stopAllBackground()

      // Photograph the result before the next contestant wipes the slate.
      const snap = await createProjectSnapshot(workspaceRoot, new AbortController().signal)
      contestant.snapshot = snap.ok ? snap.name : ''
      contestant.files = snap.ok
        ? diffAgainstBase(baseDir, snapshotDirOf(workspaceRoot, snap.name))
        : 0
      contestant.tests = await runTests(workspaceRoot)
      arena.activeId = null
      sendState()
    }

    // Hand the workspace back to the human exactly as it was: no files, no
    // servers, nothing of the contestants survives the tournament.
    stopAllBackground()
    resetToBase(workspaceRoot, base.name)

    if (abortedMidway || arena.canceled) {
      arena.status = 'error'
      arena.error = 'canceled'
    } else {
      arena.status = 'ready'
      await judgeRuns(arena.task)
    }
  } catch (error) {
    arena.status = 'error'
    arena.error = error instanceof Error ? error.message : String(error)
    try {
      resetToBase(workspaceRoot, base.name)
    } catch {
      // Best effort — the snapshots remain available for a manual restore.
    }
  }
  sendState()
  return { ok: true }
}

/**
 * Serves a contestant's snapshot over an ephemeral local server, so their site
 * stays browsable long after the run ended and its dev server was stopped.
 */
let previewServer: Server | null = null

const PREVIEW_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4'
}

export function stopSnapshotPreview(): void {
  if (previewServer) {
    previewServer.close()
    previewServer = null
  }
}

export async function startSnapshotPreview(
  contestantId: number
): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!arena) return { ok: false, error: 'no-arena' }
  const workspaceRoot = getWorkspaceRoot()
  if (!workspaceRoot) return { ok: false, error: 'no-workspace' }
  const contestant = arena.contestants.find((c) => c.id === contestantId)
  if (!contestant?.snapshot) return { ok: false, error: 'no-snapshot' }
  const dir = snapshotDirOf(workspaceRoot, contestant.snapshot)
  if (!existsSync(dir)) return { ok: false, error: 'no-snapshot' }

  stopSnapshotPreview()
  const server = createServer((request, response) => {
    try {
      const raw = (request.url ?? '/').split('?')[0]
      let rel = decodeURIComponent(raw).replace(/^\/+/, '')
      let file = join(dir, rel)
      if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) {
        file = join(dir, 'index.html')
      }
      if (!existsSync(file) || !file.startsWith(dir)) {
        response.statusCode = 404
        response.end('not found')
        return
      }
      response.setHeader('Content-Type', PREVIEW_MIME[extname(file).toLowerCase()] ?? 'application/octet-stream')
      response.end(readFileSync(file))
    } catch {
      response.statusCode = 500
      response.end('error')
    }
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      previewServer = server
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ ok: port > 0, url: `http://localhost:${port}` })
    })
  })
}

/** Applies the champion's work to the workspace and closes the arena. */
export function pickArenaContestant(contestantId: number): { ok: boolean; error?: string } {
  if (!arena) return { ok: false, error: 'no-arena' }
  const workspaceRoot = getWorkspaceRoot()
  if (!workspaceRoot) return { ok: false, error: 'no-workspace' }
  const contestant = arena.contestants.find((c) => c.id === contestantId)
  if (!contestant?.snapshot) return { ok: false, error: 'no-snapshot' }
  const restored = restoreProjectSnapshot(workspaceRoot, contestant.snapshot)
  if (restored < 0) return { ok: false, error: 'restore-failed' }
  endArena()
  return { ok: true }
}

export function cancelArena(): void {
  if (!arena) return
  arena.canceled = true
  abortChat()
  stopAllBackground()
  stopSnapshotPreview()
  const workspaceRoot = getWorkspaceRoot()
  if (workspaceRoot && arena.baseName) {
    try {
      resetToBase(workspaceRoot, arena.baseName)
    } catch {
      // Best effort — the snapshot stays available for a manual restore.
    }
  }
  arena.status = 'error'
  arena.error = 'canceled'
  sendState()
}

/** Leaves the last state on screen until the user closes it. */
export function endArena(): void {
  stopSnapshotPreview()
  arena = null
  emit = null
}
