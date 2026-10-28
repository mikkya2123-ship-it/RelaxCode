import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  CircleAlert,
  History,
  ListEnd,
  Loader2,
  MoonStar,
  MoreHorizontal,
  Paperclip,
  PencilLine,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Square,
  Trash2,
  X,
  Zap
} from 'lucide-react'
import type { ChatMode } from '@shared/ipc'
import { ATTACHMENT_LIMITS, type AttachmentRef } from '@shared/attachments'
import { LOOPS_BEFORE_OFF } from '@shared/model-memory'
import { useUiStore } from '@/stores/ui'
import { useChatStore, type AttachmentPart } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { toast } from '@/stores/toast'
import { useT, useTranslateError } from '@/lib/i18n'
import { catalogForBaseUrl } from '@/lib/provider-catalog'
import { createPendingAttachment, processAttachment } from '@/lib/attachments'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ProviderLogo } from '@/components/ui/provider-logo'
import { ModelIcon } from '@/components/ui/model-icon'
import { MarqueeText } from '@/components/ui/marquee-text'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ToolCallCard } from '@/components/chat/ToolCallCard'
import { AttachmentChip, AttachmentStrip } from '@/components/chat/AttachmentStrip'
import { WebSourcesFooter } from '@/components/chat/WebSearchCard'
import { Markdown } from '@/components/chat/Markdown'
import { ReasoningCard } from '@/components/chat/ReasoningCard'
import { ContextMeter } from '@/components/chat/ContextMeter'
import { ThinkingMenu } from '@/components/chat/ThinkingMenu'
import { TodoPanel } from '@/components/chat/TodoPanel'
import { ProcessPanel } from '@/components/chat/ProcessPanel'
import { ApprovalBar } from '@/components/chat/ApprovalBar'
import { AskUserBar } from '@/components/chat/AskUserBar'
import { cn } from '@/lib/utils'

const MODES: ChatMode[] = ['chat', 'agent', 'plan']

/** Local time of a message, 24-hour, without seconds. */
const formatTime = (at: number): string =>
  new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

const iconButton =
  'rounded-md p-1 text-tertiary transition-colors duration-100 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-tertiary'

export function ChatPanel(): JSX.Element {
  const open = useUiStore((s) => s.chatOpen)
  const openSettings = useUiStore((s) => s.openSettings)
  const messages = useChatStore((s) => s.messages)
  const streaming = useChatStore((s) => s.streaming)
  const mode = useChatStore((s) => s.mode)
  const setMode = useChatStore((s) => s.setMode)
  const thinking = useChatStore((s) => s.thinking)
  const setThinking = useChatStore((s) => s.setThinking)
  const todos = useChatStore((s) => s.todos)
  const processes = useChatStore((s) => s.processes)
  const pendingApproval = useChatStore((s) => s.pendingApproval)
  const pendingQuestion = useChatStore((s) => s.pendingQuestion)
  const notice = useChatStore((s) => s.notice)
  const contextTokens = useChatStore((s) => s.contextTokens)
  const saved = useChatStore((s) => s.saved)
  const send = useChatStore((s) => s.send)
  const stop = useChatStore((s) => s.stop)
  const enqueue = useChatStore((s) => s.enqueue)
  const queueAction = useChatStore((s) => s.queueAction)
  const steer = useChatStore((s) => s.steer)
  const togglePause = useChatStore((s) => s.togglePause)
  const toggleNight = useChatStore((s) => s.toggleNight)
  const queue = useChatStore((s) => s.queue)
  const paused = useChatStore((s) => s.paused)
  const night = useChatStore((s) => s.night)
  const stopProcess = useChatStore((s) => s.stopProcess)
  const respondApproval = useChatStore((s) => s.respondApproval)
  const replyQuestion = useChatStore((s) => s.replyQuestion)
  const chats = useChatStore((s) => s.chats)
  const activeChatId = useChatStore((s) => s.activeChatId)
  const newChat = useChatStore((s) => s.newChat)
  const selectChat = useChatStore((s) => s.selectChat)
  const deleteChat = useChatStore((s) => s.deleteChat)
  const model = useSettingsStore((s) => s.settings?.model ?? null)
  const save = useSettingsStore((s) => s.save)
  const models = useSettingsStore((s) => s.models)
  const modelsState = useSettingsStore((s) => s.modelsState)
  const modelsError = useSettingsStore((s) => s.modelsError)
  const loadModels = useSettingsStore((s) => s.loadModels)
  const ui = useSettingsStore((s) => s.settings?.ui)
  const chatSettings = useSettingsStore((s) => s.settings?.chat)
  const tokenSaving = useSettingsStore((s) => s.settings?.agent.tokenSaving ?? 'off')
  // The logo of the provider the models come from; stable by reference.
  const providerEntry = useSettingsStore((s) => catalogForBaseUrl(s.settings?.baseUrl))
  // What the endpoint says about the picked model (reasoning support, mostly).
  const modelInfo = models.find((entry) => entry.id === model)
  const chatWidth = ui?.chatWidth ?? 384
  const sendOnEnter = chatSettings?.sendOnEnter ?? true
  const autoScroll = chatSettings?.autoScroll ?? true
  const [draft, setDraft] = useState('')
  /** Files waiting to go out with the next message, alongside their shells. */
  const [draftAttachments, setDraftAttachments] = useState<Array<{ file: File; attachment: AttachmentRef }>>([])
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [modelOpen, setModelOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const modelListRef = useRef<HTMLDivElement>(null)
  const t = useT()
  const translateError = useTranslateError()

  const activeChat = chats.find((chat) => chat.id === activeChatId)
  const activeTitle = activeChat?.title || t('chat.newChat')
  // The main process answers one conversation at a time.
  const streamsElsewhere = !streaming && chats.some((chat) => chat.streaming)
  const onlyEmptyChat = chats.length === 1 && messages.length === 0

  useEffect(() => {
    if (!autoScroll) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, todos, processes, pendingApproval, pendingQuestion, activeChatId, autoScroll])

  // Warm the model list as soon as a connection is known, so the picker opens
  // with its items already there instead of growing under the cursor.
  const connectionKey = useSettingsStore((s) =>
    s.settings ? `${s.settings.activeProviderId}|${s.settings.baseUrl}|${s.settings.hasApiKey}` : ''
  )
  useEffect(() => {
    if (connectionKey) void loadModels()
  }, [connectionKey, loadModels])

  // With a long list the sheet opens at the model in use, not at the first one.
  useEffect(() => {
    if (!modelOpen) return
    const timer = window.setTimeout(() => {
      modelListRef.current
        ?.querySelector('[data-current="true"]')
        ?.scrollIntoView({ block: 'nearest' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [modelOpen, models])

  let noticeText: string | null = null
  let noticeWarning = false
  if (notice) {
    switch (notice.kind) {
      case 'text-call-fallback':
        noticeText = t('chat.notice.textCall', { tools: notice.tools.join(', ') })
        break
      case 'no-tool-calls':
        noticeText = t('chat.notice.noToolCalls')
        noticeWarning = true
        break
      case 'unverified-result':
        noticeText = t('chat.notice.unverified')
        noticeWarning = true
        break
      case 'no-answer':
        noticeText = t(
          notice.reason === 'step-limit' ? 'chat.notice.noAnswerLimit' : 'chat.notice.noAnswerEmpty',
          { steps: notice.steps }
        )
        noticeWarning = true
        break
      case 'night-limit':
        noticeText = t(
          notice.reason === 'tokens' ? 'chat.notice.nightTokens' : 'chat.notice.nightTimeout'
        )
        noticeWarning = true
        break
      case 'param-dropped':
        noticeText = t(
          notice.param === 'reasoning'
            ? 'chat.notice.paramDroppedReasoning'
            : notice.param === 'sampling'
              ? 'chat.notice.paramDroppedSampling'
              : 'chat.notice.paramDroppedOther'
        )
        noticeWarning = true
        break
      case 'image-dropped':
        noticeText = t('chat.notice.imageDropped')
        noticeWarning = true
        break
      case 'thinking-loop':
        noticeText = t(
          notice.loops >= LOOPS_BEFORE_OFF
            ? 'chat.notice.thinkingLoopOff'
            : 'chat.notice.thinkingLoopLowered',
          { n: notice.repeats }
        )
        noticeWarning = true
        break
      case 'thinking-lowered':
        noticeText = t('chat.notice.thinkingLowered', {
          loops: notice.loops,
          from: t(`chat.thinking.${notice.from}` as 'chat.thinking.off'),
          to: t(`chat.thinking.${notice.to}` as 'chat.thinking.off')
        })
        break
      case 'rate-limit-retry':
      case 'server-retry':
        noticeText = t(
          notice.kind === 'rate-limit-retry' ? 'chat.notice.rateLimit' : 'chat.notice.serverRetry',
          { s: notice.seconds, n: notice.attempt, max: notice.maxAttempts }
        )
        break
    }
  }

  // Without this, a file dropped anywhere outside the composer would navigate
  // the window to the file itself. Files are only accepted by the composer.
  useEffect(() => {
    const swallow = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    window.addEventListener('dragover', swallow)
    window.addEventListener('drop', swallow)
    return () => {
      window.removeEventListener('dragover', swallow)
      window.removeEventListener('drop', swallow)
    }
  }, [])

  /** Files join the draft as chips; the bytes are decoded while the user types. */
  const addFiles = (files: ArrayLike<File>): void => {
    const all = Array.from(files)
    if (all.length === 0) return
    const room = ATTACHMENT_LIMITS.maxCount - draftAttachments.length
    if (room <= 0) {
      toast(t('chat.attach.tooMany', { n: ATTACHMENT_LIMITS.maxCount }))
      return
    }
    const incoming = all.slice(0, room)
    if (incoming.length < all.length) toast(t('chat.attach.tooMany', { n: ATTACHMENT_LIMITS.maxCount }))
    const shells = incoming.map((file) => ({ file, attachment: createPendingAttachment(file) }))
    setDraftAttachments((prev) => [...prev, ...shells])
    for (const shell of shells) {
      if (shell.attachment.status === 'error') continue
      void processAttachment(shell.attachment, shell.file).then((resolved) => {
        setDraftAttachments((prev) =>
          prev.map((item) => (item.attachment.id === resolved.id ? { ...item, attachment: resolved } : item))
        )
      })
    }
  }

  const removeAttachment = (id: string): void => {
    setDraftAttachments((prev) => prev.filter((item) => item.attachment.id !== id))
  }

  const readyAttachments = draftAttachments
    .filter((item) => item.attachment.status === 'ready')
    .map((item) => item.attachment)
  // A chip that is still decoding, or one that failed, holds the send: the
  // user should see which files are actually about to reach the model.
  const attachmentsBusy = draftAttachments.some((item) => item.attachment.status !== 'ready')

  const handleSend = (): void => {
    if (streaming || streamsElsewhere || pendingApproval || pendingQuestion) return
    if (!model) {
      openSettings()
      return
    }
    // Enter and the button must agree: a chip still decoding or failed holds
    // the send until it is ready or removed.
    if (attachmentsBusy) return
    const text = draft
    if (!text.trim() && readyAttachments.length === 0) return
    setDraft('')
    setDraftAttachments([])
    void send(text, undefined, readyAttachments)
  }

  /** Mid-run input: interrupt the agent with this message at the next step. */
  const handleSteer = (): void => {
    const text = draft
    if (!text.trim() || !streaming) return
    setDraft('')
    void steer(text).then((injected) => {
      // The run can end between the click and the call — queue it instead.
      if (!injected) enqueue(text)
    })
  }

  const handleEnqueue = (): void => {
    const text = draft
    if (!text.trim()) return
    setDraft('')
    enqueue(text)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    // Either Enter sends and Ctrl+Enter breaks the line, or the other way round.
    if (sendOnEnter || event.ctrlKey || event.metaKey) {
      event.preventDefault()
      if (streaming) handleSteer()
      else handleSend()
    }
  }

  const handlePickModel = (id: string): void => {
    void save({ model: id }).then((result) => {
      if (!result.ok) toast(t('chat.model.saveFailed'), result.error, 'error')
    })
  }

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
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            <div className="flex flex-col gap-4">
              {messages.map((message) =>
                message.role === 'user' ? (
                  <div key={message.id} className="flex max-w-[85%] flex-col items-end gap-0.5 self-end">
                    {(() => {
                      const attachments = message.parts.filter(
                        (part): part is AttachmentPart => part.kind === 'attachment'
                      )
                      const hasText = message.parts.some((part) => part.kind === 'text' && part.text !== '')
                      return (
                        <>
                          {attachments.length > 0 && <AttachmentStrip attachments={attachments.map((part) => part.attachment)} />}
                          {hasText && (
                            <div className="whitespace-pre-wrap break-words rounded-2xl bg-foreground/[0.06] px-3.5 py-2 text-[13px] leading-relaxed">
                              {message.steered && <Zap className="mb-0.5 ml-auto block size-3 text-amber-500" />}
                              {message.parts
                                .filter((part) => part.kind === 'text')
                                .map((part, index) => (
                                  <span key={index}>{part.kind === 'text' ? part.text : null}</span>
                                ))}
                            </div>
                          )}
                          {message.snapshot && (
                            <button
                              type="button"
                              data-testid="chat-timetravel"
                              title={t('chat.timeTravel.title')}
                              aria-label={t('chat.timeTravel.title')}
                              className={cn(iconButton, 'text-[10px]')}
                              onClick={() => {
                                if (!window.confirm(t('chat.timeTravel.confirm'))) return
                                void window.relaxcode.snapshots.restore(message.snapshot as string).then((result) => {
                                  toast(
                                    result.ok
                                      ? t('chat.timeTravel.done', { n: result.files })
                                      : t('chat.timeTravel.failed')
                                  )
                                })
                              }}
                            >
                              <History className="size-3" />
                              {t('chat.timeTravel.label')}
                            </button>
                          )}
                        </>
                      )
                    })()}
                    {ui?.showTimestamps && message.at !== undefined && (
                      <span className="pr-1 text-[10px] tabular-nums text-tertiary">
                        {formatTime(message.at)}
                      </span>
                    )}
                  </div>
                ) : (
                  <div
                    key={message.id}
                    className="flex w-full flex-col gap-2 text-[13px] leading-relaxed"
                  >
                    {message.parts.map((part, index) =>
                      part.kind === 'text' ? (
                        <Markdown key={index} text={part.text} parts={message.parts} />
                      ) : part.kind === 'reasoning' ? (
                        <ReasoningCard
                          key={`reasoning-${index}`}
                          part={part}
                          live={message.status === 'streaming' && index === message.parts.length - 1}
                          defaultOpen={ui?.reasoningOpen ?? false}
                        />
                      ) : part.kind === 'tool' ? (
                        <ToolCallCard
                          key={`${part.callId}-${index}`}
                          part={part}
                          defaultExpanded={ui?.toolDetailsOpen ?? false}
                        />
                      ) : null
                    )}
                    <WebSourcesFooter parts={message.parts} />
                    {message.status === 'streaming' && message.parts.length === 0 && (
                      <p className="text-tertiary">
                        <span className="animate-pulse">•••</span>
                      </p>
                    )}
                    {message.status === 'error' && (
                      <p
                        data-testid="chat-error"
                        className="whitespace-pre-wrap break-words text-destructive"
                      >
                        {translateError(message.error ?? '')}
                      </p>
                    )}
                    {message.status === 'done' &&
                      message.parts.length > 0 &&
                      ((ui?.showTimestamps && message.at !== undefined) ||
                        (ui?.showTokenUsage &&
                          (message.promptTokens !== undefined ||
                            message.completionTokens !== undefined))) && (
                        <div className="flex items-center gap-2 text-[10px] tabular-nums text-tertiary">
                          {ui?.showTimestamps && message.at !== undefined && (
                            <span>{formatTime(message.at)}</span>
                          )}
                          {ui?.showTokenUsage && (
                            <span>
                              {message.promptTokens || message.completionTokens
                                ? t('chat.tokens', {
                                    input: message.promptTokens ?? 0,
                                    output: message.completionTokens ?? 0
                                  })
                                : t('chat.tokens.unknown')}
                            </span>
                          )}
                          {ui?.showTokenUsage &&
                            message.reasoningTokens !== undefined &&
                            message.reasoningTokens > 0 && (
                              <span>
                                {t('chat.reasoning.tokens', { t: message.reasoningTokens })}
                              </span>
                            )}
                        </div>
                      )}
                  </div>
                )
              )}
            </div>
          </div>
        )}

        <div className="flex shrink-0 flex-col gap-2 p-3 pt-0">
          {pendingApproval && (
            <ApprovalBar request={pendingApproval} onDecision={respondApproval} />
          )}
          {pendingQuestion && <AskUserBar question={pendingQuestion} onReply={replyQuestion} />}
          <TodoPanel todos={todos} />
          {ui?.serversPanel !== false && (
            <ProcessPanel processes={processes} onStop={stopProcess} />
          )}

          {noticeText && (
            <p
              data-testid="chat-notice"
              className={cn(
                'flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground',
                noticeWarning && 'text-amber-600 dark:text-amber-500'
              )}
            >
              {noticeWarning ? (
                <CircleAlert className="size-3 shrink-0" />
              ) : (
                <Loader2 className="size-3 shrink-0 animate-spin" />
              )}
              {noticeText}
            </p>
          )}

          {queue.length > 0 && (
            <div className="space-y-1 rounded-[12px] border border-border bg-card/60 p-1.5" data-testid="chat-queue">
              <p className="px-1.5 pt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {t('chat.queue.title', { n: queue.length })}
              </p>
              {queue.map((item, index) => (
                <div key={item.id} className="flex items-center gap-1 rounded-md bg-background px-1.5 py-1">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-foreground" title={item.text}>
                    {item.text}
                  </span>
                  <button
                    type="button"
                    aria-label={t('chat.queue.up')}
                    className={cn(iconButton)}
                    disabled={index === 0}
                    onClick={() => queueAction(item.id, 'up')}
                  >
                    <ArrowUp className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('chat.queue.down')}
                    className={cn(iconButton)}
                    disabled={index === queue.length - 1}
                    onClick={() => queueAction(item.id, 'down')}
                  >
                    <ArrowDown className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('chat.queue.edit')}
                    className={cn(iconButton)}
                    onClick={() => {
                      setDraft(item.text)
                      queueAction(item.id, 'remove')
                    }}
                  >
                    <PencilLine className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('chat.queue.remove')}
                    className={cn(iconButton)}
                    onClick={() => queueAction(item.id, 'remove')}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div
            className={cn(
              'composer-frame relative rounded-[12px] border border-input bg-card shadow-xs transition-colors duration-150 focus-within:border-ring',
              dragOver && 'border-ring border-dashed'
            )}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes('Files')) {
                event.preventDefault()
                setDragOver(true)
              }
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false)
            }}
            onDrop={(event) => {
              if (event.dataTransfer.files.length === 0) return
              event.preventDefault()
              setDragOver(false)
              addFiles(event.dataTransfer.files)
            }}
          >
            {/* Focus flash: a light along the top edge that slides down a bit
                and melts away. */}
            <span className="composer-flash" aria-hidden="true" />
            {draftAttachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-2 pt-2" data-testid="chat-attachments-draft">
                {draftAttachments.map(({ attachment }) => (
                  <div
                    key={attachment.id}
                    className="group/attach relative"
                    data-status={attachment.status}
                    title={attachment.status === 'error' ? attachment.error : attachment.name}
                  >
                    <AttachmentChip
                      attachment={attachment}
                      className={cn(
                        'h-12 w-12 rounded-md',
                        attachment.status === 'error' && 'border-destructive/60 opacity-60'
                      )}
                    />
                    {attachment.status === 'pending' && (
                      <span className="absolute inset-0 flex items-center justify-center rounded-md bg-background/60">
                        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={t('chat.attach.remove')}
                      className="absolute -right-1 -top-1 rounded-full border border-border bg-card p-0.5 text-muted-foreground opacity-0 shadow-xs transition-opacity duration-100 hover:text-foreground focus-visible:opacity-100 group-hover/attach:opacity-100"
                      onClick={() => removeAttachment(attachment.id)}
                    >
                      <X className="size-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {dragOver && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[12px] border border-dashed border-ring bg-card/85 text-[11px] text-muted-foreground">
                {t('chat.attach.drop')}
              </div>
            )}
            <Textarea
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={(event) => {
                const files = event.clipboardData?.files
                if (files && files.length > 0) {
                  event.preventDefault()
                  addFiles(files)
                }
              }}
              placeholder={
                pendingApproval
                  ? t('chat.approval.awaiting')
                  : streaming
                    ? paused
                      ? t('chat.pausedPlaceholder')
                      : t('chat.steerPlaceholder')
                    : streamsElsewhere
                      ? t('chat.busy')
                      : t('chat.placeholder')
              }
              className="max-h-[200px] min-h-[56px] resize-none border-0 bg-transparent shadow-none focus-visible:border-0 focus-visible:ring-0"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                {/* The model chip and the mode switch only shape the next run,
                    so while one is streaming they give their room to the
                    steering buttons instead of squeezing them out. */}
                {!streaming && (
                <DropdownMenu
                  open={modelOpen}
                  onOpenChange={(next) => {
                    setModelOpen(next)
                    if (next) void loadModels()
                  }}
                >
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      data-testid="chat-model"
                      title={model ?? t('chat.modelNotSelected')}
                      className={cn(
                        // Shrinks with the panel — the name truncates, the
                        // chevron stays — so the icon buttons to the right
                        // never get pushed under the send button.
                        'flex w-[160px] min-w-[56px] shrink items-center gap-1 rounded-md border border-input bg-card px-1.5 py-1 text-[11px] text-muted-foreground transition-colors duration-150 hover:border-ring/60 hover:text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
                        // While the list is open the chip and the panel read as one sheet.
                        modelOpen && 'rounded-t-none'
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-left">
                        {model ?? t('chat.modelNotSelected')}
                      </span>
                      <ChevronDown
                        className={cn(
                          'size-3 shrink-0 transition-transform duration-150',
                          modelOpen && 'rotate-180'
                        )}
                      />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    // The sheet is anchored by its own height, so a list that
                    // changes size while open has to be measured again.
                    key={`models-${models.length}`}
                    align="start"
                    side="top"
                    sideOffset={-1}
                    collisionPadding={12}
                    // The chip shrinks with the panel, so the sheet follows it
                    // instead of a fixed width — together they read as one.
                    className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-0 rounded-t-xl rounded-b-none border-b-0 p-0 shadow-none"
                  >
                    {/* The list is capped — a long model list scrolls instead of
                        covering the window, and the actions stay reachable. */}
                    <div
                      ref={modelListRef}
                      className="max-h-[240px] overflow-y-auto overscroll-contain p-1"
                    >
                      <DropdownMenuLabel className="flex items-center gap-1.5 px-2 text-[11px] font-normal text-tertiary">
                        {providerEntry && <ProviderLogo id={providerEntry.id} className="size-3.5" />}
                        {t('chat.model.choose')}
                      </DropdownMenuLabel>
                      {modelsState === 'loading' && (
                        <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-tertiary">
                          <Loader2 className="size-3.5 shrink-0 animate-spin" />
                          {t('chat.models.loading')}
                        </div>
                      )}
                      {modelsState !== 'loading' && models.length === 0 && (
                        <div className="px-2 py-1.5 text-[11px] text-tertiary">
                          <span className="block">{t('chat.models.empty')}</span>
                          {modelsState === 'error' && modelsError && (
                            <span className="mt-0.5 block break-all text-destructive">
                              {translateError(modelsError)}
                            </span>
                          )}
                        </div>
                      )}
                      {models.map((entry) => (
                        <DropdownMenuItem
                          key={entry.id}
                          data-current={entry.id === model ? 'true' : undefined}
                          onSelect={() => handlePickModel(entry.id)}
                          className={cn(
                            'gap-1.5 px-2 py-1.5 text-[12px]',
                            entry.id === model && 'bg-accent text-foreground'
                          )}
                          title={entry.tools ? t('chat.model.tools', { id: entry.id }) : entry.id}
                        >
                          <ModelIcon id={entry.id} />
                          <MarqueeText className="min-w-0 flex-1">{entry.id}</MarqueeText>
                          {entry.free && (
                            <Badge variant="success" className="shrink-0">
                              {t('chat.model.free')}
                            </Badge>
                          )}
                        </DropdownMenuItem>
                      ))}
                    </div>
                    <div className="p-1">
                      <DropdownMenuItem
                        onSelect={() => void loadModels(true)}
                        className="gap-1.5 px-2 text-[12px]"
                      >
                        <RefreshCw className="size-3 shrink-0" />
                        <span className="truncate">{t('chat.models.refresh')}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => openSettings()}
                        className="gap-1.5 px-2 text-[12px]"
                      >
                        <Settings className="size-3 shrink-0" />
                        <span className="truncate">{t('chat.settings.open')}</span>
                      </DropdownMenuItem>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
                )}

                {!streaming && (
                <div
                  data-testid="chat-modes"
                  className="flex items-center gap-0.5 rounded-md bg-foreground/[0.05] p-0.5"
                >
                  {MODES.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setMode(item)}
                      className={cn(
                        'rounded-[5px] px-1.5 py-0.5 text-[11px] transition-colors duration-100',
                        item === mode
                          ? 'bg-card text-foreground shadow-xs'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {t(`chat.mode.${item}` as 'chat.mode.chat')}
                    </button>
                  ))}
                </div>
                )}

                <ThinkingMenu
                  level={thinking}
                  info={modelInfo}
                  saving={tokenSaving}
                  live={streaming && thinking !== 'off'}
                  onChange={setThinking}
                />

                {!streaming && (
                  <button
                    type="button"
                    data-testid="chat-attach"
                    title={t('chat.attach.title')}
                    aria-label={t('chat.attach.title')}
                    className={cn(iconButton)}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="size-3.5" />
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(event) => {
                    addFiles(event.target.files ?? [])
                    // So picking the same file twice in a row still fires.
                    event.target.value = ''
                  }}
                />

                <button
                  type="button"
                  data-testid="chat-night"
                  title={t('chat.night.title')}
                  aria-pressed={night}
                  className={cn(
                    'rounded-md p-1 text-tertiary transition-colors duration-100 hover:bg-foreground/[0.06] hover:text-foreground',
                    night && 'bg-amber-500/15 text-amber-500 hover:text-amber-500'
                  )}
                  onClick={toggleNight}
                >
                  <MoonStar className="size-3.5" />
                </button>
              </div>

              {streaming ? (
                <div className="flex shrink-0 items-center gap-1">
                  {/* Rare controls (pause, queue) hide in one quiet menu, so the
                      busy state shows only the two buttons that matter. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        data-testid="chat-more"
                        aria-label={t('chat.more')}
                        title={t('chat.more')}
                        className="rounded-full"
                      >
                        <MoreHorizontal className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" side="top" collisionPadding={12}>
                      <DropdownMenuItem
                        onSelect={togglePause}
                        className="gap-1.5 px-2 text-[12px]"
                      >
                        {paused ? <Play className="size-3.5 shrink-0" /> : <Pause className="size-3.5 shrink-0" />}
                        <span className="truncate">{paused ? t('chat.resume') : t('chat.pause')}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={handleEnqueue}
                        disabled={!draft.trim()}
                        className="gap-1.5 px-2 text-[12px]"
                      >
                        <ListEnd className="size-3.5 shrink-0" />
                        <span className="truncate">{t('chat.enqueue')}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant="primary"
                    size="icon-sm"
                    data-testid="chat-steer"
                    disabled={!draft.trim()}
                    aria-label={t('chat.steer')}
                    title={t('chat.steer.title')}
                    className="rounded-full"
                    onClick={handleSteer}
                  >
                    <Zap className="size-3.5" />
                  </Button>
                  <Button
                    variant="default"
                    size="icon-sm"
                    data-testid="chat-send"
                    aria-label={t('chat.stop')}
                    className="rounded-full"
                    onClick={stop}
                  >
                    <Square className="size-3 fill-current" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="primary"
                  size="icon-sm"
                  data-testid="chat-send"
                  disabled={
                    (!draft.trim() && readyAttachments.length === 0) || attachmentsBusy || streamsElsewhere
                  }
                  aria-label={t('chat.send')}
                  className="shrink-0 rounded-full"
                  onClick={handleSend}
                >
                  <ArrowUp className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
