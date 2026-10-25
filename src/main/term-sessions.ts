import { spawn, type ChildProcess } from 'node:child_process'
import { homedir, platform } from 'node:os'
import { IPC } from '@shared/ipc'
import type { TerminalSessionInfo } from '@shared/ipc'
import { decodeConsoleLine } from './terminal'
import { killTree } from './proc'
import { getWorkspaceRoot } from './workspace'
import { pushUi } from './ui-bridge'

/**
 * The IDE's own terminal panel.
 *
 * A session is ONE long-running shell (PowerShell / cmd / sh) with pipes: the
 * user's lines go to stdin, so `cd`, variables and history persist between
 * commands — the honest behaviour of a terminal without a PTY dependency.
 * After every command the panel injects a silent marker line into stdin so
 * it knows when the command finished and with which exit code.
 *
 * The `agent` session is not a shell at all: it is the read-only feed of the
 * commands the AI runs (run_command, git, tests, servers), mirrored live by
 * the tools themselves.
 */

const MARKER_RE = /^__RC__(-?\d+)?$/
const AGENT_LOG_LINES = 400

interface Session extends TerminalSessionInfo {
  child: ChildProcess | null
  /** Bytes of a line that has not seen its `\n` yet (code pages decode per line). */
  pending: Buffer
  /** Decoded text waiting for the 40 ms flush. */
  flushable: string
  flushTimer: ReturnType<typeof setTimeout> | null
  running: boolean
  /** The agent session keeps its history so a freshly opened panel catches up. */
  log: string[]
}

const sessions = new Map<string, Session>()

function send(session: Session, text: string, done?: boolean): void {
  if (session.kind === 'agent' && text.length > 0) {
    session.log.push(...text.split('\n'))
    if (session.log.length > AGENT_LOG_LINES) session.log.splice(0, session.log.length - AGENT_LOG_LINES)
  }
  pushUi(IPC.TERM_OUTPUT, { id: session.id, text, ...(done ? { done: true } : {}) } satisfies {
    id: string
    text: string
    done?: boolean
  })
}

function flush(session: Session): void {
  session.flushTimer = null
  if (session.flushable.length === 0) return
  const text = session.flushable
  session.flushable = ''
  send(session, text)
}

/** One chunk of bytes from the shell: split to lines, decode, watch markers. */
function ingest(session: Session, chunk: Buffer): void {
  session.pending = Buffer.concat([session.pending, chunk])
  let start = 0
  const lines: string[] = []
  for (let index = 0; index < session.pending.length; index += 1) {
    if (session.pending[index] !== 0x0a) continue
    const line = decodeConsoleLine(session.pending.subarray(start, index))
    start = index + 1
    if (MARKER_RE.test(line.trim())) {
      // The marker never reaches the screen; it only ends the command.
      session.running = false
      if (session.flushTimer) {
        clearTimeout(session.flushTimer)
        flush(session)
      }
      send(session, '', true)
      continue
    }
    lines.push(line)
  }
  session.pending = session.pending.subarray(start)
  if (lines.length === 0) return
  session.flushable += `${lines.join('\n')}\n`
  if (!session.flushTimer) session.flushTimer = setTimeout(() => flush(session), 40)
}

function shellCommand(): { file: string; args: string[]; title: string } {
  if (platform() === 'win32') {
    return {
      file: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass'],
      title: 'PowerShell'
    }
  }
  const shell = process.env.SHELL && process.env.SHELL.length > 0 ? process.env.SHELL : '/bin/sh'
  return { file: shell, args: ['-i'], title: shell.split('/').pop() ?? 'sh' }
}

function markerLine(): string {
  if (platform() === 'win32') return 'Write-Output "__RC__$LASTEXITCODE"'
  return 'echo "__RC__$?"'
}

function spawnShell(session: Session, cwd: string): void {
  const { file, args } = shellCommand()
  const child = spawn(file, args, {
    cwd,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env
  })
  session.child = child
  session.pending = Buffer.alloc(0)
  session.running = false
  child.stdout?.on('data', (chunk: Buffer) => ingest(session, chunk))
  child.stderr?.on('data', (chunk: Buffer) => ingest(session, chunk))
  child.on('exit', () => {
    if (sessions.get(session.id) !== session) return
    session.child = null
    session.running = false
    send(session, '', true)
    send(session, '\n(shell exited; a new one starts on the next command)\n')
    spawnShell(session, cwd)
  })
  child.on('error', (error) => {
    send(session, `\n(shell failed: ${error.message})\n`)
  })
  if (platform() === 'win32') {
    // The same UTF-8 setup the captured commands use, so Cyrillic reads right.
    child.stdin?.write(
      "$ProgressPreference = 'SilentlyContinue'\n[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n$OutputEncoding = [Console]::OutputEncoding\nchcp 65001 > $null\n"
    )
  }
}

export function createTerminal(): TerminalSessionInfo {
  const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  const { title } = shellCommand()
  const session: Session = {
    id,
    title: `${title} ${Math.max(1, [...sessions.values()].filter((item) => item.kind === 'shell').length + 1)}`,
    kind: 'shell',
    child: null,
    pending: Buffer.alloc(0),
    flushable: '',
    flushTimer: null,
    running: false,
    log: []
  }
  sessions.set(id, session)
  spawnShell(session, getWorkspaceRoot() ?? homedir())
  return { id, title: session.title, kind: 'shell' }
}

export function closeTerminal(id: string): void {
  const session = sessions.get(id)
  if (!session || session.kind === 'agent') return
  sessions.delete(id)
  if (session.flushTimer) clearTimeout(session.flushTimer)
  if (session.child?.pid) killTree(session.child.pid)
}

/** The user's line: the command itself plus the silent completion marker. */
export function terminalInput(id: string, line: string): void {
  const session = sessions.get(id)
  if (!session || session.kind !== 'shell') return
  const command = line.replace(/\r?\n$/, '').trim()
  if (command.length === 0) return
  if (!session.child?.stdin || session.child.stdin.destroyed) {
    spawnShell(session, getWorkspaceRoot() ?? homedir())
  }
  session.running = true
  const stdin = session.child?.stdin
  stdin?.write(`${command}\n`)
  stdin?.write(`${markerLine()}\n`)
}

/** Stop the running command: Ctrl-C first, a fresh shell if it ignores that. */
export function stopTerminal(id: string): void {
  const session = sessions.get(id)
  if (!session || session.kind !== 'shell' || !session.running) return
  session.child?.stdin?.write('\x03')
  const child = session.child
  setTimeout(() => {
    if (sessions.get(id) === session && session.running && child?.pid) {
      killTree(child.pid)
      // The exit handler respawns the shell for the next command.
    }
  }, 700)
}

export function listTerminals(): { sessions: TerminalSessionInfo[]; agentLog: string[] } {
  const agent = [...sessions.values()].find((item) => item.kind === 'agent')
  return {
    sessions: [...sessions.values()].map(({ child, pending, flushable, flushTimer, running, log, ...info }) => ({
      ...info
    })),
    agentLog: agent ? [...agent.log] : []
  }
}

/** The read-only feed of everything the AI runs; created on first use. */
function agentSession(): Session {
  const existing = [...sessions.values()].find((item) => item.kind === 'agent')
  if (existing) return existing
  const session: Session = {
    id: 'agent',
    title: 'AI',
    kind: 'agent',
    child: null,
    pending: Buffer.alloc(0),
    flushable: '',
    flushTimer: null,
    running: false,
    log: []
  }
  sessions.set('agent', session)
  return session
}

/**
 * Mirrors one AI-run command into the agent feed: the command line, a short
 * tail of its output and the outcome. Called from every exec-style tool.
 */
export function mirrorAgentCommand(command: string, outcome: { ok: boolean; output: string }): void {
  const session = agentSession()
  const tail = outcome.output
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(-12)
    .map((line) => `  ${line.slice(0, 200)}`)
    .join('\n')
  const parts = [`❯ ${command.slice(0, 300)}`, tail, outcome.ok ? '' : '  ↳ failed']
  send(session, `${parts.filter(Boolean).join('\n')}\n`)
}

export function disposeTerminals(): void {
  for (const id of [...sessions.keys()]) closeTerminal(id)
}
