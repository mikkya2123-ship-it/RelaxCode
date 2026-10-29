import { useEffect } from 'react'
import { useChatStore, messageText } from '@/stores/chat'
import { useEditorStore } from '@/stores/editor'
import { toast } from '@/stores/toast'
import { useI18nStore } from '@/lib/i18n'

/**
 * Renderer side of the ui-bridge: everything the main process asks the window
 * to do lands here — toast notifications, opening files, speech, chat export
 * and scheduled prompts arriving as new messages.
 */

export function useUiBridge(): void {
  useEffect(() => {
    const offNotify = window.relaxcode.ui.onNotify(({ title, body }) => {
      toast(title, body)
    })

    const offOpen = window.relaxcode.ui.onOpenFile(({ path, line }) => {
      const name = path.split(/[\\/]/).pop() ?? path
      void useEditorStore.getState().openFile(path, name)
      if (typeof line === 'number' && line > 0) {
        toast(`${name}:${line}`)
      }
    })

    const offSpeak = window.relaxcode.ui.onSpeak(({ text }) => {
      try {
        const utterance = new SpeechSynthesisUtterance(text.slice(0, 2000))
        const locale = useI18nStore.getState().locale
        utterance.lang = locale === 'ru' ? 'ru-RU' : 'en-US'
        window.speechSynthesis.cancel()
        window.speechSynthesis.speak(utterance)
      } catch {
        // Speech synthesis is unavailable; nothing sensible to do.
      }
    })

    const offExport = window.relaxcode.ui.onExportChat(({ replyId, fileName }) => {
      void exportActiveChat(fileName)
        .then((path) => window.relaxcode.ui.reply(replyId, path))
        .catch(() => window.relaxcode.ui.reply(replyId, null))
    })

    const offPrompt = window.relaxcode.ui.onAgentPrompt(({ text }) => {
      void useChatStore.getState().send(text)
    })

    return () => {
      offNotify()
      offOpen()
      offSpeak()
      offExport()
      offPrompt()
    }
  }, [])
}

/** Writes the active conversation to a workspace Markdown file. */
async function exportActiveChat(fileName: string): Promise<string | null> {
  const state = useChatStore.getState()
  const chat = state.chats.find((item) => item.id === state.activeChatId) ?? state.chats[0]
  if (!chat) return null
  const safeName = fileName.replace(/[^\w.\-]+/g, '-').replace(/^-+|-+$/g, '') || 'chat.md'
  const lines: string[] = [`# ${chat.title || 'Chat'}`, '']
  for (const message of chat.messages) {
    const text = messageText(message)
    if (text.trim() === '') continue
    lines.push(message.role === 'user' ? '## 🧑 Пользователь' : '## 🤖 Модель', '', text, '')
  }
  const result = await window.relaxcode.file.write(safeName, `${lines.join('\n')}\n`)
  return result.ok ? safeName : null
}
