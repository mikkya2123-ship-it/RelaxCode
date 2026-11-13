import { useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import { Loader2 } from 'lucide-react'
import type { ModelInfo } from '@shared/ipc'
import { useT, useTranslateError } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ProviderLogo } from '@/components/ui/provider-logo'
import { ModelIcon } from '@/components/ui/model-icon'
import { MarqueeText } from '@/components/ui/marquee-text'
import { DropdownMenuItem, DropdownMenuLabel } from '@/components/ui/dropdown-menu'

/** Rows kept mounted around the visible part of the list. */
const WINDOW_ROWS = 40
const OVERSCAN_ROWS = 8
/** Used until the first row is measured; the real height wins afterwards. */
const FALLBACK_ROW = 32

interface ModelListProps {
  models: ModelInfo[]
  current: string | null
  onPick: (id: string) => void
  state: 'idle' | 'loading' | 'ok' | 'error'
  error: string | null
  /** The provider the models belong to, for the logo beside the caption. */
  providerId?: string
}

/**
 * The model sheet. Endpoints can describe thousands of models, so only the
 * rows around the visible part of the capped list are mounted — scrolling
 * stays smooth no matter how many models the provider reports. Short lists
 * render whole, exactly as before.
 */
export function ModelList({
  models,
  current,
  onPick,
  state,
  error,
  providerId
}: ModelListProps): JSX.Element {
  const t = useT()
  const translateError = useTranslateError()
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [rowHeight, setRowHeight] = useState(FALLBACK_ROW)

  // The sheet opens at the model in use, not at the first row.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const index = models.findIndex((entry) => entry.id === current)
    if (index > 3) list.scrollTop = index * rowHeight
  }, [models, current, rowHeight])

  // Rows are styled in one place, but their height still depends on the font:
  // measure it once instead of hard-coding a height that drifts.
  useLayoutEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>('[data-model-row]')
    const height = row?.getBoundingClientRect().height
    if (height && Math.abs(height - rowHeight) > 0.5) setRowHeight(height)
  }, [rowHeight, models])

  const windowed = models.length > WINDOW_ROWS
  const range = useMemo(() => {
    if (!windowed) return { start: 0, end: models.length }
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS)
    return { start: first, end: Math.min(models.length, first + WINDOW_ROWS) }
  }, [windowed, scrollTop, rowHeight, models.length])

  const rows = windowed ? models.slice(range.start, range.end) : models

  return (
    <div
      ref={listRef}
      onScroll={(event) => {
        if (windowed) setScrollTop(event.currentTarget.scrollTop)
      }}
      className="max-h-[240px] overflow-y-auto overscroll-contain p-1"
    >
      <DropdownMenuLabel className="flex items-center gap-1.5 px-2 text-[11px] font-normal text-tertiary">
        {providerId && <ProviderLogo id={providerId} className="size-3.5" />}
        {t('chat.model.choose')}
      </DropdownMenuLabel>
      {state === 'loading' && (
        <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-tertiary">
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
          {t('chat.models.loading')}
        </div>
      )}
      {state !== 'loading' && models.length === 0 && (
        <div className="px-2 py-1.5 text-[11px] text-tertiary">
          <span className="block">{t('chat.models.empty')}</span>
          {state === 'error' && error && (
            <span className="mt-0.5 block break-all text-destructive">{translateError(error)}</span>
          )}
        </div>
      )}
      {windowed && range.start > 0 && (
        <div aria-hidden style={{ height: range.start * rowHeight }} />
      )}
      {rows.map((entry) => (
        <DropdownMenuItem
          key={entry.id}
          data-model-row
          data-current={entry.id === current ? 'true' : undefined}
          onSelect={() => onPick(entry.id)}
          className={cn(
            'cv-auto gap-1.5 px-2 py-1.5 text-[12px]',
            entry.id === current && 'bg-accent text-foreground'
          )}
          title={entry.tools ? t('chat.model.tools', { id: entry.id }) : entry.id}
        >
          <ModelIcon id={entry.id} />
          <MarqueeText className="min-w-0 flex-1">{entry.id}</MarqueeText>
          {entry.free && (
            <Badge variant="success" className="shrink-0">
              {t('chat.model.free')}
            </Badge>
          )}
        </DropdownMenuItem>
      ))}
      {windowed && range.end < models.length && (
        <div aria-hidden style={{ height: (models.length - range.end) * rowHeight }} />
      )}
    </div>
  )
}
