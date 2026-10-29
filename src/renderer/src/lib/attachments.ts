import {
  ATTACHMENT_LIMITS,
  classifyAttachment,
  type AttachmentKind,
  type AttachmentRef
} from '@shared/attachments'
import { translate, useI18nStore } from '@/lib/i18n'

/**
 * The renderer half of attachments: turning a dropped/pasted/picked `File`
 * into an `AttachmentRef` the chat can keep and the model can read.
 *
 * The heavy work is deliberate:
 *  - images are scaled down to the vision-friendly long side, so a phone
 *    photo does not cost a fortune in tokens;
 *  - videos are decoded by Chromium itself and reduced to a few keyframes —
 *    there is no ffmpeg here, and a handful of frames is what lets a chat
 *    model "watch" a clip at all.
 */

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

async function imageToDataUrl(file: File): Promise<string> {
  const raw = await readAsDataUrl(file)
  // A canvas would flatten the animation to its first frame; send it as is.
  if (file.type === 'image/gif') return raw
  try {
    const image = new Image()
    image.src = raw
    await image.decode()
    const long = Math.max(image.naturalWidth, image.naturalHeight)
    if (long <= ATTACHMENT_LIMITS.imageMaxDim) return raw
    const scale = ATTACHMENT_LIMITS.imageMaxDim / long
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return raw
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    // PNG keeps its transparency; everything else had none to begin with.
    return canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.85)
  } catch {
    // Cannot decode here — the provider may still accept the original bytes.
    return raw
  }
}

/** Resolves on `event`, rejects on a decode error or a timeout. */
function videoEvent(video: HTMLVideoElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      window.clearTimeout(timer)
      video.removeEventListener(event, done)
      video.removeEventListener('error', failed)
      resolve()
    }
    const failed = () => {
      window.clearTimeout(timer)
      video.removeEventListener(event, done)
      video.removeEventListener('error', failed)
      reject(new Error(video.error?.message || 'video decode failed'))
    }
    const timer = window.setTimeout(failed, timeoutMs)
    video.addEventListener(event, done, { once: true })
    video.addEventListener('error', failed, { once: true })
  })
}

async function extractVideoFrames(file: File): Promise<string[]> {
  const deadline = Date.now() + 20_000
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.src = url
  try {
    await videoEvent(video, 'loadedmetadata', 8_000)
    const duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0 || video.videoWidth === 0) return []

    const frames: string[] = []
    const count = ATTACHMENT_LIMITS.videoFrames
    for (let index = 1; index <= count; index += 1) {
      if (Date.now() > deadline) break
      // Spread over the middle of the clip: the first and last moments are
      // usually fade-ins and credits.
      video.currentTime = Math.min(Math.max(duration - 0.05, 0), (duration * index) / (count + 1))
      await videoEvent(video, 'seeked', 4_000)
      const long = Math.max(video.videoWidth, video.videoHeight)
      const scale = long > ATTACHMENT_LIMITS.videoFrameMaxDim
        ? ATTACHMENT_LIMITS.videoFrameMaxDim / long
        : 1
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) break
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      frames.push(canvas.toDataURL('image/jpeg', 0.8))
    }
    return frames
  } catch {
    // An unsupported codec is not the user's fault to fix: the attachment
    // stays, and the model reads its name and size instead of the pixels.
    return []
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

function byteLimitOf(kind: AttachmentKind): number {
  if (kind === 'image') return ATTACHMENT_LIMITS.imageBytes
  if (kind === 'video') return ATTACHMENT_LIMITS.videoBytes
  if (kind === 'text') return ATTACHMENT_LIMITS.textBytes
  return ATTACHMENT_LIMITS.binaryBytes
}

/**
 * The shell a chip is rendered from the moment a file arrives, while the
 * bytes are still being read. Files over their kind's cap start (and stay)
 * errored — the chip says why and never reaches the request.
 */
export function createPendingAttachment(file: File): AttachmentRef {
  const kind = classifyAttachment(file.name, file.type)
  const attachment: AttachmentRef = {
    id: crypto.randomUUID(),
    name: file.name,
    mime: file.type,
    bytes: file.size,
    kind,
    status: 'pending'
  }
  if (file.size > byteLimitOf(kind)) {
    const locale = useI18nStore.getState().locale
    return {
      ...attachment,
      status: 'error',
      error: translate(locale, 'chat.attach.tooLarge', {
        limit: Math.round(byteLimitOf(kind) / (1024 * 1024))
      })
    }
  }
  return attachment
}

/** Fills a pending shell with what the model will actually see. */
export async function processAttachment(
  attachment: AttachmentRef,
  file: File
): Promise<AttachmentRef> {
  try {
    if (attachment.kind === 'image') {
      return { ...attachment, dataUrl: await imageToDataUrl(file), status: 'ready' }
    }
    if (attachment.kind === 'video') {
      return { ...attachment, frames: await extractVideoFrames(file), status: 'ready' }
    }
    if (attachment.kind === 'text') {
      const text = await file.text()
      return {
        ...attachment,
        text:
          text.length > ATTACHMENT_LIMITS.textExcerptChars
            ? `${text.slice(0, ATTACHMENT_LIMITS.textExcerptChars)}\n… [truncated]`
            : text,
        status: 'ready'
      }
    }
    return { ...attachment, status: 'ready' }
  } catch (error) {
    return {
      ...attachment,
      status: 'error',
      error: error instanceof Error ? error.message : 'processing failed'
    }
  }
}
