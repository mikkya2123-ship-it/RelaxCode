import { useState, type JSX } from 'react'
import { File as FileIcon, FileText, Film, X } from 'lucide-react'
import { formatBytes, type AttachmentRef } from '@shared/attachments'
import { useT } from '@/lib/i18n'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/** A visual the lightbox can show: an attached picture or a video keyframe. */
function visualsOf(attachment: AttachmentRef): string[] {
  if (attachment.kind === 'image') return attachment.dataUrl ? [attachment.dataUrl] : []
  if (attachment.kind === 'video') return attachment.frames ?? []
  return []
}

/**
 * One attachment as a compact square: the picture itself, the first extracted
 * keyframe, or a quiet file card when there is nothing to show (a text file,
 * an archive, or a picture whose bytes were dropped from storage).
 */
export function AttachmentChip({
  attachment,
  className
}: {
  attachment: AttachmentRef
  className?: string
}): JSX.Element {
  const [visual] = visualsOf(attachment)
  if (visual) {
    return (
      <span
        className={cn(
          'relative block h-16 w-16 overflow-hidden rounded-lg border border-border bg-foreground/[0.03]',
          className
        )}
      >
        <img src={visual} alt={attachment.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        {attachment.kind === 'video' && (attachment.frames?.length ?? 0) > 1 && (
          <span className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded bg-black/60 px-1 py-0.5 text-[9px] font-medium tabular-nums text-white">
            <Film className="size-2.5" />
            {attachment.frames?.length}
          </span>
        )}
      </span>
    )
  }
  const Icon = attachment.kind === 'text' ? FileText : attachment.kind === 'video' ? Film : FileIcon
  return (
    <span
      className={cn(
        'flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-lg border border-border bg-foreground/[0.03] px-1 py-1.5',
        className
      )}
      title={attachment.name}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="w-full truncate text-center text-[9px] leading-tight text-muted-foreground">
        {attachment.name}
      </span>
      <span className="text-[9px] leading-tight tabular-nums text-tertiary">{formatBytes(attachment.bytes)}</span>
    </span>
  )
}

/**
 * The attachments of a sent user message: a wrap of chips under the text
 * bubble. Pictures and keyframes open in a lightbox; opaque files stay as
 * cards — there is nothing to zoom into.
 */
export function AttachmentStrip({ attachments }: { attachments: AttachmentRef[] }): JSX.Element | null {
  const t = useT()
  const [zoomed, setZoomed] = useState<AttachmentRef | null>(null)
  if (attachments.length === 0) return null
  const zoomedVisuals = zoomed ? visualsOf(zoomed) : []

  return (
    <div className="flex max-w-full flex-wrap justify-end gap-1.5" data-testid="chat-attachments">
      {attachments.map((attachment) =>
        visualsOf(attachment).length > 0 ? (
          <button
            key={attachment.id}
            type="button"
            onClick={() => setZoomed(attachment)}
            aria-label={t('chat.image.enlarge')}
            title={attachment.name}
            className="block cursor-zoom-in rounded-lg transition-opacity duration-100 hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <AttachmentChip attachment={attachment} />
          </button>
        ) : (
          <AttachmentChip key={attachment.id} attachment={attachment} />
        )
      )}

      <Dialog open={zoomed !== null} onOpenChange={(open) => !open && setZoomed(null)}>
        <DialogContent className="max-w-[94vw] border-border/60 bg-black/90 p-2 sm:rounded-2xl [&>button]:hidden">
          <DialogTitle className="sr-only">{zoomed?.name ?? 'attachment'}</DialogTitle>
          <div className="relative">
            <div className="flex max-h-[76vh] flex-col items-center gap-2 overflow-y-auto">
              {zoomedVisuals.map((src, index) => (
                <img
                  key={index}
                  src={src}
                  alt={index === 0 ? zoomed?.name : `${zoomed?.name} — frame ${index + 1}`}
                  className="max-h-[70vh] w-auto max-w-full rounded-lg object-contain"
                />
              ))}
            </div>
            <div className="absolute right-1 top-1 flex gap-1.5">
              <button
                type="button"
                onClick={() => setZoomed(null)}
                aria-label={t('chat.image.collapse')}
                className="rounded-md border border-white/10 bg-black/50 p-1.5 text-white/70 backdrop-blur transition-colors hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>
            {zoomed && (
              <div className="mt-2 flex items-center gap-2 px-1 pb-1 text-[11px] text-white/60">
                <span className="min-w-0 flex-1 truncate text-white/80" title={zoomed.name}>
                  {zoomed.name}
                </span>
                <span className="shrink-0 tabular-nums">{formatBytes(zoomed.bytes)}</span>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
