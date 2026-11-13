import type { JSX } from 'react'
import { ArrowUpCircle, ArrowUpRight, CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { useUpdatesStore } from '@/stores/updates'
import { formatBytes } from '@shared/updater'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

/**
 * The update dialog: what the new release brings, in a few plain lines, and
 * one button that downloads and installs it. Everything technical (sha512,
 * NSIS, restart) stays out of the user's way.
 */
export function UpdateDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): JSX.Element | null {
  const t = useT()
  const state = useUpdatesStore((s) => s.state)
  const download = useUpdatesStore((s) => s.download)
  const check = useUpdatesStore((s) => s.check)
  const install = useUpdatesStore((s) => s.install)

  if (!state) return null

  const version = state.version ?? ''
  const phase = state.phase
  const percent = state.progress?.percent ?? 0
  const total = state.progress?.total ?? 0
  const transferred = state.progress?.transferred ?? 0
  const notes = state.notes

  const close = (): void => onOpenChange(false)

  const act = (): void => {
    if (phase === 'ready') {
      void install()
      return
    }
    if (phase === 'available') {
      void download()
      return
    }
    if (phase === 'error') {
      void (state.version ? download() : check())
    }
  }

  const actionLabel =
    phase === 'downloading'
      ? t('update.downloading')
      : phase === 'ready'
        ? t('update.install')
        : phase === 'error'
          ? t('update.retry')
          : t('update.download')

  const actionIcon =
    phase === 'downloading' ? (
      <Loader2 className="size-3.5 animate-spin" />
    ) : phase === 'ready' || phase === 'error' ? (
      <RefreshCw className="size-3.5" />
    ) : (
      <Download className="size-3.5" />
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[470px] gap-0 overflow-hidden p-0" data-testid="update-dialog">
        <div className="px-6 pb-5 pt-6">
          <div className="flex items-start gap-3.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-xs">
              <ArrowUpCircle className="size-5" />
            </span>
            <DialogHeader className="min-w-0 gap-1 pr-6">
              <DialogTitle className="text-[15px]">
                {t('update.title', { version })}
              </DialogTitle>
              <DialogDescription className="text-[12.5px] leading-relaxed">
                {t('update.description', { current: state.current })}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="mt-5 rounded-xl border border-border bg-accent/40 px-4 py-3.5">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-tertiary">
              {t('update.notes.title')}
            </p>
            {notes.length > 0 ? (
              <ul className="mt-2.5 space-y-1.5">
                {notes.map((line, index) => (
                  <li
                    key={`${index}-${line.slice(0, 24)}`}
                    className="flex gap-2 text-[12.5px] leading-relaxed text-foreground/90"
                  >
                    <span className="mt-[7px] size-1 shrink-0 rounded-full bg-primary/40" />
                    <span className="min-w-0">{line}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
                {t('update.notes.empty')}
              </p>
            )}
            {state.releaseUrl && (
              <a
                href={state.releaseUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-[11.5px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                {t('update.notes.more')}
                <ArrowUpRight className="size-3" />
              </a>
            )}
          </div>

          {phase === 'downloading' && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
                <span>{t('update.downloading')}</span>
                <span className="tabular-nums">{percent}%</span>
              </div>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-accent"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                  style={{ width: `${percent}%` }}
                />
              </div>
              {total > 0 && (
                <p className="mt-1 text-[10.5px] tabular-nums text-tertiary">
                  {t('update.downloading.progress', {
                    done: formatBytes(transferred),
                    total: formatBytes(total)
                  })}
                </p>
              )}
            </div>
          )}

          {phase === 'ready' && (
            <p className="mt-4 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
              {t('update.ready')}
            </p>
          )}

          {phase === 'error' && (
            <div className="mt-4">
              <p className="text-[11.5px] leading-relaxed text-destructive">{t('update.error')}</p>
              {state.error && (
                <p className="mt-1 break-words text-[10.5px] leading-relaxed text-tertiary">
                  {state.error}
                </p>
              )}
            </div>
          )}

          {state.manual && (
            <p className="mt-3 text-[10.5px] leading-relaxed text-tertiary">
              {t('update.devHint')}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border bg-accent/30 px-6 py-3.5">
          <span className="text-[10.5px] leading-snug text-tertiary">{t('update.footer')}</span>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" className="h-8 text-[13px]" onClick={close}>
              {t('update.later')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="h-8 gap-1.5 text-[13px]"
              disabled={phase === 'downloading'}
              onClick={act}
              data-testid="update-action"
            >
              {actionIcon}
              {actionLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
