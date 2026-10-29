import { useEffect, useRef, useState, type JSX } from 'react'
import { ChevronDown, Pause, Play, Table as TableIcon } from 'lucide-react'
import type { DiffMeta, TableMeta, DiagramMeta, TimelapseMeta } from '@shared/tool-meta'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/** A unified diff as a colored card: green additions, red removals. */
export function DiffCard({ meta, defaultCollapsed = false }: { meta: DiffMeta; defaultCollapsed?: boolean }): JSX.Element {
  const t = useT()
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [expanded, setExpanded] = useState(false)
  const lines = meta.patch.split('\n')
  // The header lines (`---`/`+++`) are metadata; the body carries the change.
  const body = lines.filter((line) => !line.startsWith('---') && !line.startsWith('+++'))
  const added = body.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length
  const removed = body.filter((line) => line.startsWith('-') && !line.startsWith('---')).length
  const shown = expanded ? body : body.slice(0, 14)
  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-panel/70" data-testid="diff-card">
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors duration-100 hover:bg-foreground/[0.03]"
      >
        <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', collapsed && '-rotate-90')} />
        {meta.file && <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/90">{meta.file}</span>}
        {!meta.file && meta.title && <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/90">{meta.title}</span>}
        {added + removed > 0 && (
          <span className="shrink-0 rounded-full bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[10px] tabular-nums">
            <span className="text-green-600 dark:text-green-400">+{added}</span>{' '}
            <span className="text-red-600 dark:text-red-400">−{removed}</span>
          </span>
        )}
      </button>
      {!collapsed && (
        <div className="max-h-[420px] overflow-auto border-t border-border/60 px-2 py-1.5">
          <pre className="font-mono text-[11px] leading-relaxed">
            {shown.map((line, index) => (
              <div
                key={index}
                className={cn(
                  '-mx-1 rounded px-1',
                  line.startsWith('@@') && 'text-tertiary',
                  line.startsWith('+') && !line.startsWith('+++') && 'bg-success/10 text-green-700 dark:text-green-400',
                  line.startsWith('-') && !line.startsWith('---') && 'bg-destructive/10 text-red-700 dark:text-red-400'
                )}
              >
                {line || ' '}
              </div>
            ))}
          </pre>
          {!expanded && body.length > 14 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-1 flex w-full items-center justify-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronDown className="size-3" />
              {t('chat.diff.more', { n: body.length - 14 })}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Structured results as a real grid instead of a text dump. */
export function TableCard({ meta }: { meta: TableMeta }): JSX.Element {
  const t = useT()
  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-panel/70" data-testid="table-card">
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[12px]">
        <TableIcon className="size-3.5 shrink-0 text-muted-foreground" />
        {meta.title ? (
          <span className="min-w-0 flex-1 truncate text-foreground/90">{meta.title}</span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {t('chat.table.title', { n: meta.rows.length })}
          </span>
        )}
        <span className="shrink-0 text-[10px] tabular-nums text-tertiary">
          {meta.rows.length} × {meta.columns.length}
        </span>
      </div>
      <div className="max-h-[420px] overflow-auto border-t border-border/60">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 bg-panel">
            <tr>
              {meta.columns.map((column, index) => (
                <th
                  key={index}
                  className="border-b border-border px-2 py-1 text-left font-medium text-muted-foreground"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {meta.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="odd:bg-foreground/[0.02]">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-2 py-1 align-top tabular-nums text-foreground/90">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** A boxes-and-arrows scheme rendered from the model's description. */
export function DiagramCard({ meta }: { meta: DiagramMeta }): JSX.Element {
  return (
    <figure className="w-full overflow-hidden rounded-lg border border-border bg-panel/70 text-foreground" data-testid="diagram-card">
      {meta.title && (
        <figcaption className="px-2.5 py-1.5 text-[12px] text-foreground/90">{meta.title}</figcaption>
      )}
      <div
        className="overflow-x-auto border-t border-border/60 px-3 py-3 [&_svg]:h-auto [&_svg]:w-full [&_svg]:min-w-[320px]"
        dangerouslySetInnerHTML={{ __html: meta.svg }}
      />
    </figure>
  )
}

/** A film of the running app: frames shot while the agent worked. */
export function TimelapseCard({ meta }: { meta: TimelapseMeta }): JSX.Element {
  const t = useT()
  const [playing, setPlaying] = useState(false)
  const [frame, setFrame] = useState(0)
  const frameRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    if (!playing || meta.frames.length < 2) return
    // Real pace feels slow on replay; 2.5 frames a second reads as a film.
    const timer = window.setInterval(() => {
      setFrame((current) => (current + 1) % meta.frames.length)
    }, 400)
    return () => window.clearInterval(timer)
  }, [playing, meta.frames.length])

  if (meta.frames.length === 0) return <></>
  const seconds = Math.round((meta.frames.length - 1) * meta.intervalSec)

  return (
    <figure className="w-full overflow-hidden rounded-lg border border-border bg-panel/70" data-testid="timelapse-card">
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[12px]">
        <span className="min-w-0 flex-1 truncate text-foreground/90">{t('chat.timelapse.title')}</span>
        <span className="shrink-0 text-[10px] tabular-nums text-tertiary">
          {t('chat.timelapse.facts', { n: meta.frames.length, seconds })}
        </span>
        <button
          type="button"
          onClick={() => setPlaying((value) => !value)}
          aria-label={playing ? t('chat.timelapse.pause') : t('chat.timelapse.play')}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </button>
      </div>
      <div className="relative border-t border-border/60">
        <img
          ref={frameRef}
          src={meta.frames[frame]}
          alt={`${t('chat.timelapse.title')} — ${frame + 1}/${meta.frames.length}`}
          className="max-h-[380px] w-full bg-white object-contain object-top"
        />
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] tabular-nums text-white">
          {frame + 1}/{meta.frames.length}
        </span>
      </div>
      {/* The strip doubles as a scrubber: click a thumb to jump to it. */}
      <div className="flex gap-1 overflow-x-auto p-1.5">
        {meta.frames.map((src, index) => (
          <button
            key={index}
            type="button"
            onClick={() => {
              setPlaying(false)
              setFrame(index)
            }}
            className={cn(
              'h-10 w-14 shrink-0 overflow-hidden rounded border transition-opacity',
              index === frame ? 'border-ring opacity-100' : 'border-border opacity-60 hover:opacity-100'
            )}
          >
            <img src={src} alt="" className="h-full w-full bg-white object-cover object-top" />
          </button>
        ))}
      </div>
    </figure>
  )
}
