import { app, BrowserWindow, shell } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { IPC } from '@shared/ipc'
import { releaseNotesLines, type UpdateState } from '@shared/updater'
import { logEvent } from './logger'

/**
 * In-app updates from the GitHub releases of the project.
 *
 * electron-updater reads `latest.yml` from the newest release, verifies the
 * installer against the sha512 it lists and hands the file to NSIS. Downloads
 * never start on their own: a release is only reported, and the user decides
 * in the title-bar dialog whether to fetch and install it.
 */

const OWNER = 'mikkya2123-ship-it'
const REPO = 'RelaxCode'

const FIRST_CHECK_DELAY_MS = 8_000
const CHECK_EVERY_MS = 90 * 60 * 1000
const RETRY_AFTER_FAILURE_MS = 30 * 60 * 1000

/** A dev preview of the whole flow: RELAXCODE_UPDATE_DEMO=1 npm run dev. */
const DEMO = !app.isPackaged && process.env.RELAXCODE_UPDATE_DEMO === '1'

function initialState(): UpdateState {
  return {
    phase: 'idle',
    current: app.getVersion(),
    version: null,
    notes: [],
    releaseDate: null,
    releaseUrl: null,
    progress: null,
    error: null,
    manual: !app.isPackaged
  }
}

let state: UpdateState = initialState()
let started = false
let installing = false
let checkTimer: NodeJS.Timeout | null = null
let retryTimer: NodeJS.Timeout | null = null
let demoTimer: NodeJS.Timeout | null = null

function publish(patch: Partial<UpdateState>): UpdateState {
  state = { ...state, ...patch, current: app.getVersion() }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.UPDATE_STATE, state)
  }
  return state
}

function releasePage(version: string | null): string {
  return version
    ? `https://github.com/${OWNER}/${REPO}/releases/tag/v${version}`
    : `https://github.com/${OWNER}/${REPO}/releases`
}

function notesFrom(info: UpdateInfo): string[] {
  return releaseNotesLines(info.releaseNotes ?? null)
}

function shortError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/\s+/g, ' ').trim().slice(0, 200)
}

function onAvailable(info: UpdateInfo): void {
  const notes = notesFrom(info)
  publish({
    phase: 'available',
    version: info.version,
    notes,
    releaseDate: info.releaseDate ?? null,
    releaseUrl: releasePage(info.version),
    progress: null,
    error: null
  })
  logEvent('info', `update available: ${info.version}`)
}

function armCheckTimer(): void {
  if (checkTimer) clearInterval(checkTimer)
  checkTimer = setInterval(() => void checkForUpdates(), CHECK_EVERY_MS)
  checkTimer.unref?.()
}

function armRetry(): void {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(() => void checkForUpdates(), RETRY_AFTER_FAILURE_MS)
  retryTimer.unref?.()
}

/** Starts the updater once, after the main window exists. */
export function startUpdater(): void {
  if (started) return
  started = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.autoRunAppAfterInstall = true
  // Development runs read `dev-app-update.yml` instead of the packaged config,
  // so the button and the dialog can be exercised without a release build.
  autoUpdater.forceDevUpdateConfig = !app.isPackaged
  autoUpdater.logger = {
    info: (message?: unknown) => logEvent('info', `update: ${String(message)}`),
    warn: (message?: unknown) => logEvent('warn', `update: ${String(message)}`),
    error: (message?: unknown) => logEvent('error', `update: ${String(message)}`),
    debug: (message?: unknown) => logEvent('debug', `update: ${String(message)}`)
  }

  autoUpdater.on('checking-for-update', () => {
    if (state.phase !== 'available' && state.phase !== 'downloading' && state.phase !== 'ready') {
      publish({ phase: 'checking', error: null })
    }
  })

  autoUpdater.on('update-available', onAvailable)

  autoUpdater.on('update-not-available', () => {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    publish({
      phase: 'up-to-date',
      version: null,
      notes: [],
      releaseDate: null,
      releaseUrl: null,
      progress: null,
      error: null
    })
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    publish({
      phase: 'downloading',
      progress: {
        percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total
      }
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    const notes = notesFrom(info)
    publish({
      phase: 'ready',
      version: info.version,
      notes: notes.length > 0 ? notes : state.notes,
      releaseDate: info.releaseDate ?? state.releaseDate,
      releaseUrl: releasePage(info.version),
      progress: { percent: 100, bytesPerSecond: 0, transferred: 0, total: 0 },
      error: null
    })
    logEvent('info', `update downloaded: ${info.version}`)
  })

  autoUpdater.on('error', (error: Error) => {
    const wasChecking = state.phase === 'checking'
    // A quiet background check must not put an error banner anywhere: the
    // button simply stays hidden and the next check tries again.
    publish({ phase: 'error', error: shortError(error), progress: null })
    logEvent('warn', `update error: ${shortError(error)}`)
    if (wasChecking) armRetry()
  })

  armCheckTimer()

  if (DEMO) {
    demoTimer = setTimeout(() => {
      publish({
        phase: 'available',
        version: bumpVersion(app.getVersion()),
        notes: [
          'Faster app start: the editor and the chat load in parallel.',
          'The updater now installs a new release without leaving the app.',
          'Fixed a crash when a project folder disappeared while the IDE was open.',
          'Smaller installer and a quieter first launch.'
        ],
        releaseDate: new Date().toISOString(),
        releaseUrl: releasePage(bumpVersion(app.getVersion())),
        progress: null,
        error: null
      })
    }, 1500)
    demoTimer.unref?.()
    return
  }

  const first = setTimeout(() => void checkForUpdates(), FIRST_CHECK_DELAY_MS)
  first.unref?.()
}

/** Only the newest patch of the installed version is demoed. */
function bumpVersion(version: string): string {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10) || 0)
  while (parts.length < 3) parts.push(0)
  parts[2] += 1
  return parts.slice(0, 3).join('.')
}

export function getUpdateState(): UpdateState {
  return state
}

/**
 * Asks GitHub for the newest release. A check never interrupts a download and
 * never replaces an update that is already waiting for a restart.
 */
export async function checkForUpdates(): Promise<UpdateState> {
  if (installing || DEMO) return state
  if (state.phase === 'downloading' || state.phase === 'ready') return state

  try {
    const result = await autoUpdater.checkForUpdates()
    // electron-updater emits the state events itself; the resolved result is a
    // fallback for the rare case where the event did not arrive.
    if (result?.updateInfo && result.updateInfo.version && state.phase === 'checking') {
      onAvailable(result.updateInfo)
    }
  } catch (error) {
    publish({ phase: 'error', error: shortError(error), progress: null })
    logEvent('warn', `update check failed: ${shortError(error)}`)
    armRetry()
  }
  return state
}

/** Downloads the pending release; progress arrives as update:state events. */
export async function downloadUpdate(): Promise<UpdateState> {
  if (installing) return state
  if (DEMO) return demoDownload()

  // An error without a known release came from the check itself: try again
  // before pretending there is something to download.
  if (state.phase === 'error' && !state.version) return checkForUpdates()

  const pending = state.phase === 'available' || state.phase === 'error'
  if (!pending || !state.version) return state

  publish({
    phase: 'downloading',
    error: null,
    progress: { percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 }
  })
  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    publish({ phase: 'error', error: shortError(error), progress: null })
    logEvent('warn', `update download failed: ${shortError(error)}`)
  }
  return state
}

/**
 * Restarts into the downloaded installer. Development runs cannot replace
 * themselves, so there the release page opens instead.
 */
export function installUpdate(): void {
  if (state.phase !== 'ready' || installing) return
  if (!app.isPackaged || DEMO) {
    void shell.openExternal(state.releaseUrl ?? releasePage(state.version))
    return
  }
  installing = true
  // Silent, per-user NSIS: no wizard, the app comes back on the new version.
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}

/** The demo flow: the dialog and the progress bar without a real release. */
function demoDownload(): UpdateState {
  if (state.phase !== 'available') return state
  let percent = 0
  publish({
    phase: 'downloading',
    error: null,
    progress: { percent, bytesPerSecond: 0, transferred: 0, total: 0 }
  })
  const step = setInterval(() => {
    percent = Math.min(100, percent + 12)
    if (percent >= 100) {
      clearInterval(step)
      publish({
        phase: 'ready',
        progress: { percent: 100, bytesPerSecond: 0, transferred: 0, total: 0 }
      })
      return
    }
    publish({
      phase: 'downloading',
      progress: {
        percent,
        bytesPerSecond: 6 * 1024 * 1024,
        transferred: Math.round((percent / 100) * 132 * 1024 * 1024),
        total: 132 * 1024 * 1024
      }
    })
  }, 180)
  return state
}
