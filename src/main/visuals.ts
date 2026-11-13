import { promises as fs } from 'node:fs'
import { extname } from 'node:path'
import {
  IMAGE_MIME_BY_EXTENSION,
  imageSize,
  isAllowedImageMime,
  sniffImageMime
} from '../shared/image-magic.ts'
import { safeHttpUrl } from '../shared/web-search.ts'
import { fetchPublicFile } from './public-net.ts'

export { IMAGE_MIME_BY_EXTENSION, imageSize, isAllowedImageMime, sniffImageMime }

/**
 * Pictures for the chat.
 *
 * A picture is fetched once, checked, size-capped and turned into a data URL,
 * so the card renders it even when the site blocks hotlinking or needs cookies.
 * Remote addresses go through the same SSRF guard as web search: no loopback,
 * no private ranges, no redirects into them.
 */

export interface ImageBytes {
  buffer: Buffer
  mime: string
  /** Final URL after redirects (remote only). */
  url?: string
}

/** A data URL is the one form the renderer can always display. */
export function toDataUrl(mime: string, buffer: Buffer): string {
  return `data:${mime};base64,${buffer.toString('base64')}`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/** A workspace picture, read into memory with the same caps as a remote one. */
export async function readImageFile(absolute: string, maxBytes: number): Promise<ImageBytes> {
  const stat = await fs.stat(absolute).catch(() => null)
  if (!stat || !stat.isFile()) throw new Error('the file was not found')
  if (stat.size > maxBytes) {
    throw new Error(`the picture is ${formatBytes(stat.size)}, larger than the ${formatBytes(maxBytes)} limit`)
  }
  const buffer = await fs.readFile(absolute)
  const byExtension = IMAGE_MIME_BY_EXTENSION[extname(absolute).toLowerCase()]
  const sniffed = sniffImageMime(buffer)
  const mime = sniffed ?? byExtension
  if (!mime || !isAllowedImageMime(mime)) {
    throw new Error('this file is not a supported image (PNG, JPEG, GIF, WebP, AVIF or BMP)')
  }
  return { buffer, mime }
}

/**
 * Downloads a picture from a public address. Redirects are followed by hand so
 * every hop is checked again instead of trusting the first host.
 */
export async function fetchRemoteImage(
  rawUrl: string,
  signal: AbortSignal,
  maxBytes: number
): Promise<ImageBytes> {
  const file = await fetchPublicFile(rawUrl, signal, {
    maxBytes,
    noun: 'picture',
    serverLabel: 'image server',
    accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8'
  })
  if (file.contentType && !file.contentType.startsWith('image/')) {
    throw new Error(`the link is not an image (${file.contentType})`)
  }
  // The bytes decide, not the header: a server that labels text as PNG must
  // not put an "image" the browser cannot decode into the chat.
  const mime = sniffImageMime(file.buffer)
  if (!mime || !isAllowedImageMime(mime)) {
    throw new Error('the link did not return a supported image')
  }
  return { buffer: file.buffer, mime, url: safeHttpUrl(file.url) ?? undefined }
}
