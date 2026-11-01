import { useState, type JSX } from 'react'
import {
  Bug,
  HandHeart,
  Loader2,
  Mail,
  MessageCircleQuestion,
  Send,
  Smile,
  ThumbsDown
} from 'lucide-react'
import { useT } from '@/lib/i18n'
import type { TKey } from '@shared/i18n'
import { toast } from '@/stores/toast'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/**
 * The feedback dialog: a review, a complaint, a question, a request or a bug
 * report. Submissions are delivered to the maintainer's inbox; the address is
 * deliberately never shown in the interface.
 */

const ENDPOINT = 'https://formsubmit.co/ajax/relaxcodesupp@mail.ru'

const TYPES: Array<{ id: string; label: TKey; icon: JSX.Element }> = [
  { id: 'review', label: 'feedback.type.review', icon: <Smile className="size-3.5" /> },
  { id: 'complaint', label: 'feedback.type.complaint', icon: <ThumbsDown className="size-3.5" /> },
  {
    id: 'question',
    label: 'feedback.type.question',
    icon: <MessageCircleQuestion className="size-3.5" />
  },
  { id: 'request', label: 'feedback.type.request', icon: <HandHeart className="size-3.5" /> },
  { id: 'bug', label: 'feedback.type.bug', icon: <Bug className="size-3.5" /> }
]

const MAX_MESSAGE = 4000

export function FeedbackDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): JSX.Element {
  const t = useT()
  const [type, setType] = useState('review')
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [sending, setSending] = useState(false)

  const close = (): void => onOpenChange(false)
  const filled = message.trim().length > 0

  const submit = async (): Promise<void> => {
    const text = message.trim()
    if (text.length === 0) return
    setSending(true)
    try {
      // Field keys are the row labels the email shows, so they are written in
      // plain language. `_template: box` renders boxes instead of the default
      // blue table — the nicest shell this intermediary can produce.
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          _subject: `RelaxCode — ${t(`feedback.type.${type}` as TKey)}`,
          _template: 'box',
          _captcha: 'false',
          Тип: t(`feedback.type.${type}` as TKey),
          Сообщение: text,
          Контакт: contact.trim() || '—',
          Приложение: navigator.userAgent.split(' ').slice(-4).join(' ')
        })
      })
      if (!response.ok) throw new Error(`http-${response.status}`)
      close()
      setMessage('')
      setContact('')
      toast(t('feedback.sent'), t('feedback.sent.hint'))
    } catch (error) {
      toast(t('feedback.failed'), error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] gap-0 p-6">
        <DialogHeader>
          <DialogTitle className="text-[15px]">{t('feedback.title')}</DialogTitle>
          <DialogDescription className="max-w-[380px]">
            {t('feedback.description')}
          </DialogDescription>
        </DialogHeader>

        <div
          role="radiogroup"
          aria-label={t('feedback.title')}
          className="mt-4 grid grid-cols-5 gap-1.5 rounded-xl border border-input bg-accent/40 p-1"
        >
          {TYPES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={type === item.id}
              onClick={() => setType(item.id)}
              title={t(item.label)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] leading-none transition-all duration-150',
                type === item.id
                  ? 'bg-card text-foreground shadow-xs ring-1 ring-ring/40'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {item.icon}
              <span className="w-full truncate text-center">{t(item.label)}</span>
            </button>
          ))}
        </div>

        <div className="group relative mt-3.5">
          <textarea
            data-slot="textarea"
            value={message}
            onChange={(event) => setMessage(event.target.value.slice(0, MAX_MESSAGE))}
            rows={6}
            maxLength={MAX_MESSAGE}
            placeholder={t('feedback.messagePlaceholder')}
            className="w-full resize-none rounded-xl border border-input bg-card px-3.5 py-3 text-[13px] leading-relaxed text-foreground placeholder:text-tertiary transition-colors focus:border-ring focus:outline-none"
          />
          <span className="pointer-events-none absolute bottom-2.5 right-3 text-[10.5px] tabular-nums text-tertiary">
            {message.length}/{MAX_MESSAGE}
          </span>
        </div>

        <label className="mt-2.5 flex items-center gap-2.5 rounded-xl border border-input bg-card pl-3 pr-1 transition-colors focus-within:border-ring">
          <Mail className="size-3.5 shrink-0 text-tertiary" />
          <input
            value={contact}
            onChange={(event) => setContact(event.target.value.slice(0, 200))}
            maxLength={200}
            placeholder={t('feedback.contactPlaceholder')}
            className="h-10 w-full bg-transparent text-[13px] text-foreground placeholder:text-tertiary focus:outline-none"
          />
        </label>

        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="text-[11px] leading-snug text-tertiary">{t('feedback.private')}</p>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" className="h-8 text-[13px]" onClick={close}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="h-8 gap-1.5 text-[13px]"
              disabled={sending || !filled}
              onClick={() => void submit()}
            >
              {sending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              {t('feedback.send')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
