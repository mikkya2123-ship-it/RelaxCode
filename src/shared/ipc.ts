import type { EntryKind, EntryNameIssue } from './entries'
import type { ThinkingLevel } from './reasoning'
import type { ToolMeta } from './tool-meta'

export const IPC = {
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggle-maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_MAXIMIZED_CHANGED: 'window:maximized-changed',
  WORKSPACE_OPEN_FOLDER: 'workspace:open-folder',
  WORKSPACE_OPEN_PATH: 'workspace:open-path',
  WORKSPACE_RECENT_LIST: 'workspace:recent-list',
  WORKSPACE_READ_DIR: 'workspace:read-dir',
  WORKSPACE_CHANGED: 'workspace:changed',
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  ENTRY_CREATE: 'entry:create',
  ENTRY_RENAME: 'entry:rename',
  ENTRY_MOVE: 'entry:move',
  ENTRY_DUPLICATE: 'entry:duplicate',
  ENTRY_DELETE: 'entry:delete',
  ENTRY_REVEAL: 'entry:reveal',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_EXPORT: 'settings:export',
  SETTINGS_IMPORT: 'settings:import',
  SETTINGS_REVEAL: 'settings:reveal',
  SETTINGS_RESET: 'settings:reset',
  MODELS_LIST: 'models:list',
  CHAT_SEND: 'chat:send',
  CHAT_ABORT: 'chat:abort',
  CHAT_EVENT: 'chat:event',
  CHAT_APPROVAL: 'chat:approval',
  CHAT_USER_REPLY: 'chat:user-reply',
  PROCESS_LIST: 'process:list',
  PROCESS_STOP: 'process:stop'
} as const

export interface OpenFolderResult {
  path: string
}

export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
}

export type FileErrorReason =
  | 'binary'
  | 'too-large'
  | 'not-file'
  | 'not-found'
  | 'outside-workspace'
  | 'unknown'

export type ReadFileResult =
  | { ok: true; content: string; name: string; mtime: number }
  | { ok: false; reason: FileErrorReason }

export type WriteFileResult = { ok: true } | { ok: false; reason: FileErrorReason }

/** Why a create/rename/move/duplicate/delete of an entry was refused. */
export type EntryOpReason =
  | 'exists'
  | 'not-found'
  | 'not-directory'
  | 'invalid-name'
  | 'outside-workspace'
  | 'root'
  | 'inside-itself'
  | 'unknown'

export interface EntryOpFailure {
  ok: false
  reason: EntryOpReason
  /** Set with `invalid-name`: which rule the typed name broke. */
  issue?: EntryNameIssue
}

/** Create, rename, move and duplicate all answer with the path of the result. */
export type EntryOpResult = { ok: true; path: string } | EntryOpFailure

export type EntryDeleteResult = { ok: true } | EntryOpFailure

export interface EntryCreateRequest {
  kind: EntryKind
  /** Directory the entry is created in (must be inside the workspace). */
  parentPath: string
  /** A single name, or a slash-separated path whose missing folders are created. */
  name: string
}

export type ApprovalMode = 'ask' | 'auto-safe' | 'full-auto'

/*
 * The settings schema, its defaults and its patch contract live in
 * `@shared/settings`; they are re-exported here because the IPC surface (and
 * everything that already imported them from `@shared/ipc`) is built on them.
 */
export type {
  PublicSettings,
  SettingsPatch,
  SettingsSaveResult,
  SettingsValues,
  SettingsGroup,
  ProviderProfile,
  PublicProvider
} from './settings'

export type { ThinkingLevel, ReasoningStyle } from './reasoning'
export { THINKING_LEVELS } from './reasoning'

export interface ModelInfo {
  id: string
  /** Zero-cost model (`pricing` is 0 or the id carries the `:free` suffix). */
  free: boolean
  /** Model advertises tool/function calling — required for AGENT mode. */
  tools: boolean
  /** Levels the endpoint says it supports (OpenRouter only, so far). */
  reasoningEfforts?: string[]
  /** The endpoint says the model always reasons, whatever the request asks. */
  reasoningAlways?: boolean
  /** Context window in tokens, when the endpoint reports one. */
  contextLength?: number
}

export type ModelsResult = { ok: true; models: ModelInfo[] } | { ok: false; error: string }

export interface ModelsListOptions {
  baseUrl?: string
  apiKey?: string
  /** Look up the endpoint and the stored key of a provider (used by the settings screen). */
  providerId?: string
}

/** Result of exporting or importing the settings file. */
export interface SettingsFileResult {
  ok: boolean
  /** Path that was written/read, when the operation went through. */
  path?: string
  canceled?: boolean
  error?: string
}

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessagePayload {
  role: ChatRole
  content: string
}

export type ChatMode = 'chat' | 'agent' | 'plan'

export interface ChatSendRequest {
  requestId: string
  mode: ChatMode
  messages: ChatMessagePayload[]
  /** How deeply the model should reason; falls back to the settings default. */
  thinking?: ThinkingLevel
  context: {
    activeFile?: string | null
    openFiles?: string[]
  }
}

export interface ToolCallInfo {
  callId: string
  name: string
  args: string
}

export type ApprovalDecision = 'allow' | 'always' | 'deny'

export interface ApprovalRequest {
  approvalId: string
  toolName: string
  args: string
  preview: string
  risk: 'write' | 'exec' | 'delete'
}

export interface ApprovalResponse {
  approvalId: string
  decision: ApprovalDecision
}

export interface UserReply {
  questionId: string
  text: string
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  id: string
  content: string
  status: TodoStatus
}

/** A long-running process (dev server, watcher) started by the agent. */
export interface BackgroundProcessInfo {
  id: string
  command: string
  cwd: string
  pid: number
  port: number | null
  running: boolean
  startedAt: number
}

export type ChatEvent =
  | { requestId: string; type: 'delta'; text: string }
  /** A piece of the model's reasoning (`reasoning_content`, `reasoning`, think tags). */
  | { requestId: string; type: 'reasoning'; text: string }
  /** A retry dropped reasoning that had already been streamed. */
  | { requestId: string; type: 'reasoning-rewind'; length: number }
  | { requestId: string; type: 'tool-start'; callId: string; name: string; args: string; step: number }
  /** Live structured progress of a tool (search query, sources, pages read). */
  | { requestId: string; type: 'tool-meta'; callId: string; meta: ToolMeta }
  | {
      requestId: string
      type: 'tool-result'
      callId: string
      ok: boolean
      summary: string
      detail: string
      meta?: ToolMeta
    }
  | { requestId: string; type: 'tool-approval'; request: ApprovalRequest }
  | { requestId: string; type: 'todos'; todos: TodoItem[] }
  | { requestId: string; type: 'processes'; processes: BackgroundProcessInfo[] }
  | { requestId: string; type: 'user-question'; questionId: string; question: string; options: string[] }
  | {
      requestId: string
      type: 'notice'
      kind: 'rate-limit-retry' | 'server-retry'
      attempt: number
      maxAttempts: number
      seconds: number
    }
  | { requestId: string; type: 'notice'; kind: 'text-call-fallback'; tools: string[] }
  | { requestId: string; type: 'notice'; kind: 'no-tool-calls' }
  | { requestId: string; type: 'notice'; kind: 'unverified-result' }
  // The model finished its turn without writing any answer text (an empty step
  // after tool calls, or the step budget ran out).
  | { requestId: string; type: 'notice'; kind: 'no-answer'; reason: 'empty-step' | 'step-limit'; steps: number }
  // The provider refused a parameter we sent (reasoning, temperature); the
  // request is retried without it.
  | { requestId: string; type: 'notice'; kind: 'param-dropped'; param: 'reasoning' | 'sampling' | 'other' }
  | { requestId: string; type: 'text-rewind'; length: number }
  | {
      requestId: string
      type: 'done'
      promptTokens: number
      completionTokens: number
      steps: number
      /** Completion tokens spent on reasoning, when the provider reports them. */
      reasoningTokens?: number
      /**
       * Size of the conversation as the provider counted it on the *last* step
       * (prompt + completion of that one request). This is what the next request
       * will roughly carry, so it is what the context meter shows — unlike
       * promptTokens, which adds every step up.
       */
      contextTokens?: number
      /** What the saving mode left out of this request, when it was active. */
      saved?: { messages: number; chars: number }
    }
  | { requestId: string; type: 'error'; message: string }
