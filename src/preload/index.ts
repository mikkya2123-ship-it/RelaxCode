import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type ApprovalResponse,
  type BackgroundProcessInfo,
  type ChatEvent,
  type ChatSendRequest,
  type DirEntry,
  type EntryCreateRequest,
  type EntryDeleteResult,
  type EntryOpResult,
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
import type { EntryKind } from '@shared/entries'

const api = {
  window: {
    minimize: (): void => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
    toggleMaximize: (): void => ipcRenderer.send(IPC.WINDOW_TOGGLE_MAXIMIZE),
    close: (): void => ipcRenderer.send(IPC.WINDOW_CLOSE),
    onMaximizedChanged: (callback: (maximized: boolean) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, maximized: boolean): void => callback(maximized)
      ipcRenderer.on(IPC.WINDOW_MAXIMIZED_CHANGED, listener)
      return () => {
        ipcRenderer.removeListener(IPC.WINDOW_MAXIMIZED_CHANGED, listener)
      }
    }
  },
  workspace: {
    openFolder: (): Promise<OpenFolderResult | null> =>
      ipcRenderer.invoke(IPC.WORKSPACE_OPEN_FOLDER),
    openPath: (path: string): Promise<OpenFolderResult | null> =>
      ipcRenderer.invoke(IPC.WORKSPACE_OPEN_PATH, path),
    recentList: (): Promise<string[]> => ipcRenderer.invoke(IPC.WORKSPACE_RECENT_LIST),
    readDir: (path: string): Promise<DirEntry[]> =>
      ipcRenderer.invoke(IPC.WORKSPACE_READ_DIR, path),
    onChanged: (callback: (dirs: string[]) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, dirs: string[]): void => callback(dirs)
      ipcRenderer.on(IPC.WORKSPACE_CHANGED, listener)
      return () => {
        ipcRenderer.removeListener(IPC.WORKSPACE_CHANGED, listener)
      }
    }
  },
  file: {
    read: (path: string): Promise<ReadFileResult> => ipcRenderer.invoke(IPC.FILE_READ, path),
    write: (path: string, content: string): Promise<WriteFileResult> =>
      ipcRenderer.invoke(IPC.FILE_WRITE, path, content)
  },
  entries: {
    create: (kind: EntryKind, parentPath: string, name: string): Promise<EntryOpResult> =>
      ipcRenderer.invoke(IPC.ENTRY_CREATE, { kind, parentPath, name } satisfies EntryCreateRequest),
    rename: (path: string, name: string): Promise<EntryOpResult> =>
      ipcRenderer.invoke(IPC.ENTRY_RENAME, path, name),
    move: (path: string, parentPath: string): Promise<EntryOpResult> =>
      ipcRenderer.invoke(IPC.ENTRY_MOVE, path, parentPath),
    duplicate: (path: string): Promise<EntryOpResult> =>
      ipcRenderer.invoke(IPC.ENTRY_DUPLICATE, path),
    remove: (path: string): Promise<EntryDeleteResult> => ipcRenderer.invoke(IPC.ENTRY_DELETE, path),
    reveal: (path: string): void => ipcRenderer.send(IPC.ENTRY_REVEAL, path)
  },
  settings: {
    get: (): Promise<PublicSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
    set: (patch: SettingsPatch): Promise<SettingsSaveResult> =>
      ipcRenderer.invoke(IPC.SETTINGS_SET, patch),
    exportFile: (): Promise<SettingsFileResult> => ipcRenderer.invoke(IPC.SETTINGS_EXPORT),
    importFile: (): Promise<SettingsSaveResult> => ipcRenderer.invoke(IPC.SETTINGS_IMPORT),
    reset: (): Promise<PublicSettings> => ipcRenderer.invoke(IPC.SETTINGS_RESET),
    reveal: (): void => ipcRenderer.send(IPC.SETTINGS_REVEAL)
  },
  models: {
    list: (options?: ModelsListOptions): Promise<ModelsResult> =>
      ipcRenderer.invoke(IPC.MODELS_LIST, options)
  },
  servers: {
    list: (): Promise<BackgroundProcessInfo[]> => ipcRenderer.invoke(IPC.PROCESS_LIST),
    stop: (id: string): Promise<BackgroundProcessInfo[]> =>
      ipcRenderer.invoke(IPC.PROCESS_STOP, id)
  },
  chat: {
    send: (request: ChatSendRequest): Promise<void> => ipcRenderer.invoke(IPC.CHAT_SEND, request),
    abort: (): void => ipcRenderer.send(IPC.CHAT_ABORT),
    respondApproval: (response: ApprovalResponse): void =>
      ipcRenderer.send(IPC.CHAT_APPROVAL, response),
    replyUser: (reply: UserReply): void => ipcRenderer.send(IPC.CHAT_USER_REPLY, reply),
    onEvent: (callback: (event: ChatEvent) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, chatEvent: ChatEvent): void => callback(chatEvent)
      ipcRenderer.on(IPC.CHAT_EVENT, listener)
      return () => {
        ipcRenderer.removeListener(IPC.CHAT_EVENT, listener)
      }
    }
  }
}

export type RelaxCodeApi = typeof api

contextBridge.exposeInMainWorld('relaxcode', api)
