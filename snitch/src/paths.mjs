import { existsSync, promises as fs, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Everything Snitch owns lives under this folder; nothing outside is written. */
export const SNITCH_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const DATA_DIR = process.env.SNITCH_DATA_DIR
  ? resolve(process.env.SNITCH_DATA_DIR)
  : join(SNITCH_ROOT, 'data')
export const OUT_DIR = process.env.SNITCH_OUT_DIR
  ? resolve(process.env.SNITCH_OUT_DIR)
  : join(SNITCH_ROOT, 'out')
export const PUBLIC_DIR = join(SNITCH_ROOT, 'public')
export const ARCHIVE_DIR = join(DATA_DIR, 'archive')
export const STATE_FILE = join(DATA_DIR, 'state.json')
export const CONFIG_FILE = join(DATA_DIR, 'config.json')
export const SNITCH_LOG_FILE = join(DATA_DIR, 'snitch.log')

export function exists(path) {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

export function statSafe(path) {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

function mtimeOf(path) {
  return statSafe(path)?.mtimeMs ?? 0
}

/**
 * Profile folders RelayCode may use. `relaxcode` is current, `easycode` is the
 * pre-rename profile; both are checked because a user can still be running the
 * old build.
 */
export function candidateUserDataDirs() {
  const home = homedir()
  const candidates = []
  if (process.env.APPDATA) {
    candidates.push(join(process.env.APPDATA, 'relaxcode'))
    candidates.push(join(process.env.APPDATA, 'easycode'))
  }
  if (process.platform === 'darwin') {
    candidates.push(join(home, 'Library', 'Application Support', 'relaxcode'))
    candidates.push(join(home, 'Library', 'Application Support', 'easycode'))
  }
  const configHome = process.env.XDG_CONFIG_HOME || join(home, '.config')
  candidates.push(join(configHome, 'relaxcode'))
  candidates.push(join(configHome, 'easycode'))
  // A portable copy can point Snitch at its own profile folder.
  if (process.env.RELAXCODE_USER_DATA) candidates.unshift(process.env.RELAXCODE_USER_DATA)
  if (process.env.EASYCODE_USER_DATA) candidates.unshift(process.env.EASYCODE_USER_DATA)
  return [...new Set(candidates.map((path) => resolve(path)))]
}

/** A folder is a usable profile when it has settings or an exchanges folder. */
export function isUserDataDir(path) {
  if (!path) return false
  return exists(join(path, 'settings.json')) || exists(join(path, 'exchanges'))
}

export function detectUserDataDir(explicit) {
  if (explicit && isUserDataDir(explicit)) return resolve(explicit)
  const found = candidateUserDataDirs()
    .filter(isUserDataDir)
    .map((path) => ({
      path,
      score:
        (exists(join(path, 'exchanges')) ? 2 : 0) +
        (exists(join(path, 'settings.json')) ? 1 : 0) +
        mtimeOf(join(path, 'settings.json')) / 1e13
    }))
    .sort((a, b) => b.score - a.score)
  return found[0]?.path ?? null
}

/** Never returns the encrypted blobs — only the public picture of the app. */
export async function readAppSettings(userDataDir) {
  if (!userDataDir) return null
  const file = join(userDataDir, 'settings.json')
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    const providers = Array.isArray(raw.providers) ? raw.providers : []
    const active = providers.find((provider) => provider?.id === raw.activeProviderId) ?? providers[0]
    return {
      approvalMode: typeof raw.approvalMode === 'string' ? raw.approvalMode : 'ask',
      uiLanguage: raw.ui?.language ?? 'system',
      logLevel: raw.notifications?.logLevel ?? 'error',
      logRequests: raw.notifications?.logRequests === true,
      model: typeof active?.model === 'string' ? active.model : null,
      providerName: typeof active?.name === 'string' ? active.name : null,
      baseUrl: typeof active?.baseUrl === 'string' ? active.baseUrl : null,
      agent: {
        maxSteps: raw.agent?.maxSteps ?? null,
        responseLanguage: raw.agent?.responseLanguage ?? 'auto',
        tokenSaving: raw.agent?.tokenSaving ?? 'off',
        defaultThinking: raw.chat?.defaultThinking ?? 'off',
        timeTravel: raw.agent?.timeTravel !== false,
        selfReview: raw.agent?.selfReview !== false
      },
      servers: {
        allowRunCommand: raw.servers?.allowRunCommand !== false,
        allowBackground: raw.servers?.allowBackground !== false,
        terminalShell: raw.servers?.terminalShell ?? 'auto',
        commandTimeoutMs: raw.servers?.commandTimeoutMs ?? null,
        protectTerminal: raw.servers?.protectTerminal !== false
      },
      recentWorkspaces: Array.isArray(raw.recentWorkspaces)
        ? raw.recentWorkspaces.filter((item) => typeof item === 'string').slice(0, 12)
        : []
    }
  } catch {
    return null
  }
}

export function detectLogFile(userDataDir) {
  if (!userDataDir) return null
  for (const name of ['relaxcode.log', 'easycode.log']) {
    const file = join(userDataDir, name)
    if (exists(file)) return file
  }
  return null
}

/** Chromium writes the real DevTools port here when remote debugging is on. */
export function detectDevToolsPort(userDataDir) {
  if (!userDataDir) return null
  try {
    const text = readFileSync(join(userDataDir, 'DevToolsActivePort'), 'utf8')
    const port = Number.parseInt(String(text).split(/\r?\n/)[0], 10)
    return Number.isInteger(port) && port > 0 ? port : null
  } catch {
    return null
  }
}

export async function detectWorkspace(userDataDir, explicit) {
  if (explicit && exists(explicit)) return resolve(explicit)
  const settings = await readAppSettings(userDataDir)
  const recent = settings?.recentWorkspaces ?? []
  return recent.find((path) => exists(path)) ?? recent[0] ?? null
}

export function exchangesDir(userDataDir) {
  return userDataDir ? join(userDataDir, 'exchanges') : null
}

export function framesDir(userDataDir) {
  return userDataDir ? join(userDataDir, 'frames') : null
}

export function mcpFile(userDataDir) {
  return userDataDir ? join(userDataDir, 'mcp.json') : null
}

export function modelMemoryFile(userDataDir) {
  return userDataDir ? join(userDataDir, 'model-memory.json') : null
}

export function backupsDir(userDataDir) {
  return userDataDir ? join(userDataDir, 'backups') : null
}

export async function listExchangeFiles(userDataDir) {
  const dir = exchangesDir(userDataDir)
  if (!dir) return []
  try {
    const names = await fs.readdir(dir)
    const files = []
    for (const name of names) {
      if (!name.endsWith('.json') || name === 'latest.json') continue
      const path = join(dir, name)
      const stat = statSafe(path)
      if (!stat?.isFile()) continue
      files.push({ path, name, size: stat.size, mtimeMs: stat.mtimeMs })
    }
    return files.sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

export async function fileSize(path) {
  try {
    return (await fs.stat(path)).size
  } catch {
    return null
  }
}

export const projectRoot = resolve(SNITCH_ROOT, '..')
