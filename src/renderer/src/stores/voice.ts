import { create } from 'zustand'
import { recorderSupported, startRecording, type AudioSession } from '@/lib/voice'
import { useI18nStore, translate } from '@/lib/i18n'
import { toast } from './toast'

/**
 * Push-to-talk state: hold the hotkey (or the mic button) and speak; the
 * recording is transcribed by the main process through the provider, and the
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
      toast(translate(useI18nStore.getState().locale, 'chat.voice.denied'))
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
      const result = await window.relaxcode.audio.transcribe(audio)
      if (!result.ok) {
        toast(
          translate(useI18nStore.getState().locale, 'chat.voice.error', { error: result.error ?? '' })
        )
      }
      set({
        transcribing: false,
        ...(result.ok && result.text ? { text: result.text } : {})
      })
    })
  }
}))
