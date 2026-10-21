import { spawnSync, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import net from 'node:net'
import type { BackgroundProcessInfo } from '@shared/ipc'
import { createWindowsTerminalHost, spawnShell, type WindowsTerminalHost } from './terminal.ts'

/**
 * Kill a shell command together with every process it started.
 *
 * Killing only the shell (`cmd.exe`) leaves things like `npx serve`, a dev
 * server or a watcher running in the background, still holding their port.
 * On Windows the whole tree is removed with `taskkill /T`; elsewhere the child
 * is started in its own process group so the group can be signalled.
 *
 * Kept dependency-free so it can be unit tested outside Electron.
 */
export function killTree(pid: number | undefined): void {
  if (!pid) return
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
      return
    }
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      process.kill(pid, 'SIGKILL')
    }
  } catch {
    // best effort — the process may already be gone
  }
}

/** True while a process with this pid exists. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------------- *
 * Background processes (dev servers, watchers).
 *
 * `run_command` waits for a command to finish, which is useless for a server
 * that never exits. These helpers keep such a process alive across the agent
 * run, remember its output, and can tell whether its port is actually
 * accepting connections.
 * ------------------------------------------------------------------------- */

export interface StartedProcess {
  info: BackgroundProcessInfo
  /** True when a TCP connection to the requested/detected port succeeded. */
  listening: boolean
  /** Set when the process died during the wait window. */
  exited: { code: number | null; signal: NodeJS.Signals | null } | null
  output: string
  /** Port the caller asked for, if any. */
  requestedPort: number | null
  /** Port that actually answered, if any. */
  listeningPort: number | null
  /** Set when the process could not be started at all. */
  startupError?: string
}

export type ShellKind = 'powershell' | 'cmd' | 'sh'

interface BackgroundEntry extends BackgroundProcessInfo {
  /** Null for commands that live in a Windows Terminal tab. */
  child: ChildProcess | null
  lines: string[]
  host?: WindowsTerminalHost
  timer?: NodeJS.Timeout
}

const BACKGROUND = new Map<string, BackgroundEntry>()
const MAX_OUTPUT_LINES = 300

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function pushLines(entry: BackgroundEntry, lines: string[]): void {
  for (const line of lines) {
    if (line.length === 0) continue
    entry.lines.push(line)
  }
  if (entry.lines.length > MAX_OUTPUT_LINES) {
    entry.lines.splice(0, entry.lines.length - MAX_OUTPUT_LINES)
  }
}

function pushOutput(entry: BackgroundEntry, chunk: Buffer): void {
  pushLines(entry, chunk.toString().split(/\r?\n/))
}

function hostAnswers(host: string, port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const done = (result: boolean): void => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/**
 * Loopback hosts to probe. A server started with `listen(port, 'localhost')`
 * resolves to `::1` on Windows (and to `127.0.0.1` elsewhere), so a check that
 * only tries `127.0.0.1` reports "not answering" for a perfectly healthy server.
 */
const LOOPBACK_HOSTS = ['127.0.0.1', '::1']

/** True when something accepts connections on this port on either loopback. */
export async function localPortOpen(port: number): Promise<boolean> {
  const answers = await Promise.all(LOOPBACK_HOSTS.map((host) => hostAnswers(host, port)))
  return answers.some(Boolean)
}

/**
 * Ports mentioned in a process output, e.g. `http://localhost:3000`,
 * `Listening on 0.0.0.0:8080`, `server running on port 5173`.
 * Used to discover the real port when the requested one was a guess.
 */
export function detectPorts(output: string): number[] {
  const found = new Set<number>()
  const patterns = [
    /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|::1|\[::1\])\s*:\s*(\d{2,5})/gi,
    /(?:port|порт)\s*[:=]?\s*(\d{2,5})/gi
  ]
  for (const pattern of patterns) {
    for (const match of output.matchAll(pattern)) {
      const value = Number(match[1])
      if (Number.isInteger(value) && value > 0 && value < 65536) found.add(value)
    }
  }
  return [...found]
}

export function listBackground(): BackgroundProcessInfo[] {
  for (const entry of BACKGROUND.values()) {
    if (!entry.host) continue
    const pid = entry.host.pid()
    if (pid > 0) entry.pid = pid
  }
  return [...BACKGROUND.values()].map(({ child, lines, host, timer, ...info }) => ({
    ...info,
    running: info.running && (host ? host.alive() : isAlive(info.pid))
  }))
}

/**
 * Processes that exited are kept in the list so the panel can report them, but
 * they stop being useful once new work starts: dropping them keeps two servers
 * from claiming the same port and keeps the list readable.
 */
function pruneExited(): void {
  for (const [id, entry] of BACKGROUND) {
    if (entry.host) {
      if (!entry.host.alive()) {
        BACKGROUND.delete(id)
        if (entry.timer) clearInterval(entry.timer)
        void entry.host.cleanup()
      }
      continue
    }
    if (!entry.running || !isAlive(entry.pid)) BACKGROUND.delete(id)
  }
}

export function backgroundOutput(id: string): string {
  const entry = BACKGROUND.get(id)
  if (!entry) return ''
  return entry.lines.join('\n')
}

/**
 * Start a command in the background and wait until its port answers, it exits,
 * or `waitMs` runs out. The process is kept in a registry so it can be listed
 * and stopped later.
 */
export async function startBackground(
  command: string,
  cwd: string,
  port: number | null,
  waitMs: number,
  shell: ShellKind = process.platform === 'win32' ? 'cmd' : 'sh'
): Promise<StartedProcess> {
  pruneExited()
  const id = randomUUID()
  const child = spawnShell(shell, command, cwd)

  const entry: BackgroundEntry = {
    id,
    command,
    cwd,
    pid: child.pid ?? 0,
    port,
    running: true,
    startedAt: Date.now(),
    child,
    lines: []
  }
  BACKGROUND.set(id, entry)

  child.stdout?.on('data', (chunk: Buffer) => pushOutput(entry, chunk))
  child.stderr?.on('data', (chunk: Buffer) => pushOutput(entry, chunk))

  let exited: StartedProcess['exited'] = null
  child.once('exit', (code, signal) => {
    exited = { code, signal }
    entry.running = false
  })
  child.once('error', () => {
    entry.running = false
  })

  const deadline = Date.now() + waitMs
  let listeningPort: number | null = null
  while (Date.now() < deadline) {
    if (exited) break
    const candidates = new Set<number>()
    if (port !== null) candidates.add(port)
    for (const detected of detectPorts(entry.lines.join('\n'))) candidates.add(detected)
    for (const candidate of candidates) {
      if (await localPortOpen(candidate)) {
        listeningPort = candidate
        break
      }
    }
    if (listeningPort !== null) break
    await sleep(200)
  }
  // Give a provider that exits immediately a chance to report its code.
  if (!exited && entry.pid > 0 && !isAlive(entry.pid)) {
    await sleep(200)
  }
  if (listeningPort !== null) {
    // Remember the port that really answers: the UI links to it and
    // `stop_server` can be given it.
    entry.port = listeningPort
  }

  const info = listBackground().find((item) => item.id === id) ?? {
    id,
    command,
    cwd,
    pid: entry.pid,
    port: entry.port,
    running: entry.running,
    startedAt: entry.startedAt
  }

  return {
    info,
    listening: listeningPort !== null,
    exited,
    output: entry.lines.join('\n'),
    requestedPort: port,
    listeningPort
  }
}

function disposeHost(entry: BackgroundEntry): void {
  if (entry.timer) clearInterval(entry.timer)
  if (entry.host) {
    entry.host.stop()
    void entry.host.cleanup()
  }
}

/**
 * A server that runs in a visible Windows Terminal tab. The tab is the process
 * the user sees; the registry keeps the same shape as a captured server so the
 * panel, `stop_server` and port detection keep working.
 */
export async function startBackgroundInTerminal(
  command: string,
  cwd: string,
  port: number | null,
  waitMs: number
): Promise<StartedProcess> {
  pruneExited()
  const id = randomUUID()
  const host = await createWindowsTerminalHost(command, cwd)
  const entry: BackgroundEntry = {
    id,
    command,
    cwd,
    pid: host.pid(),
    port,
    running: host.alive(),
    startedAt: Date.now(),
    child: null,
    lines: [],
    host
  }
  BACKGROUND.set(id, entry)

  // Keep the panel's output fresh for as long as the tab lives, without
  // keeping the event loop busy after the command exits.
  const refresh = async (): Promise<void> => {
    if (!entry.host) return
    try {
      pushLines(entry, await entry.host.poll())
      if (entry.host.exit()) {
        entry.running = false
        if (entry.timer) clearInterval(entry.timer)
        entry.timer = undefined
        await entry.host.cleanup()
      }
    } catch {
      // A tab the user closed by hand can take its log with it.
      entry.running = false
      if (entry.timer) clearInterval(entry.timer)
      entry.timer = undefined
    }
  }
  entry.timer = setInterval(() => void refresh(), 400)

  const deadline = Date.now() + waitMs
  let listeningPort: number | null = null
  while (Date.now() < deadline) {
    await refresh()
    if (!entry.running) break
    const candidates = new Set<number>()
    if (port !== null) candidates.add(port)
    for (const detected of detectPorts(entry.lines.join('\n'))) candidates.add(detected)
    for (const candidate of candidates) {
      if (await localPortOpen(candidate)) {
        listeningPort = candidate
        break
      }
    }
    if (listeningPort !== null) break
    await sleep(200)
  }
  await refresh()
  entry.pid = host.pid() || entry.pid
  entry.running = entry.running && host.alive()
  if (listeningPort !== null) entry.port = listeningPort

  const info = listBackground().find((item) => item.id === id) ?? {
    id,
    command,
    cwd,
    pid: entry.pid,
    port: entry.port,
    running: entry.running,
    startedAt: entry.startedAt
  }

  const exit = host.exit()
  return {
    info,
    listening: listeningPort !== null,
    exited: exit,
    output: entry.lines.join('\n'),
    requestedPort: port,
    listeningPort,
    startupError:
      !entry.running && listeningPort === null && entry.pid === 0
        ? 'Windows Terminal did not open a tab, so the command was not started. Check that Windows Terminal is installed and can be opened.'
        : undefined
  }
}

export function stopBackground(id: string): BackgroundProcessInfo | null {
  const entry = BACKGROUND.get(id)
  if (!entry) return null
  if (entry.host) {
    disposeHost(entry)
  } else {
    killTree(entry.pid)
  }
  entry.running = false
  return listBackground().find((item) => item.id === id) ?? null
}

export function stopBackgroundByPort(port: number): BackgroundProcessInfo | null {
  const entry = [...BACKGROUND.values()].find((item) => item.port === port && item.running)
  return entry ? stopBackground(entry.id) : null
}

export function stopBackgroundByPid(pid: number): BackgroundProcessInfo | null {
  const entry = [...BACKGROUND.values()].find((item) => item.pid === pid)
  return entry ? stopBackground(entry.id) : null
}

/** Kill every process this app started (used when the IDE quits). */
export function stopAllBackground(): void {
  for (const entry of BACKGROUND.values()) {
    if (!entry.running) continue
    if (entry.host) disposeHost(entry)
    else killTree(entry.pid)
    entry.running = false
  }
}

