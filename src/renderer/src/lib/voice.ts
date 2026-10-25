/**
 * Dictation via the Web Speech API. In Electron this depends on the bundled
 * Chromium having a speech backend; when it does not, `startDictation`
 * reports unsupported and the UI says so honestly instead of pretending.
 */

interface RecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}

type RecognitionCtor = new () => RecognitionLike

function recognitionCtor(): RecognitionCtor | null {
  const holder = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return holder.SpeechRecognition ?? holder.webkitSpeechRecognition ?? null
}

export function dictationSupported(): boolean {
  return recognitionCtor() !== null
}

/**
 * Listens until `stop()` is called; every finished phrase is handed to
 * `onPhrase`. Returns null when speech recognition is unavailable.
 */
export function startDictation(lang: string, onPhrase: (text: string) => void, onEnd?: () => void): { stop: () => void } | null {
  const Ctor = recognitionCtor()
  if (!Ctor) return null
  const recognition = new Ctor()
  recognition.continuous = true
  recognition.interimResults = false
  recognition.lang = lang

  recognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index]
      const text = result[0]?.transcript ?? ''
      if (result.isFinal && text.trim() !== '') onPhrase(text.trim())
    }
  }
  recognition.onerror = () => {
    // "no-speech" and friends just end the session; the UI does not care why.
  }
  recognition.onend = () => onEnd?.()

  try {
    recognition.start()
  } catch {
    return null
  }
  return {
    stop: () => {
      try {
        recognition.stop()
      } catch {
        // Already stopped.
      }
    }
  }
}
