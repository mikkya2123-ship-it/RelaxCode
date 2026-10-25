/**
 * Microphone capture for push-to-talk. Electron's Chromium ships without the
 * speech service backend (webkitSpeechRecognition fails with `not-allowed`),
 * so dictation is a two-step affair: record with MediaRecorder, then the main
 * process transcribes the audio through the provider's own endpoint.
 */

export interface AudioSession {
  /** Stops recording and resolves the captured audio, or null on failure. */
  stop: () => Promise<ArrayBuffer | null>
}

export function recorderSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window.MediaRecorder !== 'undefined'
  )
}

/**
 * Starts capturing the microphone. Rejects when access is denied; the caller
 * turns that into an honest message instead of a dead button.
 */
export async function startRecording(): Promise<AudioSession> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : undefined
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  recorder.start(250)

  let stopped = false
  return {
    stop: () =>
      new Promise<ArrayBuffer | null>((resolve) => {
        if (stopped) return resolve(null)
        stopped = true
        recorder.onstop = () => {
          stream.getTracks().forEach((track) => track.stop())
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
          void blob.arrayBuffer().then(resolve)
        }
        try {
          recorder.stop()
        } catch {
          stream.getTracks().forEach((track) => track.stop())
          resolve(null)
        }
      })
  }
}
