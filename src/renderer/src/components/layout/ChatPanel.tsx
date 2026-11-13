import { useEffect, useRef, type JSX } from 'react'
import {
  ChevronDown,
  Loader2,
  Plus,
  Trash2
} from 'lucide-react'
import { useUiStore } from '@/stores/ui'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { MessageRow } from '@/components/chat/MessageRow'
import { ContextMeter } from '@/components/chat/ContextMeter'
import { TodoPanel } from '@/components/chat/TodoPanel'
import { ProcessPanel } from '@/components/chat/ProcessPanel'
import { ChatComposer } from '@/components/chat/ChatComposer'
import { cn } from '@/lib/utils'

const iconButton =
  'rounded-md p-1 text-tertiary transition-colors duration-100 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-tertiary'

/**
 * The chat dock of the agent shell: the transcript next to the editor, with the
 * conversation switcher in its header. The input itself lives in
 * `ChatComposer`, which the full-window chat screen shares.
 */
export function ChatPanel(): JSX.Element {
  const open = useUiStore((s) => s.chatOpen)
  const openSettings = useUiStore((s) => s.openSettings)
  const messages = useChatStore((s) => s.messages)
  const streaming = useChatStore((s) => s.streaming)
  const todos = useChatStore((s) => s.todos)
  const processes = useChatStore((s) => s.processes)
  const pendingApproval = useChatStore((s) => s.pendingApproval)
  const pendingQuestion = useChatStore((s) => s.pendingQuestion)
  const contextTokens = useChatStore((s) => s.contextTokens)
  const saved = useChatStore((s) => s.saved)
  const stopProcess = useChatStore((s) => s.stopProcess)
  const chats = useChatStore((s) => s.chats)
  const activeChatId = useChatStore((s) => s.activeChatId)
  const newChat = useChatStore((s) => s.newChat)
  const selectChat = useChatStore((s) => s.selectChat)
  const deleteChat = useChatStore((s) => s.deleteChat)
  const model = useSettingsStore((s) => s.settings?.model ?? null)
  const models = useSettingsStore((s) => s.models)
  const ui = useSettingsStore((s) => s.settings?.ui)
  const chatSettings = useSettingsStore((s) => s.settings?.chat)
  // What the endpoint says about the picked model (reasoning support, mostly).
  const modelInfo = models.find((entry) => entry.id === model)
  const chatWidth = ui?.chatWidth ?? 384
  const autoScroll = chatSettings?.autoScroll ?? true
  const scrollRef = useRef<HTMLDivElement>(null)
  const t = useT()

  const activeChat = chats.find((chat) => chat.id === activeChatId)
  const activeTitle = activeChat?.title || t('chat.newChat')
  const onlyEmptyChat = chats.length === 1 && messages.length === 0

  // Auto-scroll once per frame: the store coalesces stream deltas, and writing
  // scrollTop for every token would force a layout per token.
  useEffect(() => {
    if (!autoScroll) return
    const el = scrollRef.current
    if (!el) return
    const frame = window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
    return () => window.cancelAnimationFrame(frame)
  }, [messages, todos, processes, pendingApproval, pendingQuestion, activeChatId, autoScroll])

  return (
    <aside
      style={{ width: open ? chatWidth : 0 }}
      className={cn(
        'relative h-full shrink-0 overflow-hidden bg-background transition-[width] duration-200 ease-out'
      )}
      aria-hidden={!open}
    >
      <div className="flex h-full flex-col" style={{ width: chatWidth }}>
        <div className="flex h-9 shrink-0 items-center gap-1 px-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="chat-list"
                title={t('chat.newChat')}
                className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-muted-foreground transition-colors duration-100 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                <span className="max-w-[190px] truncate">{activeTitle}</span>
                <ChevronDown className="size-3 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[300px]">
              <DropdownMenuItem onSelect={() => newChat()} className="gap-2 text-[12px]">
                <Plus className="size-3.5" />
                {t('chat.newChat')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {chats.map((chat) => (
                <DropdownMenuItem
                  key={chat.id}
                  onSelect={() => selectChat(chat.id)}
                  className="gap-2 text-[12px]"
                >
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      chat.id === activeChatId && 'font-medium text-foreground'
                    )}
                  >
                    {chat.title || t('chat.newChat')}
                  </span>
                  {chat.streaming && (
                    <Loader2 className="size-3 shrink-0 animate-spin text-tertiary" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="ml-auto flex items-center gap-0.5">
            <ContextMeter
              used={contextTokens ?? 0}
              limit={modelInfo?.contextLength ?? null}
              saved={saved}
              streaming={streaming}
            />
            <button
              type="button"
              data-testid="chat-delete"
              title={t('chat.deleteChat')}
              aria-label={t('chat.deleteChat')}
              disabled={onlyEmptyChat}
              onClick={() => deleteChat(activeChatId)}
              className={cn(iconButton, 'hover:text-destructive')}
            >
              <Trash2 className="size-3.5" />
            </button>
            <button
              type="button"
              data-testid="chat-new"
              title={t('chat.newChat')}
              aria-label={t('chat.newChat')}
              onClick={() => newChat()}
              className={iconButton}
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        </div>

        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8">
            <p className="max-w-[260px] text-center text-[13px] leading-relaxed text-muted-foreground">
              {t('chat.empty')}
            </p>
            {!model && (
              <Button variant="default" size="sm" onClick={openSettings}>
                {t('chat.configure')}
              </Button>
            )}
          </div>
        ) : (
          <div ref={scrollRef} data-testid="chat-scroll" className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            <div className="flex flex-col gap-4">
              {messages.map((message) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  showTimestamps={ui?.showTimestamps ?? false}
                  showTokenUsage={ui?.showTokenUsage ?? false}
                  reasoningOpen={ui?.reasoningOpen ?? false}
                  toolDetailsOpen={ui?.toolDetailsOpen ?? false}
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex shrink-0 flex-col gap-2 p-3 pt-0">
          <TodoPanel todos={todos} />
          {ui?.serversPanel !== false && (
            <ProcessPanel processes={processes} onStop={stopProcess} />
          )}
          <ChatComposer variant="panel" />
        </div>
      </div>
    </aside>
  )
}
