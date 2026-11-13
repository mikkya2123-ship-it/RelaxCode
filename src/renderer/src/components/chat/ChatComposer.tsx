import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  CircleAlert,
  ListEnd,
  Loader2,
  MoonStar,
  MoreHorizontal,
  Paperclip,
  PencilLine,
  Pause,
  Play,
  RefreshCw,
  Settings,
  Sparkles,
  Square,
  Swords,
  Trash2,
  X,
  Zap
} from 'lucide-react'
import type { ChatMode } from '@shared/ipc'
import { ATTACHMENT_LIMITS, type AttachmentRef } from '@shared/attachments'
import { LOOPS_BEFORE_OFF } from '@shared/model-memory'
import { effectiveSkills, type Skill } from '@shared/skills'
import { useUiStore } from '@/stores/ui'
import { useArenaStore } from '@/stores/arena'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { toast } from '@/stores/toast'
import { useI18nStore, useT } from '@/lib/i18n'
import { catalogForBaseUrl } from '@/lib/provider-catalog'
import { createPendingAttachment, processAttachment } from '@/lib/attachments'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { AttachmentChip } from '@/components/chat/AttachmentStrip'
import { ModelList } from '@/components/chat/ModelList'
import { ThinkingMenu } from '@/components/chat/ThinkingMenu'
import { ApprovalBar } from '@/components/chat/ApprovalBar'
import { AskUserBar } from '@/components/chat/AskUserBar'
import { cn } from '@/lib/utils'

const MODES: ChatMode[] = ['chat', 'agent', 'plan']

const iconButton =
  'rounded-md p-1 text-tertiary transition-colors duration-100 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-tertiary'

interface ChatComposerProps {
  /**
   * `panel` — the narrow dock next to the editor, everything is compact and
   * agent controls (night, arena, steering) are all present.
   * `hero` — the wide centred input of the chat screen, one size larger, with
   * the run controls that only matter to an agent hidden.
   */
  variant?: 'panel' | 'hero'
}

/**
 * The input row every chat surface shares: draft, attachments, the `#` skill
 * picker, the model sheet and the send/steer/stop buttons. The run-state strips
 * that sit right above the input — approval, the agent's question, retry
 * notices and the message queue — belong to it too, so a message can never be
 * typed over a request the user has not answered yet.
 */
export function ChatComposer({ variant = 'panel' }: ChatComposerProps): JSX.Element {
  const hero = variant === 'hero'
  const openSettings = useUiStore((s) => s.openSettings)
  const streaming = useChatStore((s) => s.streaming)
  const mode = useChatStore((s) => s.mode)
  const setMode = useChatStore((s) => s.setMode)
  const thinking = useChatStore((s) => s.thinking)
  const setThinking = useChatStore((s) => s.setThinking)
  const pendingApproval = useChatStore((s) => s.pendingApproval)
  const pendingQuestion = useChatStore((s) => s.pendingQuestion)
  const notice = useChatStore((s) => s.notice)
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
  const respondApproval = useChatStore((s) => s.respondApproval)
  const replyQuestion = useChatStore((s) => s.replyQuestion)
  const chats = useChatStore((s) => s.chats)
  const model = useSettingsStore((s) => s.settings?.model ?? null)
  const save = useSettingsStore((s) => s.save)
  const models = useSettingsStore((s) => s.models)
  const modelsState = useSettingsStore((s) => s.modelsState)
  const modelsError = useSettingsStore((s) => s.modelsError)
  const loadModels = useSettingsStore((s) => s.loadModels)
  const chatSettings = useSettingsStore((s) => s.settings?.chat)
  const tokenSaving = useSettingsStore((s) => s.settings?.agent.tokenSaving ?? 'off')
  // The logo of the provider the models come from; stable by reference.
  const providerEntry = useSettingsStore((s) => catalogForBaseUrl(s.settings?.baseUrl))
  // What the endpoint says about the picked model (reasoning support, mostly).
  const modelInfo = models.find((entry) => entry.id === model)
  const sendOnEnter = chatSettings?.sendOnEnter ?? true
  const skillsSettings = useSettingsStore((s) => s.settings?.skills)
  const skills = useMemo(() => effectiveSkills(skillsSettings), [skillsSettings])
  const locale = useI18nStore((s) => s.locale)
  const t = useT()

  const [draft, setDraft] = useState('')
  // The `#` picker: `skillQuery` is the text typed after `#` (null = closed).
  const [skillQuery, setSkillQuery] = useState<string | null>(null)
  const [skillCursor, setSkillCursor] = useState(0)
  const [pickedSkillId, setPickedSkillId] = useState<string | null>(null)
  /** Files waiting to go out with the next message, alongside their shells. */
  const [draftAttachments, setDraftAttachments] = useState<
    Array<{ file: File; attachment: AttachmentRef }>
  >([])
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [modelOpen, setModelOpen] = useState(false)

  // The main process answers one conversation at a time.
  const streamsElsewhere = !streaming && chats.some((chat) => chat.streaming)

  const pickedSkill = pickedSkillId ? (skills.find((item) => item.id === pickedSkillId) ?? null) : null
  const skillTitle = (skill: Skill): string => (locale === 'en' ? skill.titleEn : skill.title)
  const skillSummary = (skill: Skill): string => (locale === 'en' ? skill.summaryEn : skill.summary)

  // What the `#` menu shows: every enabled skill, narrowed by what was typed.
  const skillMatches = useMemo(() => {
    if (skillQuery === null) return []
    const query = skillQuery.trim().toLowerCase()
    const list =
      query === ''
        ? skills
        : skills.filter((skill) =>
            `${skill.id} ${skill.title} ${skill.titleEn}`.toLowerCase().includes(query)
          )
    return list.slice(0, 6)
  }, [skillQuery, skills])

  // A bare `#` always opens the list; a word that matches nothing closes it, so
  // "тикет #123" never leaves a stray popup over the composer.
  const skillMenuOpen = skillQuery !== null && (skillQuery.trim() === '' || skillMatches.length > 0)

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
      case 'auto-connect':
        noticeText = t('chat.notice.autoConnect', { app: notice.app })
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

  // Warm the model list as soon as a connection is known, so the picker opens
  // with its items already there instead of growing under the cursor.
  const connectionKey = useSettingsStore((s) =>
    s.settings ? `${s.settings.activeProviderId}|${s.settings.baseUrl}|${s.settings.hasApiKey}` : ''
  )
  useEffect(() => {
    if (connectionKey) void loadModels()
  }, [connectionKey, loadModels])

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

  const chooseSkill = (skill: Skill): void => {
    const query = skillQuery ?? ''
    // The `#query` that opened the picker is replaced by the pinned chip.
    setDraft((current) => current.slice(0, Math.max(0, current.length - query.length - 1)).replace(/\s+$/, ''))
    setPickedSkillId(skill.id)
    setSkillQuery(null)
  }

  const onDraftChange = (value: string): void => {
    setDraft(value)
    const match = /(?:^|\s)#([\p{L}\p{N}_-]*)$/u.exec(value)
    setSkillQuery(match ? match[1] : null)
    setSkillCursor(0)
  }

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
    setSkillQuery(null)
    const skillId = pickedSkillId ?? undefined
    setPickedSkillId(null)
    void send(text, undefined, readyAttachments, skillId)
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
    // While the `#` menu is open it owns the arrows, Enter, Tab and Escape.
    if (skillMenuOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        const count = Math.max(1, skillMatches.length)
        setSkillCursor((current) => (current + step + count) % count)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const skill = skillMatches[skillCursor] ?? skillMatches[0]
        if (skill) {
          event.preventDefault()
          chooseSkill(skill)
          return
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setSkillQuery(null)
        return
      }
    }
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
    <div className={cn('flex flex-col gap-2', hero && 'gap-3')}>
      {pendingApproval && <ApprovalBar request={pendingApproval} onDecision={respondApproval} />}
      {pendingQuestion && <AskUserBar question={pendingQuestion} onReply={replyQuestion} />}

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
          hero && 'rounded-[16px] shadow-pop',
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
        {pickedSkill && (
          <div className="flex flex-wrap items-center gap-1.5 px-2 pt-2" data-testid="chat-skill-pinned">
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-panel/70 px-1.5 py-0.5 text-[11px] text-foreground">
              <Sparkles className="size-3 shrink-0 text-primary" />
              {skillTitle(pickedSkill)}
              <button
                type="button"
                aria-label={t('chat.skill.clear')}
                title={t('chat.skill.clear')}
                className="rounded p-0.5 text-tertiary transition-colors hover:text-foreground"
                onClick={() => setPickedSkillId(null)}
              >
                <X className="size-2.5" />
              </button>
            </span>
          </div>
        )}
        {skillMenuOpen && (
          <div
            data-testid="chat-skill-menu"
            className="absolute bottom-full left-2 z-30 mb-1 w-[300px] overflow-hidden rounded-lg border border-border bg-popover shadow-pop"
          >
            <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-tertiary">
              {t('chat.skill.pick')}
            </p>
            {skillMatches.length === 0 && (
              <p className="px-2 pb-2 text-[11px] text-muted-foreground">{t('chat.skill.noMatch')}</p>
            )}
            {skillMatches.map((skill, index) => (
              <button
                key={skill.id}
                type="button"
                data-testid={`chat-skill-option-${skill.id}`}
                // `mousedown` keeps the textarea focused and beats blur.
                onMouseDown={(event) => {
                  event.preventDefault()
                  chooseSkill(skill)
                }}
                onMouseEnter={() => setSkillCursor(index)}
                className={cn(
                  'flex w-full items-start gap-2 px-2 py-1.5 text-left',
                  index === skillCursor ? 'bg-accent' : 'hover:bg-accent/60'
                )}
              >
                <Sparkles className="mt-0.5 size-3 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block truncate text-[11.5px] font-medium text-foreground">
                    {skillTitle(skill)}
                  </span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">
                    {skillSummary(skill)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        <Textarea
          rows={hero ? 3 : 2}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
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
          className={cn(
            'max-h-[200px] resize-none border-0 bg-transparent shadow-none focus-visible:border-0 focus-visible:ring-0',
            hero ? 'min-h-[72px] px-3.5 py-3 text-[14px] leading-relaxed' : 'min-h-[56px]'
          )}
        />
        <div
          className={cn(
            'flex items-center justify-between gap-2 px-2 pb-2',
            hero && 'px-3 pb-2.5'
          )}
        >
          {/* pr-3 keeps the model sheet a touch shorter than the full row. */}
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden pr-3">
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
                      'flex min-w-[56px] flex-1 items-center gap-1 rounded-md border border-input bg-card px-1.5 py-1 text-[11px] text-muted-foreground transition-colors duration-150 hover:border-ring/60 hover:text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
                      hero && 'min-w-0 flex-none px-2 py-1.5 text-[12px]',
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
                  className={cn(
                    'min-w-0 rounded-t-xl rounded-b-none border-b-0 p-0 shadow-none',
                    hero
                      ? 'w-[320px]'
                      : 'w-[var(--radix-dropdown-menu-trigger-width)]'
                  )}
                >
                  {/* The mode lives in the sheet next to the model it applies
                      to — one compact segmented row above the list. In the
                      wide composer the switch is out in the open, so the
                      sheet leaves it out. */}
                  {!hero && (
                    <div className="border-b border-border p-1.5 pb-2">
                      <ModeRow mode={mode} onPick={setMode} />
                    </div>
                  )}
                  {/* The list is capped — a long model list scrolls instead of
                      covering the window, and the actions stay reachable. */}
                  <ModelList
                    models={models}
                    current={model}
                    onPick={handlePickModel}
                    state={modelsState}
                    error={modelsError}
                    providerId={providerEntry?.id}
                  />
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

            {/* The per-run extras hug the right edge, so the model chip can
                stretch as far as the panel allows. */}
            <div className="ml-auto flex items-center gap-0.5">
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

              {!hero && (
                <>
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

                  <button
                    type="button"
                    data-testid="chat-arena"
                    title={t('arena.title')}
                    aria-label={t('arena.title')}
                    className="rounded-md p-1 text-tertiary transition-colors duration-100 hover:bg-foreground/[0.06] hover:text-foreground"
                    onClick={useArenaStore.getState().openArena}
                  >
                    <Swords className="size-3.5" />
                  </button>
                </>
              )}
            </div>
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
                  <DropdownMenuItem onSelect={togglePause} className="gap-1.5 px-2 text-[12px]">
                    {paused ? (
                      <Play className="size-3.5 shrink-0" />
                    ) : (
                      <Pause className="size-3.5 shrink-0" />
                    )}
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
              className={cn('shrink-0 rounded-full', hero && 'size-8')}
              onClick={handleSend}
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/** The three chat modes as one segmented row. */
export function ModeRow({
  mode,
  onPick
}: {
  mode: ChatMode
  onPick: (mode: ChatMode) => void
}): JSX.Element {
  const t = useT()
  return (
    <div
      role="radiogroup"
      data-testid="chat-modes"
      aria-label={t('chat.mode.label')}
      className="grid grid-cols-3 gap-1 rounded-lg bg-foreground/[0.05] p-0.5"
    >
      {MODES.map((item) => (
        <button
          key={item}
          type="button"
          role="radio"
          aria-checked={item === mode}
          onClick={() => onPick(item)}
          className={cn(
            'rounded-[6px] px-1.5 py-1 text-[11.5px] transition-colors duration-100',
            item === mode
              ? 'bg-card text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {t(`chat.mode.${item}` as 'chat.mode.chat')}
        </button>
      ))}
    </div>
  )
}
