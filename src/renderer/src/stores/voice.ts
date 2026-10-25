import { create } from 'zustand'
import { dictationSupported, startDictation } from '@/lib/voice'
import { useI18nStore } from '@/lib/i18n'

/**
 * Push-to-talk state: hold the hotkey (or the mic button) and speak — every
 * finished phrase accumulates here; when listening stops, the composer takes
 * the text into the draft.
 */

interface VoiceState {
  listening: boolean
  /** Recognized phrases so far, joined into one line. */
  text: string
  /** True when this build has no speech backend at all. */
  unsupported: boolean
  start: () => boolean
  stop: () => void
}

let controller: { stop: () => void } | null = null

export const useVoiceStore = create<VoiceState>((set, get) => ({
  listening: false,
  text: '',
  unsupported: !dictationSupported(),

  start: () => {
    if (get().listening || get().unsupported) return false
    const locale = useI18nStore.getState().locale
    const handle = startDictation(
      locale === 'ru' ? 'ru-RU' : 'en-US',
      (phrase) => {
        set((state) => ({ text: state.text === '' ? phrase : `${state.text} ${phrase}` }))
      },
      () => {
        // The backend ended on its own (silence timeout); close the session
        // so the next press starts fresh.
        if (get().listening) get().stop()
      }
    )
    if (!handle) {
      set({ unsupported: true })
      return false
    }
    controller = handle
    set({ listening: true, text: '' })
    return true
  },

  stop: () => {
    controller?.stop()
    controller = null
    set({ listening: false })
  }
}))
