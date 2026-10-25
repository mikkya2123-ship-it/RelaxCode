import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { ApprovalMode, SettingsFileResult } from '@shared/ipc'
import { TERMINAL_SHELLS } from '@shared/terminal'
import { normalizeBaseUrl } from '@shared/base-url'
import { THINKING_LEVELS } from '@shared/reasoning'
import { TOKEN_SAVING_MODES } from '@shared/token-saving'
import { WEB_SEARCH_PROVIDERS } from '@shared/web-search'
import { FIGURE_THEMES } from '@shared/figures'
import {
  ACCENTS,
  asBoolean,
  asChoice,
  asNumber,
  asString,
  asStringList,
  AUTOSAVE_MODES,
  CURSOR_BLINKING,
  DEFAULT_SETTINGS,
  DENSITIES,
  LANGUAGES,
  LINE_HIGHLIGHTS,
  LINE_NUMBERS,
  LOG_LEVELS,
  mergeDefaults,
  RESPONSE_LANGUAGES,
  THEMES,
  VISUAL_MODES,
  WHITESPACE,
  type ProviderProfile,
  type PublicProvider,
  type PublicSettings,
  type SettingsPatch,
  type SettingsSaveResult,
  type SettingsValues
} from '@shared/settings'

/** A provider as it is stored: the key is encrypted and never leaves this process. */
export interface StoredProvider extends ProviderProfile {
  apiKeyEnc: string | null
}

export interface AppSettings extends SettingsValues {
  recentWorkspaces: string[]
  providers: StoredProvider[]
  activeProviderId: string
  /** Encrypted Tavily / Brave / Serper key; Bing needs none. */
  webSearchApiKeyEnc: string | null
}

/** The shape written by releases that had a single connection. */
interface LegacySettings {
  baseUrl?: string
  model?: string | null
  apiKeyEnc?: string | null
}

let cache: AppSettings | null = null

/** Set when a stored address had to be repaired, so the file is written back. */
let repairedOnLoad = false

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/**
 * The app was called EasyCode until the RelaxCode rename, and Electron derives
 * the profile folder from the package name — so a renamed install would start
 * with an empty profile and lose every chat. Copy the old profile over once,
 * before Chromium opens it.
 */
function migrateLegacyData(): void {
  try {
    const file = settingsPath()
    const profile = dirname(file)
    const legacyProfile = join(dirname(profile), 'easycode')
    if (!existsSync(legacyProfile) || legacyProfile === profile) return

    mkdirSync(profile, { recursive: true })
    if (!existsSync(file)) copyIfPresent(join(legacyProfile, 'settings.json'), file)
    copyIfPresent(join(legacyProfile, 'easycode.log'), join(profile, 'relaxcode.log'))
    // Chats, theme, locale and panel sizes live in localStorage, which the
    // browser keeps inside the profile folder.
    const localStorage = join(profile, 'Local Storage')
    if (!existsSync(localStorage)) {
      const legacyLocalStorage = join(legacyProfile, 'Local Storage')
      if (existsSync(legacyLocalStorage)) {
        cpSync(legacyLocalStorage, localStorage, { recursive: true })
      }
    }
    // `Local State` holds the OS-bound key that encrypts saved API keys. It is
    // tied to the app's identity, so without it a key copied from the old
    // profile can never be decrypted again — the provider would answer 401
    // "Missing Authentication header". Only a profile that has none of its own
    // gets the old one, so a working key store is never overwritten.
    copyIfPresent(join(legacyProfile, 'Local State'), join(profile, 'Local State'))
  } catch {
    // A failed migration is not fatal: the app simply starts from defaults.
  }
}

function copyIfPresent(from: string, to: string): void {
  if (existsSync(from) && !existsSync(to)) copyFileSync(from, to)
}

let migrated = false

/** The address as it should be stored: repaired when that is possible. */
function storageBaseUrl(input: string): string {
  const normalized = normalizeBaseUrl(input)
  return normalized.ok ? normalized.value : input.trim().replace(/\/+$/, '')
}

function newProvider(input: Partial<StoredProvider> = {}): StoredProvider {
  const baseUrl = input.baseUrl ?? ''
  const normalized = normalizeBaseUrl(baseUrl)
  if (normalized.ok && normalized.fixed) repairedOnLoad = true
  return {
    id: input.id ?? randomUUID(),
    name: input.name?.trim() || 'Provider',
    baseUrl: storageBaseUrl(baseUrl),
    model: input.model ?? null,
    apiKeyEnc: input.apiKeyEnc ?? null
  }
}

/**
 * A settings file may predate providers (single `baseUrl` + `apiKeyEnc`) or be
 * hand-edited. Whatever comes in, the result always has at least one provider
 * and an active id that exists.
 */
function normalize(raw: Partial<AppSettings> & LegacySettings): AppSettings {
  const values: SettingsValues = {
    approvalMode: (raw.approvalMode ?? DEFAULT_SETTINGS.approvalMode) as ApprovalMode,
    agent: mergeDefaults(DEFAULT_SETTINGS.agent, sanitizeAgent(raw.agent)),
    tools: mergeDefaults(DEFAULT_SETTINGS.tools, sanitizeTools(raw.tools)),
    webSearch: mergeDefaults(DEFAULT_SETTINGS.webSearch, sanitizeWebSearch(raw.webSearch)),
    visuals: mergeDefaults(DEFAULT_SETTINGS.visuals, sanitizeVisuals(raw.visuals)),
    editor: mergeDefaults(DEFAULT_SETTINGS.editor, sanitizeEditor(raw.editor)),
    ui: mergeDefaults(DEFAULT_SETTINGS.ui, sanitizeUi(raw.ui)),
    chat: mergeDefaults(DEFAULT_SETTINGS.chat, sanitizeChat(raw.chat)),
    files: mergeDefaults(DEFAULT_SETTINGS.files, sanitizeFiles(raw.files)),
    servers: mergeDefaults(DEFAULT_SETTINGS.servers, sanitizeServers(raw.servers)),
    notifications: mergeDefaults(DEFAULT_SETTINGS.notifications, sanitizeNotifications(raw.notifications)),
    advanced: mergeDefaults(DEFAULT_SETTINGS.advanced, sanitizeAdvanced(raw.advanced)),
    keymap: mergeDefaults(DEFAULT_SETTINGS.keymap, sanitizeKeymap(raw.keymap))
  }

  const stored = Array.isArray(raw.providers) ? raw.providers : []
  const providers = stored
    .map((entry) => normalizeProvider(entry))
    .filter((entry): entry is StoredProvider => entry !== null)

  if (providers.length === 0) {
    providers.push(
      newProvider({
        name: legacyProviderName(raw.baseUrl),
        baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : 'https://api.openai.com/v1',
        model: raw.model ?? null,
        apiKeyEnc: raw.apiKeyEnc ?? null
      })
    )
  }

  const activeProviderId = providers.some((entry) => entry.id === raw.activeProviderId)
    ? (raw.activeProviderId as string)
    : providers[0].id

  return {
    ...values,
    recentWorkspaces: Array.isArray(raw.recentWorkspaces)
      ? raw.recentWorkspaces.filter((item): item is string => typeof item === 'string').slice(0, 12)
      : [],
    providers,
    activeProviderId,
    webSearchApiKeyEnc:
      typeof raw.webSearchApiKeyEnc === 'string' && raw.webSearchApiKeyEnc.length > 0
        ? raw.webSearchApiKeyEnc
        : null
  }
}

function normalizeProvider(value: unknown): StoredProvider | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<StoredProvider>
  if (typeof raw.baseUrl !== 'string' || raw.baseUrl.trim().length === 0) return null
  return newProvider({
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : undefined,
    name: typeof raw.name === 'string' ? raw.name : undefined,
    baseUrl: raw.baseUrl,
    model: typeof raw.model === 'string' ? raw.model : null,
    apiKeyEnc: typeof raw.apiKeyEnc === 'string' ? raw.apiKeyEnc : null
  })
}

function legacyProviderName(baseUrl: unknown): string {
  if (typeof baseUrl !== 'string') return 'OpenAI'
  try {
    return new URL(baseUrl).hostname.replace(/^api\./, '') || 'Provider'
  } catch {
    return 'Provider'
  }
}

export function getSettings(): AppSettings {
  if (cache) return cache
  return reloadSettings()
}

export function reloadSettings(): AppSettings {
  if (!migrated) {
    migrated = true
    migrateLegacyData()
  }
  let raw: Partial<AppSettings> & LegacySettings = {}
  try {
    raw = JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<AppSettings> & LegacySettings
  } catch {
    raw = {}
  }
  repairedOnLoad = false
  cache = normalize(raw)
  // A file written by an older build can hold an address that no longer parses
  // (`http:/https://host`); the repaired value is written back once.
  if (repairedOnLoad) persist(cache)
  return cache
}

function persist(settings: AppSettings): void {
  cache = settings
  const file = settingsPath()
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8')
  renameSync(tmp, file)
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch }
  persist(next)
  return next
}

export function activeProvider(settings: AppSettings = getSettings()): StoredProvider {
  return settings.providers.find((item) => item.id === settings.activeProviderId) ?? settings.providers[0]
}

export function providerById(id: string): StoredProvider | null {
  return getSettings().providers.find((item) => item.id === id) ?? null
}

export function getPublicSettings(): PublicSettings {
  const settings = getSettings()
  const active = activeProvider(settings)
  const providers: PublicProvider[] = settings.providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    hasApiKey: provider.apiKeyEnc !== null
  }))
  return {
    ...toValues(settings),
    baseUrl: active.baseUrl,
    hasApiKey: active.apiKeyEnc !== null,
    model: active.model,
    activeProviderId: active.id,
    providers,
    hasSearchApiKey: settings.webSearchApiKeyEnc !== null
  }
}

function toValues(settings: AppSettings): SettingsValues {
  return {
    approvalMode: settings.approvalMode,
    agent: settings.agent,
    tools: settings.tools,
    webSearch: settings.webSearch,
    visuals: settings.visuals,
    editor: settings.editor,
    ui: settings.ui,
    chat: settings.chat,
    files: settings.files,
    servers: settings.servers,
    notifications: settings.notifications,
    advanced: settings.advanced,
    keymap: settings.keymap
  }
}

/** The plain values, without secrets — what "export settings" writes. */
export function serializeSettings(): string {
  const settings = getSettings()
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      values: toValues(settings),
      providers: settings.providers.map(({ name, baseUrl, model }) => ({ name, baseUrl, model }))
    },
    null,
    2
  )
}

/**
 * Applies an exported file. Values are clamped exactly like a patch; providers
 * are only *added* (by endpoint) — stored keys are never overwritten.
 */
export function importSettings(json: string): SettingsSaveResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { ok: false, error: 'invalid-json' }
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'invalid-json' }
  const raw = parsed as {
    values?: Record<string, unknown>
    providers?: Array<{ name?: unknown; baseUrl?: unknown; model?: unknown }>
  }
  const values = (raw.values ?? {}) as Partial<SettingsValues>

  const next: AppSettings = normalize({
    ...(getSettings() as unknown as Partial<AppSettings>),
    ...values,
    providers: getSettings().providers,
    activeProviderId: getSettings().activeProviderId
  })

  if (Array.isArray(raw.providers)) {
    for (const entry of raw.providers) {
      if (!entry || typeof entry.baseUrl !== 'string' || entry.baseUrl.trim().length === 0) continue
      const baseUrl = entry.baseUrl.trim().replace(/\/+$/, '')
      if (next.providers.some((provider) => provider.baseUrl === baseUrl)) continue
      next.providers.push(
        newProvider({
          name: typeof entry.name === 'string' ? entry.name : legacyProviderName(baseUrl),
          baseUrl,
          model: typeof entry.model === 'string' ? entry.model : null
        })
      )
    }
  }

  persist(next)
  return { ok: true, settings: getPublicSettings() }
}

/** Back to the shipped defaults, keeping the connection and the recent folders. */
export function resetSettings(): PublicSettings {
  const settings = getSettings()
  persist({
    ...normalize({}),
    providers: settings.providers,
    activeProviderId: settings.activeProviderId,
    recentWorkspaces: settings.recentWorkspaces,
    webSearchApiKeyEnc: settings.webSearchApiKeyEnc
  })
  return getPublicSettings()
}

export function revealSettingsFile(): SettingsFileResult {
  return { ok: true, path: settingsPath() }
}

export function getWebSearchApiKey(): string | null {
  const encrypted = getSettings().webSearchApiKeyEnc
  if (!encrypted) return null
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch {
    return null
  }
}

export function getApiKey(providerId?: string): string | null {
  const settings = getSettings()
  const provider = providerId
    ? settings.providers.find((item) => item.id === providerId)
    : activeProvider(settings)
  if (!provider?.apiKeyEnc) return null
  try {
    return safeStorage.decryptString(Buffer.from(provider.apiKeyEnc, 'base64'))
  } catch {
    return null
  }
}

function encryptKey(value: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  return safeStorage.encryptString(value).toString('base64')
}

export function addRecentWorkspace(path: string): void {
  const { recentWorkspaces } = getSettings()
  const recent = [path, ...recentWorkspaces.filter((p) => p !== path)].slice(0, 10)
  updateSettings({ recentWorkspaces: recent })
}

export function removeRecentWorkspace(path: string): void {
  const { recentWorkspaces } = getSettings()
  updateSettings({ recentWorkspaces: recentWorkspaces.filter((p) => p !== path) })
}

/* ------------------------------------------------------------------------ *
 * Patch application
 *
 * Everything a patch can carry is coerced and clamped here, so a hand-written
 * patch (or an imported file) can never put a nonsense value into the store.
 * ------------------------------------------------------------------------ */

function sanitizeAgent(value: unknown): Partial<SettingsValues['agent']> {
  const raw = (value ?? {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS.agent
  const out: Partial<SettingsValues['agent']> = {}
  if (raw.temperature !== undefined) out.temperature = asNumber(raw.temperature, 0, 2, d.temperature)
  if (raw.topP !== undefined) out.topP = asNumber(raw.topP, 0, 1, d.topP)
  if (raw.maxTokens !== undefined) out.maxTokens = Math.round(asNumber(raw.maxTokens, 0, 200000, d.maxTokens))
  if (raw.maxSteps !== undefined) out.maxSteps = Math.round(asNumber(raw.maxSteps, 1, 200, d.maxSteps))
  if (raw.historyMessages !== undefined) {
    out.historyMessages = Math.round(asNumber(raw.historyMessages, 2, 400, d.historyMessages))
  }
  if (raw.maxRulesChars !== undefined) {
    out.maxRulesChars = Math.round(asNumber(raw.maxRulesChars, 0, 100000, d.maxRulesChars))
  }
  if (raw.retryAttempts !== undefined) {
    out.retryAttempts = Math.round(asNumber(raw.retryAttempts, 0, 10, d.retryAttempts))
  }
  if (raw.retryBaseSeconds !== undefined) {
    out.retryBaseSeconds = Math.round(asNumber(raw.retryBaseSeconds, 1, 120, d.retryBaseSeconds))
  }
  if (raw.contextActiveFile !== undefined) out.contextActiveFile = asBoolean(raw.contextActiveFile, d.contextActiveFile)
  if (raw.contextOpenFiles !== undefined) out.contextOpenFiles = asBoolean(raw.contextOpenFiles, d.contextOpenFiles)
  if (raw.rulesEnabled !== undefined) out.rulesEnabled = asBoolean(raw.rulesEnabled, d.rulesEnabled)
  if (raw.rulesFiles !== undefined) out.rulesFiles = asStringList(raw.rulesFiles, d.rulesFiles, 12)
  if (raw.responseLanguage !== undefined) {
    out.responseLanguage = asChoice(raw.responseLanguage, RESPONSE_LANGUAGES, d.responseLanguage)
  }
  if (raw.systemPromptExtra !== undefined) {
    out.systemPromptExtra = asString(raw.systemPromptExtra, d.systemPromptExtra, 20000)
  }
  // 'guidanceAsk' was the old name of the chat-mode guidance.
  const rawGuidanceChat = raw.guidanceChat ?? raw.guidanceAsk
  if (rawGuidanceChat !== undefined) {
    out.guidanceChat = asString(rawGuidanceChat, d.guidanceChat, 4000)
  }
  if (raw.guidanceAgent !== undefined) out.guidanceAgent = asString(raw.guidanceAgent, d.guidanceAgent, 4000)
  if (raw.guidancePlan !== undefined) out.guidancePlan = asString(raw.guidancePlan, d.guidancePlan, 4000)
  if (raw.autoVerifyClaims !== undefined) out.autoVerifyClaims = asBoolean(raw.autoVerifyClaims, d.autoVerifyClaims)
  if (raw.recoverTextCalls !== undefined) out.recoverTextCalls = asBoolean(raw.recoverTextCalls, d.recoverTextCalls)
  if (raw.ruleTodos !== undefined) out.ruleTodos = asBoolean(raw.ruleTodos, d.ruleTodos)
  if (raw.ruleServers !== undefined) out.ruleServers = asBoolean(raw.ruleServers, d.ruleServers)
  if (raw.ruleVerify !== undefined) out.ruleVerify = asBoolean(raw.ruleVerify, d.ruleVerify)
  if (raw.morningBriefing !== undefined) out.morningBriefing = asBoolean(raw.morningBriefing, d.morningBriefing)
  if (raw.selfReview !== undefined) out.selfReview = asBoolean(raw.selfReview, d.selfReview)
  if (raw.timeTravel !== undefined) out.timeTravel = asBoolean(raw.timeTravel, d.timeTravel)
  if (raw.timelapse !== undefined) out.timelapse = asBoolean(raw.timelapse, d.timelapse)
  if (raw.tokenSaving !== undefined) {
    out.tokenSaving = asChoice(raw.tokenSaving, TOKEN_SAVING_MODES, d.tokenSaving)
  }
  if (raw.nightMaxSteps !== undefined) {
    out.nightMaxSteps = Math.round(asNumber(raw.nightMaxSteps, 1, 2000, d.nightMaxSteps))
  }
  if (raw.nightMaxTokens !== undefined) {
    out.nightMaxTokens = Math.round(asNumber(raw.nightMaxTokens, 10000, 100000000, d.nightMaxTokens))
  }
  if (raw.nightTimeoutMin !== undefined) {
    out.nightTimeoutMin = Math.round(asNumber(raw.nightTimeoutMin, 1, 1440, d.nightTimeoutMin))
  }
  return out
}

function sanitizeTools(value: unknown): Partial<SettingsValues['tools']> {
  const raw = (value ?? {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS.tools
  const out: Partial<SettingsValues['tools']> = {}
  if (raw.disabled !== undefined) out.disabled = asStringList(raw.disabled, d.disabled, 60)
  if (raw.alwaysAllow !== undefined) out.alwaysAllow = asStringList(raw.alwaysAllow, d.alwaysAllow, 60)
  if (raw.alwaysDeny !== undefined) out.alwaysDeny = asStringList(raw.alwaysDeny, d.alwaysDeny, 60)
  if (raw.maxReadLines !== undefined) {
    out.maxReadLines = Math.round(asNumber(raw.maxReadLines, 50, 20000, d.maxReadLines))
  }
  if (raw.maxOutputChars !== undefined) {
    out.maxOutputChars = Math.round(asNumber(raw.maxOutputChars, 1000, 400000, d.maxOutputChars))
  }
  if (raw.searchMaxResults !== undefined) {
    out.searchMaxResults = Math.round(asNumber(raw.searchMaxResults, 5, 2000, d.searchMaxResults))
  }
  if (raw.fetchMaxKb !== undefined) out.fetchMaxKb = Math.round(asNumber(raw.fetchMaxKb, 4, 4096, d.fetchMaxKb))
  if (raw.maxScanFiles !== undefined) {
    out.maxScanFiles = Math.round(asNumber(raw.maxScanFiles, 100, 200000, d.maxScanFiles))
  }
  return out
}

function sanitizeWebSearch(value: unknown): Partial<SettingsValues['webSearch']> {
  const raw = (value ?? {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS.webSearch
  const out: Partial<SettingsValues['webSearch']> = {}
  if (raw.enabled !== undefined) out.enabled = asBoolean(raw.enabled, d.enabled)
  if (raw.provider !== undefined) {
    out.provider = asChoice(raw.provider, WEB_SEARCH_PROVIDERS, d.provider)
  }
  if (raw.maxResults !== undefined) {
    out.maxResults = Math.round(asNumber(raw.maxResults, 1, 10, d.maxResults))
  }
  if (raw.readPages !== undefined) {
    out.readPages = Math.round(asNumber(raw.readPages, 0, 5, d.readPages))
  }
  if (raw.maxUses !== undefined) {
    out.maxUses = Math.round(asNumber(raw.maxUses, 1, 20, d.maxUses))
  }
  if (raw.safeSearch !== undefined) out.safeSearch = asBoolean(raw.safeSearch, d.safeSearch)
  return out
}

function sanitizeVisuals(value: unknown): Partial<SettingsValues['visuals']> {
  const raw = (value ?? {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS.visuals
  const out: Partial<SettingsValues['visuals']> = {}
  if (raw.imagesEnabled !== undefined) out.imagesEnabled = asBoolean(raw.imagesEnabled, d.imagesEnabled)
  if (raw.imageMode !== undefined) out.imageMode = asChoice(raw.imageMode, VISUAL_MODES, d.imageMode)
  if (raw.remoteImages !== undefined) out.remoteImages = asBoolean(raw.remoteImages, d.remoteImages)
  if (raw.maxImageMb !== undefined) {
    out.maxImageMb = asNumber(raw.maxImageMb, 1, 12, d.maxImageMb)
  }
  if (raw.imageSource !== undefined) out.imageSource = asBoolean(raw.imageSource, d.imageSource)
  if (raw.figuresEnabled !== undefined) {
    out.figuresEnabled = asBoolean(raw.figuresEnabled, d.figuresEnabled)
  }
  if (raw.figureMode !== undefined) out.figureMode = asChoice(raw.figureMode, VISUAL_MODES, d.figureMode)
  if (raw.figureGrid !== undefined) out.figureGrid = asBoolean(raw.figureGrid, d.figureGrid)
  if (raw.figureResults !== undefined) {
    out.figureResults = asBoolean(raw.figureResults, d.figureResults)
  }
  if (raw.figureTheme !== undefined) {
    out.figureTheme = asChoice(raw.figureTheme, FIGURE_THEMES, d.figureTheme)
  }
  return out
}

function sanitizeEditor(value: unknown): Partial<SettingsValues['editor']> {
  const raw = (value ?? {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS.editor
  const out: Partial<SettingsValues['editor']> = {}
  if (raw.fontSize !== undefined) out.fontSize = Math.round(asNumber(raw.fontSize, 8, 32, d.fontSize))
  if (raw.fontFamily !== undefined) out.fontFamily = asString(raw.fontFamily, d.fontFamily, 300)
  if (raw.lineHeight !== undefined) out.lineHeight = Math.round(asNumber(raw.lineHeight, 0, 60, d.lineHeight))
  if (raw.tabSize !== undefined) out.tabSize = Math.round(asNumber(raw.tabSize, 1, 8, d.tabSize))
  if (raw.insertSpaces !== undefined) out.insertSpaces = asBoolean(raw.insertSpaces, d.insertSpaces)
  if (raw.wordWrap !== undefined) out.wordWrap = asBoolean(raw.wordWrap, d.wordWrap)
  if (raw.minimap !== undefined) out.minimap = asBoolean(raw.minimap, d.minimap)
  if (raw.lineNumbers !== undefined) out.lineNumbers = asChoice(raw.lineNumbers, LINE_NUMBERS, d.lineNumbers)
  if (raw.renderWhitespace !== undefined) {
    out.renderWhitespace = asChoice(raw.renderWhitespace, WHITESPACE, d.renderWhitespace)
  }
  if (raw.fontLigatures !== undefined) out.fontLigatures = asBoolean(raw.fontLigatures, d.fontLigatures)
  if (raw.stickyScroll !== undefined) out.stickyScroll = asBoolean(raw.stickyScroll, d.stickyScroll)
  if (raw.smoothScrolling !== undefined) out.smoothScrolling = asBoolean(raw.smoothScrolling, d.smoothScrolling)
  if (raw.cursorBlinking !== undefined) {
    out.cursorBlinking = asChoice(raw.cursorBlinking, CURSOR_BLINKING, d.cursorBlinking)
  }
  if (raw.renderLineHighlight !== undefined) {
    out.renderLineHighlight = asChoice(raw.renderLineHighlight, LINE_HIGHLIGHTS, d.renderLineHighlight)
  }
  if (raw.bracketPairColorization !== undefined) {
    out.bracketPairColorization = asBoolean(raw.bracketPairColorization, d.bracketPairColorization)
  }
  if (raw.indentGuides !== undefined) out.indentGuides = asBoolean(raw.indentGuides, d.indentGuides)
  if (raw.scrollBeyondLastLine !== undefined) {
    out.scrollBeyondLastLine = asBoolean(raw.scrollBeyondLastLine, d.scrollBeyondLastLine)
  }
  if (raw.glyphMargin !== undefined) out.glyphMargin = asBoolean(raw.glyphMargin, d.glyphMargin)
  if (raw.padding !== undefined) out.padding = Math.round(asNumber(raw.padding, 0, 48, d.padding))
  if (raw.autoSave !== undefined) out.autoSave = asChoice(raw.autoSave, AUTOSAVE_MODES, d.autoSave)
  if (raw.autoSaveDelayMs !== undefined) {
    out.autoSaveDelayMs = Math.round(asNumber(raw.autoSaveDelayMs, 200, 60000, d.autoSaveDelayMs))
  }
  return out
}

function sanitizeUi(value: unknown): Partial<SettingsValues['ui']> {
  const raw = (value ?? {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS.ui
  const out: Partial<SettingsValues['ui']> = {}
  if (raw.theme !== undefined) out.theme = asChoice(raw.theme, THEMES, d.theme)
  if (raw.accent !== undefined) out.accent = asChoice(raw.accent, ACCENTS, d.accent)
  if (raw.scale !== undefined) out.scale = asNumber(raw.scale, 0.85, 1.3, d.scale)
  if (raw.density !== undefined) out.density = asChoice(raw.density, DENSITIES, d.density)
  if (raw.animations !== undefined) out.animations = asBoolean(raw.animations, d.animations)
  if (raw.language !== undefined) out.language = asChoice(raw.language, LANGUAGES, d.language)
  if (raw.sidebarOpen !== undefined) out.sidebarOpen = asBoolean(raw.sidebarOpen, d.sidebarOpen)
  if (raw.chatOpen !== undefined) out.chatOpen = asBoolean(raw.chatOpen, d.chatOpen)
  if (raw.statusBar !== undefined) out.statusBar = asBoolean(raw.statusBar, d.statusBar)
  if (raw.showTimestamps !== undefined) out.showTimestamps = asBoolean(raw.showTimestamps, d.showTimestamps)
  if (raw.showTokenUsage !== undefined) out.showTokenUsage = asBoolean(raw.showTokenUsage, d.showTokenUsage)
  if (raw.toolDetailsOpen !== undefined) out.toolDetailsOpen = asBoolean(raw.toolDetailsOpen, d.toolDetailsOpen)
  if (raw.reasoningOpen !== undefined) out.reasoningOpen = asBoolean(raw.reasoningOpen, d.reasoningOpen)
  if (raw.chatWidth !== undefined) out.chatWidth = Math.round(asNumber(raw.chatWidth, 300, 720, d.chatWidth))
  if (raw.serversPanel !== undefined) out.serversPanel = asBoolean(raw.serversPanel, d.serversPanel)
  if (raw.screenOpen !== undefined) out.screenOpen = asBoolean(raw.screenOpen, d.screenOpen)
  if (raw.screenWidth !== undefined) {
    out.screenWidth = Math.round(asNumber(raw.screenWidth, 280, 720, d.screenWidth))
  }
  return out
}

function sanitizeChat(value: unknown): Partial<SettingsValues['chat']> {
  const raw = (value ?? {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS.chat
  const out: Partial<SettingsValues['chat']> = {}
  if (raw.defaultMode !== undefined) {
    // 'ask' was the old name of the chat mode.
    const legacyMode = raw.defaultMode === 'ask' ? 'chat' : raw.defaultMode
    out.defaultMode = asChoice(legacyMode, ['chat', 'agent', 'plan'] as const, d.defaultMode)
  }
  if (raw.sendOnEnter !== undefined) out.sendOnEnter = asBoolean(raw.sendOnEnter, d.sendOnEnter)
  if (raw.persist !== undefined) out.persist = asBoolean(raw.persist, d.persist)
  if (raw.persistLimit !== undefined) {
    out.persistLimit = Math.round(asNumber(raw.persistLimit, 1, 500, d.persistLimit))
  }
  if (raw.autoScroll !== undefined) out.autoScroll = asBoolean(raw.autoScroll, d.autoScroll)
  if (raw.titleFromMessage !== undefined) out.titleFromMessage = asBoolean(raw.titleFromMessage, d.titleFromMessage)
  if (raw.defaultThinking !== undefined) {
    out.defaultThinking = asChoice(raw.defaultThinking, THINKING_LEVELS, d.defaultThinking)
  }
  return out
}

function sanitizeFiles(value: unknown): Partial<SettingsValues['files']> {
  const raw = (value ?? {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS.files
  const out: Partial<SettingsValues['files']> = {}
  if (raw.showHidden !== undefined) out.showHidden = asBoolean(raw.showHidden, d.showHidden)
  if (raw.excludeGlobs !== undefined) out.excludeGlobs = asStringList(raw.excludeGlobs, d.excludeGlobs, 80)
  if (raw.autoRefresh !== undefined) out.autoRefresh = asBoolean(raw.autoRefresh, d.autoRefresh)
  if (raw.useTrash !== undefined) out.useTrash = asBoolean(raw.useTrash, d.useTrash)
  if (raw.largeFileKb !== undefined) {
    out.largeFileKb = Math.round(asNumber(raw.largeFileKb, 64, 65536, d.largeFileKb))
  }
  return out
}

function sanitizeServers(value: unknown): Partial<SettingsValues['servers']> {
  const raw = (value ?? {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS.servers
  const out: Partial<SettingsValues['servers']> = {}
  if (raw.allowRunCommand !== undefined) out.allowRunCommand = asBoolean(raw.allowRunCommand, d.allowRunCommand)
  if (raw.terminalShell !== undefined) {
    out.terminalShell = asChoice(raw.terminalShell, TERMINAL_SHELLS, d.terminalShell)
  }
  if (raw.protectTerminal !== undefined) {
    out.protectTerminal = asBoolean(raw.protectTerminal, d.protectTerminal)
  }
  if (raw.commandTimeoutMs !== undefined) {
    out.commandTimeoutMs = Math.round(asNumber(raw.commandTimeoutMs, 1000, 600000, d.commandTimeoutMs))
  }
  if (raw.allowBackground !== undefined) out.allowBackground = asBoolean(raw.allowBackground, d.allowBackground)
  if (raw.maxServers !== undefined) out.maxServers = Math.round(asNumber(raw.maxServers, 1, 50, d.maxServers))
  if (raw.stopOnExit !== undefined) out.stopOnExit = asBoolean(raw.stopOnExit, d.stopOnExit)
  if (raw.bindHint !== undefined) out.bindHint = asBoolean(raw.bindHint, d.bindHint)
  if (raw.verifyServers !== undefined) out.verifyServers = asBoolean(raw.verifyServers, d.verifyServers)
  return out
}

function sanitizeNotifications(value: unknown): Partial<SettingsValues['notifications']> {
  const raw = (value ?? {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS.notifications
  const out: Partial<SettingsValues['notifications']> = {}
  if (raw.toastSeconds !== undefined) out.toastSeconds = asNumber(raw.toastSeconds, 1, 30, d.toastSeconds)
  if (raw.errorsSticky !== undefined) out.errorsSticky = asBoolean(raw.errorsSticky, d.errorsSticky)
  if (raw.logLevel !== undefined) out.logLevel = asChoice(raw.logLevel, LOG_LEVELS, d.logLevel)
  if (raw.logRequests !== undefined) out.logRequests = asBoolean(raw.logRequests, d.logRequests)
  if (raw.openDevTools !== undefined) out.openDevTools = asBoolean(raw.openDevTools, d.openDevTools)
  return out
}

function sanitizeAdvanced(value: unknown): Partial<SettingsValues['advanced']> {
  const raw = (value ?? {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS.advanced
  const out: Partial<SettingsValues['advanced']> = {}
  if (raw.requestTimeoutMs !== undefined) {
    out.requestTimeoutMs = Math.round(asNumber(raw.requestTimeoutMs, 5000, 3600000, d.requestTimeoutMs))
  }
  if (raw.extraBody !== undefined) out.extraBody = asString(raw.extraBody, d.extraBody, 8000)
  if (raw.extraHeaders !== undefined) out.extraHeaders = asString(raw.extraHeaders, d.extraHeaders, 8000)
  if (raw.proxyUrl !== undefined) out.proxyUrl = asString(raw.proxyUrl, d.proxyUrl, 500)
  return out
}

function sanitizeKeymap(value: unknown): Partial<SettingsValues['keymap']> {
  const raw = (value ?? {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS.keymap
  const out: Partial<SettingsValues['keymap']> = {}
  if (raw.toggleSidebar !== undefined) out.toggleSidebar = asString(raw.toggleSidebar, d.toggleSidebar, 40)
  if (raw.toggleChat !== undefined) out.toggleChat = asString(raw.toggleChat, d.toggleChat, 40)
  if (raw.toggleScreen !== undefined) out.toggleScreen = asString(raw.toggleScreen, d.toggleScreen, 40)
  if (raw.save !== undefined) out.save = asString(raw.save, d.save, 40)
  if (raw.newChat !== undefined) out.newChat = asString(raw.newChat, d.newChat, 40)
  if (raw.openSettings !== undefined) out.openSettings = asString(raw.openSettings, d.openSettings, 40)
  if (raw.newFile !== undefined) out.newFile = asString(raw.newFile, d.newFile, 40)
  if (raw.newFolder !== undefined) out.newFolder = asString(raw.newFolder, d.newFolder, 40)
  if (raw.rename !== undefined) out.rename = asString(raw.rename, d.rename, 40)
  if (raw.deleteEntry !== undefined) out.deleteEntry = asString(raw.deleteEntry, d.deleteEntry, 40)
  if (raw.closeTab !== undefined) out.closeTab = asString(raw.closeTab, d.closeTab, 40)
  if (raw.pushToTalk !== undefined) out.pushToTalk = asString(raw.pushToTalk, d.pushToTalk, 40)
  return out
}

/** Rejects JSON that is not an object — the request body/headers must stay objects. */
function invalidJsonObject(value: string): boolean {
  if (value.trim().length === 0) return false
  try {
    const parsed: unknown = JSON.parse(value)
    return !parsed || typeof parsed !== 'object' || Array.isArray(parsed)
  } catch {
    return true
  }
}

export function applySettingsPatch(patch: SettingsPatch): SettingsSaveResult {
  const current = getSettings()
  const next: AppSettings = {
    ...current,
    providers: current.providers.map((provider) => ({ ...provider })),
    agent: { ...current.agent },
    tools: { ...current.tools },
    webSearch: { ...current.webSearch },
    visuals: { ...current.visuals },
    editor: { ...current.editor },
    ui: { ...current.ui },
    chat: { ...current.chat },
    files: { ...current.files },
    servers: { ...current.servers },
    notifications: { ...current.notifications },
    advanced: { ...current.advanced },
    keymap: { ...current.keymap }
  }

  if (patch.approvalMode !== undefined) next.approvalMode = patch.approvalMode

  if (patch.agent) Object.assign(next.agent, sanitizeAgent(patch.agent))
  if (patch.tools) Object.assign(next.tools, sanitizeTools(patch.tools))
  if (patch.webSearch) Object.assign(next.webSearch, sanitizeWebSearch(patch.webSearch))
  if (patch.visuals) Object.assign(next.visuals, sanitizeVisuals(patch.visuals))
  if (patch.webSearchApiKey !== undefined) {
    if (patch.webSearchApiKey === null || patch.webSearchApiKey.trim() === '') {
      next.webSearchApiKeyEnc = null
    } else {
      if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'encryption-unavailable' }
      next.webSearchApiKeyEnc = encryptKey(patch.webSearchApiKey.trim())
    }
  }
  if (patch.editor) Object.assign(next.editor, sanitizeEditor(patch.editor))
  if (patch.ui) Object.assign(next.ui, sanitizeUi(patch.ui))
  if (patch.chat) Object.assign(next.chat, sanitizeChat(patch.chat))
  if (patch.files) Object.assign(next.files, sanitizeFiles(patch.files))
  if (patch.servers) Object.assign(next.servers, sanitizeServers(patch.servers))
  if (patch.notifications) Object.assign(next.notifications, sanitizeNotifications(patch.notifications))
  if (patch.advanced) Object.assign(next.advanced, sanitizeAdvanced(patch.advanced))
  if (patch.keymap) Object.assign(next.keymap, sanitizeKeymap(patch.keymap))

  if (invalidJsonObject(next.advanced.extraBody)) return { ok: false, error: 'invalid-json-body' }
  if (invalidJsonObject(next.advanced.extraHeaders)) return { ok: false, error: 'invalid-json-headers' }

  const active = next.providers.find((provider) => provider.id === next.activeProviderId)

  // `baseUrl`/`model`/`apiKey` are shortcuts for the active provider: the chat
  // panel, the status bar and older callers keep using them.
  if (patch.baseUrl !== undefined && active) {
    const baseUrl = normalizeBaseUrl(patch.baseUrl)
    if (!baseUrl.ok) return { ok: false, error: 'invalid-base-url' }
    active.baseUrl = baseUrl.value
  }
  if (patch.model !== undefined && active) active.model = patch.model
  if (patch.apiKey !== undefined && active) {
    if (patch.apiKey === null || patch.apiKey.trim() === '') {
      active.apiKeyEnc = null
    } else {
      if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'encryption-unavailable' }
      active.apiKeyEnc = encryptKey(patch.apiKey.trim())
    }
  }

  if (patch.providerAdd) {
    const baseUrl = normalizeBaseUrl(patch.providerAdd.baseUrl ?? '')
    if (!baseUrl.ok) return { ok: false, error: 'invalid-base-url' }
    const provider = newProvider({
      name: patch.providerAdd.name?.trim() || legacyProviderName(baseUrl.value),
      baseUrl: baseUrl.value,
      model: patch.providerAdd.model ?? null
    })
    if (patch.providerAdd.apiKey !== undefined && patch.providerAdd.apiKey !== null) {
      if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'encryption-unavailable' }
      provider.apiKeyEnc = encryptKey(patch.providerAdd.apiKey.trim())
    }
    next.providers.push(provider)
  }

  if (patch.providerUpdate) {
    const provider = next.providers.find((item) => item.id === patch.providerUpdate?.id)
    if (!provider) return { ok: false, error: 'unknown-provider' }
    const update = patch.providerUpdate
    if (update.baseUrl !== undefined) {
      const baseUrl = normalizeBaseUrl(update.baseUrl)
      if (!baseUrl.ok) return { ok: false, error: 'invalid-base-url' }
      provider.baseUrl = baseUrl.value
    }
    if (update.name !== undefined) provider.name = update.name.trim() || provider.name
    if (update.model !== undefined) provider.model = update.model
    if (update.apiKey !== undefined) {
      if (update.apiKey === null || update.apiKey.trim() === '') {
        provider.apiKeyEnc = null
      } else {
        if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'encryption-unavailable' }
        provider.apiKeyEnc = encryptKey(update.apiKey.trim())
      }
    }
  }

  if (patch.providerRemove !== undefined) {
    if (next.providers.length <= 1) return { ok: false, error: 'last-provider' }
    next.providers = next.providers.filter((provider) => provider.id !== patch.providerRemove)
    if (!next.providers.some((provider) => provider.id === next.activeProviderId)) {
      next.activeProviderId = next.providers[0].id
    }
  }

  if (patch.activeProviderId !== undefined) {
    if (!next.providers.some((provider) => provider.id === patch.activeProviderId)) {
      return { ok: false, error: 'unknown-provider' }
    }
    next.activeProviderId = patch.activeProviderId
  }

  persist(next)
  return { ok: true, settings: getPublicSettings() }
}
