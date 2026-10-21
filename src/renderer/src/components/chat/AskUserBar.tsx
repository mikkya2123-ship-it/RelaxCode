import { useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { MessageCircleQuestion } from 'lucide-react'
import type { PendingQuestion } from '@/stores/chat'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function AskUserBar({
  question,
  onReply
}: {
  question: PendingQuestion
  onReply: (text: string) => void
}): JSX.Element {
  const [value, setValue] = useState('')
  const t = useT()

  const submit = (): void => {
    const trimmed = value.trim()
    if (!trimmed) return
    setValue('')
    onReply(trimmed)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-2.5 shadow-xs">
      <div className="flex items-center gap-1.5 text-[12px] font-medium">
        <MessageCircleQuestion className="size-3.5 text-muted-foreground" />
        {t('chat.question.title')}
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed">{question.question}</p>
      {question.options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {question.options.map((option) => (
            <Button key={option} variant="default" size="sm" onClick={() => onReply(option)}>
              {option}
            </Button>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.question.placeholder')}
          autoFocus
        />
        <Button variant="primary" size="default" onClick={submit} disabled={!value.trim()}>
          {t('chat.question.send')}
        </Button>
      </div>
    </div>
  )
}
