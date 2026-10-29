import {
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type PointerEvent
} from 'react'
import { THINKING_LEVELS, type ThinkingLevel } from '@shared/reasoning'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/** Where a level sits on the rail: 0 at the cold end, 1 at the hot one. */
function positionOf(level: ThinkingLevel): number {
  const index = THINKING_LEVELS.indexOf(level)
  return index <= 0 ? 0 : index / (THINKING_LEVELS.length - 1)
}

/**
 * The thinking level as a slider instead of a list: a rail that warms up from
 * deep blue through magenta to hot orange, a glassy handle, four snap points and
 * a readout that follows the handle.
 *
 * The wait shown next to the level is an estimate — the model and the task
 * decide it — so it carries a "≈".
 *
 * Levels the model does not accept stay visible on the rail but cannot be
 * reached, so the picture never promises a level the request would drop.
 */
export function ThinkingSlider({
  level,
  onChange,
  blocked = [],
  live = false
}: {
  level: ThinkingLevel
  onChange: (level: ThinkingLevel) => void
  /** Levels the endpoint says this model will not take. */
  blocked?: ThinkingLevel[]
  /** A request is streaming in this chat right now. */
  live?: boolean
}): JSX.Element {
  const t = useT()
  const railRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  /**
   * While a finger or the mouse holds the handle it sits exactly where the
   * pointer is — no jumping from stop to stop — and the level under it changes
   * live. Letting go slides it onto the nearest stop.
   */
  const [heldAt, setHeldAt] = useState<number | null>(null)
  const fraction = heldAt ?? positionOf(level)
  const current = THINKING_LEVELS.indexOf(level)
  const lastIndex = THINKING_LEVELS.length - 1
  const name = t(`chat.thinking.${level}` as 'chat.thinking.off')

  /** The stop nearest to an index that the model actually accepts. */
  const allowedFor = (index: number, direction: number): number => {
    let best = -1
    let bestDistance = Number.POSITIVE_INFINITY
    for (let i = 0; i < THINKING_LEVELS.length; i += 1) {
      if (blocked.includes(THINKING_LEVELS[i])) continue
      const distance = Math.abs(i - index)
      // On a tie the pointer's direction wins, so the handle can step over a
      // blocked stop instead of sticking to it.
      if (distance < bestDistance || (distance === bestDistance && direction > 0)) {
        best = i
        bestDistance = distance
      }
    }
    return best
  }

  const moveTo = (index: number): void => {
    const target = allowedFor(index, index - current)
    if (target === -1) return
    const value = THINKING_LEVELS[target]
    if (value !== level) onChange(value)
  }

  /** Where the pointer is along the rail, 0…1 — the handle follows it exactly. */
  const fractionAt = (clientX: number): number => {
    const rail = railRef.current
    if (!rail) return fraction
    const rect = rail.getBoundingClientRect()
    if (rect.width <= 0) return fraction
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  /** Which stop the pointer is closest to, measured on the rail itself. */
  const indexAt = (clientX: number): number =>
    Math.round(fractionAt(clientX) * lastIndex)

  const handleDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    setDragging(true)
    setHeldAt(fractionAt(event.clientX))
    moveTo(indexAt(event.clientX))
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // A synthetic pointer (tests, some input devices) has nothing to capture;
      // the drag still follows the pointermove events.
    }
  }

  const handleMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    setHeldAt(fractionAt(event.clientX))
    moveTo(indexAt(event.clientX))
  }

  const handleUp = (event: PointerEvent<HTMLDivElement>): void => {
    setDragging(false)
    // Let go: the handle slides from wherever the pointer was onto the stop.
    setHeldAt(null)
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // Nothing was captured — nothing to release.
    }
  }

  const handleKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -1
          : 0
    if (step !== 0) {
      event.preventDefault()
      moveTo(current + step)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      moveTo(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      moveTo(lastIndex)
    }
  }

  return (
    <div className="px-3 pb-2.5 pt-1.5">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span data-testid="thinking-level" className="text-[12px] font-medium text-foreground">
          {name}
        </span>
        <span
          data-testid="thinking-eta"
          className={cn('text-[11px] tabular-nums', live ? 'text-primary' : 'text-tertiary')}
        >
          {live
            ? t('chat.reasoning.thinking')
            : t(`chat.thinking.eta.${level}` as 'chat.thinking.eta.off')}
        </span>
      </div>

      <div
        className="think-slider relative h-7 select-none"
        style={{ '--think-at': String(fraction) } as CSSProperties}
      >
        <div
          ref={railRef}
          role="slider"
          tabIndex={0}
          data-testid="thinking-slider"
          data-level={level}
          data-live={live ? 'true' : undefined}
          aria-label={t('chat.thinking.slider')}
          aria-valuemin={0}
          aria-valuemax={lastIndex}
          aria-valuenow={current}
          aria-valuetext={name}
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleUp}
          onKeyDown={handleKey}
          className="absolute inset-x-2 top-1/2 h-2.5 -translate-y-1/2 cursor-grab touch-none rounded-full bg-foreground/[0.09] focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none active:cursor-grabbing"
        >
          {/* The whole scale, asleep; then the same scale lit up to the handle. */}
          <span
            aria-hidden
            className="think-rail-gradient pointer-events-none absolute inset-0 overflow-hidden rounded-full opacity-25"
          />
          <span
            aria-hidden
            data-testid="thinking-fill"
            className={cn(
              'think-rail-gradient pointer-events-none absolute inset-0 overflow-hidden rounded-full',
              live && 'think-live'
            )}
            style={{ clipPath: `inset(0 ${(1 - fraction) * 100}% 0 0)` }}
          />
          {THINKING_LEVELS.map((value, index) => (
            <span
              key={value}
              aria-hidden
              style={{ left: `${(index / lastIndex) * 100}%` }}
              className={cn(
                'pointer-events-none absolute top-1/2 size-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-100',
                index <= Math.round(fraction * lastIndex) ? 'bg-white/80' : 'bg-foreground/30'
              )}
            />
          ))}
        </div>
        <span
          aria-hidden
          data-dragging={dragging ? 'true' : undefined}
          className="think-thumb pointer-events-none absolute top-1/2 size-4 rounded-full"
        />
      </div>

      <div className="mt-1.5 flex items-center justify-between">
        {THINKING_LEVELS.map((value) => {
          const isCurrent = value === level
          return (
            <button
              key={value}
              type="button"
              data-testid="thinking-stop"
              data-level={value}
              data-current={isCurrent ? 'true' : undefined}
              disabled={blocked.includes(value)}
              aria-pressed={isCurrent}
              aria-label={t('chat.thinking.stop', {
                level: t(`chat.thinking.${value}` as 'chat.thinking.off')
              })}
              title={t(`chat.thinking.${value}.hint` as 'chat.thinking.off.hint')}
              onClick={() => onChange(value)}
              className={cn(
                'rounded px-0.5 py-0.5 text-[10px] transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-35',
                isCurrent ? 'font-medium text-foreground' : 'text-tertiary hover:text-foreground'
              )}
            >
              {t(`chat.thinking.${value}` as 'chat.thinking.off')}
            </button>
          )
        })}
      </div>
    </div>
  )
}
