import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  Bot,
  ChevronDown,
  FolderOpen,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Settings,
  SquarePen,
  X
} from 'lucide-react'
import { useChatStore, type ChatSession } from '@/stores/chat'
import { useUiStore } from '@/stores/ui'
import { useSettingsStore } from '@/stores/settings'
import { useI18nStore, useT } from '@/lib/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn, basename } from '@/lib/utils'

const DAY = 86_400_000

/** "сегодня" / "5 дн" / "21 окт" — the granularity the list actually needs. */
function relativeDay(at: number, locale: string, t: ReturnType<typeof useT>): string {
  const startOfDay = (value: number): number => {
    const date = new Date(value)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }
  const days = Math.round((startOfDay(Date.now()) - startOfDay(at)) / DAY)
  if (days <= 0) return t('chatScreen.today')
  if (days === 1) return t('chatScreen.yesterday')
  if (days < 7) return t('chatScreen.daysAgo', { n: days })
  return new Date(at).toLocaleDateString(locale === 'en' ? 'en-GB' : 'ru-RU', {
    day: 'numeric',
    month: 'short'
  })
}

/** A run in flight, a failed answer, or a plain finished conversation. */
function chatState(chat: ChatSession): 'live' | 'error' | 'idle' {
  if (chat.streaming) return 'live'
  const last = chat.messages[chat.messages.length - 1]
  return last?.role === 'assistant' && last.status === 'error' ? 'error' : 'idle'
}

/**
 * The left rail of the chat screen: the project the conversation is bound to,
 * a new-task button, a filter over the conversations and the list itself.
 */
export function ChatRail(): JSX.Element {
  const chats = useChatStore((s) => s.chats)
  const activeChatId = useChatStore((s) => s.activeChatId)
  const newChat = useChatStore((s) => s.newChat)
  const selectChat = useChatStore((s) => s.selectChat)
  const workspace = useUiStore((s) => s.workspace)
  const openWorkspace = useUiStore((s) => s.openWorkspace)
  const openRecent = useUiStore((s) => s.openRecent)
  const openSettings = useUiStore((s) => s.openSettings)
  const profileName = useSettingsStore((s) => s.settings?.profile.name ?? '')
  const newChatKey = useSettingsStore((s) => s.settings?.keymap.newChat ?? '')
  const locale = useI18nStore((s) => s.locale)
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  const t = useT()

  // The folder list is kept by the main process; it is only read when the menu
  // is actually opened, so a slow disk never delays the first paint.
  const loadRecent = (): void => {
    void window.relaxcode.workspace
      .recentList()
      .then(setRecent)
      .catch(() => setRecent([]))
  }
  useEffect(loadRecent, [])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    // "Ранее" is a history, so an untouched draft only earns a row while it is
    // the one on screen — otherwise every "new task" would leave an entry.
    const known = chats.filter((chat) => chat.messages.length > 0 || chat.id === activeChatId)
    const list = needle
      ? known.filter((chat) => (chat.title || t('chat.newChat')).toLowerCase().includes(needle))
      : known
    // Newest first, but a chat that is still streaming floats to the top: it is
    // the one the user came back to look at.
    return [...list].sort((a, b) => Number(b.streaming) - Number(a.streaming) || b.createdAt - a.createdAt)
  }, [chats, activeChatId, query, t])

  const initial = profileName.trim().charAt(0).toUpperCase()

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col bg-panel/55">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <DropdownMenu onOpenChange={(open) => open && loadRecent()}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="chat-screen-project"
              className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-transparent bg-foreground/[0.04] px-3 text-left text-[13px] transition-[background-color,border-color] duration-150 hover:border-border/80 hover:bg-foreground/[0.065] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none dark:bg-white/[0.04] dark:hover:bg-white/[0.065]"
            >
              <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">
                {workspace ? basename(workspace.path) : t('chatScreen.noFolder')}
              </span>
              <ChevronDown className="size-3.5 shrink-0 text-tertiary" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[248px]">
            <DropdownMenuItem onSelect={() => void openWorkspace()} className="gap-2 text-[12px]">
              <FolderOpen className="size-3.5 shrink-0" />
              {t('chatScreen.openFolder')}
            </DropdownMenuItem>
            {recent.length > 0 && <DropdownMenuSeparator />}
            {recent.length > 0 && (
              <DropdownMenuLabel className="px-2 py-1 text-[10px] uppercase tracking-wide text-tertiary">
                {t('chatScreen.recentFolders')}
              </DropdownMenuLabel>
            )}
            {recent.slice(0, 8).map((path) => (
              <DropdownMenuItem
                key={path}
                onSelect={() => void openRecent(path)}
                title={path}
                className="gap-2 text-[12px]"
              >
                <FolderOpen className="size-3.5 shrink-0 text-tertiary" />
                <span className="truncate">{basename(path)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="px-3">
        <button
          type="button"
          data-testid="chat-screen-new"
          onClick={() => newChat('chat')}
          className="flex h-10 w-full items-center gap-2.5 rounded-xl bg-primary px-3 text-[13px] font-semibold text-primary-foreground shadow-xs transition-[filter,transform] duration-150 hover:brightness-105 active:translate-y-px active:brightness-95 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-panel focus-visible:outline-none"
        >
          <SquarePen className="size-4 shrink-0" />
          {t('chatScreen.newTask')}
          {newChatKey && (
            <span className="ml-auto rounded-md border border-primary-foreground/20 bg-primary-foreground/10 px-1.5 py-0.5 text-[9.5px] font-medium text-primary-foreground/70">
              {newChatKey}
            </span>
          )}
        </button>
      </div>

      <div className="px-3 pt-3">
        <div className="flex h-9 items-center gap-2 rounded-xl border border-border/70 bg-background/60 px-3 text-tertiary transition-[background-color,border-color,box-shadow] duration-150 focus-within:border-ring/80 focus-within:bg-background focus-within:ring-2 focus-within:ring-ring/20">
          <Search className="size-3.5 shrink-0" />
          <input
            value={query}
            data-testid="chat-screen-search"
            aria-label={t('chatScreen.search')}
            placeholder={t('chatScreen.search')}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-tertiary"
          />
          {query.length > 0 && (
            <button
              type="button"
              aria-label={t('action.close')}
              className="-mr-1 flex size-6 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
              onClick={() => setQuery('')}
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      <p className="px-4 pb-2 pt-5 text-[10px] font-semibold uppercase tracking-[0.12em] text-tertiary">
        {t('chatScreen.recent')}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {visible.length === 0 && (
          <p className="px-2 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
            {query.trim() ? t('chatScreen.noMatches') : t('chatScreen.recentEmpty')}
          </p>
        )}
        {visible.map((chat) => {
          const state = chatState(chat)
          const isActive = chat.id === activeChatId
          return (
            <button
              key={chat.id}
              type="button"
              data-testid={`chat-screen-item-${chat.id}`}
              onClick={() => selectChat(chat.id)}
              aria-current={isActive ? 'page' : undefined}
              title={chat.title || t('chat.newChat')}
              className={cn(
                'group relative mb-0.5 flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12.5px] transition-[background-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:outline-none',
                isActive
                  ? 'bg-foreground/[0.06] text-foreground dark:bg-white/[0.065]'
                  : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground dark:hover:bg-white/[0.04]'
              )}
            >
              <span className={cn('flex size-4 shrink-0 items-center justify-center', isActive ? 'text-foreground/75' : 'text-tertiary/80')}>
                {state === 'live' ? (
                  <Loader2 className="size-3.5 animate-spin text-amber-500" />
                ) : state === 'error' ? (
                  <MessageSquare className="size-3.5 text-destructive/80" />
                ) : (
                  <MessageSquare className="size-3.5" />
                )}
              </span>
              <span className={cn('min-w-0 flex-1 truncate', isActive ? 'font-semibold' : 'font-medium')}>
                {chat.title || t('chat.newChat')}
              </span>
              {/* An agent conversation is marked, so the list says which shell a
                  click will open. */}
              {chat.mode !== 'chat' && (
                <span
                  className="shrink-0 text-tertiary"
                  title={t(`chat.mode.${chat.mode}` as 'chat.mode.agent')}
                >
                  {chat.mode === 'plan' ? (
                    <MessageSquare className="size-3" />
                  ) : (
                    <Bot className="size-3" />
                  )}
                </span>
              )}
              <span className="shrink-0 text-[10px] tabular-nums text-tertiary/90">
                {relativeDay(chat.createdAt, locale, t)}
              </span>
            </button>
          )
        })}
      </div>

      <div className="m-2.5 mt-0 flex items-center gap-2 rounded-xl bg-background/60 p-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-[11.5px] font-bold text-primary-foreground">
          {initial || t('chatScreen.you').charAt(0)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium">
            {profileName.trim() || t('chatScreen.you')}
          </span>
          <span className="block truncate text-[10.5px] text-tertiary">
            {workspace ? basename(workspace.path) : t('chatScreen.noFolder')}
          </span>
        </span>
        <button
          type="button"
          data-testid="chat-screen-settings"
          aria-label={t('titlebar.settings')}
          title={t('titlebar.settings')}
          onClick={openSettings}
          className="flex size-8 items-center justify-center rounded-lg text-tertiary transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <Settings className="size-4" />
        </button>
        <button
          type="button"
          aria-label={t('chatScreen.newTask')}
          title={t('chatScreen.newTask')}
          onClick={() => newChat('chat')}
          className="flex size-8 items-center justify-center rounded-lg text-tertiary transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <Plus className="size-4" />
        </button>
      </div>
    </aside>
  )
}
