import type { ApprovalMode, ChatMode } from './ipc'
import { FIGURE_THEMES, type FigureTheme } from './figures.ts'
import type { ThinkingLevel } from './reasoning'
import type { TokenSaving } from './token-saving'
import { DEFAULT_TERMINAL_SHELL, type TerminalShell } from './terminal.ts'
import type { WebSearchProvider } from './web-search'

/* ------------------------------------------------------------------------- *
 * Every knob of the IDE lives here.
 *
 * The same module is used by the main process (which owns `settings.json`) and
 * by the renderer (which renders the settings screen), so the two can never
 * drift apart. Secrets are the one exception: `apiKeyEnc` only ever exists in
 * the main process, the renderer sees `hasApiKey` instead.
 * ------------------------------------------------------------------------- */

export type ThemeMode = 'light' | 'dark' | 'system'
export type LanguageMode = 'system' | 'ru' | 'en'
export type DensityMode = 'comfortable' | 'compact'
export type AutoSaveMode = 'off' | 'afterDelay' | 'onFocusChange'
export type AccentName = 'default' | 'blue' | 'violet' | 'green' | 'orange' | 'rose'
export type LogLevel = 'error' | 'warn' | 'info' | 'debug'
export type ResponseLanguage = 'auto' | 'ru' | 'en'
/**
 * When the model may add a picture or a drawing to its answer:
 * `auto` — whenever it genuinely helps, without being asked;
 * `onRequest` — only when the user asks for a picture/drawing;
 * `off` — never.
 */
export type VisualMode = 'auto' | 'onRequest' | 'off'

export const RESPONSE_LANGUAGES: readonly ResponseLanguage[] = ['auto', 'ru', 'en']
export const VISUAL_MODES: readonly VisualMode[] = ['auto', 'onRequest', 'off']
export const THEMES: readonly ThemeMode[] = ['light', 'dark', 'system']
export const LANGUAGES: readonly LanguageMode[] = ['system', 'ru', 'en']
export const DENSITIES: readonly DensityMode[] = ['comfortable', 'compact']
export const AUTOSAVE_MODES: readonly AutoSaveMode[] = ['off', 'afterDelay', 'onFocusChange']
export const ACCENTS: readonly AccentName[] = ['default', 'blue', 'violet', 'green', 'orange', 'rose']
export const LOG_LEVELS: readonly LogLevel[] = ['error', 'warn', 'info', 'debug']
export const CURSOR_BLINKING = ['blink', 'smooth', 'phase', 'expand', 'solid'] as const
export const LINE_HIGHLIGHTS = ['none', 'line', 'all'] as const
export const LINE_NUMBERS = ['on', 'off', 'relative'] as const
export const WHITESPACE = ['none', 'selection', 'all'] as const

/** One connection profile (endpoint + key + default model). */
export interface ProviderProfile {
  id: string
  name: string
  baseUrl: string
  model: string | null
}

/** A provider as the renderer sees it: no key, only whether one is stored. */
export interface PublicProvider extends ProviderProfile {
  hasApiKey: boolean
}

/** A provider sent by the settings screen. */
export interface ProviderInput {
  id?: string
  name?: string
  baseUrl?: string
  /** `undefined` keeps the stored key, `null` clears it, a string replaces it. */
  apiKey?: string | null
  model?: string | null
}

export interface AgentSettings {
  /** 0–2. Lower is more deterministic. */
  temperature: number
  topP: number
  /** 0 = let the provider choose. */
  maxTokens: number
  maxSteps: number
  historyMessages: number
  maxRulesChars: number
  retryAttempts: number
  retryBaseSeconds: number
  contextActiveFile: boolean
  contextOpenFiles: boolean
  rulesEnabled: boolean
  rulesFiles: string[]
  responseLanguage: ResponseLanguage
  systemPromptExtra: string
  /** Empty string = keep the built-in guidance for that mode. */
  guidanceChat: string
  guidanceAgent: string
  guidancePlan: string
  /** Warn when the reply claims success after a failed tool. */
  autoVerifyClaims: boolean
  /** Rescue tool calls that the model printed as text. */
  recoverTextCalls: boolean
  ruleTodos: boolean
  ruleServers: boolean
  ruleVerify: boolean
  /** Once a day, when a workspace opens, the agent runs a read-only morning briefing. */
  morningBriefing: boolean
  /** Before a commit, a second pass reviews the diff and appends its verdict. */
  selfReview: boolean
  /** Before a run's first change, the project is snapshotted; the chat can roll back to it. */
  timeTravel: boolean
  /** While a run has a dev server up, its page is photographed into a timelapse card. */
  timelapse: boolean
  /**
   * How much of the conversation is sent to the model: 'off' sends everything,
   * 'on' keeps a generous window, 'super' keeps the goal, the current step and a
   * digest. See shared/token-saving.ts for the exact numbers.
   */
  tokenSaving: TokenSaving
  /**
   * Night autopilot: full-auto within hard limits. The toggle lives in the
   * composer; these are the limits a night run may not exceed.
   */
  nightMaxSteps: number
  nightMaxTokens: number
  nightTimeoutMin: number
}

export interface ToolsSettings {
  /** Tools switched off completely (not offered to the model). */
  disabled: string[]
  /** Tools that never ask for approval. */
  alwaysAllow: string[]
  /** Tools that are always refused. */
  alwaysDeny: string[]
  maxReadLines: number
  maxOutputChars: number
  searchMaxResults: number
  fetchMaxKb: number
  maxScanFiles: number
}

export interface WebSearchSettings {
  enabled: boolean
  /** `auto` uses a saved key when it works and falls back to DuckDuckGo, then Bing. */
  provider: WebSearchProvider
  /** Results requested from the provider (and shown in the card). */
  maxResults: number
  /** Top results whose pages are downloaded and extracted for the model. */
  readPages: number
  /** Hard limit of searches per agent run, so a model cannot loop. */
  maxUses: number
  safeSearch: boolean
}

export interface VisualsSettings {
  /** `show_image` is offered to the model at all. */
  imagesEnabled: boolean
  imageMode: VisualMode
  /** Allow pictures hosted on the web; off keeps only workspace files. */
  remoteImages: boolean
  /** Largest picture the tool will fetch or read, in megabytes. */
  maxImageMb: number
  /** Show the page a picture came from under it. */
  imageSource: boolean
  /** `draw_figure` is offered to the model at all. */
  figuresEnabled: boolean
  figureMode: VisualMode
  /** Fine grid behind drawings (like graph paper). */
  figureGrid: boolean
  /** Print the computed values under a drawing. */
  figureResults: boolean
  figureTheme: FigureTheme
}

export interface EditorSettings {
  fontSize: number
  fontFamily: string
  /** 0 = compute from the font size. */
  lineHeight: number
  tabSize: number
  insertSpaces: boolean
  wordWrap: boolean
  minimap: boolean
  lineNumbers: (typeof LINE_NUMBERS)[number]
  renderWhitespace: (typeof WHITESPACE)[number]
  fontLigatures: boolean
  stickyScroll: boolean
  smoothScrolling: boolean
  cursorBlinking: (typeof CURSOR_BLINKING)[number]
  renderLineHighlight: (typeof LINE_HIGHLIGHTS)[number]
  bracketPairColorization: boolean
  indentGuides: boolean
  scrollBeyondLastLine: boolean
  glyphMargin: boolean
  padding: number
  autoSave: AutoSaveMode
  autoSaveDelayMs: number
}

export interface UiSettings {
  theme: ThemeMode
  accent: AccentName
  /** 0.85–1.25, scales the whole interface. */
  scale: number
  density: DensityMode
  animations: boolean
  language: LanguageMode
  sidebarOpen: boolean
  chatOpen: boolean
  statusBar: boolean
  showTimestamps: boolean
  showTokenUsage: boolean
  /** Tool cards start expanded. */
  toolDetailsOpen: boolean
  /** Reasoning blocks start expanded instead of collapsed. */
  reasoningOpen: boolean
  /** Chat panel width in pixels. */
  chatWidth: number
  /** Show the background-processes strip in the chat. */
  serversPanel: boolean
  /** The Screen dock right of the chat (live view of connected apps). */
  screenOpen: boolean
  /** Screen dock width in pixels. */
  screenWidth: number
}

export interface ChatSettings {
  defaultMode: ChatMode
  sendOnEnter: boolean
  persist: boolean
  persistLimit: number
  autoScroll: boolean
  titleFromMessage: boolean
  /** How deeply a new chat asks the model to reason before it answers. */
  defaultThinking: ThinkingLevel
}

export interface FilesSettings {
  showHidden: boolean
  /** Names skipped by the file tree and by the agent's scans. */
  excludeGlobs: string[]
  autoRefresh: boolean
  /** delete_path moves entries to the trash instead of removing them. */
  useTrash: boolean
  largeFileKb: number
}

export interface ServerSettings {
  allowRunCommand: boolean
  /** Where the model's commands run: auto, PowerShell, cmd or Windows Terminal. */
  terminalShell: TerminalShell
  /** Refuse catastrophic commands and ask before destructive ones. */
  protectTerminal: boolean
  /** Default timeout of run_command when the model does not pass one. */
  commandTimeoutMs: number
  allowBackground: boolean
  maxServers: number
  stopOnExit: boolean
  bindHint: boolean
  verifyServers: boolean
}

export interface NotificationSettings {
  toastSeconds: number
  /** Errors stay on screen until dismissed. */
  errorsSticky: boolean
  logLevel: LogLevel
  logRequests: boolean
  openDevTools: boolean
}

export interface AdvancedSettings {
  requestTimeoutMs: number
  /** Extra JSON object merged into every chat request body. */
  extraBody: string
  /** Extra JSON object of HTTP headers sent with every chat request. */
  extraHeaders: string
  proxyUrl: string
}

export interface KeymapSettings {
  toggleSidebar: string
  toggleChat: string
  toggleScreen: string
  save: string
  newChat: string
  openSettings: string
  /** Create a file next to the selection (folders in the typed path are created). */
  newFile: string
  newFolder: string
  /** Rename the entry selected in the explorer. */
  rename: string
  deleteEntry: string
  /** Close the file shown in the editor. */
  closeTab: string
  /** Hold to dictate a message into the composer (push-to-talk). */
  pushToTalk: string
}

export interface SettingsValues {
  approvalMode: ApprovalMode
  agent: AgentSettings
  tools: ToolsSettings
  webSearch: WebSearchSettings
  visuals: VisualsSettings
  editor: EditorSettings
  ui: UiSettings
  chat: ChatSettings
  files: FilesSettings
  servers: ServerSettings
  notifications: NotificationSettings
  advanced: AdvancedSettings
  keymap: KeymapSettings
}

export const DEFAULT_SETTINGS: SettingsValues = {
  approvalMode: 'ask',
  agent: {
    temperature: 0.2,
    topP: 1,
    maxTokens: 0,
    maxSteps: 30,
    historyMessages: 40,
    maxRulesChars: 8000,
    retryAttempts: 3,
    retryBaseSeconds: 5,
    contextActiveFile: true,
    contextOpenFiles: true,
    rulesEnabled: true,
    rulesFiles: ['AGENTS.md', 'CLAUDE.md', '.relaxcode/rules.md'],
    responseLanguage: 'auto',
    systemPromptExtra: '',
    guidanceChat: '',
    guidanceAgent: '',
    guidancePlan: '',
    autoVerifyClaims: true,
    recoverTextCalls: true,
    ruleTodos: true,
    ruleServers: true,
    ruleVerify: true,
    morningBriefing: false,
    selfReview: true,
    timeTravel: true,
    timelapse: true,
    tokenSaving: 'off',
    nightMaxSteps: 100,
    nightMaxTokens: 2000000,
    nightTimeoutMin: 120
  },
  tools: {
    disabled: [],
    alwaysAllow: [],
    alwaysDeny: [],
    maxReadLines: 2000,
    maxOutputChars: 30000,
    searchMaxResults: 100,
    fetchMaxKb: 100,
    maxScanFiles: 20000
  },
  webSearch: {
    enabled: true,
    provider: 'auto',
    maxResults: 6,
    readPages: 3,
    maxUses: 6,
    safeSearch: true
  },
  visuals: {
    imagesEnabled: true,
    imageMode: 'auto',
    remoteImages: true,
    maxImageMb: 4,
    imageSource: true,
    figuresEnabled: true,
    figureMode: 'auto',
    figureGrid: true,
    figureResults: true,
    figureTheme: FIGURE_THEMES[0]
  },
  editor: {
    fontSize: 13,
    fontFamily:
      "'Cascadia Code', 'Cascadia Mono', Consolas, 'JetBrains Mono', 'Courier New', monospace",
    lineHeight: 0,
    tabSize: 2,
    insertSpaces: true,
    wordWrap: false,
    minimap: false,
    lineNumbers: 'on',
    renderWhitespace: 'selection',
    fontLigatures: true,
    stickyScroll: false,
    smoothScrolling: true,
    cursorBlinking: 'blink',
    renderLineHighlight: 'line',
    bracketPairColorization: false,
    indentGuides: true,
    scrollBeyondLastLine: false,
    glyphMargin: false,
    padding: 10,
    autoSave: 'off',
    autoSaveDelayMs: 1200
  },
  ui: {
    theme: 'light',
    accent: 'default',
    scale: 1,
    density: 'comfortable',
    animations: true,
    language: 'system',
    sidebarOpen: true,
    chatOpen: true,
    statusBar: true,
    showTimestamps: false,
    showTokenUsage: true,
    toolDetailsOpen: false,
    reasoningOpen: false,
    chatWidth: 384,
    serversPanel: true,
    screenOpen: false,
    screenWidth: 360
  },
  chat: {
    defaultMode: 'agent',
    sendOnEnter: true,
    persist: true,
    persistLimit: 50,
    autoScroll: true,
    titleFromMessage: true,
    defaultThinking: 'off'
  },
  files: {
    showHidden: true,
    excludeGlobs: [
      'node_modules',
      '.git',
      '.svn',
      'dist',
      'out',
      'build',
      'coverage',
      '.next',
      '.nuxt',
      '.cache',
      '.turbo',
      '__pycache__',
      '.venv',
      'venv',
      'target',
      '.idea'
    ],
    autoRefresh: true,
    useTrash: true,
    largeFileKb: 4096
  },
  servers: {
    allowRunCommand: true,
    terminalShell: DEFAULT_TERMINAL_SHELL,
    protectTerminal: true,
    commandTimeoutMs: 60000,
    allowBackground: true,
    maxServers: 5,
    stopOnExit: true,
    bindHint: true,
    verifyServers: true
  },
  notifications: {
    toastSeconds: 4,
    errorsSticky: false,
    logLevel: 'error',
    logRequests: false,
    openDevTools: false
  },
  advanced: {
    requestTimeoutMs: 300000,
    extraBody: '',
    extraHeaders: '',
    proxyUrl: ''
  },
  keymap: {
    toggleSidebar: 'Ctrl+B',
    toggleChat: 'Ctrl+J',
    toggleScreen: 'Ctrl+Shift+E',
    save: 'Ctrl+S',
    newChat: 'Ctrl+Alt+N',
    openSettings: 'Ctrl,',
    newFile: 'Ctrl+N',
    newFolder: 'Ctrl+Shift+N',
    rename: 'F2',
    deleteEntry: 'Delete',
    closeTab: 'Ctrl+W',
    pushToTalk: 'Ctrl+Shift+M'
  }
}

/* --------------------------- value coercion --------------------------- */

export function asNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value))
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

export function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function asString(value: unknown, fallback: string, maxLength = 8000): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback
}

export function asChoice<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

export function asStringList(value: unknown, fallback: string[], maxItems = 60): string[] {
  if (!Array.isArray(value)) return fallback
  const clean = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 120)
  return clean.slice(0, maxItems)
}

/** Deep merge for the settings groups: arrays and scalars are replaced wholesale. */
export function mergeDefaults<T>(defaults: T, value: unknown): T {
  if (value === null || value === undefined) return defaults
  if (Array.isArray(defaults) || typeof defaults !== 'object') {
    return (typeof value === typeof defaults || Array.isArray(defaults) ? value : defaults) as T
  }
  if (typeof value !== 'object' || Array.isArray(value)) return defaults
  const source = value as Record<string, unknown>
  const base = defaults as Record<string, unknown>
  const out: Record<string, unknown> = { ...base }
  for (const key of Object.keys(base)) {
    out[key] = mergeDefaults(base[key], source[key])
  }
  return out as T
}

/* ---------------------------- patch contract ---------------------------- */

export interface SettingsPatch {
  /** Connection shortcuts that write to the active provider. */
  baseUrl?: string
  model?: string | null
  apiKey?: string | null
  approvalMode?: ApprovalMode
  activeProviderId?: string
  providerAdd?: ProviderInput
  providerUpdate?: ProviderInput & { id: string }
  providerRemove?: string
  agent?: Partial<AgentSettings>
  tools?: Partial<ToolsSettings>
  webSearch?: Partial<WebSearchSettings>
  visuals?: Partial<VisualsSettings>
  /** Write-only secret: `undefined` keeps it, `null` clears it. */
  webSearchApiKey?: string | null
  editor?: Partial<EditorSettings>
  ui?: Partial<UiSettings>
  chat?: Partial<ChatSettings>
  files?: Partial<FilesSettings>
  servers?: Partial<ServerSettings>
  notifications?: Partial<NotificationSettings>
  advanced?: Partial<AdvancedSettings>
  keymap?: Partial<KeymapSettings>
}

/** What the renderer receives: everything except secrets. */
export interface PublicSettings extends SettingsValues {
  /** Convenience mirrors of the active provider. */
  baseUrl: string
  hasApiKey: boolean
  model: string | null
  activeProviderId: string
  providers: PublicProvider[]
  /** Whether a search-provider key is stored; the key itself never leaves main. */
  hasSearchApiKey: boolean
}

export type SettingsSaveResult =
  | { ok: true; settings: PublicSettings }
  | { ok: false; error: string }

/** Groups the settings screen can reset at once. */
export type SettingsGroup = Exclude<
  keyof SettingsPatch,
  'providerAdd' | 'providerUpdate' | 'webSearchApiKey'
>

export type ToolRiskLevel = 'read' | 'write' | 'exec' | 'delete'

/** Every tool the agent can call, with the risk level it is approved by. */
export interface ToolCatalogEntry {
  name: string
  risk: ToolRiskLevel
}

/** Listed in the order the settings screen shows them. */
export const TOOL_CATALOG: readonly ToolCatalogEntry[] = [
  { name: 'list_dir', risk: 'read' },
  { name: 'read_file', risk: 'read' },
  { name: 'search_files', risk: 'read' },
  { name: 'search_content', risk: 'read' },
  { name: 'fetch_url', risk: 'read' },
  { name: 'web_search', risk: 'read' },
  { name: 'show_image', risk: 'read' },
  { name: 'draw_figure', risk: 'read' },
  { name: 'git_status', risk: 'read' },
  { name: 'git_diff', risk: 'read' },
  { name: 'todo_write', risk: 'read' },
  { name: 'ask_user', risk: 'read' },
  { name: 'write_file', risk: 'write' },
  { name: 'edit_file', risk: 'write' },
  { name: 'move_path', risk: 'write' },
  { name: 'delete_path', risk: 'delete' },
  { name: 'run_command', risk: 'exec' },
  { name: 'start_server', risk: 'exec' },
  { name: 'stop_server', risk: 'exec' },
  { name: 'list_servers', risk: 'read' }
]

export const TOOL_NAMES: readonly string[] = TOOL_CATALOG.map((tool) => tool.name)
