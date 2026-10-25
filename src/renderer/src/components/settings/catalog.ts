import type { TKey } from '@shared/i18n'
import type { SettingsValues } from '@shared/settings'
import { TERMINAL_SHELLS } from '@shared/terminal'
import { FIGURE_THEMES } from '@shared/figures'

/**
 * The settings screen is generated from this catalogue: one entry per row.
 * Adding a setting means adding a field to `@shared/settings` and a line here —
 * the screen, the search and the wiring come for free.
 */

export type SectionId =
  | 'connection'
  | 'agent'
  | 'tools'
  | 'webSearch'
  | 'visuals'
  | 'editor'
  | 'ui'
  | 'chat'
  | 'files'
  | 'servers'
  | 'mcp'
  | 'notifications'
  | 'keymap'
  | 'advanced'

export interface SectionDef {
  id: SectionId
  label: TKey
  icon: string
}

export const SECTIONS: SectionDef[] = [
  { id: 'connection', label: 'settings.section.connection', icon: 'plug' },
  { id: 'agent', label: 'settings.section.agent', icon: 'bot' },
  { id: 'tools', label: 'settings.section.tools', icon: 'wrench' },
  { id: 'webSearch', label: 'settings.section.webSearch', icon: 'globe' },
  { id: 'visuals', label: 'settings.section.visuals', icon: 'image' },
  { id: 'editor', label: 'settings.section.editor', icon: 'code' },
  { id: 'ui', label: 'settings.section.ui', icon: 'palette' },
  { id: 'chat', label: 'settings.section.chat', icon: 'messages' },
  { id: 'files', label: 'settings.section.files', icon: 'folder' },
  { id: 'servers', label: 'settings.section.servers', icon: 'server' },
  { id: 'mcp', label: 'settings.section.mcp', icon: 'monitor' },
  { id: 'notifications', label: 'settings.section.notifications', icon: 'bell' },
  { id: 'keymap', label: 'settings.section.keymap', icon: 'keyboard' },
  { id: 'advanced', label: 'settings.section.advanced', icon: 'sliders' }
]

export interface SelectOption {
  value: string
  label: TKey
}

export type Unit = 'ms' | 's' | 'px' | 'kb' | 'mb' | 'chars' | 'tokens'

export type Control =
  | { kind: 'switch' }
  | { kind: 'select'; options: SelectOption[] }
  | { kind: 'number'; min: number; max: number; step?: number; unit?: Unit }
  | { kind: 'slider'; min: number; max: number; step: number }
  | { kind: 'text'; placeholder?: string }
  | { kind: 'textarea'; rows?: number }
  | { kind: 'list' }
  | { kind: 'accent' }
  | { kind: 'keymap' }
  | { kind: 'tools' }
  | { kind: 'providers' }
  | { kind: 'mcpServers' }
  | { kind: 'webSearchKey' }
  | { kind: 'action'; action: 'export' | 'import' | 'reveal' | 'reset' | 'clearChats' }

export interface SettingDef {
  id: string
  section: SectionId
  /** Group the value lives in; omitted for rows that are not a single value. */
  group?: keyof SettingsValues
  key?: string
  /** The group itself holds the value (e.g. `approvalMode`) instead of an object. */
  flat?: boolean
  label: TKey
  hint?: TKey
  control: Control
  /** Extra words the search should match (both languages). */
  keywords?: string
}

/** Builds `prefix.value` labels for a list of enum values. */
function options(prefix: string, values: readonly string[]): SelectOption[] {
  return values.map((value) => ({
    value,
    label: `${prefix}.${value}` as TKey
  }))
}

export const SETTINGS_CATALOG: SettingDef[] = [
  // ---------------------------------------------------------------- connection
  {
    id: 'connection.providers',
    section: 'connection',
    label: 'settings.providers',
    hint: 'settings.providers.hint',
    control: { kind: 'providers' },
    keywords: 'api key ключ endpoint base url провайдер модель'
  },

  // ---------------------------------------------------------------------- agent
  {
    id: 'agent.approvalMode',
    section: 'agent',
    group: 'approvalMode',
    flat: true,
    label: 'settings.approval',
    hint: 'settings.approval.hint',
    control: { kind: 'select', options: options('settings.approval', ['ask', 'auto-safe', 'full-auto']) },
    keywords: 'подтверждение разрешение approval'
  },
  {
    id: 'agent.tokenSaving',
    section: 'agent',
    group: 'agent',
    key: 'tokenSaving',
    label: 'settings.agent.tokenSaving',
    hint: 'settings.agent.tokenSaving.hint',
    control: { kind: 'select', options: options('settings.saving', ['off', 'on', 'super']) },
    keywords: 'экономия tokens saving контекст budget super супер лимит стоимость'
  },
  {
    id: 'agent.temperature',
    section: 'agent',
    group: 'agent',
    key: 'temperature',
    label: 'settings.agent.temperature',
    hint: 'settings.agent.temperature.hint',
    control: { kind: 'slider', min: 0, max: 2, step: 0.05 },
    keywords: 'temperature случайность креативность'
  },
  {
    id: 'agent.topP',
    section: 'agent',
    group: 'agent',
    key: 'topP',
    label: 'settings.agent.topP',
    control: { kind: 'slider', min: 0.1, max: 1, step: 0.05 },
    keywords: 'top_p nucleus sampling'
  },
  {
    id: 'agent.maxTokens',
    section: 'agent',
    group: 'agent',
    key: 'maxTokens',
    label: 'settings.agent.maxTokens',
    hint: 'settings.agent.maxTokens.hint',
    control: { kind: 'number', min: 0, max: 200000, step: 128, unit: 'tokens' },
    keywords: 'max_tokens длина ответа лимит'
  },
  {
    id: 'agent.maxSteps',
    section: 'agent',
    group: 'agent',
    key: 'maxSteps',
    label: 'settings.agent.maxSteps',
    hint: 'settings.agent.maxSteps.hint',
    control: { kind: 'number', min: 1, max: 200, step: 1 },
    keywords: 'шаги итерации цикл'
  },
  {
    id: 'agent.historyMessages',
    section: 'agent',
    group: 'agent',
    key: 'historyMessages',
    label: 'settings.agent.historyMessages',
    hint: 'settings.agent.historyMessages.hint',
    control: { kind: 'number', min: 2, max: 400, step: 2 },
    keywords: 'история сообщений контекст'
  },
  {
    id: 'agent.retryAttempts',
    section: 'agent',
    group: 'agent',
    key: 'retryAttempts',
    label: 'settings.agent.retryAttempts',
    hint: 'settings.agent.retryAttempts.hint',
    control: { kind: 'number', min: 0, max: 10, step: 1 },
    keywords: 'повторы retry ошибки'
  },
  {
    id: 'agent.retryBaseSeconds',
    section: 'agent',
    group: 'agent',
    key: 'retryBaseSeconds',
    label: 'settings.agent.retryBaseSeconds',
    hint: 'settings.agent.retryBaseSeconds.hint',
    control: { kind: 'number', min: 1, max: 120, step: 1, unit: 's' },
    keywords: 'задержка повторов пауза'
  },
  {
    id: 'agent.responseLanguage',
    section: 'agent',
    group: 'agent',
    key: 'responseLanguage',
    label: 'settings.agent.responseLanguage',
    control: { kind: 'select', options: options('settings.language', ['auto', 'ru', 'en']) },
    keywords: 'язык ответа язык'
  },
  {
    id: 'agent.contextActiveFile',
    section: 'agent',
    group: 'agent',
    key: 'contextActiveFile',
    label: 'settings.agent.contextActiveFile',
    control: { kind: 'switch' },
    keywords: 'контекст активный файл'
  },
  {
    id: 'agent.contextOpenFiles',
    section: 'agent',
    group: 'agent',
    key: 'contextOpenFiles',
    label: 'settings.agent.contextOpenFiles',
    control: { kind: 'switch' },
    keywords: 'контекст открытые вкладки'
  },
  {
    id: 'agent.rulesEnabled',
    section: 'agent',
    group: 'agent',
    key: 'rulesEnabled',
    label: 'settings.agent.rulesEnabled',
    hint: 'settings.agent.rulesEnabled.hint',
    control: { kind: 'switch' },
    keywords: 'правила проекта agents.md rules'
  },
  {
    id: 'agent.rulesFiles',
    section: 'agent',
    group: 'agent',
    key: 'rulesFiles',
    label: 'settings.agent.rulesFiles',
    hint: 'settings.agent.rulesFiles.hint',
    control: { kind: 'list' },
    keywords: 'файлы правил agents claude'
  },
  {
    id: 'agent.maxRulesChars',
    section: 'agent',
    group: 'agent',
    key: 'maxRulesChars',
    label: 'settings.agent.maxRulesChars',
    control: { kind: 'number', min: 0, max: 100000, step: 500, unit: 'chars' },
    keywords: 'лимит правил символов'
  },
  {
    id: 'agent.ruleTodos',
    section: 'agent',
    group: 'agent',
    key: 'ruleTodos',
    label: 'settings.agent.ruleTodos',
    control: { kind: 'switch' },
    keywords: 'todo план правилами'
  },
  {
    id: 'agent.morningBriefing',
    section: 'agent',
    group: 'agent',
    key: 'morningBriefing',
    label: 'settings.agent.morningBriefing',
    hint: 'settings.agent.morningBriefing.hint',
    control: { kind: 'switch' },
    keywords: 'брифинг утро дайджест briefing'
  },
  {
    id: 'agent.selfReview',
    section: 'agent',
    group: 'agent',
    key: 'selfReview',
    label: 'settings.agent.selfReview',
    hint: 'settings.agent.selfReview.hint',
    control: { kind: 'switch' },
    keywords: 'ревью критик коммит проверка'
  },
  {
    id: 'agent.timeTravel',
    section: 'agent',
    group: 'agent',
    key: 'timeTravel',
    label: 'settings.agent.timeTravel',
    hint: 'settings.agent.timeTravel.hint',
    control: { kind: 'switch' },
    keywords: 'снапшот откат машина времени'
  },
  {
    id: 'agent.timelapse',
    section: 'agent',
    group: 'agent',
    key: 'timelapse',
    label: 'settings.agent.timelapse',
    hint: 'settings.agent.timelapse.hint',
    control: { kind: 'switch' },
    keywords: 'тимелапс скриншоты фильм запись'
  },
  {
    id: 'agent.ruleServers',
    section: 'agent',
    group: 'agent',
    key: 'ruleServers',
    label: 'settings.agent.ruleServers',
    control: { kind: 'switch' },
    keywords: 'серверы инструкция start_server'
  },
  {
    id: 'agent.ruleVerify',
    section: 'agent',
    group: 'agent',
    key: 'ruleVerify',
    label: 'settings.agent.ruleVerify',
    control: { kind: 'switch' },
    keywords: 'проверка честность не врать'
  },
  {
    id: 'agent.autoVerifyClaims',
    section: 'agent',
    group: 'agent',
    key: 'autoVerifyClaims',
    label: 'settings.agent.autoVerifyClaims',
    hint: 'settings.agent.autoVerifyClaims.hint',
    control: { kind: 'switch' },
    keywords: 'проверка ложный успех предупреждение'
  },
  {
    id: 'agent.recoverTextCalls',
    section: 'agent',
    group: 'agent',
    key: 'recoverTextCalls',
    label: 'settings.agent.recoverTextCalls',
    hint: 'settings.agent.recoverTextCalls.hint',
    control: { kind: 'switch' },
    keywords: 'текстовые вызовы инструментов восстановление'
  },
  {
    id: 'agent.nightMaxSteps',
    section: 'agent',
    group: 'agent',
    key: 'nightMaxSteps',
    label: 'settings.agent.nightMaxSteps',
    hint: 'settings.agent.nightMaxSteps.hint',
    control: { kind: 'number', min: 1, max: 2000, step: 1 },
    keywords: 'ночной автопилот лимит шагов night steps'
  },
  {
    id: 'agent.nightMaxTokens',
    section: 'agent',
    group: 'agent',
    key: 'nightMaxTokens',
    label: 'settings.agent.nightMaxTokens',
    control: { kind: 'number', min: 10000, max: 100000000, step: 10000, unit: 'tokens' },
    keywords: 'ночной автопилот лимит токенов night tokens'
  },
  {
    id: 'agent.nightTimeoutMin',
    section: 'agent',
    group: 'agent',
    key: 'nightTimeoutMin',
    label: 'settings.agent.nightTimeoutMin',
    control: { kind: 'number', min: 1, max: 1440, step: 1, unit: 's' },
    keywords: 'ночной автопилот лимит времени таймаут night timeout'
  },
  {
    id: 'agent.systemPromptExtra',
    section: 'agent',
    group: 'agent',
    key: 'systemPromptExtra',
    label: 'settings.agent.systemPromptExtra',
    hint: 'settings.agent.systemPromptExtra.hint',
    control: { kind: 'textarea', rows: 5 },
    keywords: 'системный промпт инструкции'
  },
  {
    id: 'agent.guidanceChat',
    section: 'agent',
    group: 'agent',
    key: 'guidanceChat',
    label: 'settings.agent.guidanceChat',
    hint: 'settings.agent.guidance.hint',
    control: { kind: 'textarea', rows: 3 },
    keywords: 'промпт режим чат'
  },
  {
    id: 'agent.guidanceAgent',
    section: 'agent',
    group: 'agent',
    key: 'guidanceAgent',
    label: 'settings.agent.guidanceAgent',
    hint: 'settings.agent.guidance.hint',
    control: { kind: 'textarea', rows: 3 },
    keywords: 'промпт режим агент'
  },
  {
    id: 'agent.guidancePlan',
    section: 'agent',
    group: 'agent',
    key: 'guidancePlan',
    label: 'settings.agent.guidancePlan',
    hint: 'settings.agent.guidance.hint',
    control: { kind: 'textarea', rows: 3 },
    keywords: 'промпт режим план'
  },

  // ---------------------------------------------------------------------- tools
  {
    id: 'tools.matrix',
    section: 'tools',
    label: 'settings.tools.matrix',
    hint: 'settings.tools.matrix.hint',
    control: { kind: 'tools' },
    keywords: 'инструменты разрешения allow deny'
  },
  {
    id: 'tools.maxReadLines',
    section: 'tools',
    group: 'tools',
    key: 'maxReadLines',
    label: 'settings.tools.maxReadLines',
    control: { kind: 'number', min: 50, max: 20000, step: 100 },
    keywords: 'лимит чтения строк'
  },
  {
    id: 'tools.maxOutputChars',
    section: 'tools',
    group: 'tools',
    key: 'maxOutputChars',
    label: 'settings.tools.maxOutputChars',
    control: { kind: 'number', min: 1000, max: 400000, step: 1000, unit: 'chars' },
    keywords: 'вывод команды лимит символов'
  },
  {
    id: 'tools.searchMaxResults',
    section: 'tools',
    group: 'tools',
    key: 'searchMaxResults',
    label: 'settings.tools.searchMaxResults',
    control: { kind: 'number', min: 5, max: 2000, step: 5 },
    keywords: 'поиск результатов лимит'
  },
  {
    id: 'tools.fetchMaxKb',
    section: 'tools',
    group: 'tools',
    key: 'fetchMaxKb',
    label: 'settings.tools.fetchMaxKb',
    control: { kind: 'number', min: 4, max: 4096, step: 4, unit: 'kb' },
    keywords: 'fetch url размер ответа'
  },
  {
    id: 'tools.maxScanFiles',
    section: 'tools',
    group: 'tools',
    key: 'maxScanFiles',
    label: 'settings.tools.maxScanFiles',
    control: { kind: 'number', min: 100, max: 200000, step: 100 },
    keywords: 'сканирование файлов лимит'
  },

  // ---------------------------------------------------------------- web search
  {
    id: 'webSearch.enabled',
    section: 'webSearch',
    group: 'webSearch',
    key: 'enabled',
    label: 'settings.webSearch.enabled',
    hint: 'settings.webSearch.enabled.hint',
    control: { kind: 'switch' },
    keywords: 'интернет поиск web search google duckduckgo bing включить'
  },
  {
    id: 'webSearch.provider',
    section: 'webSearch',
    group: 'webSearch',
    key: 'provider',
    label: 'settings.webSearch.provider',
    hint: 'settings.webSearch.provider.hint',
    control: {
      kind: 'select',
      options: options('settings.webSearch.provider', [
        'auto',
        'tavily',
        'brave',
        'serper',
        'duckduckgo',
        'bing'
      ])
    },
    keywords: 'tavily brave serper duckduckgo bing поисковик провайдер api'
  },
  {
    id: 'webSearch.apiKey',
    section: 'webSearch',
    label: 'settings.webSearch.apiKey',
    hint: 'settings.webSearch.apiKey.hint',
    control: { kind: 'webSearchKey' },
    keywords: 'ключ api key tavily brave serper поиск'
  },
  {
    id: 'webSearch.maxResults',
    section: 'webSearch',
    group: 'webSearch',
    key: 'maxResults',
    label: 'settings.webSearch.maxResults',
    hint: 'settings.webSearch.maxResults.hint',
    control: { kind: 'number', min: 1, max: 10, step: 1 },
    keywords: 'результаты выдача количество'
  },
  {
    id: 'webSearch.readPages',
    section: 'webSearch',
    group: 'webSearch',
    key: 'readPages',
    label: 'settings.webSearch.readPages',
    hint: 'settings.webSearch.readPages.hint',
    control: { kind: 'number', min: 0, max: 5, step: 1 },
    keywords: 'страницы читать открывать источники'
  },
  {
    id: 'webSearch.maxUses',
    section: 'webSearch',
    group: 'webSearch',
    key: 'maxUses',
    label: 'settings.webSearch.maxUses',
    hint: 'settings.webSearch.maxUses.hint',
    control: { kind: 'number', min: 1, max: 20, step: 1 },
    keywords: 'лимит поисков запросов цикл'
  },
  {
    id: 'webSearch.safeSearch',
    section: 'webSearch',
    group: 'webSearch',
    key: 'safeSearch',
    label: 'settings.webSearch.safeSearch',
    hint: 'settings.webSearch.safeSearch.hint',
    control: { kind: 'switch' },
    keywords: 'безопасный поиск фильтр adult'
  },

  // -------------------------------------------------- pictures and drawings
  {
    id: 'visuals.imagesEnabled',
    section: 'visuals',
    group: 'visuals',
    key: 'imagesEnabled',
    label: 'settings.visuals.imagesEnabled',
    hint: 'settings.visuals.imagesEnabled.hint',
    control: { kind: 'switch' },
    keywords: 'картинки изображения фото image picture screenshot скриншот вставить'
  },
  {
    id: 'visuals.imageMode',
    section: 'visuals',
    group: 'visuals',
    key: 'imageMode',
    label: 'settings.visuals.imageMode',
    hint: 'settings.visuals.imageMode.hint',
    control: {
      kind: 'select',
      options: options('settings.visualMode', ['auto', 'onRequest', 'off'])
    },
    keywords: 'картинки автоматически по запросу никогда pictures automatic request'
  },
  {
    id: 'visuals.remoteImages',
    section: 'visuals',
    group: 'visuals',
    key: 'remoteImages',
    label: 'settings.visuals.remoteImages',
    hint: 'settings.visuals.remoteImages.hint',
    control: { kind: 'switch' },
    keywords: 'интернет ссылка url скачать download remote internet'
  },
  {
    id: 'visuals.maxImageMb',
    section: 'visuals',
    group: 'visuals',
    key: 'maxImageMb',
    label: 'settings.visuals.maxImageMb',
    hint: 'settings.visuals.maxImageMb.hint',
    control: { kind: 'number', min: 1, max: 8, step: 1, unit: 'mb' },
    keywords: 'размер лимит мегабайты size limit'
  },
  {
    id: 'visuals.imageSource',
    section: 'visuals',
    group: 'visuals',
    key: 'imageSource',
    label: 'settings.visuals.imageSource',
    hint: 'settings.visuals.imageSource.hint',
    control: { kind: 'switch' },
    keywords: 'источник ссылка сайт source link attribution'
  },
  {
    id: 'visuals.figuresEnabled',
    section: 'visuals',
    group: 'visuals',
    key: 'figuresEnabled',
    label: 'settings.visuals.figuresEnabled',
    hint: 'settings.visuals.figuresEnabled.hint',
    control: { kind: 'switch' },
    keywords: 'чертежи рисунки графики геометрия углы отрезки diagram figure graph geometry'
  },
  {
    id: 'visuals.figureMode',
    section: 'visuals',
    group: 'visuals',
    key: 'figureMode',
    label: 'settings.visuals.figureMode',
    hint: 'settings.visuals.figureMode.hint',
    control: {
      kind: 'select',
      options: options('settings.visualMode', ['auto', 'onRequest', 'off'])
    },
    keywords: 'чертить автоматически по запросу никогда draw diagram automatic request'
  },
  {
    id: 'visuals.figureGrid',
    section: 'visuals',
    group: 'visuals',
    key: 'figureGrid',
    label: 'settings.visuals.figureGrid',
    hint: 'settings.visuals.figureGrid.hint',
    control: { kind: 'switch' },
    keywords: 'сетка клетка миллиметровка grid paper'
  },
  {
    id: 'visuals.figureResults',
    section: 'visuals',
    group: 'visuals',
    key: 'figureResults',
    label: 'settings.visuals.figureResults',
    hint: 'settings.visuals.figureResults.hint',
    control: { kind: 'switch' },
    keywords: 'вычисления значения таблица results values вычисления углы площадь'
  },
  {
    id: 'visuals.figureTheme',
    section: 'visuals',
    group: 'visuals',
    key: 'figureTheme',
    label: 'settings.visuals.figureTheme',
    hint: 'settings.visuals.figureTheme.hint',
    control: {
      kind: 'select',
      options: options('settings.figureTheme', [...FIGURE_THEMES])
    },
    keywords: 'оформление тема цвет paper blueprint калька бумага стиль'
  },

  // --------------------------------------------------------------------- editor
  {
    id: 'editor.fontSize',
    section: 'editor',
    group: 'editor',
    key: 'fontSize',
    label: 'settings.editor.fontSize',
    control: { kind: 'number', min: 8, max: 32, step: 1, unit: 'px' },
    keywords: 'шрифт размер editor'
  },
  {
    id: 'editor.fontFamily',
    section: 'editor',
    group: 'editor',
    key: 'fontFamily',
    label: 'settings.editor.fontFamily',
    hint: 'settings.editor.fontFamily.hint',
    control: { kind: 'text' },
    keywords: 'шрифт семейство monospace'
  },
  {
    id: 'editor.lineHeight',
    section: 'editor',
    group: 'editor',
    key: 'lineHeight',
    label: 'settings.editor.lineHeight',
    hint: 'settings.editor.lineHeight.hint',
    control: { kind: 'number', min: 0, max: 60, step: 1, unit: 'px' },
    keywords: 'высота строки интерлиньяж'
  },
  {
    id: 'editor.tabSize',
    section: 'editor',
    group: 'editor',
    key: 'tabSize',
    label: 'settings.editor.tabSize',
    control: { kind: 'number', min: 1, max: 8, step: 1 },
    keywords: 'отступ таб'
  },
  {
    id: 'editor.insertSpaces',
    section: 'editor',
    group: 'editor',
    key: 'insertSpaces',
    label: 'settings.editor.insertSpaces',
    control: { kind: 'switch' },
    keywords: 'пробелы вместо табов'
  },
  {
    id: 'editor.wordWrap',
    section: 'editor',
    group: 'editor',
    key: 'wordWrap',
    label: 'settings.editor.wordWrap',
    control: { kind: 'switch' },
    keywords: 'перенос строк'
  },
  {
    id: 'editor.minimap',
    section: 'editor',
    group: 'editor',
    key: 'minimap',
    label: 'settings.editor.minimap',
    control: { kind: 'switch' },
    keywords: 'миникарта'
  },
  {
    id: 'editor.lineNumbers',
    section: 'editor',
    group: 'editor',
    key: 'lineNumbers',
    label: 'settings.editor.lineNumbers',
    control: { kind: 'select', options: options('settings.editor.lineNumbers', ['on', 'off', 'relative']) },
    keywords: 'номера строк'
  },
  {
    id: 'editor.renderWhitespace',
    section: 'editor',
    group: 'editor',
    key: 'renderWhitespace',
    label: 'settings.editor.renderWhitespace',
    control: { kind: 'select', options: options('settings.editor.renderWhitespace', ['none', 'selection', 'all']) },
    keywords: 'пробелы невидимые символы'
  },
  {
    id: 'editor.fontLigatures',
    section: 'editor',
    group: 'editor',
    key: 'fontLigatures',
    label: 'settings.editor.fontLigatures',
    control: { kind: 'switch' },
    keywords: 'лигатуры'
  },
  {
    id: 'editor.stickyScroll',
    section: 'editor',
    group: 'editor',
    key: 'stickyScroll',
    label: 'settings.editor.stickyScroll',
    control: { kind: 'switch' },
    keywords: 'залипание области'
  },
  {
    id: 'editor.smoothScrolling',
    section: 'editor',
    group: 'editor',
    key: 'smoothScrolling',
    label: 'settings.editor.smoothScrolling',
    control: { kind: 'switch' },
    keywords: 'плавная прокрутка'
  },
  {
    id: 'editor.cursorBlinking',
    section: 'editor',
    group: 'editor',
    key: 'cursorBlinking',
    label: 'settings.editor.cursorBlinking',
    control: {
      kind: 'select',
      options: options('settings.editor.cursorBlinking', ['blink', 'smooth', 'phase', 'expand', 'solid'])
    },
    keywords: 'курсор мигание'
  },
  {
    id: 'editor.renderLineHighlight',
    section: 'editor',
    group: 'editor',
    key: 'renderLineHighlight',
    label: 'settings.editor.renderLineHighlight',
    control: { kind: 'select', options: options('settings.editor.renderLineHighlight', ['none', 'line', 'all']) },
    keywords: 'подсветка строки'
  },
  {
    id: 'editor.bracketPairColorization',
    section: 'editor',
    group: 'editor',
    key: 'bracketPairColorization',
    label: 'settings.editor.bracketPairs',
    control: { kind: 'switch' },
    keywords: 'скобки пары цвет'
  },
  {
    id: 'editor.indentGuides',
    section: 'editor',
    group: 'editor',
    key: 'indentGuides',
    label: 'settings.editor.indentGuides',
    control: { kind: 'switch' },
    keywords: 'направляющие отступов'
  },
  {
    id: 'editor.scrollBeyondLastLine',
    section: 'editor',
    group: 'editor',
    key: 'scrollBeyondLastLine',
    label: 'settings.editor.scrollBeyondLastLine',
    control: { kind: 'switch' },
    keywords: 'прокрутка за последнюю строку'
  },
  {
    id: 'editor.glyphMargin',
    section: 'editor',
    group: 'editor',
    key: 'glyphMargin',
    label: 'settings.editor.glyphMargin',
    control: { kind: 'switch' },
    keywords: 'поля значков отладка'
  },
  {
    id: 'editor.padding',
    section: 'editor',
    group: 'editor',
    key: 'padding',
    label: 'settings.editor.padding',
    control: { kind: 'number', min: 0, max: 48, step: 2, unit: 'px' },
    keywords: 'отступы сверху снизу'
  },
  {
    id: 'editor.autoSave',
    section: 'editor',
    group: 'editor',
    key: 'autoSave',
    label: 'settings.editor.autoSave',
    hint: 'settings.editor.autoSave.hint',
    control: { kind: 'select', options: options('settings.editor.autoSave', ['off', 'afterDelay', 'onFocusChange']) },
    keywords: 'автосохранение'
  },
  {
    id: 'editor.autoSaveDelayMs',
    section: 'editor',
    group: 'editor',
    key: 'autoSaveDelayMs',
    label: 'settings.editor.autoSaveDelay',
    control: { kind: 'number', min: 200, max: 60000, step: 100, unit: 'ms' },
    keywords: 'задержка автосохранения'
  },

  // ------------------------------------------------------------------------- ui
  {
    id: 'ui.theme',
    section: 'ui',
    group: 'ui',
    key: 'theme',
    label: 'settings.ui.theme',
    control: { kind: 'select', options: options('settings.ui.theme', ['light', 'dark', 'system']) },
    keywords: 'тема тёмная светлая оформление theme dark'
  },
  {
    id: 'ui.accent',
    section: 'ui',
    group: 'ui',
    key: 'accent',
    label: 'settings.ui.accent',
    hint: 'settings.ui.accent.hint',
    control: { kind: 'accent' },
    keywords: 'акцент цвет цветовая схема кнопки'
  },
  {
    id: 'ui.scale',
    section: 'ui',
    group: 'ui',
    key: 'scale',
    label: 'settings.ui.scale',
    hint: 'settings.ui.scale.hint',
    control: { kind: 'slider', min: 0.85, max: 1.3, step: 0.05 },
    keywords: 'масштаб размер интерфейса zoom'
  },
  {
    id: 'ui.density',
    section: 'ui',
    group: 'ui',
    key: 'density',
    label: 'settings.ui.density',
    hint: 'settings.ui.density.hint',
    control: { kind: 'select', options: options('settings.ui.density', ['comfortable', 'compact']) },
    keywords: 'плотность компактный списки'
  },
  {
    id: 'ui.animations',
    section: 'ui',
    group: 'ui',
    key: 'animations',
    label: 'settings.ui.animations',
    control: { kind: 'switch' },
    keywords: 'анимации переходы'
  },
  {
    id: 'ui.language',
    section: 'ui',
    group: 'ui',
    key: 'language',
    label: 'settings.ui.language',
    control: { kind: 'select', options: options('settings.language', ['system', 'ru', 'en']) },
    keywords: 'язык интерфейса locale'
  },
  {
    id: 'ui.chatWidth',
    section: 'ui',
    group: 'ui',
    key: 'chatWidth',
    label: 'settings.ui.chatWidth',
    control: { kind: 'number', min: 300, max: 720, step: 8, unit: 'px' },
    keywords: 'ширина панели чата'
  },
  {
    id: 'ui.sidebarOpen',
    section: 'ui',
    group: 'ui',
    key: 'sidebarOpen',
    label: 'settings.ui.sidebarOpen',
    hint: 'settings.ui.startup.hint',
    control: { kind: 'switch' },
    keywords: 'проводник слева старт'
  },
  {
    id: 'ui.chatOpen',
    section: 'ui',
    group: 'ui',
    key: 'chatOpen',
    label: 'settings.ui.chatOpen',
    hint: 'settings.ui.startup.hint',
    control: { kind: 'switch' },
    keywords: 'чат панель старт'
  },
  {
    id: 'ui.statusBar',
    section: 'ui',
    group: 'ui',
    key: 'statusBar',
    label: 'settings.ui.statusBar',
    control: { kind: 'switch' },
    keywords: 'строка состояния статус'
  },
  {
    id: 'ui.serversPanel',
    section: 'ui',
    group: 'ui',
    key: 'serversPanel',
    label: 'settings.ui.serversPanel',
    control: { kind: 'switch' },
    keywords: 'панель серверов процессы'
  },
  {
    id: 'ui.screenOpen',
    section: 'ui',
    group: 'ui',
    key: 'screenOpen',
    label: 'settings.ui.screenOpen',
    hint: 'settings.ui.screenOpen.hint',
    control: { kind: 'switch' },
    keywords: 'экран панель приложений blender стрим кадры screen dock'
  },
  {
    id: 'ui.screenWidth',
    section: 'ui',
    group: 'ui',
    key: 'screenWidth',
    label: 'settings.ui.screenWidth',
    control: { kind: 'number', min: 280, max: 720, step: 8, unit: 'px' },
    keywords: 'ширина панели экрана'
  },
  {
    id: 'ui.showTimestamps',
    section: 'ui',
    group: 'ui',
    key: 'showTimestamps',
    label: 'settings.ui.showTimestamps',
    control: { kind: 'switch' },
    keywords: 'время сообщений'
  },
  {
    id: 'ui.showTokenUsage',
    section: 'ui',
    group: 'ui',
    key: 'showTokenUsage',
    label: 'settings.ui.showTokenUsage',
    control: { kind: 'switch' },
    keywords: 'токены расход'
  },
  {
    id: 'ui.toolDetailsOpen',
    section: 'ui',
    group: 'ui',
    key: 'toolDetailsOpen',
    label: 'settings.ui.toolDetailsOpen',
    hint: 'settings.ui.toolDetailsOpen.hint',
    control: { kind: 'switch' },
    keywords: 'детали инструментов развёрнуто'
  },
  {
    id: 'ui.reasoningOpen',
    section: 'ui',
    group: 'ui',
    key: 'reasoningOpen',
    label: 'settings.ui.reasoningOpen',
    hint: 'settings.ui.reasoningOpen.hint',
    control: { kind: 'switch' },
    keywords: 'размышления reasoning thinking мысли развёрнуто'
  },

  // ----------------------------------------------------------------------- chat
  {
    id: 'chat.defaultMode',
    section: 'chat',
    group: 'chat',
    key: 'defaultMode',
    label: 'settings.chat.defaultMode',
    hint: 'settings.chat.defaultMode.hint',
    control: { kind: 'select', options: options('chat.mode', ['chat', 'agent', 'plan']) },
    keywords: 'режим по умолчанию чат агент план'
  },
  {
    id: 'chat.defaultThinking',
    section: 'chat',
    group: 'chat',
    key: 'defaultThinking',
    label: 'settings.chat.defaultThinking',
    hint: 'settings.chat.defaultThinking.hint',
    control: { kind: 'select', options: options('chat.thinking', ['off', 'low', 'medium', 'high']) },
    keywords: 'размышления reasoning thinking effort думать по умолчанию'
  },
  {
    id: 'chat.sendOnEnter',
    section: 'chat',
    group: 'chat',
    key: 'sendOnEnter',
    label: 'settings.chat.sendOnEnter',
    hint: 'settings.chat.sendOnEnter.hint',
    control: { kind: 'switch' },
    keywords: 'enter отправка ctrl enter'
  },
  {
    id: 'chat.persist',
    section: 'chat',
    group: 'chat',
    key: 'persist',
    label: 'settings.chat.persist',
    hint: 'settings.chat.persist.hint',
    control: { kind: 'switch' },
    keywords: 'история чатов сохранение'
  },
  {
    id: 'chat.persistLimit',
    section: 'chat',
    group: 'chat',
    key: 'persistLimit',
    label: 'settings.chat.persistLimit',
    control: { kind: 'number', min: 1, max: 500, step: 1 },
    keywords: 'сколько чатов хранить'
  },
  {
    id: 'chat.autoScroll',
    section: 'chat',
    group: 'chat',
    key: 'autoScroll',
    label: 'settings.chat.autoScroll',
    control: { kind: 'switch' },
    keywords: 'автопрокрутка вниз'
  },
  {
    id: 'chat.titleFromMessage',
    section: 'chat',
    group: 'chat',
    key: 'titleFromMessage',
    label: 'settings.chat.titleFromMessage',
    control: { kind: 'switch' },
    keywords: 'название чата из сообщения'
  },
  {
    id: 'chat.clearAll',
    section: 'chat',
    label: 'settings.chat.clearAll',
    hint: 'settings.chat.clearAll.hint',
    control: { kind: 'action', action: 'clearChats' },
    keywords: 'очистить историю чатов удалить'
  },

  // ---------------------------------------------------------------------- files
  {
    id: 'files.showHidden',
    section: 'files',
    group: 'files',
    key: 'showHidden',
    label: 'settings.files.showHidden',
    control: { kind: 'switch' },
    keywords: 'скрытые файлы dotfiles'
  },
  {
    id: 'files.excludeGlobs',
    section: 'files',
    group: 'files',
    key: 'excludeGlobs',
    label: 'settings.files.exclude',
    hint: 'settings.files.exclude.hint',
    control: { kind: 'list' },
    keywords: 'исключения node_modules игнор'
  },
  {
    id: 'files.autoRefresh',
    section: 'files',
    group: 'files',
    key: 'autoRefresh',
    label: 'settings.files.autoRefresh',
    control: { kind: 'switch' },
    keywords: 'обновление дерева слежение'
  },
  {
    id: 'files.useTrash',
    section: 'files',
    group: 'files',
    key: 'useTrash',
    label: 'settings.files.useTrash',
    hint: 'settings.files.useTrash.hint',
    control: { kind: 'switch' },
    keywords: 'корзина удаление безвозвратно'
  },
  {
    id: 'files.largeFileKb',
    section: 'files',
    group: 'files',
    key: 'largeFileKb',
    label: 'settings.files.largeFileKb',
    hint: 'settings.files.largeFileKb.hint',
    control: { kind: 'number', min: 64, max: 65536, step: 64, unit: 'kb' },
    keywords: 'большие файлы лимит размера'
  },

  // -------------------------------------------------------------------- servers
  {
    id: 'servers.allowRunCommand',
    section: 'servers',
    group: 'servers',
    key: 'allowRunCommand',
    label: 'settings.servers.allowRunCommand',
    hint: 'settings.servers.allowRunCommand.hint',
    control: { kind: 'switch' },
    keywords: 'команды терминал run_command'
  },
  {
    id: 'servers.terminalShell',
    section: 'servers',
    group: 'servers',
    key: 'terminalShell',
    label: 'settings.servers.terminalShell',
    hint: 'settings.servers.terminalShell.hint',
    control: { kind: 'select', options: options('settings.servers.terminalShell', TERMINAL_SHELLS) },
    keywords: 'терминал оболочка shell powershell cmd windows terminal'
  },
  {
    id: 'servers.protectTerminal',
    section: 'servers',
    group: 'servers',
    key: 'protectTerminal',
    label: 'settings.servers.protectTerminal',
    hint: 'settings.servers.protectTerminal.hint',
    control: { kind: 'switch' },
    keywords: 'защита опасные команды удаление формат диска'
  },
  {
    id: 'servers.commandTimeoutMs',
    section: 'servers',
    group: 'servers',
    key: 'commandTimeoutMs',
    label: 'settings.servers.commandTimeout',
    hint: 'settings.servers.commandTimeout.hint',
    control: { kind: 'number', min: 1000, max: 600000, step: 1000, unit: 'ms' },
    keywords: 'таймаут команд'
  },
  {
    id: 'servers.allowBackground',
    section: 'servers',
    group: 'servers',
    key: 'allowBackground',
    label: 'settings.servers.allowBackground',
    hint: 'settings.servers.allowBackground.hint',
    control: { kind: 'switch' },
    keywords: 'фоновые процессы серверы start_server'
  },
  {
    id: 'servers.maxServers',
    section: 'servers',
    group: 'servers',
    key: 'maxServers',
    label: 'settings.servers.maxServers',
    control: { kind: 'number', min: 1, max: 50, step: 1 },
    keywords: 'лимит серверов процессов'
  },
  {
    id: 'servers.stopOnExit',
    section: 'servers',
    group: 'servers',
    key: 'stopOnExit',
    label: 'settings.servers.stopOnExit',
    control: { kind: 'switch' },
    keywords: 'остановка при выходе закрытии'
  },
  {
    id: 'servers.bindHint',
    section: 'servers',
    group: 'servers',
    key: 'bindHint',
    label: 'settings.servers.bindHint',
    hint: 'settings.servers.bindHint.hint',
    control: { kind: 'switch' },
    keywords: 'localhost ipv6 подсказка порт'
  },
  {
    id: 'servers.verifyServers',
    section: 'servers',
    group: 'servers',
    key: 'verifyServers',
    label: 'settings.servers.verifyServers',
    hint: 'settings.servers.verifyServers.hint',
    control: { kind: 'switch' },
    keywords: 'проверка сервера fetch_url'
  },

  // ------------------------------------------------- applications & MCP servers
  {
    id: 'mcp.servers',
    section: 'mcp',
    label: 'settings.section.mcp',
    hint: 'settings.mcp.hint',
    control: { kind: 'mcpServers' },
    keywords:
      'mcp серверы приложения blender unity godot after effects коннектор инструменты внешние model context protocol'
  },

  // -------------------------------------------------------------- notifications
  {
    id: 'notifications.toastSeconds',
    section: 'notifications',
    group: 'notifications',
    key: 'toastSeconds',
    label: 'settings.notifications.toastSeconds',
    control: { kind: 'number', min: 1, max: 30, step: 1, unit: 's' },
    keywords: 'уведомления время всплывающие'
  },
  {
    id: 'notifications.errorsSticky',
    section: 'notifications',
    group: 'notifications',
    key: 'errorsSticky',
    label: 'settings.notifications.errorsSticky',
    control: { kind: 'switch' },
    keywords: 'ошибки не скрывать'
  },
  {
    id: 'notifications.logLevel',
    section: 'notifications',
    group: 'notifications',
    key: 'logLevel',
    label: 'settings.notifications.logLevel',
    hint: 'settings.notifications.logLevel.hint',
    control: { kind: 'select', options: options('settings.notifications.logLevel', ['error', 'warn', 'info', 'debug']) },
    keywords: 'лог уровень relaxcode.log'
  },
  {
    id: 'notifications.logRequests',
    section: 'notifications',
    group: 'notifications',
    key: 'logRequests',
    label: 'settings.notifications.logRequests',
    hint: 'settings.notifications.logRequests.hint',
    control: { kind: 'switch' },
    keywords: 'логировать запросы к модели'
  },
  {
    id: 'notifications.openDevTools',
    section: 'notifications',
    group: 'notifications',
    key: 'openDevTools',
    label: 'settings.notifications.openDevTools',
    hint: 'settings.notifications.openDevTools.hint',
    control: { kind: 'switch' },
    keywords: 'devtools отладка'
  },

  // -------------------------------------------------------------------- keymap
  {
    id: 'keymap.bindings',
    section: 'keymap',
    label: 'settings.keymap.title',
    hint: 'settings.keymap.hint',
    control: { kind: 'keymap' },
    keywords: 'горячие клавиши сокращения'
  },

  // ------------------------------------------------------------------ advanced
  {
    id: 'advanced.requestTimeoutMs',
    section: 'advanced',
    group: 'advanced',
    key: 'requestTimeoutMs',
    label: 'settings.advanced.requestTimeout',
    hint: 'settings.advanced.requestTimeout.hint',
    control: { kind: 'number', min: 5000, max: 3600000, step: 5000, unit: 'ms' },
    keywords: 'таймаут запроса к модели'
  },
  {
    id: 'advanced.extraHeaders',
    section: 'advanced',
    group: 'advanced',
    key: 'extraHeaders',
    label: 'settings.advanced.extraHeaders',
    hint: 'settings.advanced.extraHeaders.hint',
    control: { kind: 'textarea', rows: 3 },
    keywords: 'http заголовки headers openrouter'
  },
  {
    id: 'advanced.extraBody',
    section: 'advanced',
    group: 'advanced',
    key: 'extraBody',
    label: 'settings.advanced.extraBody',
    hint: 'settings.advanced.extraBody.hint',
    control: { kind: 'textarea', rows: 3 },
    keywords: 'тело запроса параметры json'
  },
  {
    id: 'advanced.proxyUrl',
    section: 'advanced',
    group: 'advanced',
    key: 'proxyUrl',
    label: 'settings.advanced.proxy',
    hint: 'settings.advanced.proxy.hint',
    control: { kind: 'text', placeholder: 'http://127.0.0.1:8080' },
    keywords: 'прокси proxy сеть'
  },
  {
    id: 'advanced.export',
    section: 'advanced',
    label: 'settings.advanced.export',
    hint: 'settings.advanced.export.hint',
    control: { kind: 'action', action: 'export' },
    keywords: 'экспорт сохранить файл'
  },
  {
    id: 'advanced.import',
    section: 'advanced',
    label: 'settings.advanced.import',
    hint: 'settings.advanced.import.hint',
    control: { kind: 'action', action: 'import' },
    keywords: 'импорт загрузить файл'
  },
  {
    id: 'advanced.reveal',
    section: 'advanced',
    label: 'settings.advanced.reveal',
    hint: 'settings.advanced.reveal.hint',
    control: { kind: 'action', action: 'reveal' },
    keywords: 'файл настроек открыть папку'
  },
  {
    id: 'advanced.reset',
    section: 'advanced',
    label: 'settings.advanced.reset',
    hint: 'settings.advanced.reset.hint',
    control: { kind: 'action', action: 'reset' },
    keywords: 'сброс настройки по умолчанию'
  }
]

/** Tool ↔ settings helpers (the tools section renders its own matrix). */
export const RISK_ORDER = ['read', 'write', 'exec', 'delete'] as const
