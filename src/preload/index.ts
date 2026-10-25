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
  type McpDetectedApp,
  type McpEvent,
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
  type SettingsFileResult,
  type AudioTranscribeResult,
  type SettingsPatch,
  type SettingsSaveResult,
  type SteerResult,
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
  mcp: {
    list: (): Promise<McpServerState[]> => ipcRenderer.invoke(IPC.MCP_LIST),
    save: (config: unknown): Promise<McpSaveResult> => ipcRenderer.invoke(IPC.MCP_SAVE, config),
    remove: (name: string): Promise<McpServerState[]> => ipcRenderer.invoke(IPC.MCP_REMOVE, name),
    connect: (name: string): Promise<McpStartResult> => ipcRenderer.invoke(IPC.MCP_CONNECT, name),
    disconnect: (name: string): Promise<McpServerState[]> =>
      ipcRenderer.invoke(IPC.MCP_DISCONNECT, name),
    trust: (name: string): Promise<McpServerState[]> => ipcRenderer.invoke(IPC.MCP_TRUST, name),
    import: (json: string): Promise<McpImportResult> => ipcRenderer.invoke(IPC.MCP_IMPORT, json),
    exportFile: (): Promise<SettingsFileResult> => ipcRenderer.invoke(IPC.MCP_EXPORT),
    invoke: (server: string, tool: string, argsJson: string): Promise<McpInvokeResult> =>
      ipcRenderer.invoke(IPC.MCP_INVOKE, server, tool, argsJson),
    detect: (appId: string): Promise<McpDetectedApp[]> =>
      ipcRenderer.invoke(IPC.MCP_DETECT, appId),
    setup: (appId: string): Promise<McpSetupResult> => ipcRenderer.invoke(IPC.MCP_SETUP, appId),
    launch: (appId: string, exePath: string): Promise<McpStartResult> =>
      ipcRenderer.invoke(IPC.MCP_LAUNCH, appId, exePath),
    playbookGet: (server: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.MCP_PLAYBOOK_GET, server),
    playbookSet: (server: string, text: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.MCP_PLAYBOOK_SET, server, text),
    onEvent: (callback: (event: McpEvent) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, mcpEvent: McpEvent): void => callback(mcpEvent)
      ipcRenderer.on(IPC.MCP_EVENT, listener)
      return () => {
        ipcRenderer.removeListener(IPC.MCP_EVENT, listener)
      }
    }
  },
  screen: {
    getSource: (appId: string): Promise<ScreenSourceResult> =>
      ipcRenderer.invoke(IPC.SCREEN_SOURCE, appId)
  },
  snapshots: {
    /** Time travel: restore the workspace to a run snapshot. */
    restore: (name: string): Promise<{ ok: boolean; files: number }> =>
      ipcRenderer.invoke(IPC.SNAPSHOT_RESTORE, name)
  },
  audio: {
    /** Push-to-talk: transcribe a recording through the active provider. */
    transcribe: (audio: ArrayBuffer): Promise<AudioTranscribeResult> =>
      ipcRenderer.invoke(IPC.AUDIO_TRANSCRIBE, audio)
  },
  chat: {
    send: (request: ChatSendRequest): Promise<void> => ipcRenderer.invoke(IPC.CHAT_SEND, request),
    abort: (): void => ipcRenderer.send(IPC.CHAT_ABORT),
    steer: (text: string): Promise<SteerResult> => ipcRenderer.invoke(IPC.CHAT_STEER, text),
    pause: (paused: boolean): Promise<boolean> => ipcRenderer.invoke(IPC.CHAT_PAUSE, paused),
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
  },
  ui: {
    /** Answer a main-process round trip (chat export). */
    reply: (replyId: string, value: unknown): void => ipcRenderer.send(IPC.UI_REPLY, { replyId, value }),
    onNotify: (callback: (payload: { title: string; body?: string }) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: { title: string; body?: string }): void => callback(payload)
      ipcRenderer.on(IPC.UI_NOTIFY, listener)
      return () => ipcRenderer.removeListener(IPC.UI_NOTIFY, listener)
    },
    onOpenFile: (callback: (payload: { path: string; line?: number }) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: { path: string; line?: number }): void => callback(payload)
      ipcRenderer.on(IPC.UI_OPEN_FILE, listener)
      return () => ipcRenderer.removeListener(IPC.UI_OPEN_FILE, listener)
    },
    onSpeak: (callback: (payload: { text: string }) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: { text: string }): void => callback(payload)
      ipcRenderer.on(IPC.UI_SPEAK, listener)
      return () => ipcRenderer.removeListener(IPC.UI_SPEAK, listener)
    },
    onExportChat: (
      callback: (payload: { replyId: string; fileName: string }) => void
    ): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: { replyId: string; fileName: string }): void =>
        callback(payload)
      ipcRenderer.on(IPC.UI_EXPORT_CHAT, listener)
      return () => ipcRenderer.removeListener(IPC.UI_EXPORT_CHAT, listener)
    },
    onAgentPrompt: (callback: (payload: { text: string }) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: { text: string }): void => callback(payload)
      ipcRenderer.on(IPC.UI_AGENT_PROMPT, listener)
      return () => ipcRenderer.removeListener(IPC.UI_AGENT_PROMPT, listener)
    }
  }
}

export type RelaxCodeApi = typeof api

contextBridge.exposeInMainWorld('relaxcode', api)
