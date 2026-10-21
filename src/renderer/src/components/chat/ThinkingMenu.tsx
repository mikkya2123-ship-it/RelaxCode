import { useState, type JSX } from 'react'
import { Brain } from 'lucide-react'
import type { ModelInfo } from '@shared/ipc'
import {
  levelsFromEfforts,
  THINKING_LEVELS,
  type ThinkingLevel
} from '@shared/reasoning'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { effectiveThinking, type TokenSaving } from '@shared/token-saving'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ThinkingSlider } from '@/components/chat/ThinkingSlider'

/**
 * The reasoning switch of the composer: one compact icon that says whether the
 * model is asked to think, and a sheet with a slider — a gradient that warms up
 * from cold blue to hot pink, a glassy handle and a readout.
 */
export function ThinkingMenu({
  level,
  info,
  saving = 'off',
  live = false,
  onChange
}: {
  level: ThinkingLevel
  /** The picked model's entry, when the endpoint describes it. */
  info?: ModelInfo
  /** Super saving lowers the level at the wire; the sheet says so. */
  saving?: TokenSaving
  /** A request is streaming in this chat; the rail flows while it lasts. */
  live?: boolean
  onChange: (level: ThinkingLevel) => void
}): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  // What the model is really asked to do: a saving mode may lower the chat's
  // level, and every number in this sheet has to describe the wire, not the tab.
  const effective = effectiveThinking(level, saving)
  const label = t(`chat.thinking.${level}` as 'chat.thinking.off')
  const effectiveLabel = t(`chat.thinking.${effective}` as 'chat.thinking.off')
  const capped = effective !== level
  const active = effective !== 'off'
  // OpenRouter tells us which efforts a model takes and whether reasoning is
  // mandatory; that metadata outranks any guess made from the model's name.
  const supported = info?.reasoningEfforts ? levelsFromEfforts(info.reasoningEfforts) : null
  const mandatory = info?.reasoningAlways === true
  // Stops the endpoint says the model will not take. They stay on the rail so
  // the scale keeps its shape, but they cannot be reached.
  const blocked: ThinkingLevel[] = [
    ...(mandatory ? (['off'] as ThinkingLevel[]) : []),
    ...(supported
      ? THINKING_LEVELS.filter((value) => value !== 'off' && !supported.includes(value))
      : [])
  ]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="chat-thinking"
          data-level={level}
          data-effective={effective}
          data-live={live ? 'true' : undefined}
          aria-label={
            capped
              ? `${t('chat.thinking.current', { level: label })} · ${t('chat.thinking.savingCap', { level: effectiveLabel })}`
              : t('chat.thinking.current', { level: label })
          }
          title={
            capped
              ? `${t('chat.thinking.current', { level: label })} · ${t('chat.thinking.savingCap', { level: effectiveLabel })}`
              : t('chat.thinking.current', { level: label })
          }
          className={cn(
            'relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md border transition-colors duration-150 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
            active
              ? 'border-transparent text-foreground'
              : 'border-transparent text-tertiary hover:bg-foreground/[0.05] hover:text-foreground',
            open && 'border-ring',
            active && live && 'think-glow'
          )}
        >
          {active && (
            <span
              aria-hidden
              className={cn(
                'think-rail-gradient pointer-events-none absolute inset-0',
                live ? 'think-live opacity-45' : 'opacity-20'
              )}
            />
          )}
          <Brain className="relative size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={6}
        collisionPadding={12}
        className="w-[280px] min-w-0 p-0"
      >
        <div className="flex items-start gap-2 px-3 pb-0.5 pt-2.5">
          <Brain className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-foreground">{t('chat.thinking.title')}</p>
            <p className="text-[11px] leading-snug text-tertiary">{t('chat.thinking.hint')}</p>
          </div>
        </div>

        {capped && (
          <p
            data-testid="thinking-saving-cap"
            className="mx-3 mt-1.5 rounded-md bg-primary/[0.07] px-2 py-1 text-[10px] leading-snug text-primary"
          >
            {t('chat.thinking.savingCap', { level: effectiveLabel })}
          </p>
        )}

        <ThinkingSlider level={level} onChange={onChange} blocked={blocked} live={live} />
      </PopoverContent>
    </Popover>
  )
}
