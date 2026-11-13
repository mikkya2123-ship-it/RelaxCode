import { useState, type JSX } from 'react'
import { ArrowUpCircle, Loader2 } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { useUpdatesStore } from '@/stores/updates'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { UpdateDialog } from '@/components/layout/UpdateDialog'

/**
 * The title-bar reminder: it exists only while a newer release does. The
 * dialog behind it explains what changed and installs the build.
 */
export function UpdateButton(): JSX.Element | null {
  const t = useT()
  const state = useUpdatesStore((s) => s.state)
  const [open, setOpen] = useState(false)

  if (!state) return null

  const active =
    state.phase === 'available' || state.phase === 'downloading' || state.phase === 'ready'
  if (!active) return null

  const downloading = state.phase === 'downloading'
  const percent = state.progress?.percent ?? 0
  const label =
    state.phase === 'downloading'
      ? t('update.button.downloading', { percent })
      : state.phase === 'ready'
        ? t('update.button.ready')
        : t('update.button', { version: state.version ?? '' })

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="primary"
            size="sm"
            className="no-drag h-7 gap-1.5 rounded-full px-2.5 text-[12px] font-medium"
            onClick={() => setOpen(true)}
            aria-label={t('update.tooltip')}
            data-testid="update-button"
          >
            {downloading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ArrowUpCircle className="size-3.5" />
            )}
            <span className="tabular-nums">{label}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('update.tooltip')}</TooltipContent>
      </Tooltip>

      <UpdateDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
