/**
 * Offline speech recognition: Whisper running inside the app through
 * transformers.js (WASM, no server, no key). The model downloads from
 * HuggingFace on first use and is cached afterwards.
 *
 * Loaded through a dynamic import so the main bundle never pays for it, and
 * only when dictation actually needs the fallback.
 */

interface AsrPipeline {
  (audio: Float32Array, options?: Record<string, unknown>): Promise<Array<{ text: string }> | { text: string }>
}

let asr: AsrPipeline | null = null
let loading: Promise<void> | null = null

export async function ensureLocalAsr(onStatus: (message: string) => void): Promise<void> {
  if (asr) return
  if (!loading) {
    loading = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers')
      // The wasm backend and the model come from the CDN; nothing is bundled.
      env.allowLocalModels = false
      asr = (await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base', {
        dtype: 'q8',
        progress_callback: (info: { status?: string; progress?: number; file?: string }) => {
          if (info.status === 'progress' && typeof info.progress === 'number' && info.progress >= 99) {
            onStatus('chat.voice.ready')
          }
        }
      })) as unknown as AsrPipeline
    })().catch((error) => {
      loading = null
      throw error
    })
  }
  await loading
}

/** Decodes the recording and resamples it to the 16 kHz mono Whisper expects. */
async function audioToMono16k(data: ArrayBuffer): Promise<Float32Array> {
  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(data.slice(0))
    const frames = Math.max(1, Math.ceil(decoded.duration * 16000))
    const offline = new OfflineAudioContext(1, frames, 16000)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    return (await offline.startRendering()).getChannelData(0)
  } finally {
    void context.close()
  }
}

/** Returns the recognized text, or throws with the reason. */
export async function transcribeLocally(
  audio: ArrayBuffer,
  onStatus: (message: string) => void
): Promise<string> {
  await ensureLocalAsr(onStatus)
  if (!asr) throw new Error('whisper did not load')
  const output = await asr(await audioToMono16k(audio), { return_timestamps: false })
  const text = Array.isArray(output) ? (output[0]?.text ?? '') : (output.text ?? '')
  return text.trim()
}
