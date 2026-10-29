/* ------------------------------------------------------------------------- *
 * Attachments: files the user pins to a chat message so the model can look
 * at them. This module is the shared, environment-free half — the renderer
 * fills an AttachmentRef with bytes (see renderer/src/lib/attachments.ts)
 * and the main process turns refs into wire content parts (see agent.ts).
 *
 * What the model actually receives, by kind:
 *   image → native `image_url` vision parts (one per picture);
 *   video → one label + a few extracted keyframes as vision parts;
 *   text  → the file contents inline as a text part;
 *   binary → a short note with the name, type and size. Archives and other
 *            opaque formats cannot be "seen" — the note is honest about it.
 * ------------------------------------------------------------------------- */

/** How an attachment travels to the model. */
export type AttachmentKind = 'image' | 'video' | 'text' | 'binary'

export interface AttachmentRef {
  id: string
  name: string
  /** As reported by the file picker; may be empty for exotic files. */
  mime: string
  bytes: number
  kind: AttachmentKind
  /** The picture itself (data URL) — images only. */
  dataUrl?: string
  /** Extracted keyframes (data URLs), earliest first — videos only. */
  frames?: string[]
  /** File contents, already truncated — text files only. */
  text?: string
  /** Live while the renderer is still decoding the file. */
  status?: 'pending' | 'ready' | 'error'
  /** Why the attachment failed (localized, for the chip). */
  error?: string
}

/** Hard caps, so one dropped file cannot sink the request or localStorage. */
export const ATTACHMENT_LIMITS = {
  maxCount: 8,
  imageBytes: 12 * 1024 * 1024,
  videoBytes: 200 * 1024 * 1024,
  textBytes: 2 * 1024 * 1024,
  binaryBytes: 100 * 1024 * 1024,
  /** How much of a text file is worth the model's context. */
  textExcerptChars: 50_000,
  /** Keyframes extracted from a video. */
  videoFrames: 4,
  /** Longest side of an extracted frame. */
  videoFrameMaxDim: 1024,
  /** Longer side of a user photo is scaled down before sending (tokens). */
  imageMaxDim: 1568
} as const

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'avif', 'bmp', 'ico', 'heic', 'heif'
])
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi', 'ogv', '3gp', 'mpg', 'mpeg'])
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonc', 'csv', 'tsv', 'log', 'xml', 'yml', 'yaml',
  'toml', 'ini', 'cfg', 'env', 'sql', 'html', 'htm', 'css', 'scss', 'less', 'js',
  'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'py', 'rb', 'rs', 'go', 'java',
  'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'ps1',
  'bat', 'cmd', 'lua', 'vim', 'conf', 'properties', 'gradle', 'svg'
])
/** Mime types that carry text despite not starting with `text/`. */
const TEXT_MIMES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-yaml',
  'application/yaml',
  'application/toml',
  'image/svg+xml'
])

export function classifyAttachment(name: string, mime: string): AttachmentKind {
  const clean = mime.toLowerCase().split(';')[0].trim()
  if (clean.startsWith('image/') && clean !== 'image/svg+xml') return 'image'
  if (clean.startsWith('video/')) return 'video'
  if (clean.startsWith('text/') || TEXT_MIMES.has(clean)) return 'text'
  const extension = name.toLowerCase().split('.').pop() ?? ''
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  if (TEXT_EXTENSIONS.has(extension)) return 'text'
  return 'binary'
}

/** Bytes → the shortest honest label ("240 KB", "1.4 MB"). */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/**
 * The one-line stand-in for an attachment: what the model sees in later turns
 * (once the real bytes no longer travel with every request) and what a
 * non-visual attachment contributes to the current one.
 */
export function attachmentNote(attachment: AttachmentRef): string {
  const label =
    attachment.kind === 'image'
      ? 'image'
      : attachment.kind === 'video'
        ? 'video'
        : attachment.kind === 'text'
          ? 'text file'
          : attachment.mime || 'file'
  return `[attachment: ${attachment.name} (${label}, ${formatBytes(attachment.bytes)})]`
}

/** The minimum of the OpenAI multimodal content shape this app sends. */
export interface TextContentPart {
  type: 'text'
  text: string
}

export interface ImageContentPart {
  type: 'image_url'
  image_url: { url: string }
}

export type UserContentPart = TextContentPart | ImageContentPart

function fenced(name: string, text: string): string {
  // A file may itself contain fenced blocks; a longer fence still holds it.
  const fence = text.includes('```') ? '````' : '```'
  return `[file: ${name}]\n${fence}\n${text}\n${fence}`
}

/**
 * Assembles the multimodal content of a user message. A message without
 * visual attachments keeps its plain-string content — providers that cannot
 * read arrays never see one. Attachments that failed to load degrade to
 * their note instead of breaking the request.
 */
export function buildUserContent(
  content: string,
  attachments: readonly AttachmentRef[] | undefined
): string | UserContentPart[] {
  const usable = (attachments ?? []).filter((attachment) => attachment.status !== 'error')
  if (usable.length === 0) return content

  const parts: UserContentPart[] = []
  const text = content.trim()
  if (text !== '') parts.push({ type: 'text', text })

  for (const attachment of usable) {
    if (attachment.kind === 'image' && attachment.dataUrl) {
      parts.push({ type: 'text', text: `[image: ${attachment.name}]` })
      parts.push({ type: 'image_url', image_url: { url: attachment.dataUrl } })
    } else if (attachment.kind === 'video' && attachment.frames && attachment.frames.length > 0) {
      parts.push({
        type: 'text',
        text: `[video: ${attachment.name} — ${attachment.frames.length} keyframes below, in playback order]`
      })
      for (const frame of attachment.frames) {
        parts.push({ type: 'image_url', image_url: { url: frame } })
      }
    } else if (attachment.kind === 'text' && attachment.text !== undefined) {
      parts.push({ type: 'text', text: fenced(attachment.name, attachment.text) })
    } else {
      parts.push({ type: 'text', text: attachmentNote(attachment) })
    }
  }
  return parts
}
