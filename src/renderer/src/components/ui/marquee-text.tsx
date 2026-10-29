import { useLayoutEffect, useRef, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Space between the two copies of the text, in pixels. */
const GAP = 24
/** Slow and steady, as a ticker should be. */
const SPEED = 26

interface MarqueeTextProps {
  children: ReactNode
  className?: string
}

/**
 * A single line that only starts moving when it does not fit. The track holds
 * two copies and slides by exactly one copy, so the loop has no visible seam.
 */
export function MarqueeText({ children, className }: MarqueeTextProps): JSX.Element {
  const boxRef = useRef<HTMLSpanElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const [duration, setDuration] = useState(0)

  useLayoutEffect(() => {
    const box = boxRef.current
    const measure = measureRef.current
    if (!box || !measure) return
    const update = (): void => {
      const width = measure.offsetWidth
      setDuration(width > box.clientWidth + 1 ? Math.max(6, (width + GAP) / SPEED) : 0)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(box)
    return () => observer.disconnect()
  }, [children])

  return (
    <span
      ref={boxRef}
      className={cn('relative block min-w-0 overflow-hidden whitespace-nowrap', className)}
    >
      {duration > 0 ? (
        <span
          className="model-marquee inline-flex w-max align-top"
          style={{ '--marquee-duration': `${duration.toFixed(2)}s` } as CSSProperties}
        >
          <span className="pr-6">{children}</span>
          <span aria-hidden className="pr-6">
            {children}
          </span>
        </span>
      ) : (
        <span className="block truncate">{children}</span>
      )}
      <span
        ref={measureRef}
        aria-hidden
        className="pointer-events-none invisible absolute left-0 top-0 whitespace-nowrap"
      >
        {children}
      </span>
    </span>
  )
}
