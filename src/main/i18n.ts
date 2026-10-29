import { app } from 'electron'
import { dictionaries, type Locale, type TKey } from '@shared/i18n'
import type { DangerousCommand } from '@shared/terminal'
import { getSettings } from './store'

/**
 * The main process shows a handful of strings itself — native dialog titles and
 * the approval preview used by the chat. They follow the same `ui.language`
 * setting as the renderer, with the OS locale standing in for `system`.
 */
export function currentLocale(): Locale {
  const language = getSettings().ui.language
  if (language === 'ru' || language === 'en') return language
  try {
    return app.getLocale().toLowerCase().startsWith('ru') ? 'ru' : 'en'
  } catch {
    // Before `ready` there is no OS locale; English is the neutral fallback.
    return 'en'
  }
}

export type TParams = Record<string, string | number>

export function t(key: TKey, params?: TParams): string {
  const locale = currentLocale()
  const template = dictionaries[locale][key] ?? dictionaries.en[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] !== undefined ? String(params[name]) : match
  )
}

/** The localized sentence for a destructive command, for the approval bar. */
export function dangerReason(danger: DangerousCommand): string {
  if (!danger.code) return danger.reason
  return t(`chat.approval.danger.${danger.code}` as TKey)
}
