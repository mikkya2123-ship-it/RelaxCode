import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import {
  playbookFileName,
  type McpDetectedApp
} from '@shared/mcp'
import { emitMcpEvent, listStates, saveServer } from './mcp'
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

function registryBlenderPaths(): BlenderCandidate[] {
  const found: BlenderCandidate[] = []
  const hives = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  ]
  for (const hive of hives) {
    try {
      const { ok, output } = runRegistry(hive)
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

function runRegistry(hive: string): { ok: boolean; output: string } {
  // Synchronous here is fine: detection runs on an explicit user action.
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
  try {
    const output = execFileSync('reg', ['query', hive, '/s', '/f', 'Blender', '/d'], {
      timeout: 15000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true
    })
    return { ok: true, output: output.toString() }
  } catch (error) {
    const err = error as { stdout?: Buffer }
    return { ok: false, output: err.stdout?.toString() ?? '' }
  }
}

function programFilesBlenderPaths(): BlenderCandidate[] {
  const found: BlenderCandidate[] = []
  for (const base of ['C:\\Program Files\\Blender Foundation', 'C:\\Program Files (x86)\\Blender Foundation']) {
    try {
      if (!existsSync(base)) continue
      for (const version of readdirSync(base)) {
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

export async function detectApps(appId: string): Promise<McpDetectedApp[]> {
  if (appId !== 'blender') return []
  if (process.platform !== 'win32') return []

  const candidates = [...registryBlenderPaths(), ...programFilesBlenderPaths()]
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

/* --------------------------------------------------------------- setup flow */

const BLENDER_SERVER_NAME = 'blender'

export interface McpSetupResult {
  ok: boolean
  error: string | null
  serverName: string | null
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

export function setupConnector(appId: string): Promise<McpSetupResult> {
  if (appId === 'blender') return setupBlender()
  return Promise.resolve({ ok: false, error: 'unknown-app', serverName: null })
}

/** Launches the app with its MCP server auto-started (Blender: GUI + --python). */
export function launchApp(appId: string, exePath: string): { ok: boolean; error: string | null } {
  if (appId !== 'blender') return { ok: false, error: 'unknown-app' }
  if (!existsSync(exePath)) return { ok: false, error: 'app-not-found' }
  try {
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
