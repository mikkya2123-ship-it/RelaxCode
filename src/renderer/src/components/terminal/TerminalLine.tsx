import type { JSX } from 'react'
import { FilePlus, FileText, MoveRight, Pencil, Trash2, X, type LucideIcon } from 'lucide-react'
import { parseFeedLine, type FeedEventKind } from '@shared/terminal-feed'
import { cn } from '@/lib/utils'

/**
 * One line of the terminal dock's scrollback. Plain output gets a quiet left
 * rule so runs of it read as a block; events the main process tagged (a command
 * the AI ran, a file it wrote, a failure) get a frame or a coloured chip, which
 * is what keeps the feed from looking like a wall of text.
 */

const FILE_EVENTS: Partial<Record<FeedEventKind, { icon: LucideIcon; className: string }>> = {
  'file-create': { icon: FilePlus, className: 'border-success/40 bg-success/10 text-success' },
  'file-write': { icon: FileText, className: 'border-success/40 bg-success/10 text-success' },
  'file-edit': { icon: Pencil, className: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  'file-move': { icon: MoveRight, className: 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400' },
  'file-delete': { icon: Trash2, className: 'border-destructive/40 bg-destructive/10 text-destructive' }
}

function CommandRow({ text }: { text: string }): JSX.Element {
  return (
    <div className="my-1 flex items-start gap-2 rounded-md border border-border bg-card px-2 py-1 shadow-xs">
      <span aria-hidden className="select-none text-primary">
        ❯
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-foreground">{text || '\u00a0'}</span>
    </div>
  )
}

function OutputRow({ text }: { text: string }): JSX.Element {
  if (text.trim() === '') return <div className="h-[0.9em]" />
  return (
    <div className="whitespace-pre-wrap break-all border-l border-border/70 pl-2 text-muted-foreground">
      {text}
    </div>
  )
}

export function TerminalLine({ line }: { line: string }): JSX.Element {
  const event = parseFeedLine(line)

  if (!event) {
    // Untagged output, plus the two shapes the panel drew before the feed was
    // tagged, so an older scrollback still reads the same.
    if (line.startsWith('❯')) return <CommandRow text={line.replace(/^❯\s?/, '')} />
    if (line.trim().startsWith('↳')) return <ErrorRow text={line.trim()} />
    return <OutputRow text={line} />
  }

  if (event.kind === 'command') return <CommandRow text={event.text} />
  if (event.kind === 'error') return <ErrorRow text={event.text} />

  const style = FILE_EVENTS[event.kind]
  if (style) {
    const Icon = style.icon
    return (
      <div
        className={cn(
          'my-1 flex w-fit max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5',
          style.className
        )}
      >
        <Icon className="size-3 shrink-0" />
        <span className="truncate">{event.text}</span>
      </div>
    )
  }

  return <OutputRow text={event.text} />
}

function ErrorRow({ text }: { text: string }): JSX.Element {
  return (
    <div className="my-1 flex w-fit max-w-full items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-destructive">
      <X className="size-3 shrink-0" />
      <span className="truncate">{text}</span>
    </div>
  )
}
