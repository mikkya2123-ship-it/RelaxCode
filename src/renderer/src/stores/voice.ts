import { create } from 'zustand'
import { recorderSupported, startRecording, type AudioSession } from '@/lib/voice'
import { transcribeLocally } from '@/lib/local-stt'
import { useI18nStore, translate } from '@/lib/i18n'
import { toast } from './toast'

/**
 * Push-to-talk state: hold the hotkey (or the mic button) and speak. The
 * recording is transcribed by whichever works: a configured provider with
 * audio support first, then Whisper running locally inside the app. The
 * finished text lands in the composer draft.
 */

interface VoiceState {
  /** The microphone is being recorded. */
  listening: boolean
  /** Recording done; the audio is being transcribed. */
  transcribing: boolean
  /** The recognized text, ready for the composer to swallow. */
  text: string
  /** True when this build cannot record at all. */
  unsupported: boolean
  start: () => Promise<void>
  stop: () => void
}

let session: AudioSession | null = null

const say = (key: string): void => {
  toast(translate(useI18nStore.getState().locale, key as 'chat.voice.ready'))
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  listening: false,
  transcribing: false,
  text: '',
  unsupported: !recorderSupported(),

  start: async () => {
    if (get().listening || get().transcribing || get().unsupported) return
    try {
      session = await startRecording()
      set({ listening: true, text: '' })
    } catch {
      say('chat.voice.denied')
    }
  },

  stop: () => {
    if (!get().listening || !session) {
      session = null
      set({ listening: false })
      return
    }
    const current = session
    session = null
    set({ listening: false, transcribing: true })
    void current.stop().then(async (audio) => {
      if (!audio || audio.byteLength < 512) {
        set({ transcribing: false })
        return
      }
      const finish = (text: string): void => set({ transcribing: false, ...(text ? { text } : {}) })
      const locale = () => useI18nStore.getState().locale

      // 1) Any configured provider that can transcribe audio.
      const result = await window.relaxcode.audio.transcribe(audio).catch(() => null)
      if (result?.ok && result.text) return finish(result.text)

      // 2) Whisper inside the app: works offline after a one-time download.
      let localError: string | null = null
      try {
        say('chat.voice.downloading')
        const text = await transcribeLocally(audio, (key) => say(key))
        if (text !== '') return finish(text)
      } catch (error) {
        localError = (error instanceof Error ? error.message : String(error)).slice(0, 140)
      }
      // The honest ending: which of the two roads failed and why.
      if (localError) {
        toast(translate(locale(), 'chat.voice.localError', { error: localError }))
      } else {
        toast(translate(locale(), 'chat.voice.error', { error: result?.error ?? '' }))
      }
      finish('')
    })
  }
}))
