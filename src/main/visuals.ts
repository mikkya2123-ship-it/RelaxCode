import { promises as dns } from 'node:dns'
import { promises as fs } from 'node:fs'
import { extname } from 'node:path'
import { isIP } from 'node:net'
import { isPrivateHostname, safeHttpUrl } from '../shared/web-search.ts'

/**
 * Pictures for the chat.
 *
 * A picture is fetched once, checked, size-capped and turned into a data URL,
 * so the card renders it even when the site blocks hotlinking or needs cookies.
 * Remote addresses go through the same SSRF guard as web search: no loopback,
 * no private ranges, no redirects into them.
 */

/** Raster formats only: an `<img>` cannot run an SVG's scripts anyway, but a
 * drawing is better produced by `draw_figure` than by embedding someone's SVG. */
export const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp'
}

const ALLOWED_MIMES = new Set(Object.values(IMAGE_MIME_BY_EXTENSION))

const MAX_REDIRECTS = 4
const FETCH_TIMEOUT_MS = 20000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'

export interface ImageBytes {
  buffer: Buffer
  mime: string
  /** Final URL after redirects (remote only). */
  url?: string
}

export function isAllowedImageMime(value: string): boolean {
  return ALLOWED_MIMES.has(value.toLowerCase().split(';')[0].trim())
}

/** Reads the real format from the first bytes, so a wrong header cannot lie. */
export function sniffImageMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png'
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.subarray(0, 6).toString('latin1') === 'GIF87a' || buffer.subarray(0, 6).toString('latin1') === 'GIF89a') {
    return 'image/gif'
  }
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp'
  }
  if (buffer.subarray(4, 12).toString('latin1') === 'ftypavif') return 'image/avif'
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp'
  return null
}

/** Pixel size from the header when the format makes it cheap to read. */
export function imageSize(buffer: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === 'image/png' && buffer.length >= 24) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
    }
    if (mime === 'image/gif' && buffer.length >= 10) {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
    }
    if (mime === 'image/bmp' && buffer.length >= 22) {
      return { width: buffer.readInt32LE(18), height: Math.abs(buffer.readInt32LE(22)) }
    }
    if (mime === 'image/jpeg') {
      let offset = 2
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1
          continue
        }
        const marker = buffer[offset + 1]
        const length = buffer.readUInt16BE(offset + 2)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) }
        }
        offset += 2 + length
      }
    }
  } catch {
    return null
  }
  return null
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

async function assertPublicUrl(rawUrl: string, signal: AbortSignal): Promise<void> {
  if (isPrivateHostname(new URL(rawUrl).hostname)) {
    throw new Error('the address is local or private')
  }
  if (signal.aborted) throw new Error('aborted')
  const hostname = new URL(rawUrl).hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname) !== 0) return
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true }).catch((error) => {
    throw new Error(`DNS lookup failed: ${error instanceof Error ? error.message : String(error)}`)
  })
  if (addresses.length === 0) throw new Error('DNS lookup returned no addresses')
  if (addresses.some((entry) => isPrivateHostname(entry.address))) {
    throw new Error('the address resolves to a private network')
  }
}

/** Streams a response but stops reading at the cap instead of buffering it all. */
async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      const remaining = maxBytes - size
      if (remaining <= 0) {
        await reader.cancel()
        break
      }
      const chunk = value.subarray(0, remaining)
      chunks.push(Buffer.from(chunk))
      size += chunk.length
      if (size >= maxBytes) {
        await reader.cancel()
        break
      }
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
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
  let current = safeHttpUrl(rawUrl)
  if (!current) throw new Error('only public http(s) image links are supported')

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicUrl(current, signal)
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.any([signal, timeout]),
        headers: {
          'user-agent': USER_AGENT,
          accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8',
          referer: new URL(current).origin
        }
      })
    } catch (error) {
      if (timeout.aborted) throw new Error('the image server did not answer in time')
      if (signal.aborted) throw new Error('aborted')
      throw new Error(error instanceof Error ? error.message : String(error))
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error(`redirect without a location (HTTP ${response.status})`)
      current = safeHttpUrl(new URL(location, current).toString())
      if (!current) throw new Error('redirected to an unsupported address')
      continue
    }
    if (!response.ok) throw new Error(`the image server answered HTTP ${response.status}`)

    const declared = (response.headers.get('content-type') ?? '').toLowerCase()
    if (declared && !declared.startsWith('image/')) {
      throw new Error(`the link is not an image (${declared.split(';')[0]})`)
    }
    const length = Number(response.headers.get('content-length'))
    if (Number.isFinite(length) && length > maxBytes) {
      await response.body?.cancel()
      throw new Error(`the picture is ${formatBytes(length)}, larger than the ${formatBytes(maxBytes)} limit`)
    }

    const buffer = await readCapped(response, maxBytes)
    // The bytes decide, not the header: a server that labels text as PNG must
    // not put an "image" the browser cannot decode into the chat.
    const mime = sniffImageMime(buffer)
    if (!mime || !isAllowedImageMime(mime)) {
      throw new Error('the link did not return a supported image')
    }
    return { buffer, mime, url: current }
  }
  throw new Error('too many redirects')
}
