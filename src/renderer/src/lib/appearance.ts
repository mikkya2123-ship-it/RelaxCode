import type { PublicSettings } from '@shared/ipc'
import type { AccentName, ThemeMode } from '@shared/settings'
import { useI18nStore } from '@/lib/i18n'

/**
 * The look of the IDE is a handful of CSS variables plus a `dark` class. Every
 * component already uses semantic colours, so one function can restyle the
 * whole app without touching a single component.
 */

const ACCENT_COLORS: Record<Exclude<AccentName, 'default'>, { light: string; ring: string; dark: string }> = {
  blue: { light: '#2f6fdb', ring: '#9dbdf0', dark: '#6ea8ff' },
  violet: { light: '#7c5cd6', ring: '#c3b3ee', dark: '#a98cff' },
  green: { light: '#2f8f5b', ring: '#a4d6bc', dark: '#63c894' },
  orange: { light: '#c96a1f', ring: '#eec49b', dark: '#f0a35c' },
  rose: { light: '#cf3f6c', ring: '#f0aac0', dark: '#ff7fa6' }
}

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(theme: ThemeMode): 'light' | 'dark' {
  if (theme === 'system') return prefersDark() ? 'dark' : 'light'
  return theme
}

export function applyAppearance(settings: PublicSettings): 'light' | 'dark' {
  const root = document.documentElement
  const theme = resolveTheme(settings.ui.theme)
  const dark = theme === 'dark'

  root.classList.toggle('dark', dark)
  root.classList.toggle('no-animations', !settings.ui.animations)
  root.classList.toggle('density-compact', settings.ui.density === 'compact')
  root.style.fontSize = `${Math.round(settings.ui.scale * 100)}%`

  const accent = settings.ui.accent
  if (accent === 'default') {
    root.style.removeProperty('--primary')
    root.style.removeProperty('--ring')
  } else {
    const colors = ACCENT_COLORS[accent]
    root.style.setProperty('--primary', dark ? colors.dark : colors.light)
    root.style.setProperty('--ring', dark ? colors.dark : colors.ring)
  }

  // The language lives in its own store (it is needed before settings load),
  // but the settings screen owns it and a patch has to reach it immediately.
  const target =
    settings.ui.language === 'system'
      ? navigator.language.toLowerCase().startsWith('ru')
        ? 'ru'
        : 'en'
      : settings.ui.language
  if (target !== useI18nStore.getState().locale) useI18nStore.getState().setLocale(target)

  return theme
}

/** Keeps `system` theme and language reacting to the OS while the app runs. */
export function watchSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
