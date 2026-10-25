import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { Check, Copy, Download, Maximize2, Move, RotateCcw, Ruler } from 'lucide-react'
import type { FigureMeta } from '@shared/tool-meta'
import {
  figurePoints,
  moveFigurePoint,
  renderFigureSvg,
  snapValue,
  type FigurePoint,
  type FigureSpec
} from '@shared/figures'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

function fileSlug(title: string | undefined): string {
  const base = (title ?? 'figure')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return base.length > 0 ? base : 'figure'
}

interface DragState {
  /** The spec as it was when the grab started: every move re-derives from it. */
  base: FigureSpec
  origin: FigurePoint
  /** Offset between the grabbed point and the pointer, so nothing jumps. */
  grab: FigurePoint
  pointerId: number
  /** Last position already rendered, so throttled moves are not lost. */
  applied: FigurePoint
  latest: FigurePoint
  lastAt: number
}

/**
 * A drawing built by `draw_figure`. The geometry travels with the card, so the
 * points stay draggable: moving one redraws the SVG, recomputes measured angles
 * and lengths and rescales the graph. The edits live in this card; the stored
 * answer keeps the original figure and “Reset” returns to it.
 */
export function FigureCard({ meta }: { meta: FigureMeta }): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [spec, setSpec] = useState<FigureSpec | null>(meta.spec ?? null)
  const [moved, setMoved] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)

  const grid = meta.style?.grid ?? true
  const theme = meta.style?.theme ?? 'paper'
  const results = meta.style?.results ?? true

  const rendered = useMemo(
    () => (spec ? renderFigureSvg(spec, { grid, theme, results, live: moved }) : null),
    [spec, grid, theme, results, moved]
  )
  const projection = rendered?.projection ?? null
  const svg = rendered?.svg ?? meta.svg

  const handles = useMemo(() => {
    if (!spec || !projection) return []
    return figurePoints(spec).map((point) => {
      const [x, y] = projection.toPixel(point)
      return { point, x, y }
    })
  }, [spec, projection])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  // Pointer capture lives on a handle that may be removed when the dragged
  // point merges with another one; a window listener makes sure the drag always
  // ends instead of leaving the card stuck in grabbing mode.
  useEffect(() => {
    if (!dragging) return
    const stop = (): void => endDrag()
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [dragging])

  /** Pointer position inside the SVG, converted back into maths coordinates. */
  const pointerToMath = (event: ReactPointerEvent): FigurePoint | null => {
    const svgElement = boxRef.current?.querySelector('svg')
    if (!svgElement || !projection) return null
    const rect = svgElement.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const x = ((event.clientX - rect.left) / rect.width) * projection.width
    const y = ((event.clientY - rect.top) / rect.height) * projection.height
    return projection.toMath(x, y)
  }

  const startDrag = (
    event: ReactPointerEvent<HTMLSpanElement>,
    point: FigurePoint,
    index: number
  ): void => {
    if (!spec) return
    const math = pointerToMath(event)
    if (!math) return
    event.preventDefault()
    event.stopPropagation()
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // Some input devices do not allow capture; dragging still works through
      // the wrapper's move/up handlers.
    }
    dragRef.current = {
      base: spec,
      origin: point,
      grab: [point[0] - math[0], point[1] - math[1]],
      pointerId: event.pointerId,
      applied: point,
      latest: point,
      lastAt: 0
    }
    setDragging(true)
    setDragIndex(index)
    setHovered(null)
  }

  const moveDrag = (event: ReactPointerEvent): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const math = pointerToMath(event)
    if (!math) return
    let target: FigurePoint = [math[0] + drag.grab[0], math[1] + drag.grab[1]]
    if (event.shiftKey) target = [snapValue(target[0], 0.5), snapValue(target[1], 0.5)]
    drag.latest = target
    // One redraw per frame at most: a pointermove storm must not re-render the
    // card 120 times a second. Every redraw is derived from the spec at grab
    // time, so nothing accumulates and nothing can race. A time check instead
    // of requestAnimationFrame keeps dragging alive while the window is
    // occluded, where frames stop being produced.
    const now = performance.now()
    if (now - drag.lastAt < 16) return
    drag.lastAt = now
    drag.applied = target
    setSpec(moveFigurePoint(drag.base, drag.origin, target))
    setMoved(true)
  }

  const endDrag = (): void => {
    const drag = dragRef.current
    if (drag) {
      // Apply a final move that the throttle skipped, so the point lands where
      // the pointer was released.
      const missed =
        Math.abs(drag.applied[0] - drag.latest[0]) > 1e-6 ||
        Math.abs(drag.applied[1] - drag.latest[1]) > 1e-6
      if (missed) {
        setSpec(moveFigurePoint(drag.base, drag.origin, drag.latest))
        setMoved(true)
      }
    }
    dragRef.current = null
    setDragging(false)
    setDragIndex(null)
  }

  const reset = (): void => {
    setSpec(meta.spec ?? null)
    setMoved(false)
  }

  const download = (): void => {
    try {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${fileSlug(meta.title)}.svg`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch {
      // A blocked download is not worth an error banner; the picture is on screen.
    }
  }

  const copy = (): void => {
    void navigator.clipboard
      .writeText(svg)
      .then(() => setCopied(true))
      .catch(() => setCopied(false))
  }

  const action =
    'flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-tertiary transition-colors hover:bg-foreground/[0.06] hover:text-foreground'

  return (
    <figure
      className="overflow-hidden rounded-xl border border-border bg-panel/70"
      data-testid="figure-card"
    >
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Ruler className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-foreground/85">
          {meta.title || t('chat.figure.title')}
        </span>
        <button type="button" onClick={copy} title={t('chat.figure.copy')} className={action}>
          {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
          <span className="hidden sm:inline">
            {copied ? t('chat.figure.copied') : t('chat.figure.copy')}
          </span>
        </button>
        <button type="button" onClick={download} title={t('chat.figure.download')} className={action}>
          <Download className="size-3" />
        </button>
        <button type="button" onClick={() => setOpen(true)} title={t('chat.figure.expand')} className={action}>
          <Maximize2 className="size-3" />
        </button>
      </div>

      <div className="px-2 py-2">
        <div
          ref={boxRef}
          data-testid="figure-canvas"
          className={cn('relative', dragging && 'cursor-grabbing select-none')}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div
            className="[&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:w-full [&_svg]:max-w-full [&_svg]:rounded-md"
            // The SVG is generated by the trusted renderer: every label is
            // escaped there, and it contains geometry only.
            dangerouslySetInnerHTML={{ __html: svg }}
          />

          {projection &&
            handles.map((handle, index) => {
              // Index keys keep the captured element mounted while its point moves.
              const active = hovered === index || (dragging && dragIndex === index)
              return (
                <span
                  key={index}
                  role="button"
                  tabIndex={-1}
                  aria-label={t('chat.figure.dragPoint')}
                  title={t('chat.figure.dragPoint')}
                  data-testid="figure-handle"
                  onPointerDown={(event) => startDrag(event, handle.point, index)}
                  onPointerEnter={() => setHovered(index)}
                  onPointerLeave={() => setHovered(null)}
                  style={{
                    left: `${(handle.x / projection.width) * 100}%`,
                    top: `${(handle.y / projection.height) * 100}%`
                  }}
                  className="group absolute z-10 flex size-5 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
                >
                  <span
                    className={cn(
                      'size-[5px] rounded-full border transition-all duration-100',
                      active
                        ? 'size-2.5 border-accent bg-accent/25 shadow-xs'
                        : 'border-foreground/40 bg-background/80 opacity-60 group-hover:size-2.5 group-hover:border-accent group-hover:bg-accent/20 group-hover:opacity-100'
                    )}
                  />
                </span>
              )
            })}
        </div>
      </div>

      {meta.caption && (
        <figcaption className="px-3 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {meta.caption}
        </figcaption>
      )}

      {spec && (
        <div className="flex items-center gap-2 px-3 py-1 text-[10px] text-tertiary">
          <Move className="size-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{t('chat.figure.dragHint')}</span>
          {moved && (
            <button
              type="button"
              onClick={reset}
              title={t('chat.figure.resetHint')}
              className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <RotateCcw className="size-3" />
              {t('chat.figure.reset')}
            </button>
          )}
        </div>
      )}

      {(meta.results.length > 0 || meta.notes.length > 0) && (
        <div className="flex flex-col gap-2 px-3 py-2">
          {moved && meta.results.length > 0 && (
            <p className="text-[10px] leading-relaxed text-amber-600 dark:text-amber-500">
              {t('chat.figure.liveNote')}
            </p>
          )}
          {meta.results.length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" data-testid="figure-results">
              {meta.results.map((item) => (
                <div key={`${item.label}-${item.value}`} className="contents">
                  <dt className="text-[11px] text-muted-foreground">{item.label}</dt>
                  <dd className="flex flex-wrap items-baseline gap-1.5">
                    <span className="font-mono text-[11.5px] font-medium tabular-nums text-foreground">
                      {item.value}
                    </span>
                    {item.formula && (
                      <span className="font-mono text-[10px] text-tertiary">= {item.formula}</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {meta.notes.length > 0 && (
            <ol className="flex flex-col gap-0.5">
              {meta.notes.map((note, index) => (
                <li
                  key={`${index}-${note}`}
                  className={cn('flex gap-1.5 text-[11px] leading-relaxed text-muted-foreground')}
                >
                  <span className="shrink-0 tabular-nums text-tertiary">{index + 1}.</span>
                  <span>{note}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[min(1120px,94vw)] p-4">
          <DialogTitle className="pr-8 text-[13px]">{meta.title || t('chat.figure.title')}</DialogTitle>
          <div
            className="max-h-[78vh] overflow-auto rounded-lg bg-background p-2 [&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </DialogContent>
      </Dialog>
    </figure>
  )
}
