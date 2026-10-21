import { useEffect, useState, type JSX } from 'react'
import { Brain, ChevronRight } from 'lucide-react'
import type { ReasoningPart } from '@/stores/chat'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/** Seconds since a moment, ticking while the model is still thinking. */
function useElapsed(since: number, live: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [live, since])
  return Math.max(0, Math.round((now - since) / 1000))
}

/**
 * The model's own thinking, one block per step: it opens while the model is
 * working and folds away as soon as the answer starts, so the reply stays the
 * first thing the eye lands on. Clicking it keeps it open (or closed) for good.
 */
export function ReasoningCard({
  part,
  live,
  defaultOpen
}: {
  part: ReasoningPart
  /** Thoughts are still arriving into this block. */
  live: boolean
  defaultOpen: boolean
}): JSX.Element {
  const t = useT()
  const [manual, setManual] = useState<boolean | null>(null)
  const open = manual ?? (live || defaultOpen)
  const seconds = useElapsed(part.startedAt, live)
  const duration = live ? Math.max(seconds, 0) : Math.max(0, Math.round((part.endedAt - part.startedAt) / 1000))

  return (
    <div
      data-testid="chat-reasoning"
      data-live={live ? 'true' : undefined}
      className="overflow-hidden rounded-lg border border-border/70 bg-foreground/[0.02]"
    >
      <button
        type="button"
        onClick={() => setManual(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors duration-100 hover:bg-foreground/[0.03]"
      >
        <Brain
          className={cn('size-3.5 shrink-0', live ? 'text-primary' : 'text-tertiary')}
        />
        <span className="shrink-0 text-[12px] font-medium text-foreground/80">
          {live ? t('chat.reasoning.thinking') : t('chat.reasoning.title')}
        </span>
        {duration >= 1 && (
          <span className="shrink-0 text-[11px] tabular-nums text-tertiary">
            {t('chat.reasoning.for', { s: duration })}
          </span>
        )}
        <span className="min-w-0 flex-1" />
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-tertiary transition-transform duration-150',
            open && 'rotate-90'
          )}
        />
      </button>
      {open && (
        <div className="max-h-60 overflow-y-auto overscroll-contain border-t border-border/70 px-2.5 py-2">
          <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-muted-foreground">
            {part.text}
            {live && <span className="ml-0.5 animate-pulse text-primary">▍</span>}
          </p>
        </div>
      )}
    </div>
  )
}
