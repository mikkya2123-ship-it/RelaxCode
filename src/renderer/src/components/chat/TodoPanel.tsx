import type { JSX } from 'react'
import { CheckCircle2, Circle, ListChecks, Loader2 } from 'lucide-react'
import type { TodoItem } from '@shared/ipc'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export function TodoPanel({ todos }: { todos: TodoItem[] }): JSX.Element | null {
  const t = useT()
  if (todos.length === 0) return null

  const done = todos.filter((todo) => todo.status === 'completed').length

  return (
    <div className="rounded-lg border border-border bg-panel/70 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
        <ListChecks className="size-3.5" />
        {t('chat.todos.title')}
        <span className="font-normal text-tertiary">
          {done}/{todos.length}
        </span>
      </div>
      <ul className="mt-1.5 flex flex-col gap-1">
        {todos.map((todo) => (
          <li key={todo.id} className="flex items-start gap-2 text-[12px] leading-snug">
            {todo.status === 'completed' ? (
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
            ) : todo.status === 'in_progress' ? (
              <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <Circle className="mt-0.5 size-3.5 shrink-0 text-tertiary" />
            )}
            <span
              className={cn(
                'text-foreground/90',
                todo.status === 'completed' && 'text-tertiary line-through'
              )}
            >
              {todo.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
