import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { promises as fsp } from 'node:fs'
import { createServer, Socket } from 'node:net'
import { basename, join } from 'node:path'
import { app } from 'electron'
import {
  playbookFileName,
  type McpDetectedApp
} from '@shared/mcp'
import {
  ARTCRAFT_APPS,
  artCraftApp,
  artCraftBridgeMcpArgs,
  artCraftBridgePort,
  artCraftBridgeTokenFile,
  artCraftControlArgs,
  artCraftGrantedRoot,
  artCraftMcpArgs,
  artCraftPlaybook,
  artCraftServerMode,
  artCraftServerName,
  artCraftTimeoutMs,
  isArtCraftAppId,
  sameArtCraftFolder,
  type ArtCraftAppDef,
  type ArtCraftAppId,
  type ArtCraftConnectMode
} from '@shared/artcraft'
import { emitMcpEvent, listStates, saveServer, trustServer } from './mcp'
import { logEvent } from './logger'

/**
 * Application connectors: find installed apps on this computer, prepare the
 * runtime an MCP bridge needs (a dedicated Python venv in userData), install
 * the app-side addon and register the MCP server in mcp.json. Blender is the
 * reference connector; more apps slot into the same three-step setup.
 */

const RUNTIME_PACKAGE = 'mcp-for-blender'

function setupLine(line: string, level: 'info' | 'error' = 'info'): void {
  emitMcpEvent({ type: 'setup', line, level })
  logEvent(level === 'error' ? 'warn' : 'info', `connector: ${line}`)
}

function run(
  command: string,
  args: string[],
  options: { timeoutMs: number; echo?: boolean }
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    // Windows pipes default to cp1251: any Python that prints a '→' (the
    // addon installer's own messages do) dies with UnicodeEncodeError before
    // finishing. UTF-8 mode is forced for every child we spawn.
    const child = execFile(
      command,
      args,
      {
        timeout: options.timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
      },
      (error, stdout, stderr) => {
        const output = `${stdout}\n${stderr}`
        resolve({ ok: error === null, output })
      }
    )
    if (options.echo) {
      child.stdout?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split(/\r?\n/)) {
          const trimmed = line.trim()
          if (trimmed.length > 0) setupLine(trimmed.slice(0, 300))
        }
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split(/\r?\n/)) {
          const trimmed = line.trim()
          if (trimmed.length > 0 && !/^\s*$/.test(trimmed)) setupLine(trimmed.slice(0, 300))
        }
      })
    }
    void child
  })
}

/* --------------------------------------------------------------- detection */

interface BlenderCandidate {
  exePath: string
  source: string
}

async function registryBlenderPaths(): Promise<BlenderCandidate[]> {
  const found: BlenderCandidate[] = []
  const hives = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  ]
  for (const hive of hives) {
    try {
      const { ok, output } = await runRegistry(hive)
      if (!ok) continue
      // Blocks of `DisplayName … Blender` followed by `InstallLocation … <path>`.
      const lines = output.split(/\r?\n/)
      for (let i = 0; i < lines.length; i += 1) {
        if (!/DisplayName\s+REG_SZ\s+.*Blender/i.test(lines[i])) continue
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j += 1) {
          const match = /InstallLocation\s+REG_SZ\s+(.+)/.exec(lines[j])
          if (match) {
            const dir = match[1].trim()
            const exe = join(dir, 'blender.exe')
            if (existsSync(exe)) found.push({ exePath: exe, source: 'registry' })
            break
          }
        }
      }
    } catch {
      // A broken registry query just means fewer candidates.
    }
  }
  return found
}

function runRegistry(hive: string): Promise<{ ok: boolean; output: string }> {
  // Asynchronous on purpose: `reg query /s` walks the whole uninstall hive and
  // takes seconds on a loaded machine. Blocking the main process there froze
  // the whole window — including the settings page that asked for the scan.
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', hive, '/s', '/f', 'Blender', '/d'],
      { timeout: 15000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (error, stdout) => resolve({ ok: error === null, output: stdout ?? '' })
    )
  })
}

async function programFilesBlenderPaths(): Promise<BlenderCandidate[]> {
  const found: BlenderCandidate[] = []
  for (const base of ['C:\\Program Files\\Blender Foundation', 'C:\\Program Files (x86)\\Blender Foundation']) {
    try {
      if (!existsSync(base)) continue
      for (const version of await fsp.readdir(base)) {
        const exe = join(base, version, 'blender.exe')
        if (existsSync(exe)) found.push({ exePath: exe, source: 'program-files' })
      }
    } catch {
      // Unreadable folder: skip it.
    }
  }
  return found
}

async function blenderVersion(exePath: string): Promise<string | null> {
  const { ok, output } = await run(exePath, ['--version'], { timeoutMs: 20000 })
  if (!ok) return null
  const match = /Blender\s+(\d+\.\d+(?:\.\d+)?)/.exec(output)
  return match ? match[1] : null
}

/** Per-user config folder (`…\Blender Foundation\Blender\<major.minor>`). */
function blenderConfigDir(version: string | null): string | null {
  if (!version) return null
  const short = version.split('.').slice(0, 2).join('.')
  const dir = join(app.getPath('appData'), 'Blender Foundation', 'Blender', short)
  return existsSync(dir) ? dir : null
}

/* ---------------------------------------------------------- ArtCraft suite */

/** The launcher is not an MCP app, but it installs every app in the suite. */
const ARTCRAFT_LAUNCHER_ID = 'artcraft-launcher'

/** The command-line tools the suite should already put on PATH. */
async function whichAsync(name: string): Promise<string | null> {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  const { ok, output } = await run(finder, [name], { timeoutMs: 8000 })
  if (!ok) return null
  const first = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && existsSync(line))
  return first ?? null
}

function firstExisting(paths: string[]): string | null {
  for (const path of paths) {
    if (path.length > 0 && existsSync(path)) return path
  }
  return null
}

/** Install folders to try for one app, using the names ArtCraft Launcher uses. */
function craftInstallDirs(def: ArtCraftAppDef): string[] {
  const home = app.getPath('home')
  if (process.platform === 'win32') {
    const names = [def.label, def.label.replace(/\s+/g, '')]
    const dirs: string[] = []
    for (const name of names) {
      dirs.push(join(home, 'AppData', 'Local', 'Programs', 'ArtCraft', name))
      dirs.push(join('C:\\Program Files\\ArtCraft', name))
      dirs.push(join('C:\\Program Files (x86)\\ArtCraft', name))
    }
    if (def.id === 'solidcraft') {
      dirs.push(join('C:\\Program Files', 'SolidCraft'))
      dirs.push(join(home, 'AppData', 'Local', 'Programs', 'SolidCraft'))
    }
    return dirs
  }
  if (process.platform === 'darwin') {
    return [
      join('/Applications', `${def.label}.app`, 'Contents', 'MacOS', def.label),
      join(home, 'Applications', `${def.label}.app`, 'Contents', 'MacOS', def.label)
    ]
  }
  return [join('/opt', def.label.toLowerCase(), def.gui), join(home, '.local', 'share', def.label, def.gui)]
}

function craftCliCandidates(def: ArtCraftAppDef): string[] {
  const candidates: string[] = []
  if (process.platform === 'win32') {
    for (const dir of craftInstallDirs(def)) candidates.push(join(dir, `${def.cli}.exe`))
  } else {
    for (const dir of ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin', join(app.getPath('home'), '.local', 'bin'), join(app.getPath('home'), '.cargo', 'bin')]) {
      candidates.push(join(dir, def.cli))
    }
    for (const dir of craftInstallDirs(def)) candidates.push(join(dir, def.cli))
  }
  return candidates
}

function craftGuiCandidates(def: ArtCraftAppDef): string[] {
  const candidates: string[] = []
  for (const dir of craftInstallDirs(def)) {
    candidates.push(join(dir, process.platform === 'win32' ? `${def.gui}.exe` : def.gui))
  }
  return candidates
}

async function artCraftLauncherPath(): Promise<string | null> {
  const home = app.getPath('home')
  const known = firstExisting([
    join(home, 'AppData', 'Local', 'Programs', 'ArtCraft', 'Launcher', 'artcraft-launcher.exe'),
    join(home, 'AppData', 'Local', 'Programs', 'ArtCraft Launcher', 'artcraft-launcher.exe'),
    'C:\\Program Files\\ArtCraft Launcher\\artcraft-launcher.exe',
    'C:\\Program Files\\ArtCraft\\Launcher\\artcraft-launcher.exe',
    '/Applications/ArtCraft Launcher.app/Contents/MacOS/artcraft-launcher',
    '/usr/bin/artcraft-launcher',
    '/usr/local/bin/artcraft-launcher'
  ])
  return known ?? (await whichAsync('artcraft-launcher'))
}

async function craftCliVersion(cliPath: string): Promise<string | null> {
  const { ok, output } = await run(cliPath, ['--version'], { timeoutMs: 8000 })
  if (!ok) return null
  const line = output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0)
  if (!line) return null
  const match = /(\d+\.\d+(?:\.\d+)?)/.exec(line)
  return match ? match[1] : line.slice(0, 60)
}

/** An ephemeral loopback port for one app's control channel. */
function freeControlPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('no free port'))))
    })
  })
}

/** True when something already listens on the loopback port. */
function controlPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket()
    const done = (value: boolean): void => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(500)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    socket.connect(port, '127.0.0.1')
  })
}

/** Wait until a freshly launched app has opened its control channel. */
async function waitForControlPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await controlPortOpen(port)) return true
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  return controlPortOpen(port)
}

/**
 * The bearer-token file for a live connector. PhotoCraft creates it on first
 * launch (and reuses it later); keeping it under userData means it survives
 * restarts and never appears on a command line.
 */
function artCraftControlTokenFile(id: string): string {
  const dir = join(app.getPath('userData'), 'artcraft')
  mkdirSync(dir, { recursive: true })
  return join(dir, `${id}-control.token`)
}

/**
 * Detection cache. Every connector tab fires a scan on mount, and those scans
 * hit the registry, the filesystem and the app executables — seconds of work
 * per switch. A short TTL plus in-flight sharing turns tab flapping into
 * memory reads. `setScan` in the UI forces a fresh scan when the user asks.
 */
const DETECT_CACHE_TTL_MS = 30_000
const detectCache = new Map<string, { at: number; result: McpDetectedApp[] }>()
const detectInFlight = new Map<string, Promise<McpDetectedApp[]>>()

/** Registration changed what a scan would find — drop the cached answer. */
function invalidateDetectCache(): void {
  detectCache.clear()
}

function detectOnce(key: string, scan: () => Promise<McpDetectedApp[]>): Promise<McpDetectedApp[]> {
  const cached = detectCache.get(key)
  if (cached !== undefined && Date.now() - cached.at < DETECT_CACHE_TTL_MS) {
    return Promise.resolve(cached.result)
  }
  const running = detectInFlight.get(key)
  if (running !== undefined) return running
  const task = scan()
    .then((result) => {
      detectCache.set(key, { at: Date.now(), result })
      return result
    })
    .finally(() => detectInFlight.delete(key))
  detectInFlight.set(key, task)
  return task
}

async function detectArtCraftSuite(only?: string): Promise<McpDetectedApp[]> {
  if (only === ARTCRAFT_LAUNCHER_ID) {
    const launcher = await artCraftLauncherPath()
    if (!launcher) return []
    return [
      {
        app: ARTCRAFT_LAUNCHER_ID,
        label: 'ArtCraft Launcher',
        exePath: launcher,
        version: null,
        configDir: null,
        addonInstalled: false
      }
    ]
  }

  const defs = only ? ARTCRAFT_APPS.filter((entry) => entry.id === only) : ARTCRAFT_APPS
  const found = await Promise.all(
    defs.map(async (def): Promise<McpDetectedApp | null> => {
      const cliOnPath = whichAsync(process.platform === 'win32' ? `${def.cli}.exe` : def.cli)
      const guiOnPath = whichAsync(process.platform === 'win32' ? `${def.gui}.exe` : def.gui)
      const cliPath = firstExisting([...craftCliCandidates(def), (await cliOnPath) ?? ''])
      const guiPath = firstExisting([...craftGuiCandidates(def), (await guiOnPath) ?? ''])
      if (!cliPath && !guiPath) return null
      const version = cliPath ? await craftCliVersion(cliPath) : null
      return {
        app: def.id,
        label: def.label,
        exePath: guiPath ?? '',
        version,
        configDir: null,
        addonInstalled: false,
        cliPath,
        guiPath,
        serverName: artCraftServerName(def.id)
      }
    })
  )

  const out = found.filter((entry): entry is McpDetectedApp => entry !== null)
  if (only) return out
  const launcher = await artCraftLauncherPath()
  if (launcher) {
    out.unshift({
      app: ARTCRAFT_LAUNCHER_ID,
      label: 'ArtCraft Launcher',
      exePath: launcher,
      version: null,
      configDir: null,
      addonInstalled: false
    })
  }
  return out
}

export async function detectApps(appId: string): Promise<McpDetectedApp[]> {
  if (appId === 'artcraft' || appId === ARTCRAFT_LAUNCHER_ID || isArtCraftAppId(appId)) {
    const only = appId === 'artcraft' ? undefined : appId
    return detectOnce(`artcraft:${only ?? 'all'}`, () => detectArtCraftSuite(only))
  }
  if (appId === 'godot') {
    return process.platform === 'win32' ? detectOnce('godot', detectGodot) : []
  }
  if (appId !== 'blender') return []
  if (process.platform !== 'win32') return []
  return detectOnce('blender', detectBlender)
}

async function detectBlender(): Promise<McpDetectedApp[]> {
  const candidates = [...(await registryBlenderPaths()), ...(await programFilesBlenderPaths())]
  const seen = new Set<string>()
  const unique = candidates.filter((item) => {
    const key = item.exePath.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const apps = await Promise.all(
    unique.map(async (candidate): Promise<McpDetectedApp | null> => {
      const version = await blenderVersion(candidate.exePath)
      const configDir = blenderConfigDir(version)
      return {
        app: 'blender',
        label: version ? `Blender ${version}` : 'Blender',
        exePath: candidate.exePath,
        version,
        configDir,
        addonInstalled: configDir !== null && existsSync(join(configDir, 'scripts', 'addons', 'blender_mcp.py'))
      }
    })
  )
  return apps.filter((item): item is McpDetectedApp => item !== null)
}

/* ------------------------------------------------------ the Python runtime */

function venvDir(): string {
  return join(app.getPath('userData'), 'mcp-env')
}

function venvPython(): string {
  return process.platform === 'win32'
    ? join(venvDir(), 'Scripts', 'python.exe')
    : join(venvDir(), 'bin', 'python')
}

function runtimeInstalled(): boolean {
  const python = venvPython()
  if (!existsSync(python)) return false
  const probe = runSyncProbe(python)
  return probe
}

function runSyncProbe(python: string): boolean {
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
  try {
    execFileSync(python, ['-c', 'import blender_mcp'], { timeout: 20000, windowsHide: true })
    return true
  } catch {
    return false
  }
}

/** Base Pythons worth trying, best first. */
function basePythonCandidates(): string[][] {
  const candidates: string[][] = [['py', '-3'], ['python']]
  const localPrograms = join(app.getPath('home'), 'AppData', 'Local', 'Programs', 'Python')
  try {
    const versions = readdirSync(localPrograms)
      .filter((name) => /^Python3\d+$/.test(name))
      .sort()
      .reverse()
    for (const version of versions) {
      candidates.unshift([join(localPrograms, version, 'python.exe')])
    }
  } catch {
    // No per-user installs.
  }
  return candidates
}

async function ensureRuntime(): Promise<string> {
  const python = venvPython()
  if (runtimeInstalled()) {
    setupLine('The Python environment for connectors is already in place.')
    return python
  }

  mkdirSync(venvDir(), { recursive: true })
  if (!existsSync(python)) {
    let created = false
    for (const candidate of basePythonCandidates()) {
      const exe = candidate[0]
      setupLine(`Creating a dedicated Python environment with ${exe} …`)
      const result = await run(candidate[0], [...candidate.slice(1), '-m', 'venv', venvDir()], { timeoutMs: 180000 })
      if (result.ok && existsSync(python)) {
        created = true
        break
      }
      setupLine(`${exe} did not work (no suitable Python 3.10+ found).`, 'error')
    }
    if (!created) {
      throw new Error('No Python 3.10+ found on this computer. Install Python from python.org and try again.')
    }
  }

  setupLine(`Installing ${RUNTIME_PACKAGE} (this can take a minute or two) …`)
  const install = await run(
    python,
    ['-m', 'pip', 'install', '--disable-pip-version-check', RUNTIME_PACKAGE],
    { timeoutMs: 600000, echo: true }
  )
  if (!install.ok || !runSyncProbe(python)) {
    throw new Error(`Could not install ${RUNTIME_PACKAGE}. See the log lines above.`)
  }
  setupLine('The Python environment is ready.')
  return python
}

/* ----------------------------------------------------- the Godot connector */

/**
 * Godot needs no addon: the community godot-mcp server drives the editor
 * through its command line, so the setup only has to find the executable and
 * hand it to the server via GODOT_PATH.
 */
const GODOT_SERVER_NAME = 'godot'

function godotSearchDirs(): string[] {
  const home = app.getPath('home')
  return [
    join(home, 'AppData', 'Local', 'Godot'),
    join(home, 'AppData', 'Roaming', 'Godot'),
    'C:\\Program Files\\Godot',
    'C:\\Program Files (x86)\\Godot',
    'D:\\Godot',
    join(home, 'Downloads'),
    join(home, 'Загрузки'),
    home
  ]
}

/**
 * A depth-3 walk of the home folder is hundreds of milliseconds of synchronous
 * `readdir` on a good day and minutes on a full drive. It now runs on the
 * async pool under an entry/time budget, so the window keeps painting while it
 * works — a missing Godot is better than a frozen one.
 */
const GODOT_SCAN_MAX_ENTRIES = 30_000
const GODOT_SCAN_BUDGET_MS = 4_000

async function godotExeCandidates(): Promise<string[]> {
  const out: string[] = []
  const ignored = new Set(['ElevatedDiagnostics', 'Windows', 'System32', 'Temp'])
  const deadline = Date.now() + GODOT_SCAN_BUDGET_MS
  let visited = 0
  const exhausted = (): boolean => visited >= GODOT_SCAN_MAX_ENTRIES || Date.now() > deadline
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (depth > 3 || exhausted()) return
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      // Protected directories (EPERM) are simply skipped.
      return
    }
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue
      visited += 1
      if (exhausted()) return
      const full = join(dir, entry.name)
      try {
        if (entry.isDirectory()) await visit(full, depth + 1)
        else if (/^godot.*\.exe$/i.test(entry.name)) out.push(full)
      } catch {
        // One unreadable entry must not kill the whole scan.
      }
    }
  }
  for (const dir of godotSearchDirs()) await visit(dir, 0)
  return out
}

async function detectGodot(): Promise<McpDetectedApp[]> {
  if (process.platform !== 'win32') return []
  const seen = new Set<string>()
  return (await godotExeCandidates())
    .filter((exePath) => {
      const key = exePath.toLowerCase()
      if (seen.has(key) || /_console\.exe$|\.tmp$/i.test(exePath)) return false
      seen.add(key)
      return true
    })
    .map((exePath) => ({
      app: 'godot',
      label: `Godot — ${basename(exePath)}`,
      exePath,
      version: null,
      configDir: null,
      addonInstalled: false
    }))
}

async function setupGodot(exePath: string | null): Promise<McpSetupResult> {
  setupLine('Setting up the Godot connector …')
  const resolved = exePath ?? (await godotExeCandidates())[0] ?? null
  if (!resolved || !existsSync(resolved)) {
    const message = 'Godot not found on this computer. Install it, or add the godot server manually with GODOT_PATH set.'
    setupLine(message, 'error')
    return { ok: false, error: message, serverName: null }
  }
  setupLine(`Found Godot: ${resolved}`)
  setupLine('Registering the godot MCP server (it runs via npx and needs Node.js) …')
  invalidateDetectCache()
  saveServer({
    name: GODOT_SERVER_NAME,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'godot-mcp'],
    env: { GODOT_PATH: resolved },
    cwd: '',
    url: '',
    enabled: true,
    trusted: false,
    defaultRisk: 'exec',
    toolRisk: {},
    disabledTools: [],
    timeoutMs: 120000
  })
  ensurePlaybook(
    GODOT_SERVER_NAME,
    `# Godot playbook\n\nThe godot MCP server drives the Godot editor through its command line.\n\nRules:\n- Use the godot tools for anything inside the engine: opening the project in the editor, running the current scene, capturing debug output.\n- The executable is fixed via GODOT_PATH; never try to launch Godot with run_command.\n- Godot must not be already running with the same project open, or the launch fails.\n`
  )
  setupLine('Done. Trust the godot server and connect.')
  return { ok: true, error: null, serverName: GODOT_SERVER_NAME }
}

/* --------------------------------------------------------------- setup flow */

const BLENDER_SERVER_NAME = 'blender'

export interface McpSetupResult {
  ok: boolean
  error: string | null
  serverName: string | null
}

/** Marks a playbook this app generated, as opposed to one the user rewrote. */
const ARTCRAFT_PLAYBOOK_MARKER = '<!-- relaxcode:artcraft-playbook -->'

/**
 * Keep the generated playbook in step with the connector mode and folder, but
 * never overwrite text the user wrote themselves (their copy has no marker).
 */
function refreshArtCraftPlaybook(id: ArtCraftAppId, ws: string, mode: ArtCraftConnectMode): void {
  const serverName = artCraftServerName(id)
  const existing = getPlaybook(serverName)
  if (existing === null || existing.includes(ARTCRAFT_PLAYBOOK_MARKER)) {
    setPlaybook(serverName, artCraftPlaybook(id, ws, mode))
  }
}

/**
 * Registers one Craft app's own MCP server. The CLI ships with the app, so no
 * runtime has to be installed. A connector is never registered without a
 * granted folder: a server with no read/write root can list commands but
 * cannot open, save or export a single file, which is exactly the broken state
 * users used to hit.
 *
 * `headless` starts `<app>-cli mcp` with the workspace as its root.
 * `live` starts the desktop app with its control channel and roots, then
 * points the MCP server at that window, so the agent edits the document the
 * user actually has open.
 */
async function setupArtCraft(
  appId: string,
  cliPathInput: string | null,
  workspace: string,
  mode: ArtCraftConnectMode = 'headless'
): Promise<McpSetupResult> {
  const def = artCraftApp(appId)
  if (!def) return { ok: false, error: 'unknown-app', serverName: null }
  setupLine(`Setting up the ${def.label} connector …`)

  const ws = workspace.trim()
  if (ws.length === 0) {
    const message =
      `Open a project folder first. The connector grants that folder to ${def.label} so the agent can open, save and export files; without it every file operation is refused.`
    setupLine(message, 'error')
    return { ok: false, error: 'no-workspace', serverName: null }
  }
  if (!existsSync(ws)) {
    const message = `The project folder does not exist: ${ws}. Open an existing folder and connect the connector again.`
    setupLine(message, 'error')
    return { ok: false, error: 'workspace-missing', serverName: null }
  }

  const manual = cliPathInput?.trim() ?? ''
  const cliPath =
    manual.length > 0 && existsSync(manual) ? manual : firstExisting(craftCliCandidates(def))
  if (!cliPath) {
    const message = `${def.label} is not installed (its MCP server ships as ${def.cli}). Install it with ArtCraft Launcher from ${def.site} and run the detection again.`
    setupLine(message, 'error')
    return { ok: false, error: message, serverName: null }
  }
  setupLine(`Found ${def.cli}: ${cliPath}`)

  // PhotoCraft's AppImage offers the same CLI through a global --cli switch.
  const prefix =
    process.platform !== 'win32' && def.id === 'photocraft' && /\.AppImage$/i.test(cliPath)
      ? ['--cli']
      : []
  const serverName = artCraftServerName(def.id)
  let args: string[]

  // A re-grant or a mode switch runs the same executable the user already
  // approved. Keep that trust decision: only the folder and the flags change,
  // and the new command line is visible in the card. Without this the server
  // silently lands untrusted, the Connect button stays disabled, and pressing
  // "Connect" looks like nothing happens.
  const previous = listStates().find((entry) => entry.config.name === serverName)
  const sameExe =
    previous !== undefined &&
    (process.platform === 'win32'
      ? previous.config.command.trim().toLowerCase() === cliPath.trim().toLowerCase()
      : previous.config.command.trim() === cliPath.trim())
  const keepTrust = sameExe && previous?.config.trusted === true

  if (mode === 'live') {
    if (!def.bridge) {
      const message = `${def.label} does not expose a live control channel; connect it in headless mode instead.`
      setupLine(message, 'error')
      return { ok: false, error: 'live-unsupported', serverName: null }
    }
    const guiPath = firstExisting(craftGuiCandidates(def))
    if (!guiPath) {
      const message = `The ${def.label} desktop app was not found, so the live connector cannot start it. Install the app from ${def.site}, then try again.`
      setupLine(message, 'error')
      return { ok: false, error: 'gui-not-found', serverName: null }
    }

    let port: number
    try {
      port = await freeControlPort()
    } catch {
      const message = 'Could not reserve a loopback port for the live control channel.'
      setupLine(message, 'error')
      return { ok: false, error: 'no-port', serverName: null }
    }
    const tokenFile = artCraftControlTokenFile(def.id)
    setupLine(`Starting ${def.label} with the live control channel on 127.0.0.1:${port} …`)
    let child: ReturnType<typeof spawn> | null = null
    try {
      child = spawn(guiPath, artCraftControlArgs(def.id, port, tokenFile, ws), {
        cwd: ws,
        detached: true,
        stdio: 'ignore'
      })
      child.once('error', (error) => {
        setupLine(`${def.label} did not start: ${error.message}`, 'error')
      })
      child.unref()
    } catch (error) {
      const message = `${def.label} did not start: ${error instanceof Error ? error.message : String(error)}`
      setupLine(message, 'error')
      return { ok: false, error: message, serverName: null }
    }
    // Do not report success until the window actually answers: a config saved
    // against a silent port is a connector that can never connect, which looks
    // exactly like "the button does nothing".
    if (!(await waitForControlPort(port, 30000))) {
      try {
        child?.kill()
      } catch {
        // The process may already be gone.
      }
      const message = `${def.label} opened, but its control channel did not answer on 127.0.0.1:${port} within 30 s. Close any other ${def.label} windows you started yourself and try again.`
      setupLine(message, 'error')
      return { ok: false, error: 'control-port-timeout', serverName: null }
    }
    setupLine(`${def.label} is up and listening on 127.0.0.1:${port}.`)
    args = [...prefix, ...artCraftBridgeMcpArgs(def.id, port, tokenFile)]
  } else {
    args = [...prefix, ...artCraftMcpArgs(def.id, ws)]
  }

  setupLine(`Registering the ${serverName} MCP server (${mode}) …`)
  invalidateDetectCache()
  saveServer({
    name: serverName,
    transport: 'stdio',
    command: cliPath,
    args,
    env: {},
    cwd: ws,
    url: '',
    enabled: true,
    trusted: false,
    defaultRisk: 'exec',
    // The command registry and document inspection are safe to run without a
    // separate confirmation; everything else keeps the server's default risk.
    toolRisk: {
      command_list: 'read',
      list_commands: 'read',
      doc_inspect: 'read',
      inspect_document: 'read',
      read_range: 'read',
      evaluate_formula: 'read',
      ui_inspect: 'read',
      session_list: 'read',
      jobs_list: 'read'
    },
    disabledTools: [],
    timeoutMs: artCraftTimeoutMs(def.id)
  })
  // The same executable, only a new folder/mode: the user's earlier approval
  // still stands, and the server stays connectable in one click.
  if (keepTrust) trustServer(serverName)
  // Re-point the generated playbook at the current project and mode, but never
  // overwrite one the user has rewritten (the template carries a marker).
  refreshArtCraftPlaybook(def.id, ws, mode)
  setupLine(
    keepTrust
      ? `Done. ${def.label} is reconnected to the open folder${mode === 'live' ? ' in the live window' : ''}.`
      : `Done. Trust the ${serverName} server and connect it; the agent can then drive ${def.label}${mode === 'live' ? ' in the live window' : ''}.`
  )
  return { ok: true, error: null, serverName }
}

/**
 * Before connecting a Craft app, make sure its registered folder is the one
 * that is open now. Older RelaxCode versions could register a server with no
 * root at all, and switching projects leaves the previous folder behind; in
 * both cases the server connects, lists its tools, and then refuses every
 * doc_open/doc_save. Re-pointing the server here (same mode, same executable)
 * makes the "Connect" button produce a usable connector again. The trust
 * decision is kept because the user already approved this exact program and
 * the new root only narrows what it can touch.
 */
export async function prepareArtCraftForWorkspace(
  name: string,
  workspace: string
): Promise<{ ok: boolean; error: string | null; changed: boolean }> {
  if (!isArtCraftAppId(name)) return { ok: true, error: null, changed: false }
  const def = artCraftApp(name)
  if (!def) return { ok: true, error: null, changed: false }
  const state = listStates().find((entry) => entry.config.name === name)
  if (!state) return { ok: true, error: null, changed: false }

  const ws = workspace.trim()
  const roots = def.roots !== 'none'
  const mode = artCraftServerMode(state.config.args)
  const current =
    mode === 'live' || !roots
      ? state.config.cwd.trim()
      : (artCraftGrantedRoot(def.id, state.config.args) ?? '')

  if (current.length > 0 && sameArtCraftFolder(current, ws)) {
    // The root is fine, but the generated playbook may come from an older
    // RelaxCode that did not warn about headless sessions.
    refreshArtCraftPlaybook(def.id, ws, mode)
    return { ok: true, error: null, changed: false }
  }
  if (ws.length === 0) {
    if (!roots) return { ok: true, error: null, changed: false }
    return {
      ok: false,
      error: `Open a project folder first: ${def.label} needs a folder it may read and write.`,
      changed: false
    }
  }

  const wasTrusted = state.config.trusted
  const result = await setupArtCraft(def.id, state.config.command, ws, mode)
  if (!result.ok) {
    const error =
      result.error === 'no-workspace'
        ? `Open a project folder first: ${def.label} needs a folder it may read and write.`
        : result.error === 'workspace-missing'
          ? `The project folder no longer exists: ${ws}. Open an existing folder and connect again.`
          : result.error
    return { ok: false, error, changed: false }
  }
  if (wasTrusted) trustServer(name)
  setupLine(`Reconnected ${def.label} to the open project folder: ${ws}`)
  return { ok: true, error: null, changed: true }
}

async function setupBlender(): Promise<McpSetupResult> {
  setupLine('Setting up the Blender connector …')
  let python: string
  try {
    python = await ensureRuntime()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setupLine(message, 'error')
    return { ok: false, error: message, serverName: null }
  }

  setupLine('Installing the addon into Blender (latest version bundled with the server) …')
  const addon = await run(python, ['-m', 'blender_mcp.server', 'install-addon'], { timeoutMs: 120000, echo: true })
  if (!addon.ok) {
    const message = 'The addon installer failed. Is Blender installed? See the log lines above.'
    setupLine(message, 'error')
    return { ok: false, error: message, serverName: null }
  }

  setupLine('Registering the blender MCP server (it stays untrusted until you confirm) …')
  // The addon just landed on disk: the cached scan still says "not installed".
  invalidateDetectCache()
  saveServer({
    name: BLENDER_SERVER_NAME,
    transport: 'stdio',
    command: python,
    args: ['-m', 'blender_mcp.server'],
    // UTF-8 for the server too: its stdio JSON-RPC carries Russian text, and a
    // cp1251 child would mangle or choke on it.
    env: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    cwd: '',
    url: '',
    enabled: true,
    trusted: false,
    defaultRisk: 'exec',
    toolRisk: {},
    disabledTools: [],
    // Scene builds (forests, particle systems) regularly run over a minute
    // of Blender work; a too-eager timeout kills the call mid-build.
    timeoutMs: 300000
  })
  ensurePlaybook(BLENDER_SERVER_NAME, BLENDER_PLAYBOOK)

  setupLine('Done. Trust the blender server and connect; start Blender with its MCP server enabled.')
  return { ok: true, error: null, serverName: BLENDER_SERVER_NAME }
}

export function setupConnector(
  appId: string,
  exePath?: string,
  workspace = '',
  mode: ArtCraftConnectMode = 'headless'
): Promise<McpSetupResult> {
  if (appId === 'blender') return setupBlender()
  if (appId === 'godot') return setupGodot(exePath ?? null)
  if (isArtCraftAppId(appId)) return setupArtCraft(appId, exePath ?? null, workspace, mode)
  return Promise.resolve({ ok: false, error: 'unknown-app', serverName: null })
}

/**
 * Launches a desktop app. For a live ArtCraft connector the launch repeats the
 * exact control-channel arguments from its registered server, so restarting
 * PhotoCraft from Settings reconnects the agent to the window it drives; a
 * plain launch or a headless connector opens the app normally.
 */
export async function launchApp(
  appId: string,
  exePath: string
): Promise<{ ok: boolean; error: string | null }> {
  if (appId !== 'blender' && appId !== ARTCRAFT_LAUNCHER_ID && !isArtCraftAppId(appId)) {
    return { ok: false, error: 'unknown-app' }
  }
  if (!existsSync(exePath)) return { ok: false, error: 'app-not-found' }
  try {
    if (isArtCraftAppId(appId)) {
      const def = artCraftApp(appId)
      const config = listStates().find((state) => state.name === artCraftServerName(appId))?.config
      if (def?.bridge && config && artCraftServerMode(config.args) === 'live') {
        const port = artCraftBridgePort(config.args)
        const tokenFile = artCraftBridgeTokenFile(config.args)
        const root = config.cwd.trim()
        if (port && tokenFile && root.length > 0 && existsSync(root)) {
          if (await controlPortOpen(port)) {
            setupLine(`${def.label} is already running with the live connector on 127.0.0.1:${port}.`)
            return { ok: true, error: null }
          }
          const child = spawn(exePath, artCraftControlArgs(appId, port, tokenFile, root), {
            cwd: root,
            detached: true,
            stdio: 'ignore'
          })
          child.once('error', (error) => {
            setupLine(`${def.label} did not start: ${error.message}`, 'error')
          })
          child.unref()
          setupLine(`Launched ${exePath} with the live control channel on 127.0.0.1:${port}.`)
          return { ok: true, error: null }
        }
      }
    }
    if (appId === ARTCRAFT_LAUNCHER_ID || isArtCraftAppId(appId)) {
      const child = spawn(exePath, [], { detached: true, stdio: 'ignore' })
      child.unref()
      setupLine(`Launched ${exePath}.`)
      return { ok: true, error: null }
    }
    const script = join(app.getPath('userData'), 'blender-mcp-start.py')
    writeFileSync(
      script,
      [
        '# Written by RelaxCode: starts the MCP for Blender socket server.',
        'import bpy',
        'try:',
        '    bpy.ops.blendermcp.start_server()',
        '    print("RelaxCode: Blender MCP server started")',
        'except Exception as exc:',
        '    print("RelaxCode: could not auto-start the MCP server:", exc)'
      ].join('\n'),
      'utf8'
    )
    const child = spawn(exePath, ['--python', script], { detached: true, stdio: 'ignore' })
    child.unref()
    setupLine(`Launched ${exePath} with the MCP server start script.`)
    return { ok: true, error: null }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/* ------------------------------------------------------------------ playbooks */

function playbookDir(): string {
  return join(app.getPath('userData'), 'playbooks')
}

function playbookPath(server: string): string {
  return join(playbookDir(), playbookFileName(server))
}

export function getPlaybook(server: string): string | null {
  try {
    if (!existsSync(playbookPath(server))) return null
    return readFileSync(playbookPath(server), 'utf8')
  } catch {
    return null
  }
}

export function setPlaybook(server: string, text: string): { ok: boolean } {
  try {
    mkdirSync(playbookDir(), { recursive: true })
    writeFileSync(playbookPath(server), text, 'utf8')
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

function ensurePlaybook(server: string, template: string): void {
  if (getPlaybook(server) !== null) return
  setPlaybook(server, template)
}

/** Playbook text for every connected server that has one (clipped for the prompt). */
export function activePlaybooks(): Array<{ server: string; text: string }> {
  const out: Array<{ server: string; text: string }> = []
  for (const state of listStates()) {
    if (state.status !== 'ready' || !state.config.enabled || !state.config.trusted) continue
    const text = getPlaybook(state.config.name)
    if (text && text.trim().length > 0) {
      out.push({ server: state.config.name, text: text.trim().slice(0, 6000) })
    }
  }
  return out
}

const BLENDER_PLAYBOOK = `# Blender playbook

You are controlling Blender on this computer through MCP tools (mcp__blender__…).

## Tools
- \`get_scene_info\` — read the scene: objects, locations, sizes, counts, selected, mode. Call it before changing anything and after significant changes.
- \`execute_blender_code\` — runs arbitrary bpy Python inside Blender. Your main instrument: write clear, small, correct bpy scripts.
- \`look\` — captures the current viewport screenshot (PNG). Use it to SEE what the scene looks like; verify visually after building something.
- \`blender_recipe\` — appears only when offered: ready-made scene operations (clear_scene, terrain, forest, rocks, sunset_light, moon_light, camera_shot, render_preview, material_color, save_blend). When it is in your tool list, PREFER it over hand-written bpy — pick a recipe, pass arguments, omit for good defaults. When it is not listed, write the code yourself.
- \`search_assets\` / \`import_asset\` / \`generate_3d\` — asset and AI-generation helpers (external services).

## Workflow
1. Read the scene first: get_scene_info.
2. Plan the steps; for a big task write a todo list.
3. If blender_recipe is offered, build by chaining recipes (clear_scene → terrain → forest → rocks → sunset_light → camera_shot → render_preview); otherwise write bpy code in small batches.
4. After each meaningful step call get_scene_info (and look when the visual result matters).
5. For a preview render: render via blender_recipe when offered, else set scene.render settings and call bpy.ops.render.render(write_still=True) with the output INSIDE the workspace; then show_image the file.
6. Before a wide-ranging change to a saved .blend, call backup_file on it — the agent can restore the original if the bulk edit goes wrong.
7. Save the .blend when the user asks or after a backup.

## Pitfalls
- Blender must run with a GUI; the socket server refuses headless (-b) mode.
- Python runs on Blender's main thread via a timer queue: code is queued, results come back when Blender is idle. Do not send dozens of tiny calls; batch them.
- bpy.app.timers is the only safe way to touch bpy from threads — the addon already does this for you.
- Coordinates: Z is up; default units are metres. The default Cube is 2x2x2.
- If a call times out, Blender may be busy (rendering, importing). Wait and retry once before reporting failure.
- Text/scripts you create should live inside the workspace folder so the user keeps them.`
