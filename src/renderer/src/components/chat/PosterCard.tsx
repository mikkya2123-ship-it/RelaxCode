import { useState, type JSX } from 'react'
import { X } from 'lucide-react'
import type { PosterMeta } from '@shared/tool-meta'
import { useT } from '@/lib/i18n'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

function hostOf(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * An artwork afisha: the picture of the work on top with its source badge,
 * the title and author above it, and the labelled passport of the work
 * underneath. The picture is already embedded in the meta, so the card works
 * offline and ignores hotlink rules.
 */
export function PosterCard({ meta }: { meta: PosterMeta }): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const sourceBadge = meta.sourceTitle || hostOf(meta.sourceUrl)

  return (
    <figure
      className="w-full max-w-[480px] overflow-hidden rounded-2xl border border-border bg-card shadow-xs"
      data-testid="poster-card"
    >
      <div className="px-4 pb-3 pt-4 text-center">
        <h3 className="text-[15px] font-semibold leading-snug text-foreground">{meta.title}</h3>
        {meta.author && (
          <p className="mt-1 text-[13px]">
            {meta.authorUrl ? (
              <a
                href={meta.authorUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary transition-colors hover:text-primary/80"
              >
                {meta.author}
              </a>
            ) : (
              <span className="text-muted-foreground">{meta.author}</span>
            )}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('chat.image.enlarge')}
        title={meta.imageAlt}
        className="relative block w-full cursor-zoom-in px-4"
      >
        <img
          src={meta.imageSrc}
          alt={meta.imageAlt}
          loading="lazy"
          decoding="async"
          className="max-h-[420px] w-full rounded-xl object-cover"
        />
        {sourceBadge && meta.sourceUrl && (
          <a
            href={meta.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            title={meta.sourceUrl}
            onClick={(event) => event.stopPropagation()}
            className="absolute bottom-6 left-6 rounded-md bg-black/60 px-2 py-0.5 text-[11px] text-white/90 backdrop-blur transition-colors hover:bg-black/80"
          >
            {sourceBadge}
          </a>
        )}
      </button>

      {(meta.facts.length > 0 || meta.note) && (
        <div className="px-4 pb-4 pt-3">
          {meta.facts.length > 0 && (
            <dl className="space-y-1.5 border-t border-border/70 pt-3 text-[13px] leading-relaxed">
              {meta.facts.map((fact, index) => (
                <div key={`${fact.label}-${index}`} className="flex gap-x-1.5">
                  <dt className="shrink-0 font-semibold text-foreground">{fact.label}:</dt>
                  <dd className="min-w-0 text-muted-foreground">{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {meta.note && <p className="mt-3 text-center text-[13px] font-medium text-primary">{meta.note}</p>}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[94vw] border-border/60 bg-black/90 p-2 sm:rounded-2xl [&>button]:hidden">
          <DialogTitle className="sr-only">{meta.title}</DialogTitle>
          <div className="relative">
            <img
              src={meta.imageSrc}
              alt={meta.imageAlt}
              className="mx-auto max-h-[82vh] w-auto max-w-full rounded-lg object-contain"
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('chat.image.collapse')}
              className="absolute right-1 top-1 rounded-md border border-white/10 bg-black/50 p-1.5 text-white/70 backdrop-blur transition-colors hover:text-white"
            >
              <X className="size-4" />
            </button>
            {sourceBadge && meta.sourceUrl && (
              <a
                href={meta.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="absolute bottom-1 left-1 rounded-md bg-black/50 px-2 py-0.5 text-[11px] text-white/80 backdrop-blur transition-colors hover:text-white"
              >
                {sourceBadge}
              </a>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </figure>
  )
}
