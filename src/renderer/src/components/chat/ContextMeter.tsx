import type { JSX } from 'react'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** 1234 → "1 234"; 256000 → "256 000". Grouping comes from the system locale. */
function grouped(value: number): string {
  return Math.round(value).toLocaleString()
}

const RING = 20
const STROKE = 2.5
const RADIUS = (RING - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * How full the model's context window is, as a ring you can read at a glance.
 *
 * The number is not guessed: the provider reports the size of the request and of
 * the answer, and the seat this shows is the last request's prompt plus its
 * completion — that is what the conversation weighs right now. The window size
 * comes from the provider's model list; when the provider does not publish one,
 * the ring says so instead of inventing a limit.
 */
export function ContextMeter({
  used,
  limit,
  saved,
  streaming
}: {
  used: number
  /** The model's context window, when the provider reports it. */
  limit?: number | null
  /** What the last request left out thanks to token saving. */
  saved?: { messages: number; chars: number } | null
  /** A request is in flight: the numbers below will move when it lands. */
  streaming?: boolean
}): JSX.Element {
  const t = useT()
  const known = typeof limit === 'number' && limit > 0
  const ratio = known ? Math.min(1, Math.max(0, used / (limit as number))) : 0
  const percent = Math.round(ratio * 100)
  const left = known ? Math.max(0, (limit as number) - used) : null
  const full = known && used >= (limit as number)
  const near = known && !full && ratio >= 0.8

  const label = known
    ? t('chat.context.label', { used: grouped(used), limit: grouped(limit as number) })
    : t('chat.context.labelNoLimit', { used: grouped(used) })

  // Characters are what we can count exactly; tokens are the provider's unit.
  // A third of a token per character is the usual mix of code and prose, so the
  // figure is shown with "≈" and never presented as a measurement.
  const savedTokens =
    saved && saved.chars > 0 ? Math.max(1, Math.round(saved.chars / 3)) : 0

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="context-meter"
          data-used={Math.round(used)}
          data-limit={known ? Math.round(limit as number) : ''}
          data-percent={known ? percent : ''}
          data-saved-messages={saved?.messages ?? 0}
          data-saved-chars={saved?.chars ?? 0}
          role="img"
          tabIndex={0}
          aria-label={label}
          className={cn(
            'mr-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md',
            'focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
            streaming && 'animate-pulse'
          )}
        >
          <svg viewBox={`0 0 ${RING} ${RING}`} className="size-5 -rotate-90" aria-hidden>
            <circle
              cx={RING / 2}
              cy={RING / 2}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              className="stroke-current text-foreground/15"
              // With no window size there is nothing to fill, so the ring is
              // drawn as a dashed circle: "usage known, limit unknown".
              strokeDasharray={known ? undefined : '1.5 2.5'}
            />
            {known && (
              <circle
                cx={RING / 2}
                cy={RING / 2}
                r={RADIUS}
                fill="none"
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
                className={cn(
                  'stroke-current transition-[stroke-dashoffset,stroke] duration-500 ease-out',
                  full ? 'text-destructive' : near ? 'text-amber-500' : 'text-primary'
                )}
              />
            )}
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="max-w-[260px] leading-relaxed">
        <p className="font-medium">{t('chat.context.title')}</p>
        <p className="tabular-nums">
          {known
            ? t('chat.context.used', {
                used: grouped(used),
                limit: grouped(limit as number)
              })
            : t('chat.context.usedOnly', { used: grouped(used) })}
        </p>
        {known && left !== null && (
          <p className="tabular-nums text-tertiary">
            {t('chat.context.left', {
              left: grouped(left),
              percent: 100 - percent
            })}
          </p>
        )}
        {full && <p className="text-destructive">{t('chat.context.over')}</p>}
        {!known && <p className="text-tertiary">{t('chat.context.noLimit')}</p>}
        {saved && saved.messages > 0 && (
          <p className="tabular-nums text-primary/90">
            {t('chat.context.saved', {
              messages: saved.messages,
              tokens: grouped(savedTokens)
            })}
          </p>
        )}
        <p className="text-tertiary">{t('chat.context.source')}</p>
      </TooltipContent>
    </Tooltip>
  )
}
