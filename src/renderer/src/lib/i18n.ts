import { create } from 'zustand'
import { dictionaries, type Locale, type TKey } from '@shared/i18n'

function detectLocale(): Locale {
  const stored = localStorage.getItem('relaxcode.locale') ?? localStorage.getItem('easycode.locale')
  if (stored === 'ru' || stored === 'en') return stored
  return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

/** Assistive technology and `:lang()` rules read the document language. */
function applyDocumentLang(locale: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale
}

interface I18nState {
  locale: Locale
  setLocale: (locale: Locale) => void
}

export const useI18nStore = create<I18nState>((set) => ({
  locale: detectLocale(),
  setLocale: (locale) => {
    localStorage.setItem('relaxcode.locale', locale)
    applyDocumentLang(locale)
    set({ locale })
  }
}))

applyDocumentLang(useI18nStore.getState().locale)

export type TParams = Record<string, string | number>

export function translate(locale: Locale, key: TKey, params?: TParams): string {
  const template = dictionaries[locale][key] ?? dictionaries.ru[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] !== undefined ? String(params[name]) : match
  )
}

export function useT(): (key: TKey, params?: TParams) => string {
  const locale = useI18nStore((s) => s.locale)
  return (key, params) => translate(locale, key, params)
}

/** Provider error bodies are long JSON blobs; keep the beginning and stay one line. */
const HTTP_DETAIL_LIMIT = 400

function httpHintKey(status: number): TKey {
  if (status === 401 || status === 402 || status === 403 || status === 404 || status === 429) {
    return `error.http.${status}` as TKey
  }
  if (status >= 500) return 'error.http.server' as TKey
  return 'error.http.other' as TKey
}

/**
 * Main-process errors arrive as stable codes (`rate-limited`) or raw provider text.
 * Known codes become readable text, everything else is shown verbatim. Network
 * failures come as `net:<kind>:<detail>` so the sentence is localised while the
 * technical cause stays visible.
 */
function translateErrorMessage(locale: Locale, message: string): string {
  if (message.startsWith('net:')) {
    const [kind, ...rest] = message.slice(4).split(':')
    const key = `error.net.${kind}`
    if (key in dictionaries[locale]) {
      const detail = rest.join(':').trim()
      const text = translate(locale, key as TKey)
      return detail ? `${text} (${detail})` : text
    }
  }
  // `HTTP 402: <provider body>`: say in one sentence what it means, then show
  // the provider's own words (they carry the real numbers, e.g. the balance).
  const http = /^HTTP (\d{3}):?\s*([\s\S]*)$/.exec(message)
  if (http) {
    const status = Number(http[1])
    const detail = http[2]
      .trim()
      // The provider often repeats the status ("402 \"Insufficient balance\"").
      .replace(/^\d{3}\b[\s:]*/, '')
      .replace(/\s+/g, ' ')
      .slice(0, HTTP_DETAIL_LIMIT)
    const hint = translate(locale, httpHintKey(status))
    return detail ? `${hint} — ${detail}` : hint
  }
  const key = `error.${message}`
  return key in dictionaries[locale] ? translate(locale, key as TKey) : message
}

export function useTranslateError(): (message: string) => string {
  const locale = useI18nStore((s) => s.locale)
  return (message) => translateErrorMessage(locale, message)
}

/** Codes returned by `settings:set` / the settings import. */
const SETTINGS_ERROR_KEYS: Record<string, TKey> = {
  'invalid-base-url': 'settings.error.baseUrl',
  'invalid-json': 'settings.error.invalidJson',
  'invalid-json-body': 'settings.error.jsonBody',
  'invalid-json-headers': 'settings.error.jsonHeaders',
  'encryption-unavailable': 'settings.error.encryption',
  'last-provider': 'settings.error.lastProvider',
  'unknown-provider': 'settings.error.unknownProvider'
}

/** Same as `useTranslateError`, plus the codes that only settings can return. */
export function useTranslateSettingsError(): (message: string) => string {
  const locale = useI18nStore((s) => s.locale)
  return (message) => {
    const key = SETTINGS_ERROR_KEYS[message]
    return key ? translate(locale, key) : translateErrorMessage(locale, message)
  }
}
