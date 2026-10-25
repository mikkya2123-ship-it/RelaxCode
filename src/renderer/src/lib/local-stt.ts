/**
 * Offline speech recognition: Whisper running inside the app through
 * transformers.js (WASM, no server, no key). The model downloads on first
 * use and is cached afterwards.
 *
 * huggingface.co can be painfully slow on some networks, so the mirror goes
 * first and the original host is the fallback; the wasm engine itself comes
 * from jsdelivr, which is fast.
 */

interface AsrPipeline {
  (audio: Float32Array, options?: Record<string, unknown>): Promise<Array<{ text: string }> | { text: string }>
}

const MODEL = 'onnx-community/whisper-base'
const MODEL_HOSTS = ['https://hf-mirror.com', 'https://huggingface.co']

let asr: AsrPipeline | null = null
let loading: Promise<void> | null = null

interface LoadProgress {
  status?: string
  progress?: number
  file?: string
}

async function loadPipeline(onStatus: (message: string) => void): Promise<AsrPipeline> {
  const { pipeline, env } = await import('@huggingface/transformers')
  env.allowLocalModels = false

  let lastError: unknown = null
  for (const host of MODEL_HOSTS) {
    try {
      env.remoteHost = host
      return (await pipeline('automatic-speech-recognition', MODEL, {
        dtype: 'q8',
        progress_callback: (info: LoadProgress) => {
          // One line per finished file is enough; per-cent chatter would
          // drown the user in toasts.
          if (info.status === 'done' && info.file && info.file.endsWith('.onnx')) {
            onStatus('chat.voice.ready')
          }
        }
      })) as unknown as AsrPipeline
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('model download failed')
}

export async function ensureLocalAsr(onStatus: (message: string) => void): Promise<void> {
  if (asr) return
  if (!loading) {
    loading = loadPipeline(onStatus)
      .then((loaded) => {
        asr = loaded
      })
      .catch((error) => {
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
