import type { JSX } from 'react'
import { useEditorStore } from '@/stores/editor'
import { useSettingsStore } from '@/stores/settings'
import { useT } from '@/lib/i18n'

export function StatusBar(): JSX.Element | null {
  const active = useEditorStore((s) => s.files.find((f) => f.path === s.activePath))
  const model = useSettingsStore((s) => s.settings?.model ?? null)
  const visible = useSettingsStore((s) => s.settings?.ui.statusBar ?? true)
  const t = useT()

  if (!visible) return null

  return (
    <footer className="flex h-7 shrink-0 select-none items-center justify-between bg-background px-3 text-[11px] text-muted-foreground">
      <span>{t('status.version')}</span>
      <span className="flex items-center gap-3">
        {active && (
          <span className="max-w-[280px] truncate">
            {active.name}
            {active.content !== active.savedContent ? ' ●' : ''}
          </span>
        )}
        <span>{model ?? t('chat.modelNotSelected')}</span>
      </span>
    </footer>
  )
}
