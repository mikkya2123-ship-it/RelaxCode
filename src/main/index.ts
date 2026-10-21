import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  IPC,
  type ApprovalDecision,
  type ApprovalRequest,
  type ApprovalResponse,
  type BackgroundProcessInfo,
  type ChatSendRequest,
  type DirEntry,
  type EntryCreateRequest,
  type ModelsListOptions,
  type ModelsResult,
  type OpenFolderResult,
  type PublicSettings,
  type ReadFileResult,
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
  disposeWorkspace,
  getWorkspaceRoot,
  readDir,
  setChangeListener,
  setWorkspaceRoot
} from './workspace'
import { createFileOps } from './fileOps'
import { readTextFile, writeTextFile } from './files'
import { listModels } from './chat'
import { abortChat, clearSessionApprovals, runAgent } from './agent'
import { listBackground, stopAllBackground, stopBackground } from './proc'
import { logEvent } from './logger'
import { t } from './i18n'

let mainWindow: BrowserWindow | null = null

const pendingApprovals = new Map<string, (decision: ApprovalDecision) => void>()
const pendingQuestions = new Map<string, (answer: string) => void>()

function resolvePendingApprovals(): void {
  for (const resolve of pendingApprovals.values()) resolve('deny')
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
    await runAgent(
      request,
      (chatEvent) => {
        if (!sender.isDestroyed()) sender.send(IPC.CHAT_EVENT, chatEvent)
      },
      {
        requestApproval: (approval: ApprovalRequest) =>
          new Promise<ApprovalDecision>((resolve) => {
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

  ipcMain.on(IPC.CHAT_APPROVAL, (_event, response: ApprovalResponse) => {
    const resolve = pendingApprovals.get(response.approvalId)
    if (resolve) {
      pendingApprovals.delete(response.approvalId)
      resolve(response.decision)
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
  // Dev servers and watchers the agent started must not outlive the IDE.
  if (getSettings().servers.stopOnExit) stopAllBackground()
  void disposeWorkspace()
})
