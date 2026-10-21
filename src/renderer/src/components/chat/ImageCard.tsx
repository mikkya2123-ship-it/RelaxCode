import { useState, type JSX } from 'react'
import { ExternalLink, Image as ImageIcon, Maximize2, X } from 'lucide-react'
import type { ImageMeta } from '@shared/tool-meta'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/** Bytes → the shortest honest label ("240 KB", "1.4 MB"). */
function bytesLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function hostOf(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * A picture the model brought into the chat. The bytes are already embedded in
 * the meta, so this card keeps working offline and independent of hotlink rules.
 */
export function ImageCard({ meta }: { meta: ImageMeta }): JSX.Element {
  const t = useT()
  const [zoom, setZoom] = useState(false)
  const hasSource = Boolean(meta.sourceUrl)

  const frame = (
    <div className="relative flex justify-center bg-foreground/[0.035] p-2">
      <img
        src={meta.src}
        alt={meta.alt}
        loading="lazy"
        decoding="async"
        className={cn(
          'mx-auto max-h-[360px] w-auto max-w-full rounded-md object-contain shadow-xs',
          zoom && 'max-h-none w-full'
        )}
      />
      {!zoom && (
        <button
          type="button"
          onClick={() => setZoom(true)}
          title={t('chat.image.enlarge')}
          aria-label={t('chat.image.enlarge')}
          className="absolute right-3 top-3 rounded-md border border-border bg-card/90 p-1.5 text-muted-foreground opacity-0 shadow-xs backdrop-blur transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Maximize2 className="size-3.5" />
        </button>
      )}
    </div>
  )

  return (
    <figure
      className="group overflow-hidden rounded-xl border border-border bg-panel/70"
      data-testid="image-card"
    >
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-1.5">
        <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/80">
          {meta.alt}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-tertiary">
          {meta.width && meta.height ? `${meta.width}×${meta.height} · ` : ''}
          {bytesLabel(meta.bytes)}
        </span>
      </div>

      {zoom ? (
        <div className="relative bg-background">
          <button
            type="button"
            onClick={() => setZoom(false)}
            title={t('chat.image.collapse')}
            aria-label={t('chat.image.collapse')}
            className="absolute right-2 top-2 z-10 rounded-md border border-border bg-card/90 p-1.5 text-muted-foreground shadow-xs backdrop-blur hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
          {frame}
        </div>
      ) : (
        frame
      )}

      {(meta.caption || (hasSource && meta.sourceUrl)) && (
        <figcaption className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-border/60 px-3 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {meta.caption && <span className="min-w-0 flex-1">{meta.caption}</span>}
          {hasSource && meta.sourceUrl && (
            <a
              href={meta.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              title={meta.sourceUrl}
              className="ml-auto inline-flex shrink-0 items-center gap-1 text-[10px] text-tertiary transition-colors hover:text-foreground"
            >
              <ExternalLink className="size-3" />
              {meta.sourceTitle || hostOf(meta.sourceUrl) || meta.sourceUrl}
            </a>
          )}
        </figcaption>
      )}
    </figure>
  )
}
