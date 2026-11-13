import { useEffect, useRef, type JSX } from 'react'
import { FolderOpen, Loader2 } from 'lucide-react'
import { useChatStore } from '@/stores/chat'
import { useUiStore } from '@/stores/ui'
import { useSettingsStore } from '@/stores/settings'
import { useI18nStore, useT } from '@/lib/i18n'
import { AppMascot } from '@/components/ui/app-logo'
import { MessageRow } from '@/components/chat/MessageRow'
import { ContextMeter } from '@/components/chat/ContextMeter'
import { ChatComposer } from '@/components/chat/ChatComposer'
import { ChatRail } from '@/components/chat-screen/ChatRail'
import { cn, basename } from '@/lib/utils'

/**
 * The chat shell: what the window becomes when the conversation is a
 * conversation and not a project job. The editor, the file tree and the agent's
 * docks are not mounted at all — the screen is one column of talk, with the
 * conversations on the left.
 */
export function ChatScreen(): JSX.Element {
  const messages = useChatStore((s) => s.messages)
  const streaming = useChatStore((s) => s.streaming)
  const contextTokens = useChatStore((s) => s.contextTokens)
  const saved = useChatStore((s) => s.saved)
  const chats = useChatStore((s) => s.chats)
  const activeChatId = useChatStore((s) => s.activeChatId)
  const selectChat = useChatStore((s) => s.selectChat)
  const workspace = useUiStore((s) => s.workspace)
  const openWorkspace = useUiStore((s) => s.openWorkspace)
  const model = useSettingsStore((s) => s.settings?.model ?? null)
  const models = useSettingsStore((s) => s.models)
  const ui = useSettingsStore((s) => s.settings?.ui)
  const chatSettings = useSettingsStore((s) => s.settings?.chat)
  const profileName = useSettingsStore((s) => s.settings?.profile.name ?? '')
  const keymap = useSettingsStore((s) => s.settings?.keymap)
  const locale = useI18nStore((s) => s.locale)
  const scrollRef = useRef<HTMLDivElement>(null)
  const t = useT()

  const empty = messages.length === 0
  const autoScroll = chatSettings?.autoScroll ?? true
  const modelInfo = models.find((entry) => entry.id === model)
  const name = profileName.trim()
  const greeting = name ? t('chatScreen.greetingNamed', { name }) : t('chatScreen.greeting')
  // The newest finished conversations. An untouched draft is the screen itself,
  // not something the user would pick from a list of tasks.
  const recent = chats
    .filter((chat) => chat.id !== activeChatId && chat.messages.length > 0)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 4)

  useEffect(() => {
    if (!autoScroll || empty) return
    const el = scrollRef.current
    if (!el) return
    const frame = window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
    return () => window.cancelAnimationFrame(frame)
  }, [messages, empty, autoScroll])

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden" data-testid="chat-screen">
      <ChatRail />

      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {empty ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10">
            <div className="w-full max-w-[720px]">
              <div className="flex flex-col items-center text-center">
                <AppMascot className="size-20" />
                <h1 className="mt-5 text-[27px] font-semibold tracking-[-0.02em] text-foreground">
                  {greeting}
                </h1>
                <p className="mt-2 max-w-[520px] text-[12.5px] leading-relaxed text-muted-foreground">
                  {t('chatScreen.subtitle')}
                </p>
              </div>

              <div className="mt-6">
                <ChatComposer variant="hero" />
              </div>

              <div className="mt-3 flex items-center gap-3 px-1 text-[11px] text-tertiary">
                <button
                  type="button"
                  onClick={() => void openWorkspace()}
                  className="flex min-w-0 items-center gap-1.5 rounded transition-colors hover:text-foreground"
                >
                  <FolderOpen className="size-3 shrink-0" />
                  <span className="truncate">
                    {workspace ? basename(workspace.path) : t('chatScreen.noFolder')}
                  </span>
                </button>
                {streaming && (
                  <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-500">
                    <Loader2 className="size-3 animate-spin" />
                    {t('chatScreen.working')}
                  </span>
                )}
                {/* The meter has nothing to measure before a model is chosen. */}
                {model && (
                  <span className="ml-auto flex items-center gap-1.5">
                    <ContextMeter
                      used={contextTokens ?? 0}
                      limit={modelInfo?.contextLength ?? null}
                      saved={saved}
                      streaming={streaming}
                    />
                  </span>
                )}
              </div>

              {recent.length > 0 && (
                <div className="mt-9">
                  <p className="px-1 text-[10px] uppercase tracking-wide text-tertiary">
                    {t('chatScreen.recentTasks')}
                  </p>
                  <div className="mt-1">
                    {recent.map((chat) => (
                      <button
                        key={chat.id}
                        type="button"
                        onClick={() => selectChat(chat.id)}
                        title={chat.title || t('chat.newChat')}
                        className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-2 text-left text-[12.5px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                      >
                        <span
                          className={cn(
                            'size-1.5 shrink-0 rounded-full',
                            chat.streaming ? 'bg-amber-500' : 'bg-foreground/20'
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {chat.title || t('chat.newChat')}
                        </span>
                        <span className="shrink-0 text-[10.5px] tabular-nums text-tertiary">
                          {new Date(chat.createdAt).toLocaleDateString(
                            locale === 'en' ? 'en-GB' : 'ru-RU',
                            { day: 'numeric', month: 'short' }
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div ref={scrollRef} data-testid="chat-scroll" className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-6 py-6">
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

            <div className="shrink-0 bg-gradient-to-t from-background via-background to-transparent px-6 pb-2 pt-1">
              <div className="mx-auto w-full max-w-[760px]">
                <ChatComposer variant="hero" />
              </div>
            </div>
          </>
        )}

        <div className="flex shrink-0 items-center justify-center gap-4 px-6 py-1.5 text-[10.5px] text-tertiary">
          <span>{t('chatScreen.hints.send')}</span>
          <span>{t('chatScreen.hints.newline')}</span>
          {keymap?.newChat && (
            <span>{t('chatScreen.hints.newTask', { keys: keymap.newChat })}</span>
          )}
          {keymap?.openSettings && (
            <span>{t('chatScreen.hints.settings', { keys: keymap.openSettings })}</span>
          )}
        </div>
      </main>
    </div>
  )
}
