import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, net, screen, shell, Tray } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The window icon in dev: electron-vite runs `out/main/index.js`, so the repo
 * root with `build/icon.ico` sits two levels up. A packaged build inherits the
 * icon from the exe, and the file simply is not there.
 */
function windowIcon(): string | undefined {
  const ico = join(__dirname, '../../build/icon.ico')
  return existsSync(ico) ? ico : undefined
}

/* --------------------------------------------------------------------------- *
 * Tray
 *
 * Closing the window hides it: the app, its runs and the dev servers stay
 * alive, and the tray icon brings everything back. "Выход" in the menu is the
 * only way to actually quit (besides killing the process).
 * --------------------------------------------------------------------------- */

let tray: Tray | null = null
let trayMenuWindow: BrowserWindow | null = null
let quitting = false
/** The "still running" balloon shows once per session, the first time the window hides. */
let trayHintShown = false

function trayIconPath(): string {
  if (process.platform === 'win32') {
    return windowIcon() ?? join(__dirname, '../../build/icon-256.png')
  }
  return join(__dirname, '../../build/icon-256.png')
}

/** Tray labels follow the interface language setting. */
function trayText(key: string): string {
  const ru = getSettings().ui.language === 'ru'
  const table: Record<string, [string, string]> = {
    show: ['Открыть RelaxCode', 'Open RelaxCode'],
    newChat: ['Новая задача', 'New task'],
    settings: ['Настройки', 'Settings'],
    background: ['Продолжать работу при закрытии окна', 'Keep running when the window is closed'],
    quit: ['Выход', 'Quit'],
    tooltip: ['RelaxCode — работает в фоне', 'RelaxCode — running in the background'],
    hintTitle: ['RelaxCode работает в фоне', 'RelaxCode keeps running'],
    hintText: [
      'Окно закрыто, но задачи и серверы продолжают работать. Открыть — иконка в трее.',
      'The window is closed, but tasks and servers keep running. Click the tray icon to reopen.'
    ]
  }
  const pair = table[key] ?? ['?', '?']
  return ru ? pair[0] : pair[1]
}

function showMainWindow(): void {
  const win = mainWindow
  if (!win) {
    createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function sendTrayCommand(command: string): void {
  showMainWindow()
  mainWindow?.webContents.send(IPC.TRAY_COMMAND, command)
}

/* The visible tray menu is a custom frameless window with the cosmic-shader
 * background; the native menu above stays as an accessibility/CLI fallback. */

const TRAY_MENU_WIDTH = 300
const TRAY_MENU_HEIGHT = 372

function createTrayMenuWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: TRAY_MENU_WIDTH,
    height: TRAY_MENU_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // The shader keeps animating even while the menu window is hidden, so
      // Windows cannot park its GL context between openings.
      backgroundThrottling: false
    }
  })
  // Any click outside — the menu loses focus — closes it, like a native popup.
  // The window is only hidden, never destroyed while the session lives: hiding
  // keeps DevTools attached and the renderer warm.
  win.on('blur', () => win.hide())
  win.on('closed', () => {
    trayMenuWindow = null
  })
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void win.loadURL(`${devUrl}#tray-menu`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'tray-menu' })
  return win
}

/** Opens the custom menu right above the tray icon. */
function showTrayMenu(trayBounds: Electron.Rectangle): void {
  if (!trayMenuWindow) trayMenuWindow = createTrayMenuWindow()
  const menu = trayMenuWindow
  const [display] = screen.getAllDisplays()
  const work = display?.workArea
  const x = Math.min(
    Math.max(
      trayBounds.x + trayBounds.width / 2 - TRAY_MENU_WIDTH / 2,
      work ? work.x + 8 : 8
    ),
    work ? work.x + work.width - TRAY_MENU_WIDTH - 8 : TRAY_MENU_WIDTH
  )
  const y = Math.max(
    trayBounds.y - TRAY_MENU_HEIGHT - 12,
    work ? work.y + 8 : 8
  )
  menu.setPosition(x, y, false)
  menu.webContents.send(IPC.TRAY_MENU_STATE, {
    closeToTray: getSettings().ui.closeToTray,
    language: getSettings().ui.language
  })
  menu.show()
  menu.focus()
  // Transparent Windows windows are known to blank their WebGL content after
  // a hide/show cycle; invalidating the compositor forces a fresh frame.
  menu.webContents.invalidate()
}

function hideTrayMenu(): void {
  trayMenuWindow?.hide()
}

function handleTrayMenuAction(action: string): void {
  hideTrayMenu()
  switch (action) {
    case 'open':
      showMainWindow()
      break
    case 'new-chat':
    case 'open-settings':
      sendTrayCommand(action)
      break
    case 'toggle-background':
      applySettingsPatch({ ui: { closeToTray: !getSettings().ui.closeToTray } })
      break
    case 'quit':
      quitting = true
      app.quit()
      break
    default:
      break
  }
}

function createTray(): void {
  if (tray) return
  try {
    tray = new Tray(trayIconPath())
    tray.setToolTip(trayText('tooltip'))
    // The custom cosmic menu opens above the icon.
    tray.on('right-click', (_event, bounds) => showTrayMenu(bounds ?? tray!.getBounds()))
    // A left click on Windows opens the window.
    tray.on('click', () => showMainWindow())
  } catch (error) {
    logFailure('tray', error instanceof Error ? error : new Error(String(error)))
  }
}

function hideToTray(): void {
  mainWindow?.hide()
  if (trayHintShown || process.platform !== 'win32') return
  trayHintShown = true
  try {
    tray?.displayBalloon({
      iconType: 'info',
      title: trayText('hintTitle'),
      content: trayText('hintText')
    })
  } catch {
    // A balloon is a nicety; failing to show one must not break the hide.
  }
}
import {
  IPC,
  type ApprovalRequest,
  type ApprovalResponse,
  type BackgroundProcessInfo,
  type ChatSendRequest,
  type DirEntry,
  type EntryCreateRequest,
  type McpDetectedApp,
  type McpImportResult,
  type McpInvokeResult,
  type McpSaveResult,
  type McpServerState,
  type McpSetupResult,
  type McpStartResult,
  type ModelsListOptions,
  type ModelsResult,
  type OpenFolderResult,
  type PublicSettings,
  type ReadFileResult,
  type ScreenSourceResult,
  type SteerResult,
  type SettingsFileResult,
  type SettingsPatch,
  type SettingsSaveResult,
  type UserReply,
  type WriteFileResult,
  type ArenaStyle
} from '@shared/ipc'
import type { TeamState, TeamTaskStatus } from '@shared/team'
import { startArena, pickArenaContestant, cancelArena, arenaActive, startSnapshotPreview, stopSnapshotPreview } from './arena'
import {
  beginTeamSession,
  getTeamState,
  saveTeamState,
  addTeamTask,
  setTeamTaskStatus,
  removeTeamTask,
  setTeamMe,
  getTeamMe,
  teamCommitAndPush,
  teamPull,
  teamPushRoster,
  teamGithubCreate,
  teamGithubCheck,
  applyMyScope,
  setTeamNotify
} from './team'
import {
  addRecentWorkspace,
  applySettingsPatch,
  getPublicSettings,
  getSettings,
  importSettings,
  reloadSettings,
  removeRecentWorkspace,
  resetSettings,
  revealSettingsFile,
  serializeSettings
} from './store'
import {
  exportServersJson,
  importServers,
  invokeTool,
  listStates,
  removeServer,
  saveServer,
  setNotify as setMcpNotify,
  startServer as startMcpServer,
  stopAllMcp,
  stopServer as stopMcpServer,
  trustServer
} from './mcp'
import {
  detectApps,
  getPlaybook,
  launchApp,
  setPlaybook,
  setupConnector
} from './apps'
import {
  disposeWorkspace,
  getWorkspaceRoot,
  readDir,
  setChangeListener,
  setWorkspaceRoot
} from './workspace'
import { createFileOps } from './fileOps'
import { readTextFile, writeTextFile } from './files'
import { listModels } from './chat'
import { abortChat, clearSessionApprovals, runAgent, setPaused, steerMessage, type ApprovalAnswer } from './agent'
import { listBackground, stopAllBackground, stopBackground } from './proc'
import { logEvent } from './logger'
import { t } from './i18n'
import { parseMcpToolName } from '@shared/mcp'
import type { ChatEvent } from '@shared/ipc'
import type { TerminalSessionInfo } from '@shared/ipc'
import { resolveUiReply, setUiWindow } from './ui-bridge'
import { restoreProjectSnapshot } from './tools-project'
import { createTerminal, closeTerminal, listTerminals, stopTerminal, terminalInput } from './term-sessions'
import { setWebSearchFetch } from './webSearch'

let mainWindow: BrowserWindow | null = null

const pendingApprovals = new Map<string, (answer: ApprovalAnswer) => void>()
const pendingQuestions = new Map<string, (answer: string) => void>()

function resolvePendingApprovals(): void {
  for (const resolve of pendingApprovals.values()) resolve({ decision: 'deny' })
  pendingApprovals.clear()
  for (const resolve of pendingQuestions.values()) resolve('(cancelled)')
  pendingQuestions.clear()
}

/**
 * A stray error in a background task must not silently close the IDE, and if
 * something does go wrong we want a trace on disk. Failures are appended to
 * `<userData>/relaxcode.log` and the app keeps running.
 */
function logFailure(kind: string, error: unknown): void {
  const detail =
    error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error)
  logEvent('error', `${kind}: ${detail}`)
}

setWebSearchFetch((input, init) => net.fetch(input, init))

process.on('uncaughtException', (error) => logFailure('uncaughtException', error))
process.on('unhandledRejection', (reason) => logFailure('unhandledRejection', reason))

app.commandLine.appendSwitch('host-resolver-rules', 'MAP localhost 127.0.0.1')

try {
  const proxy = getSettings().advanced.proxyUrl.trim()
  if (proxy.length > 0) app.commandLine.appendSwitch('proxy-server', proxy)
} catch {
  // Settings are unreadable at this point only on a fresh profile; defaults are fine.
}

// Dev-only escape hatch used by the smoke harness; the old EASYCODE name still works.
const debugPort = process.env.RELAXCODE_DEBUG_PORT ?? process.env.EASYCODE_DEBUG_PORT
if (debugPort) {
  app.commandLine.appendSwitch('remote-debugging-port', debugPort)
}

function createWindow(): void {
  const settings = getSettings()
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    icon: windowIcon(),
    backgroundColor: '#fafafa',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (settings.notifications.openDevTools) mainWindow?.webContents.openDevTools({ mode: 'detach' })
  })

  const sendMaximizedState = (): void => {
    mainWindow?.webContents.send(IPC.WINDOW_MAXIMIZED_CHANGED, mainWindow.isMaximized())
  }
  mainWindow.on('maximize', sendMaximizedState)
  mainWindow.on('unmaximize', sendMaximizedState)
  // Tools talk to this window through the ui-bridge (notifications, opening
  // files, speech, chat export, scheduled prompts).
  setUiWindow(mainWindow)
  mainWindow.on('closed', () => setUiWindow(null))

  // Closing the window keeps the app alive in the tray while the setting is on
  // and the user is not quitting: runs, servers and the MCP links stay up.
  mainWindow.on('close', (event) => {
    if (quitting || !getSettings().ui.closeToTray) return
    event.preventDefault()
    hideToTray()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.webContents.on('console-message', (details) => {
      console.log(`[renderer:${details.level}] ${details.message}`)
    })
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    let attempts = 0
    mainWindow.webContents.on('did-fail-load', (_event, _code, _description, validatedURL) => {
      if (!validatedURL.startsWith(devUrl) || attempts >= 20) return
      attempts += 1
      setTimeout(() => void mainWindow?.loadURL(devUrl), 400)
    })
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function openWorkspacePath(path: string): Promise<OpenFolderResult | null> {
  try {
    const resolved = await setWorkspaceRoot(path)
    addRecentWorkspace(resolved)
    clearSessionApprovals()
    return { path: resolved }
  } catch {
    removeRecentWorkspace(path)
    return null
  }
}

/**
 * Windows cannot capture a minimized window at all, so before the stream
 * starts the app's windows are restored via user32 — with SW_RESTORE, which
 * does not steal the user's focus. Best effort: a failed restore just means
 * the usual not-found hint.
 */
const RESTORE_WINDOW_PS = `param([string]$Name)
Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int c);'
Get-Process -Name $Name -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.MainWindowHandle -ne 0 -and [W.U]::IsIconic($_.MainWindowHandle)) {
    [void][W.U]::ShowWindowAsync($_.MainWindowHandle, 9)
  }
}`

async function restoreMinimizedWindows(processName: string): Promise<void> {
  const safe = processName.replace(/[^a-zA-Z0-9_-]/g, '')
  if (!safe) return
  try {
    const script = join(app.getPath('userData'), 'restore-window.ps1')
    writeFileSync(script, RESTORE_WINDOW_PS, 'utf8')
    await new Promise<void>((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Name', safe],
        { timeout: 10000, windowsHide: true },
        () => resolve()
      )
    })
  } catch {
    // A failed restore is not fatal: the panel shows the not-found hint.
  }
}

/**
 * A frame of the Screen panel: right after an MCP tool ran, the app's window
 * is captured as a JPEG thumbnail and pushed with a caption naming the step.
 * Best effort — a failed capture just means one missing frame.
 */
async function captureScreenFrame(
  sender: Electron.WebContents,
  requestId: string,
  toolName: string,
  summary: string
): Promise<void> {
  try {
    const parsed = parseMcpToolName(toolName)
    if (!parsed) return
    const matcher = new RegExp(parsed.server.replace(/[^a-zA-Z0-9_-]/g, ''), 'i')
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1024, height: 576 },
      fetchWindowIcons: false
    })
    const source = sources.find((item) => matcher.test(item.name))
    if (!source || source.thumbnail.isEmpty()) return
    const jpeg = source.thumbnail.toJPEG(80)
    persistFrame(requestId, toolName, jpeg)
    if (sender.isDestroyed()) return
    sender.send(IPC.MCP_EVENT, {
      type: 'frame',
      server: parsed.server,
      dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
      caption: `${toolName}: ${summary}`.slice(0, 180),
      at: Date.now()
    })
  } catch {
    // The window may have closed between the tool call and this capture.
  }
}

/** Key step frames land on disk next to the exchange reports, capped at 200. */
function persistFrame(requestId: string, toolName: string, jpeg: Buffer): void {  try {
    const dir = join(app.getPath('userData'), 'frames')
    mkdirSync(dir, { recursive: true })
    const safeTool = toolName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)
    writeFileSync(join(dir, `${Date.now()}-${requestId.slice(0, 8)}-${safeTool}.jpg`), jpeg)
    const files = readdirSync(dir)
      .map((entry) => ({ entry, mtime: statSync(join(dir, entry)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime)
    for (const stale of files.slice(0, Math.max(0, files.length - 200))) {
      rmSync(join(dir, stale.entry), { force: true })
    }
  } catch {
    // A failed frame on disk must not break the live feed.
  }
}

function registerIpc(): void {
  const fileOps = createFileOps({
    workspaceRoot: getWorkspaceRoot,
    useTrash: () => getSettings().files.useTrash,
    trash: (path) => shell.trashItem(path),
    reveal: (path) => shell.showItemInFolder(path)
  })

  ipcMain.on(IPC.WINDOW_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.on(IPC.WINDOW_TOGGLE_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  })

  ipcMain.on(IPC.WINDOW_CLOSE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle(IPC.WORKSPACE_OPEN_FOLDER, async (event): Promise<OpenFolderResult | null> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: t('dialog.openFolder'),
      properties: ['openDirectory' as const]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return openWorkspacePath(result.filePaths[0])
  })

  ipcMain.handle(IPC.WORKSPACE_OPEN_PATH, async (_event, path: string): Promise<OpenFolderResult | null> => {
    if (!existsSync(path)) {
      removeRecentWorkspace(path)
      return null
    }
    return openWorkspacePath(path)
  })

  ipcMain.handle(IPC.WORKSPACE_RECENT_LIST, (): string[] => {
    return getSettings().recentWorkspaces
  })

  ipcMain.handle(IPC.WORKSPACE_READ_DIR, async (_event, dirPath: string): Promise<DirEntry[]> => {
    return readDir(dirPath)
  })

  ipcMain.handle(IPC.FILE_READ, async (_event, filePath: string): Promise<ReadFileResult> => {
    return readTextFile(filePath)
  })

  ipcMain.handle(
    IPC.FILE_WRITE,
    async (_event, filePath: string, content: string): Promise<WriteFileResult> => {
      return writeTextFile(filePath, content)
    }
  )

  // The explorer's own file operations. Every handler answers with a reason code
  // instead of throwing, so the UI can word the failure where the user typed.
  ipcMain.handle(IPC.ENTRY_CREATE, (_event, request: EntryCreateRequest) => fileOps.create(request))
  ipcMain.handle(IPC.ENTRY_RENAME, (_event, path: string, name: string) =>
    fileOps.rename(path, name)
  )
  ipcMain.handle(IPC.ENTRY_MOVE, (_event, path: string, parentPath: string) =>
    fileOps.move(path, parentPath)
  )
  ipcMain.handle(IPC.ENTRY_DUPLICATE, (_event, path: string) => fileOps.duplicate(path))
  ipcMain.handle(IPC.ENTRY_DELETE, (_event, path: string) => fileOps.remove(path))
  ipcMain.on(IPC.ENTRY_REVEAL, (_event, path: string) => {
    fileOps.reveal(path)
  })

  ipcMain.handle(IPC.SETTINGS_GET, (): PublicSettings => {
    reloadSettings()
    return getPublicSettings()
  })

  ipcMain.handle(IPC.SETTINGS_SET, (_event, patch: SettingsPatch): SettingsSaveResult => {
    return applySettingsPatch(patch)
  })

  ipcMain.handle(IPC.SETTINGS_EXPORT, async (event): Promise<SettingsFileResult> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: t('dialog.exportSettings'),
      defaultPath: join(app.getPath('documents'), 'relaxcode-settings.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    try {
      writeFileSync(result.filePath, serializeSettings(), 'utf8')
      return { ok: true, path: result.filePath }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(IPC.SETTINGS_IMPORT, async (event): Promise<SettingsSaveResult> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: t('dialog.importSettings'),
      properties: ['openFile' as const],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { ok: false, error: 'canceled' }
    try {
      return importSettings(readFileSync(result.filePaths[0], 'utf8'))
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(IPC.SETTINGS_RESET, (): PublicSettings => resetSettings())

  ipcMain.on(IPC.SETTINGS_REVEAL, () => {
    const file = revealSettingsFile()
    if (file.path) shell.showItemInFolder(file.path)
  })

  ipcMain.handle(IPC.MODELS_LIST, (_event, options?: ModelsListOptions): Promise<ModelsResult> => {
    return listModels(options)
  })

  ipcMain.handle(IPC.CHAT_SEND, async (event, request: ChatSendRequest): Promise<void> => {
    const sender = event.sender
    // The arena owns the single-run engine while its contestants compete.
    if (arenaActive() && !request.arena) {
      sender.send(IPC.CHAT_EVENT, { requestId: request.requestId, type: 'error', message: 'arena-running' })
      return
    }
    // Tool names are only carried by tool-start; remember them so every MCP
    // tool result can be paired with a Screen panel frame.
    // Team mode: agent edits are limited to the local user's specialty scope.
    applyMyScope()
    const toolNames = new Map<string, string>()
    await runAgent(
      request,
      (chatEvent: ChatEvent) => {
        if (sender.isDestroyed()) return
        sender.send(IPC.CHAT_EVENT, chatEvent)
        if (chatEvent.type === 'tool-start') {
          toolNames.set(chatEvent.callId, chatEvent.name)
        } else if (chatEvent.type === 'tool-result') {
          const name = toolNames.get(chatEvent.callId)
          if (name && name.startsWith('mcp__')) {
            void captureScreenFrame(sender, request.requestId, name, chatEvent.summary)
          }
        } else if (chatEvent.type === 'done' || chatEvent.type === 'error') {
          toolNames.clear()
        }
      },
      {
        requestApproval: (approval: ApprovalRequest) =>
          new Promise<ApprovalAnswer>((resolve) => {
            pendingApprovals.set(approval.approvalId, resolve)
          }),
        askUser: (questionId: string, _question: string, _options: string[]) =>
          new Promise<string>((resolve) => {
            pendingQuestions.set(questionId, resolve)
          })
      }
    )
  })

  ipcMain.on(IPC.CHAT_ABORT, () => {
    abortChat()
    resolvePendingApprovals()
  })

  // Steering: a user message typed mid-run joins the dialog at the next step
  // boundary. False means nothing is running and the caller can send normally.
  ipcMain.handle(IPC.CHAT_STEER, (_event, text: string): SteerResult => {
    return { ok: true, injected: steerMessage(text) }
  })

  ipcMain.handle(IPC.CHAT_PAUSE, (_event, paused: boolean): boolean => {
    return setPaused(paused)
  })

  ipcMain.on(IPC.CHAT_APPROVAL, (_event, response: ApprovalResponse) => {
    const resolve = pendingApprovals.get(response.approvalId)
    if (resolve) {
      pendingApprovals.delete(response.approvalId)
      resolve({
        decision: response.decision,
        ...(typeof response.editedArgs === 'string' && response.editedArgs.length > 0
          ? { editedArgs: response.editedArgs }
          : {})
      })
    }
  })

  ipcMain.on(IPC.CHAT_USER_REPLY, (_event, reply: UserReply) => {
    const resolve = pendingQuestions.get(reply.questionId)
    if (resolve) {
      pendingQuestions.delete(reply.questionId)
      resolve(reply.text)
    }
  })

  ipcMain.handle(IPC.PROCESS_LIST, (): BackgroundProcessInfo[] => {
    return listBackground()
  })

  ipcMain.handle(IPC.PROCESS_STOP, (_event, id: string): BackgroundProcessInfo[] => {
    stopBackground(id)
    return listBackground()
  })

  // ------------------------------------------------------------------ MCP
  // Every mutating call answers with the fresh state list, so the settings
  // screen can re-render without a follow-up request.
  setMcpNotify((event) => {
    if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send(IPC.MCP_EVENT, event)
  })

  // Friendly Development team: live status of the task queue.
  setTeamNotify((event: import('@shared/team').TeamEvent) => {
    if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send(IPC.TEAM_EVENT, event)
  })

  ipcMain.handle(IPC.MCP_LIST, () => listStates())

  ipcMain.handle(IPC.MCP_SAVE, (_event, config: unknown): McpSaveResult => {
    const result = saveServer(config)
    const states = listStates()
    return result.ok ? { ok: true, states } : { ok: false, error: result.error ?? 'unknown', states }
  })

  ipcMain.handle(IPC.MCP_REMOVE, (_event, name: string): McpServerState[] => {
    removeServer(name)
    return listStates()
  })

  ipcMain.handle(IPC.MCP_CONNECT, (_event, name: string): Promise<McpStartResult> => {
    return startMcpServer(name)
  })

  ipcMain.handle(IPC.MCP_DISCONNECT, (_event, name: string): McpServerState[] => {
    void stopMcpServer(name)
    return listStates()
  })

  ipcMain.handle(IPC.MCP_TRUST, (_event, name: string): McpServerState[] => {
    trustServer(name)
    return listStates()
  })

  ipcMain.handle(IPC.MCP_IMPORT, (_event, json: string): McpImportResult => {
    return importServers(json)
  })

  ipcMain.handle(IPC.MCP_EXPORT, async (event): Promise<SettingsFileResult> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: t('dialog.exportSettings'),
      defaultPath: join(app.getPath('documents'), 'mcp-servers.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    try {
      writeFileSync(result.filePath, exportServersJson(), 'utf8')
      return { ok: true, path: result.filePath }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(
    IPC.MCP_INVOKE,
    (_event, server: string, tool: string, argsJson: string): Promise<McpInvokeResult> => {
      return invokeTool(server, tool, argsJson)
    }
  )

  ipcMain.handle(IPC.MCP_DETECT, (_event, appId: string): Promise<McpDetectedApp[]> => {
    return detectApps(appId)
  })

  ipcMain.handle(IPC.MCP_SETUP, (_event, appId: string, exePath?: string): Promise<McpSetupResult> => {
    return setupConnector(appId, exePath)
  })

  ipcMain.handle(IPC.MCP_LAUNCH, (_event, appId: string, exePath: string): McpStartResult => {
    return launchApp(appId, exePath)
  })

  ipcMain.handle(IPC.MCP_PLAYBOOK_GET, (_event, server: string): string | null => {
    return getPlaybook(server)
  })

  ipcMain.handle(IPC.MCP_PLAYBOOK_SET, (_event, server: string, text: string): boolean => {
    return setPlaybook(server, text).ok
  })

  // The Screen panel's live view: resolve the app's window to a capturable id.
  ipcMain.handle(IPC.SCREEN_SOURCE, async (_event, appId: string): Promise<ScreenSourceResult> => {
    // Windows cannot capture a minimized window — restore it first, without
    // stealing focus, so the stream starts on a real picture.
    await restoreMinimizedWindows(appId)
    const matcher = new RegExp(appId.replace(/[^a-zA-Z0-9_-]/g, ''), 'i')
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1, height: 1 },
      fetchWindowIcons: false
    })
    let source = sources.find((item) => matcher.test(item.name))
    // Godot's project manager is a separate window whose title does not
    // contain "godot" — without this fallback the dock goes blank the moment
    // the user leaves the editor.
    if (!source && appId === 'godot') {
      const manager = new RegExp('project manager', 'i')
      source = sources.find((item) => manager.test(item.name))
    }
    if (!source) return { ok: false, reason: 'not-found' }
    return { ok: true, sourceId: source.id, title: source.name }
  })

  // Answers to ui-bridge `requestUi` round trips (chat export).
  ipcMain.on(IPC.UI_REPLY, (_event, reply: { replyId: string; value: unknown }) => {
    resolveUiReply(reply.replyId, reply.value)
  })

  // Time travel: roll the workspace back to a run snapshot (user-initiated).
  ipcMain.handle(IPC.SNAPSHOT_RESTORE, (_event, name: string): { ok: boolean; files: number } => {
    const root = getWorkspaceRoot()
    if (!root || typeof name !== 'string' || name.length === 0) return { ok: false, files: 0 }
    const restored = restoreProjectSnapshot(root, name)
    if (restored < 0) return { ok: false, files: 0 }
    logEvent('info', `time travel: restored ${restored} files from snapshot ${name}`)
    return { ok: true, files: restored }
  })

  // The terminal panel at the bottom of the editor.
  ipcMain.handle(IPC.TERM_LIST, (): ReturnType<typeof listTerminals> => listTerminals())

  // Arena: tournament of agent contestants. Events stream to the arena screen;
  // a running arena fences the normal chat off the single-run agent engine.
  ipcMain.handle(
    IPC.ARENA_START,
    (
      _event,
      task: string,
      attachments: unknown[],
      entrants: Array<{
        providerId: string
        model: string
        style: string
        temperature?: number
        thinking?: string
        topP?: number
        maxSteps?: number
        prompt?: string
      }>
    ) => {
      const valid = entrants.filter(
        (
          entrant
        ): entrant is {
          providerId: string
          model: string
          style: ArenaStyle
          temperature?: number
          thinking?: string
        } =>
          (entrant.style === 'careful' ||
            entrant.style === 'balanced' ||
            entrant.style === 'bold') &&
          (entrant.thinking === undefined ||
            ['off', 'low', 'medium', 'high'].includes(entrant.thinking)) &&
          (entrant.temperature === undefined ||
            (Number.isFinite(entrant.temperature) && entrant.temperature >= 0 && entrant.temperature <= 2))
      )
      return startArena(
        String(task ?? ''),
        Array.isArray(attachments)
          ? (attachments as import('@shared/attachments').AttachmentRef[])
          : [],
        valid,
        (arenaEvent) => {
          mainWindow?.webContents.send(IPC.ARENA_EVENT, arenaEvent)
        }
      )
    }
  )
  ipcMain.handle(IPC.ARENA_PICK, (_event, contestantId: number) =>
    pickArenaContestant(Number(contestantId))
  )
  ipcMain.on(IPC.ARENA_CANCEL, () => cancelArena())
  ipcMain.handle(IPC.ARENA_PREVIEW, (_event, contestantId: number) =>
    startSnapshotPreview(Number(contestantId))
  )
  ipcMain.on(IPC.ARENA_PREVIEW_STOP, () => stopSnapshotPreview())

  // Friendly Development team: shared roster/tasks, local identity, git sync.
  ipcMain.handle(IPC.TEAM_GET, () => getTeamState())
  ipcMain.handle(IPC.TEAM_SAVE, (_event, next: TeamState) => saveTeamState(next))
  ipcMain.handle(
    IPC.TEAM_TASK_ADD,
    (_event, task: { title: string; description: string; assigneeId: string; createdBy: string }) =>
      addTeamTask(task)
  )
  ipcMain.handle(IPC.TEAM_TASK_STATUS, (_event, taskId: string, status: TeamTaskStatus) =>
    setTeamTaskStatus(String(taskId), status)
  )
  ipcMain.handle(IPC.TEAM_TASK_REMOVE, (_event, taskId: string) => removeTeamTask(String(taskId)))
  ipcMain.handle(IPC.TEAM_ME_SET, (_event, memberId: string | null, token?: string) =>
    setTeamMe(memberId ? String(memberId) : null, token === undefined ? undefined : String(token))
  )
  ipcMain.handle(IPC.TEAM_ME_GET, () => getTeamMe())
  ipcMain.handle(IPC.TEAM_COMMIT_PUSH, (_event, message: string) =>
    teamCommitAndPush(String(message ?? ''))
  )
  ipcMain.handle(IPC.TEAM_PULL, () => teamPull())
  ipcMain.handle(IPC.TEAM_ROSTER_PUSH, () => teamPushRoster())
  ipcMain.handle(IPC.TEAM_GITHUB_CHECK, (_event, owner: string, repo: string, token: string) =>
    teamGithubCheck(String(owner ?? ''), String(repo ?? ''), String(token ?? ''))
  )
  ipcMain.handle(
    IPC.TEAM_GITHUB_CREATE,
    (_event, owner: string, repo: string, token: string) =>
      teamGithubCreate(String(owner ?? ''), String(repo ?? ''), String(token ?? ''))
  )
  ipcMain.handle(IPC.TERM_CREATE, (): TerminalSessionInfo => createTerminal())
  ipcMain.on(IPC.TERM_INPUT, (_event, id: string, line: string) => terminalInput(id, line))
  ipcMain.on(IPC.TERM_CLOSE, (_event, id: string) => closeTerminal(id))
  ipcMain.on(IPC.TERM_STOP, (_event, id: string) => stopTerminal(id))

  ipcMain.on(IPC.TRAY_MENU_ACTION, (_event, action: string) => handleTrayMenuAction(action))

  setChangeListener((dirs) => {
    mainWindow?.webContents.send(IPC.WORKSPACE_CHANGED, dirs)
  })
}

void app.whenReady().then(() => {
  registerIpc()
  createWindow()
  createTray()
  beginTeamSession()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // With the tray on, a hidden window is not a request to quit: the icon and
  // the background work stay. The menu's "Выход" is the real quit.
  if (process.platform !== 'darwin' && !getSettings().ui.closeToTray) app.quit()
})

app.on('before-quit', () => {
  quitting = true
  // Dev servers, watchers and MCP connections must not outlive the IDE.
  if (getSettings().servers.stopOnExit) stopAllBackground()
  void stopAllMcp()
  void disposeWorkspace()
})
