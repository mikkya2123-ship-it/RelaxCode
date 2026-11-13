import type { JSX } from 'react'
import { Bot, ListTodo, MessageSquare } from 'lucide-react'
import type { ChatMode } from '@shared/ipc'
import { useChatStore } from '@/stores/chat'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const MODES: Array<{ id: ChatMode; icon: JSX.Element }> = [
  { id: 'chat', icon: <MessageSquare className="size-3" /> },
  { id: 'agent', icon: <Bot className="size-3" /> },
  { id: 'plan', icon: <ListTodo className="size-3" /> }
]

/**
 * The mode lives in the title bar because it decides which window the user is
 * looking at: a conversation, or the workspace with an agent working in it.
 */
export function ModeSwitch(): JSX.Element {
  const mode = useChatStore((s) => s.mode)
  const setMode = useChatStore((s) => s.setMode)
  const t = useT()

  return (
    <div
      role="radiogroup"
      aria-label={t('chat.mode.label')}
      data-testid="mode-switch"
      className="no-drag mr-1 flex items-center gap-0.5 rounded-lg bg-foreground/[0.05] p-0.5"
    >
      {MODES.map((item) => (
        <button
          key={item.id}
          type="button"
          role="radio"
          aria-checked={item.id === mode}
          data-testid={`mode-switch-${item.id}`}
          onClick={() => setMode(item.id)}
          className={cn(
            'flex items-center gap-1 rounded-[6px] px-1.5 py-[3px] text-[11px] transition-colors duration-100',
            item.id === mode
              ? 'bg-card text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {item.icon}
          {t(`chat.mode.${item.id}` as 'chat.mode.chat')}
        </button>
      ))}
    </div>
  )
}
