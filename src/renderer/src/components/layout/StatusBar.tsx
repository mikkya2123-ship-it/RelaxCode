import type { JSX } from 'react'
import { TerminalSquare } from 'lucide-react'
import { useEditorStore } from '@/stores/editor'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export function StatusBar(): JSX.Element | null {
  const active = useEditorStore((s) => s.files.find((f) => f.path === s.activePath))
  const model = useSettingsStore((s) => s.settings?.model ?? null)
  const visible = useSettingsStore((s) => s.settings?.ui.statusBar ?? true)
  const terminalOpen = useUiStore((s) => s.terminalOpen)
  const toggleTerminal = useUiStore((s) => s.toggleTerminal)
  const t = useT()

  if (!visible) return null

  return (
    <footer className="flex h-7 shrink-0 select-none items-center justify-between bg-background px-3 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-3">
        <button
          type="button"
          data-testid="status-terminal"
          title={t('status.terminal')}
          aria-label={t('status.terminal')}
          aria-pressed={terminalOpen}
          onClick={toggleTerminal}
          className={cn(
            'flex items-center gap-1 rounded px-1 py-0.5 transition-colors duration-100 hover:text-foreground',
            terminalOpen && 'bg-foreground/[0.06] text-foreground'
          )}
        >
          <TerminalSquare className="size-3.5" />
        </button>
        <span>{t('status.version')}</span>
      </span>
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
