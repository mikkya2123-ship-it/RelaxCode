import type { AttachmentRef } from './attachments'
import type { EntryKind, EntryNameIssue } from './entries'
import type { ThinkingLevel } from './reasoning'
import type { ToolMeta } from './tool-meta'

export const IPC = {
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggle-maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_MAXIMIZED_CHANGED: 'window:maximized-changed',
  /** A tray menu item: 'new-chat' or 'open-settings'. */
  TRAY_COMMAND: 'tray:command',
  /** Custom tray menu window → main: open, new-chat, open-settings, toggle-background, quit, dismiss. */
  TRAY_MENU_ACTION: 'tray:menu-action',
  /** Main → menu window: the checkbox state to render. */
  TRAY_MENU_STATE: 'tray:menu-state',
  ARENA_START: 'arena:start',
  ARENA_PICK: 'arena:pick',
  ARENA_CANCEL: 'arena:cancel',
  ARENA_EVENT: 'arena:event',
  ARENA_PREVIEW: 'arena:preview',
  TEAM_GET: 'team:get',
  TEAM_SAVE: 'team:save',
  TEAM_TASK_ADD: 'team:task-add',
  TEAM_TASK_STATUS: 'team:task-status',
  TEAM_TASK_REMOVE: 'team:task-remove',
  TEAM_ME_SET: 'team:me-set',
  TEAM_ME_GET: 'team:me-get',
  TEAM_COMMIT_PUSH: 'team:commit-push',
  TEAM_PULL: 'team:pull',
  TEAM_ROSTER_PUSH: 'team:roster-push',
  TEAM_GITHUB_CREATE: 'team:github-create',
  TEAM_GITHUB_CHECK: 'team:github-check',
  TEAM_EVENT: 'team:event',
  ARENA_PREVIEW_STOP: 'arena:preview-stop',
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
  CHAT_STEER: 'chat:steer',
  CHAT_PAUSE: 'chat:pause',
  CHAT_EVENT: 'chat:event',
  CHAT_APPROVAL: 'chat:approval',
  CHAT_USER_REPLY: 'chat:user-reply',
  PROCESS_LIST: 'process:list',
  PROCESS_STOP: 'process:stop',
  MCP_LIST: 'mcp:list',
  MCP_SAVE: 'mcp:save',
  MCP_REMOVE: 'mcp:remove',
  MCP_CONNECT: 'mcp:connect',
  MCP_DISCONNECT: 'mcp:disconnect',
  MCP_TRUST: 'mcp:trust',
  MCP_IMPORT: 'mcp:import',
  MCP_EXPORT: 'mcp:export',
  MCP_INVOKE: 'mcp:invoke',
  MCP_DETECT: 'mcp:detect',
  MCP_SETUP: 'mcp:setup',
  MCP_LAUNCH: 'mcp:launch',
  MCP_PLAYBOOK_GET: 'mcp:playbook-get',
  MCP_PLAYBOOK_SET: 'mcp:playbook-set',
  SCREEN_SOURCE: 'screen:source',
  MCP_EVENT: 'mcp:event',
  UI_REPLY: 'ui:reply',
  UI_NOTIFY: 'ui:notify',
  UI_OPEN_FILE: 'ui:open-file',
  UI_SPEAK: 'ui:speak',
  UI_EXPORT_CHAT: 'ui:export-chat',
  UI_AGENT_PROMPT: 'ui:agent-prompt',
  SNAPSHOT_RESTORE: 'snapshot:restore',
  TERM_LIST: 'term:list',
  TERM_CREATE: 'term:create',
  TERM_INPUT: 'term:input',
  TERM_CLOSE: 'term:close',
  TERM_STOP: 'term:stop',
  TERM_OUTPUT: 'term:output'
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

/*
 * MCP servers live in their own `userData/mcp.json` (Claude Desktop format on
 * top); the schema and the pure helpers are in `@shared/mcp`, re-exported here
 * because the IPC surface is how the renderer reaches them.
 */
import type { McpServerState } from './mcp'

export type {
  McpDetectedApp,
  McpEvent,
  McpServerConfig,
  McpServerState,
  McpServerStatus,
  McpToolInfo,
  McpToolRisk,
  McpTransport
} from './mcp'
export { MCP_RISKS, MCP_TRANSPORTS } from './mcp'

export type McpSaveResult =
  | { ok: true; states: McpServerState[] }
  | { ok: false; error: string; states: McpServerState[] }

export type McpImportResult = { ok: boolean; added: number; error: string | null }

export type McpInvokeResult = { ok: boolean; text: string; error: string | null }

export type McpStartResult = { ok: boolean; error: string | null }

export type McpSetupResult = { ok: boolean; error: string | null; serverName: string | null }

/**
 * A window handle for the Screen panel's live view: the renderer turns the
 * source id into a MediaStream via getUserMedia (desktop capture).
 */
export type ScreenSourceResult =
  | { ok: true; sourceId: string; title: string }
  | { ok: false; reason: 'not-found' }

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

/** One terminal tab of the IDE panel. */
export interface TerminalSessionInfo {
  id: string
  title: string
  /** `shell` takes input; `agent` is the read-only feed of the AI's commands. */
  kind: 'shell' | 'agent'
}

/** Output chunk pushed from a terminal session to the panel. */
export interface TerminalOutputEvent {
  id: string
  text: string
  /** The command that was running has finished. */
  done?: boolean
}

/* ------------------------------- arena -------------------------------- */

/** Creativity preset of an arena contestant. */
export type ArenaStyle = 'careful' | 'balanced' | 'bold'

export interface ArenaContestant {
  id: number
  style: ArenaStyle
  /** The connection and model this contestant runs on. */
  providerId: string
  model: string
  temperature: number
  /** How deeply this contestant is asked to reason. */
  thinking: ThinkingLevel
  /** 0 = follow the app settings for these knobs. */
  topP: number
  maxSteps: number
  /** Personal instruction only this contestant sees. */
  prompt: string
  status: 'pending' | 'running' | 'done' | 'failed'
  steps: number
  files: number
  tests: 'unknown' | 'pass' | 'fail' | 'skipped'
  summary: string
}

export interface ArenaState {
  id: string
  task: string
  status: 'running' | 'ready' | 'error'
  activeId: number | null
  contestants: ArenaContestant[]
  /** The model's verdict after every contestant has finished. */
  judge?: { status: 'running' | 'done' | 'failed'; winnerId: number | null; reason: string }
  error?: string
}

export type ArenaEvent =
  | { kind: 'state'; state: ArenaState }
  | { kind: 'chat'; runId: string; event: ChatEvent }

export interface ChatMessagePayload {
  role: ChatRole
  content: string
  /**
   * Files pinned to this message by the user. The renderer attaches them to
   * the newest user message only; older turns carry their `attachmentNote`
   * inside `content`, so images do not ride along with every request.
   */
  attachments?: AttachmentRef[]
}

export type ChatMode = 'chat' | 'agent' | 'plan'

export interface ChatSendRequest {
  requestId: string
  mode: ChatMode
  messages: ChatMessagePayload[]
  /** How deeply the model should reason; falls back to the settings default. */
  thinking?: ThinkingLevel
  /**
   * Night autopilot: the run goes full-auto (the destructive-command guard
   * still applies) within the hard limits from the agent settings.
   */
  night?: boolean
  /**
   * Arena override: this run speaks as another connection/model with its own
   * sampling temperature. Only the arena orchestrator sends it.
   */
  arena?: {
    providerId: string
    model: string
    temperature: number
    thinking?: ThinkingLevel
    /** 0 = keep the configured value. */
    topP?: number
    maxSteps?: number
    prompt?: string
  }
  /**
   * Team persona: this run acts as one team member (nick, specialty, level,
   * duties). Only the team orchestrator sends it.
   */
  persona?: { nick: string; specialty: string; level: string; duties: string }
  /** A skill pinned with `#` in the composer; it beats the automatic choice. */
  skillId?: string
  context: {
    activeFile?: string | null
    openFiles?: string[]
    /**
     * The task list of the previous run, when it had unfinished items: long
     * jobs (scene builds, refactors) span runs, and the new run must inherit
     * the plan instead of starting blind.
     */
    previousTodos?: TodoItem[]
  }
}

export interface ToolCallInfo {
  callId: string
  name: string
  args: string
}

export type ApprovalDecision = 'allow' | 'always' | 'deny'

/** Answer of a steering attempt: false when no run is active to receive it. */
export type SteerResult = { ok: boolean; injected: boolean }

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
  /**
   * When the user edited the proposal in the approval bar (write_file content,
   * edit_file strings), the tool runs with these arguments instead of the
   * model's originals — a pretty JSON string of the full args object.
   */
  editedArgs?: string
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
  /** The user interrupted the running agent: their message joins the dialog. */
  | { requestId: string; type: 'steer'; text: string }
  /** The run was paused or resumed between steps. */
  | { requestId: string; type: 'paused'; paused: boolean }
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
  // The night autopilot stopped a run: it reached its token budget or its
  // wall-clock timeout (the step budget reuses the `no-answer` notice).
  | { requestId: string; type: 'notice'; kind: 'night-limit'; reason: 'tokens' | 'timeout' }
  // The provider refused a parameter we sent (reasoning, temperature); the
  // request is retried without it.
  | { requestId: string; type: 'notice'; kind: 'param-dropped'; param: 'reasoning' | 'sampling' | 'other' }
  | { requestId: string; type: 'notice'; kind: 'image-dropped' }
  // The design skill picked for this run; the chat shows it above the answer.
  | { requestId: string; type: 'skill'; skillId: string }
  | { requestId: string; type: 'run-snapshot'; name: string }
  | { requestId: string; type: 'timelapse'; frames: string[]; intervalSec: number }
  // The model's thoughts began repeating themselves; the stream was cut there
  // and the repeated copies were removed from the transcript. `loops` counts how
  // many times this connection has done it, which decides the next level.
  | { requestId: string; type: 'notice'; kind: 'thinking-loop'; repeats: number; loops: number }
  // This connection looped before, so the chat's level was lowered (or switched
  // off) before the request went out.
  | {
      requestId: string
      type: 'notice'
      kind: 'thinking-lowered'
      from: ThinkingLevel
      to: ThinkingLevel
      loops: number
    }
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
