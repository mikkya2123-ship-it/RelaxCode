import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
  type WriteFileResult
} from '@shared/ipc'
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
    // Tool names are only carried by tool-start; remember them so every MCP
    // tool result can be paired with a Screen panel frame.
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

  ipcMain.handle(IPC.MCP_SETUP, (_event, appId: string): Promise<McpSetupResult> => {
    return setupConnector(appId)
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
    const source = sources.find((item) => matcher.test(item.name))
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
  ipcMain.handle(IPC.TERM_CREATE, (): TerminalSessionInfo => createTerminal())
  ipcMain.on(IPC.TERM_INPUT, (_event, id: string, line: string) => terminalInput(id, line))
  ipcMain.on(IPC.TERM_CLOSE, (_event, id: string) => closeTerminal(id))
  ipcMain.on(IPC.TERM_STOP, (_event, id: string) => stopTerminal(id))

  setChangeListener((dirs) => {
    mainWindow?.webContents.send(IPC.WORKSPACE_CHANGED, dirs)
  })
}

void app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // Dev servers, watchers and MCP connections must not outlive the IDE.
  if (getSettings().servers.stopOnExit) stopAllBackground()
  void stopAllMcp()
  void disposeWorkspace()
})
