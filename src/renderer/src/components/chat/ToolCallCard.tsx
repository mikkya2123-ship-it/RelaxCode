import { useState, type JSX } from 'react'
import {
  Check,
  ChevronRight,
  FilePlus,
  FileText,
  FolderTree,
  GitBranch,
  Globe,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  MoveRight,
  Pencil,
  Ruler,
  Search,
  Terminal,
  Trash2,
  X,
  type LucideIcon
} from 'lucide-react'
import type { ToolPart } from '@/stores/chat'
import { cn } from '@/lib/utils'
import { WebSearchCard } from './WebSearchCard'
import { ImageCard } from './ImageCard'
import { FigureCard } from './FigureCard'

function iconFor(name: string): LucideIcon {
  switch (name) {
    case 'list_dir':
      return FolderTree
    case 'read_file':
      return FileText
    case 'write_file':
      return FilePlus
    case 'edit_file':
      return Pencil
    case 'delete_path':
      return Trash2
    case 'move_path':
      return MoveRight
    case 'search_files':
    case 'search_content':
      return Search
    case 'run_command':
      return Terminal
    case 'git_status':
    case 'git_diff':
      return GitBranch
    case 'todo_write':
      return ListChecks
    case 'ask_user':
      return MessageCircleQuestion
    case 'fetch_url':
      return Globe
    case 'show_image':
      return ImageIcon
    case 'draw_figure':
      return Ruler
    default:
      return FileText
  }
}

function previewText(part: ToolPart): string {
  if (part.status !== 'running' && part.summary) return part.summary
  try {
    const args = JSON.parse(part.args) as Record<string, unknown>
    for (const key of ['path', 'command', 'pattern', 'query', 'url', 'question', 'from']) {
      const value = args[key]
      if (typeof value === 'string' && value.length > 0) return value.slice(0, 160)
    }
  } catch {
    return part.name
  }
  return part.name
}

export function ToolCallCard({
  part,
  defaultExpanded = false
}: {
  part: ToolPart
  defaultExpanded?: boolean
}): JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const Icon = iconFor(part.name)

  if (part.meta?.kind === 'image') return <ImageCard meta={part.meta} />
  if (part.meta?.kind === 'figure') return <FigureCard meta={part.meta} />
  if (part.name === 'web_search') {
    return <WebSearchCard part={part} defaultExpanded={defaultExpanded} />
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-panel/70">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors duration-100 hover:bg-foreground/[0.03]"
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-[12px] font-medium text-foreground/90">{part.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-tertiary">
          {previewText(part)}
        </span>
        {part.status === 'running' && (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-tertiary" />
        )}
        {part.status === 'ok' && <Check className="size-3.5 shrink-0 text-success" />}
        {part.status === 'error' && <X className="size-3.5 shrink-0 text-destructive" />}
        {part.detail && (
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 text-tertiary transition-transform duration-150',
              expanded && 'rotate-90'
            )}
          />
        )}
      </button>
      {expanded && part.detail && (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap border-t border-border/70 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {part.detail}
        </pre>
      )}
    </div>
  )
}
