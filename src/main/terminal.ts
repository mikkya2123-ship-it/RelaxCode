import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TextDecoder } from 'node:util'
import type { ResolvedShell } from '../shared/terminal.ts'
import { isAlive, killTree } from './proc.ts'

/**
 * Running the model's commands through a real shell.
 *
 * - cmd/sh keep the historical behaviour (`spawn(command, { shell: true })`).
 * - PowerShell gets UTF-8 output and a real exit code, so native tools and
 *   Cyrillic paths do not turn into mojibake.
 * - Windows Terminal opens a visible tab. Windows Terminal cannot be piped, so
 *   the tab runs a small PowerShell wrapper that tees every line to a log file
 *   and writes the exit code to a marker; the agent reads those files and the
 *   user watches the command in the terminal. A timeout kills the tab's shell
 *   (and the whole process tree) through the pid the wrapper records.
 */

export class WindowsTerminalUnavailableError extends Error {
  constructor() {
    super('Windows Terminal (wt.exe) was not found')
    this.name = 'WindowsTerminalUnavailableError'
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** The PowerShell snippet that makes `command` behave like a normal process. */
export function powershellScript(command: string): string {
  const prefix = [
    "$ProgressPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$OutputEncoding = [Console]::OutputEncoding',
    'chcp 65001 > $null',
    '$global:LASTEXITCODE = $null'
  ].join('\n')
  // A native command reports through LASTEXITCODE; a cmdlet through `$?`.
  const suffix =
    'if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE } elseif ($?) { exit 0 } else { exit 1 }'
  return `${prefix}\n${command}\n${suffix}`
}

/* ------------------------------ output decoding ----------------------------- */

/**
 * Windows console programs do not write UTF-8: cmd.exe's own messages come out
 * in the OEM code page (cp866 on a Russian Windows) and Python's stdout in the
 * ANSI one (cp1251). Decoding those bytes as UTF-8 hands the model "�� 㤠����
 * ���� 㪠����� 䠩�" instead of "Не удается найти указанный файл", so it cannot
 * tell what actually failed and starts guessing.
 *
 * Lines are decoded one by one, because a single stream can carry UTF-8 from a
 * modern tool next to a cp866 line written by the shell itself.
 */

const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true })

function legacyDecoder(label: 'ibm866' | 'windows-1251'): TextDecoder | null {
  try {
    return new TextDecoder(label)
  } catch {
    // A Node build without full ICU: the caller falls back to plain UTF-8.
    return null
  }
}

const OEM_DECODER = legacyDecoder('ibm866')
const ANSI_DECODER = legacyDecoder('windows-1251')

const RUSSIAN_LETTER = /[а-яё]/gi
const CYRILLIC = /[\u0400-\u04FF]/gi
const GARBAGE = /[\u2500-\u257F\uFFFD]/g

/** How much a decoding looks like Russian prose rather than a wrong code page. */
function russianScore(text: string): number {
  const cyrillic = text.match(CYRILLIC)?.length ?? 0
  const letters = text.match(RUSSIAN_LETTER)?.length ?? 0
  const garbage = text.match(GARBAGE)?.length ?? 0
  // Letters outside the Russian alphabet (Ў, Ќ, Ґ) mean the code page is wrong;
  // box-drawing characters are what cp1251 text looks like when read as cp866.
  return letters * 2 - (cyrillic - letters) * 3 - garbage * 4
}

/** One line of console output, decoded with the code page it was written in. */
export function decodeConsoleLine(bytes: Buffer): string {
  let text: string
  try {
    text = UTF8_STRICT.decode(bytes)
  } catch {
    const oem = OEM_DECODER?.decode(bytes) ?? ''
    const ansi = ANSI_DECODER?.decode(bytes) ?? ''
    text = russianScore(ansi) > russianScore(oem) ? ansi : oem || bytes.toString('utf8')
  }
  return text.replace(/\r+$/, '')
}

/** A whole captured output: lines decoded on their own, CRLF folded to LF. */
export function decodeConsoleOutput(bytes: Buffer): string {
  const lines: string[] = []
  let start = 0
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0x0a) continue
    lines.push(decodeConsoleLine(bytes.subarray(start, index)))
    start = index + 1
  }
  if (start < bytes.length) lines.push(decodeConsoleLine(bytes.subarray(start)))
  return lines.join('\n')
}

/**
 * Output that is already text (Windows Terminal logs) still needs the folding:
 * pytest writes `\r\n` and Python translates the `\n` again, which is where the
 * doubled CR in captured pytest output comes from. Blank lines are kept.
 */
export function normaliseOutput(text: string): string {
  return text.replace(/\0/g, '').replace(/\r+\n?/g, '\n')
}

export function shellSummary(shell: ResolvedShell): string {
  switch (shell) {
    case 'powershell':
      return 'Windows PowerShell (powershell.exe)'
    case 'cmd':
      return 'cmd.exe'
    case 'windows-terminal':
      return 'Windows Terminal with PowerShell'
    case 'sh':
    default:
      return process.platform === 'win32' ? 'the system shell' : 'sh'
  }
}

/** One child process for the shells that can be captured directly. */
export function spawnShell(
  shell: Exclude<ResolvedShell, 'windows-terminal'>,
  command: string,
  cwd: string
): ChildProcess {
  const common = {
    cwd,
    windowsHide: true,
    detached: process.platform !== 'win32',
    // Python takes the ANSI code page when its stdout is a pipe, which is how
    // pytest output turns into mojibake. Asking for UTF-8 fixes the output
    // without changing how Python opens files (that would be PYTHONUTF8).
    env:
      process.platform === 'win32' && !process.env.PYTHONIOENCODING
        ? { ...process.env, PYTHONIOENCODING: 'utf-8' }
        : process.env
  }
  if (shell === 'powershell') {
    return spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        powershellScript(command)
      ],
      { ...common, stdio: ['ignore', 'pipe', 'pipe'] }
    )
  }
  if (shell === 'cmd') {
    return spawn(command, {
      ...common,
      shell: process.env.ComSpec || 'cmd.exe',
      stdio: ['ignore', 'pipe', 'pipe']
    })
  }
  return spawn(command, {
    ...common,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

/* ------------------------------ Windows Terminal ----------------------------- */

let wtCache: string | null | undefined

/**
 * The `wt.exe` shim under WindowsApps does nothing when spawned from a
 * non-console process, so the real packaged executable is preferred. The search
 * is done once: a command must not pay for `Get-AppxPackage` every time.
 */
export function findWindowsTerminal(): string | null {
  if (wtCache !== undefined) return wtCache
  if (process.platform !== 'win32') {
    wtCache = null
    return null
  }

  const candidates: string[] = []
  try {
    const appx = spawnSync(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-AppxPackage Microsoft.WindowsTerminal).InstallLocation'
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 6000 }
    )
    if (appx.status === 0) {
      for (const line of String(appx.stdout ?? '').split(/\r?\n/)) {
        const location = line.trim()
        if (location.length > 0) candidates.push(join(location, 'wt.exe'))
      }
    }
  } catch {
    // No packaged install; the PATH lookup below may still find one.
  }
  try {
    const where = spawnSync('where', ['wt.exe'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000
    })
    if (where.status === 0) {
      for (const line of String(where.stdout ?? '').split(/\r?\n/)) {
        const candidate = line.trim()
        if (candidate.length > 0) candidates.push(candidate)
      }
    }
  } catch {
    // not on PATH
  }

  wtCache = candidates.find((candidate) => existsSync(candidate)) ?? null
  return wtCache
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

interface WtPaths {
  dir: string
  script: string
  log: string
  pidFile: string
  doneFile: string
}

interface WtSession extends WtPaths {
  launcher: ChildProcess
  pid: number | null
  done: number | null
  logOffset: number
  decoder: TextDecoder
  launchedAt: number
}

async function prepareWt(command: string, cwd: string): Promise<WtPaths> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'relaxcode-wt-'))
  const paths: WtPaths = {
    dir,
    script: join(dir, 'run.ps1'),
    log: join(dir, 'out.log'),
    pidFile: join(dir, 'pid.txt'),
    doneFile: join(dir, 'exit.txt')
  }
  // The command travels as an encoded argument, so quotes and Unicode in it
  // cannot break the wrapper. The file itself gets a BOM: Windows PowerShell
  // 5.1 reads a BOM-less .ps1 as ANSI and would mangle Cyrillic paths.
  const encoded = Buffer.from(powershellScript(command), 'utf16le').toString('base64')
  const script = [
    "$ErrorActionPreference = 'Continue'",
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$OutputEncoding = [Console]::OutputEncoding',
    'chcp 65001 > $null',
    `Set-Location -LiteralPath ${psQuote(cwd)}`,
    `$PID | Set-Content -LiteralPath ${psQuote(paths.pidFile)} -NoNewline -Encoding ascii`,
    `$encoded = ${psQuote(encoded)}`,
    '$code = 1',
    '& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $encoded *>&1 | ForEach-Object {',
    '  $line = ($_ | Out-String)',
    '  [Console]::Write($line)',
    `  [System.IO.File]::AppendAllText(${psQuote(paths.log)}, $line, [System.Text.UTF8Encoding]::new($false))`,
    '}',
    'if ($null -ne $LASTEXITCODE) { $code = $LASTEXITCODE }',
    `Set-Content -LiteralPath ${psQuote(paths.doneFile)} -Value $code -NoNewline -Encoding ascii`,
    ''
  ].join('\r\n')
  await fs.writeFile(paths.script, `\uFEFF${script}`, 'utf8')
  return paths
}

async function startWtSession(command: string, cwd: string): Promise<WtSession> {
  const executable = findWindowsTerminal()
  if (!executable) throw new WindowsTerminalUnavailableError()

  const paths = await prepareWt(command, cwd)
  // `wt` treats `;` as a subcommand separator, so a title copied from a command
  // like `npm i; npm test` would break the launch. Keep the title plain.
  const snippet = command
    .replace(/[;"'`\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48)
  const title = snippet.length > 0 ? `RelaxCode: ${snippet}` : 'RelaxCode'
  try {
    const launcher = spawn(
      executable,
      [
        '-w',
        '0',
        'new-tab',
        '--title',
        title,
        '-d',
        cwd,
        'powershell.exe',
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        paths.script
      ],
      { windowsHide: false, stdio: 'ignore' }
    )
    // A failed launch is reported through the exit code / missing pid below;
    // an unhandled 'error' event would take the whole IDE down.
    launcher.on('error', () => {})
    return {
      ...paths,
      launcher,
      pid: null,
      done: null,
      logOffset: 0,
      decoder: new TextDecoder('utf-8'),
      launchedAt: Date.now()
    }
  } catch (error) {
    await fs.rm(paths.dir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

async function readPid(session: WtSession): Promise<number | null> {
  if (session.pid !== null) return session.pid
  const text = await fs.readFile(session.pidFile, 'utf8').catch(() => null)
  if (text === null) return null
  const pid = Number.parseInt(text.trim(), 10)
  if (Number.isInteger(pid) && pid > 0) session.pid = pid
  return session.pid
}

async function readLogChunk(session: WtSession): Promise<string> {
  const stat = await fs.stat(session.log).catch(() => null)
  if (!stat || stat.size <= session.logOffset) return ''
  const length = stat.size - session.logOffset
  const handle = await fs.open(session.log, 'r')
  try {
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, session.logOffset)
    session.logOffset = stat.size
    // Streaming decode keeps a UTF-8 character split across two reads intact.
    return session.decoder.decode(buffer, { stream: true })
  } finally {
    await handle.close()
  }
}

async function readDone(session: WtSession): Promise<number | null> {
  if (session.done !== null) return session.done
  const text = await fs.readFile(session.doneFile, 'utf8').catch(() => null)
  if (text === null) return null
  const code = Number.parseInt(text.trim(), 10)
  session.done = Number.isFinite(code) ? code : 1
  return session.done
}

function stopSession(session: WtSession): void {
  const pid = session.pid ?? session.launcher.pid
  if (pid) killTree(pid)
}

async function cleanupSession(session: WtSession): Promise<void> {
  await fs.rm(session.dir, { recursive: true, force: true }).catch(() => {})
}

export interface WindowsTerminalRun {
  /** The command was actually handed to a terminal tab. */
  launched: boolean
  /** No `wt.exe` on this machine; the caller may fall back to PowerShell. */
  unavailable: boolean
  /** The tab did not start the wrapper (broken install, closed window). */
  failedToStart: boolean
  timedOut: boolean
  aborted: boolean
  code: number | null
  output: string
}

/** Run one command in a visible Windows Terminal tab and wait for its exit. */
export async function runInWindowsTerminal(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal
): Promise<WindowsTerminalRun> {
  let session: WtSession
  try {
    session = await startWtSession(command, cwd)
  } catch (error) {
    if (error instanceof WindowsTerminalUnavailableError) {
      return {
        launched: false,
        unavailable: true,
        failedToStart: false,
        timedOut: false,
        aborted: false,
        code: null,
        output: ''
      }
    }
    throw error
  }

  let output = ''
  let timedOut = false
  let aborted = false
  const drain = async (): Promise<void> => {
    output += await readLogChunk(session)
  }
  const deadline = Date.now() + timeoutMs

  try {
    while (true) {
      await drain()
      await readPid(session)
      const done = await readDone(session)
      if (done !== null) {
        output += session.decoder.decode()
        return {
          launched: true,
          unavailable: false,
          failedToStart: false,
          timedOut: false,
          aborted: false,
          code: done,
          output
        }
      }
      if (session.pid !== null && !isAlive(session.pid)) {
        // The wrapper usually writes the marker just before exiting; give it a
        // moment so a fast command is not reported as "exit code unknown".
        await sleep(120)
        await drain()
        const settled = await readDone(session)
        output += session.decoder.decode()
        if (settled !== null) {
          return {
            launched: true,
            unavailable: false,
            failedToStart: false,
            timedOut: false,
            aborted: false,
            code: settled,
            output
          }
        }
        // `exit` inside the command, or the tab was closed by hand.
        return {
          launched: true,
          unavailable: false,
          failedToStart: false,
          timedOut: false,
          aborted: false,
          code: null,
          output
        }
      }
      if (
        session.pid === null &&
        Date.now() - session.launchedAt > 6000 &&
        session.launcher.exitCode !== null
      ) {
        return {
          launched: false,
          unavailable: false,
          failedToStart: true,
          timedOut: false,
          aborted: false,
          code: null,
          output
        }
      }
      if (signal.aborted) {
        aborted = true
        break
      }
      if (Date.now() >= deadline) {
        timedOut = true
        break
      }
      await sleep(100)
    }
  } finally {
    if (timedOut || aborted) {
      stopSession(session)
      await sleep(250)
      await drain()
      output += session.decoder.decode()
    }
    await cleanupSession(session)
  }

  return {
    launched: true,
    unavailable: false,
    failedToStart: false,
    timedOut,
    aborted,
    code: null,
    output
  }
}

/** The process registry's view of a server running inside a terminal tab. */
export interface WindowsTerminalHost {
  pid: () => number
  alive: () => boolean
  poll: () => Promise<string[]>
  exit: () => { code: number | null; signal: NodeJS.Signals | null } | null
  stop: () => void
  cleanup: () => Promise<void>
}

/**
 * Start a long-running command in a terminal tab and expose it the way
 * `startBackground` expects. Output is read from the wrapper's log, the exit
 * code from its marker, and `stop` kills the tab's shell tree.
 */
export async function createWindowsTerminalHost(
  command: string,
  cwd: string
): Promise<WindowsTerminalHost> {
  const session = await startWtSession(command, cwd)
  let pending = ''
  let stopped = false

  const collect = async (): Promise<string[]> => {
    await readPid(session)
    await readDone(session)
    pending += await readLogChunk(session)
    const parts = pending.split(/\r?\n/)
    pending = parts.pop() ?? ''
    return parts.filter((line) => line.length > 0)
  }

  // Wait briefly for the tab to come up so the registry has the real pid.
  const deadline = Date.now() + 5000
  while (session.pid === null && Date.now() < deadline) {
    await sleep(100)
    pending += await readLogChunk(session)
    await readPid(session)
  }

  return {
    pid: () => session.pid ?? 0,
    alive: () => {
      if (stopped || session.done !== null) return false
      if (session.pid !== null) return isAlive(session.pid)
      return session.launcher.exitCode === null && Date.now() - session.launchedAt < 6000
    },
    poll: collect,
    exit: () => {
      if (session.done !== null) return { code: session.done, signal: null }
      if (session.pid !== null && !isAlive(session.pid)) return { code: null, signal: null }
      if (
        session.pid === null &&
        Date.now() - session.launchedAt > 6000 &&
        session.launcher.exitCode !== null
      ) {
        return { code: null, signal: null }
      }
      return null
    },
    stop: () => {
      stopped = true
      stopSession(session)
    },
    cleanup: async () => {
      await sleep(150)
      await cleanupSession(session)
    }
  }
}
