import { memo, type JSX } from 'react'
import { History, Zap } from 'lucide-react'
import type { AttachmentPart, ChatMessage } from '@/stores/chat'
import { useT, useTranslateError } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/toast'
import { AttachmentStrip } from '@/components/chat/AttachmentStrip'
import { WebSourcesFooter } from '@/components/chat/WebSearchCard'
import { Markdown } from '@/components/chat/Markdown'
import { ReasoningCard } from '@/components/chat/ReasoningCard'
import { ToolCallCard } from '@/components/chat/ToolCallCard'
import { WorkingIndicator } from '@/components/chat/WorkingIndicator'
import { SkillChip } from '@/components/chat/SkillChip'

/** Local time of a message, 24-hour, without seconds. */
const formatTime = (at: number): string =>
  new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

const smallButton =
  'rounded-md p-1 text-tertiary transition-colors duration-100 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-tertiary'

interface MessageRowProps {
  message: ChatMessage
  showTimestamps: boolean
  showTokenUsage: boolean
  reasoningOpen: boolean
  toolDetailsOpen: boolean
}

/**
 * One entry of the transcript. Wrapped in `memo` on purpose: a streaming answer
 * replaces only its own message object, so every finished row keeps its props
 * and skips the render (and the markdown parse) for each token that arrives.
 * The row also opts into `content-visibility`, so rows scrolled out of view
 * cost neither layout nor paint.
 */
function MessageRowBase({
  message,
  showTimestamps,
  showTokenUsage,
  reasoningOpen,
  toolDetailsOpen
}: MessageRowProps): JSX.Element {
  const t = useT()
  const translateError = useTranslateError()

  if (message.role === 'user') {
    const attachments = message.parts.filter(
      (part): part is AttachmentPart => part.kind === 'attachment'
    )
    const hasText = message.parts.some((part) => part.kind === 'text' && part.text !== '')
    return (
      <div className="cv-auto flex max-w-[85%] flex-col items-end gap-0.5 self-end">
        {attachments.length > 0 && (
          <AttachmentStrip attachments={attachments.map((part) => part.attachment)} />
        )}
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
            className={cn(smallButton, 'text-[10px]')}
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
        {showTimestamps && message.at !== undefined && (
          <span className="pr-1 text-[10px] tabular-nums text-tertiary">
            {formatTime(message.at)}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="cv-auto flex w-full flex-col gap-2 text-[13px] leading-relaxed">
      {message.skillId && <SkillChip skillId={message.skillId} />}
      {message.parts.map((part, index) =>
        part.kind === 'text' ? (
          <Markdown key={index} text={part.text} parts={message.parts} />
        ) : part.kind === 'reasoning' ? (
          <ReasoningCard
            key={`reasoning-${index}`}
            part={part}
            live={message.status === 'streaming' && index === message.parts.length - 1}
            defaultOpen={reasoningOpen}
          />
        ) : part.kind === 'tool' ? (
          <ToolCallCard
            key={`${part.callId}-${index}`}
            part={part}
            defaultExpanded={toolDetailsOpen}
          />
        ) : null
      )}
      {message.status === 'streaming' && <WorkingIndicator parts={message.parts} />}
      <WebSourcesFooter parts={message.parts} />
      {message.status === 'error' && (
        <p data-testid="chat-error" className="whitespace-pre-wrap break-words text-destructive">
          {translateError(message.error ?? '')}
        </p>
      )}
      {message.status === 'done' &&
        message.parts.length > 0 &&
        ((showTimestamps && message.at !== undefined) ||
          (showTokenUsage &&
            (message.promptTokens !== undefined || message.completionTokens !== undefined))) && (
          <div className="flex items-center gap-2 text-[10px] tabular-nums text-tertiary">
            {showTimestamps && message.at !== undefined && <span>{formatTime(message.at)}</span>}
            {showTokenUsage && (
              <span>
                {message.promptTokens || message.completionTokens
                  ? t('chat.tokens', {
                      input: message.promptTokens ?? 0,
                      output: message.completionTokens ?? 0
                    })
                  : t('chat.tokens.unknown')}
              </span>
            )}
            {showTokenUsage &&
              message.reasoningTokens !== undefined &&
              message.reasoningTokens > 0 && (
                <span>{t('chat.reasoning.tokens', { t: message.reasoningTokens })}</span>
              )}
          </div>
        )}
    </div>
  )
}

export const MessageRow = memo(MessageRowBase)
