import { useState, type JSX } from 'react'
import { Download, Maximize2, X } from 'lucide-react'
import type { ImageMeta } from '@shared/tool-meta'
import { useT } from '@/lib/i18n'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
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
 * the meta, so the card works offline and ignores hotlink rules.
 *
 * The card itself is just the photo in a quiet frame: the size, the source and
 * the download live on one subdued line under it, and "open larger" swaps in a
 * proper lightbox instead of blowing the card up in place.
 */
export function ImageCard({ meta }: { meta: ImageMeta }): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const sourceHost = meta.sourceTitle || hostOf(meta.sourceUrl)
  const facts = [
    meta.width && meta.height ? `${meta.width}×${meta.height}` : '',
    bytesLabel(meta.bytes)
  ]
    .filter(Boolean)
    .join(' · ')

  const download = (
    <a
      href={meta.src}
      download={imageFileName(meta)}
      title={t('chat.image.download')}
      aria-label={t('chat.image.download')}
      className="rounded-md border border-border bg-card/90 p-1.5 text-muted-foreground shadow-xs backdrop-blur transition-colors hover:text-foreground"
      onClick={(event) => event.stopPropagation()}
    >
      <Download className="size-3.5" />
    </a>
  )

  return (
    <figure className="group w-fit max-w-full" data-testid="image-card">
      <div className="relative overflow-hidden rounded-xl border border-border bg-foreground/[0.03]">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('chat.image.enlarge')}
          title={meta.alt || meta.caption || t('chat.image.enlarge')}
          className="block cursor-zoom-in"
        >
          <img
            src={meta.src}
            alt={meta.alt}
            loading="lazy"
            decoding="async"
            className="max-h-[360px] w-auto max-w-full object-contain"
          />
        </button>

        {/* Controls live on the photo and only appear when wanted. */}
        <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={() => setOpen(true)}
            title={t('chat.image.enlarge')}
            aria-label={t('chat.image.enlarge')}
            className="rounded-md border border-border bg-card/90 p-1.5 text-muted-foreground shadow-xs backdrop-blur transition-colors hover:text-foreground"
          >
            <Maximize2 className="size-3.5" />
          </button>
          {download}
        </div>
      </div>

      {(meta.caption || facts || sourceHost) && (
        <figcaption className="mt-1 flex w-full items-baseline gap-x-2 overflow-hidden px-0.5 text-[11px] leading-relaxed text-muted-foreground">
          {meta.caption && (
            <span className="min-w-0 flex-1 truncate" title={meta.caption}>
              {meta.caption}
            </span>
          )}
          {facts && <span className="shrink-0 tabular-nums text-tertiary">{facts}</span>}
          {sourceHost && meta.sourceUrl && (
            <a
              href={meta.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              title={`${meta.sourceTitle ?? ''} ${meta.sourceUrl}`.trim()}
              className="inline-flex shrink-0 items-center gap-1 text-tertiary transition-colors hover:text-foreground"
            >
              {sourceHost}
            </a>
          )}
        </figcaption>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[94vw] border-border/60 bg-black/90 p-2 sm:rounded-2xl [&>button]:hidden">
          <DialogTitle className="sr-only">{meta.alt || meta.caption || 'image'}</DialogTitle>
          <div className="relative">
            <img
              src={meta.src}
              alt={meta.alt}
              className="mx-auto max-h-[82vh] w-auto max-w-full rounded-lg object-contain"
            />
            <div className="absolute right-1 top-1 flex gap-1.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('chat.image.collapse')}
                className={cn(
                  'rounded-md border border-white/10 bg-black/50 p-1.5 text-white/70 backdrop-blur transition-colors hover:text-white'
                )}
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2 px-1 pb-1 text-[11px] text-white/60">
              {meta.caption && (
                <span className="min-w-0 flex-1 truncate text-white/80" title={meta.caption}>
                  {meta.caption}
                </span>
              )}
              {facts && <span className="shrink-0 tabular-nums">{facts}</span>}
              {sourceHost && meta.sourceUrl && (
                <a
                  href={meta.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex shrink-0 items-center gap-1 transition-colors hover:text-white"
                >
                  {sourceHost}
                </a>
              )}
              <a
                href={meta.src}
                download={imageFileName(meta)}
                title={t('chat.image.download')}
                aria-label={t('chat.image.download')}
                className="shrink-0 rounded-md border border-white/10 bg-black/50 p-1.5 text-white/70 transition-colors hover:text-white"
              >
                <Download className="size-3.5" />
              </a>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </figure>
  )
}

/** A friendly file name for the download attribute. */
function imageFileName(meta: ImageMeta): string {
  const mime = meta.mime || 'image/png'
  const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'png'
  const base =
    (meta.alt || meta.caption || 'image')
      .toLowerCase()
      .replace(/[^a-zа-яё0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'image'
  return `${base}.${ext}`
}
