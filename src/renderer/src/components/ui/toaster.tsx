import type { JSX } from 'react'
import { X } from 'lucide-react'
import { useToastStore } from '@/stores/toast'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export function Toaster(): JSX.Element {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  const t = useT()

  return (
    <div className="pointer-events-none fixed bottom-10 right-4 z-[100] flex w-[320px] flex-col gap-2">
      {toasts.map((item) => (
        <div
          key={item.id}
          className={cn(
            'pointer-events-auto flex items-start gap-2 rounded-xl border bg-popover p-3 shadow-pop animate-slide-down',
            item.variant === 'error' ? 'border-destructive/30' : 'border-border'
          )}
        >
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                'text-[13px] font-medium',
                item.variant === 'error' ? 'text-destructive' : 'text-foreground'
              )}
            >
              {item.title}
            </p>
            {item.description && (
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {item.description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => dismiss(item.id)}
            className="rounded-md p-0.5 text-tertiary transition-colors duration-150 hover:bg-accent hover:text-foreground"
            aria-label={t('action.dismiss')}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
