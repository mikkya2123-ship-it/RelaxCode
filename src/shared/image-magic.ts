/* ------------------------------------------------------------------------- *
 * Image format magic numbers.
 *
 * Kept free of Node and Electron so the asset pipeline, the chat picture tool
 * and the tests all agree on what a file really is. A server can label a text
 * file `image/png`; these checks look at the bytes instead.
 * ------------------------------------------------------------------------- */

export const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
}

const IMAGE_MIMES = new Set(Object.values(IMAGE_MIME_BY_EXTENSION))

export function isAllowedImageMime(value: string): boolean {
  return IMAGE_MIMES.has(value.toLowerCase().split(';')[0].trim())
}

const u16 = (data: Uint8Array, offset: number, little = false): number =>
  little ? data[offset]! | (data[offset + 1]! << 8) : (data[offset]! << 8) | data[offset + 1]!
const u32 = (data: Uint8Array, offset: number, little = false): number =>
  little
    ? (data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16) | (data[offset + 3]! << 24)) >>> 0
    : ((data[offset]! << 24) | (data[offset + 1]! << 16) | (data[offset + 2]! << 8) | data[offset + 3]!) >>> 0
const s32 = (data: Uint8Array, offset: number, little = false): number => {
  const value = u32(data, offset, little)
  return value > 0x7fffffff ? value - 0x1_0000_0000 : value
}
const ascii = (data: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...data.subarray(start, end))

/** Reads the real format from the first bytes, so a wrong header cannot lie. */
export function sniffImageMime(buffer: Uint8Array): string | null {
  if (buffer.length < 12) return null
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png'
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (ascii(buffer, 0, 6) === 'GIF87a' || ascii(buffer, 0, 6) === 'GIF89a') return 'image/gif'
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WEBP') return 'image/webp'
  if (ascii(buffer, 4, 12) === 'ftypavif') return 'image/avif'
  if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) {
    return 'image/x-icon'
  }
  if (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) {
    return 'image/tiff'
  }
  if (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a) {
    return 'image/tiff'
  }
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp'
  return null
}

/** Pixel size from the header when the format makes it cheap to read. */
export function imageSize(buffer: Uint8Array, mime: string): { width: number; height: number } | null {
  try {
    if (mime === 'image/png' && buffer.length >= 24) {
      return { width: u32(buffer, 16), height: u32(buffer, 20) }
    }
    if (mime === 'image/gif' && buffer.length >= 10) {
      return { width: u16(buffer, 6, true), height: u16(buffer, 8, true) }
    }
    if (mime === 'image/bmp' && buffer.length >= 26) {
      return { width: Math.abs(s32(buffer, 18, true)), height: Math.abs(s32(buffer, 22, true)) }
    }
    if (mime === 'image/x-icon' && buffer.length >= 8) {
      return { width: buffer[6] === 0 ? 256 : buffer[6]!, height: buffer[7] === 0 ? 256 : buffer[7]! }
    }
    if (mime === 'image/jpeg') {
      let offset = 2
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1
          continue
        }
        const marker = buffer[offset + 1]!
        const length = u16(buffer, offset + 2)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: u16(buffer, offset + 7), height: u16(buffer, offset + 5) }
        }
        offset += 2 + length
      }
    }
  } catch {
    return null
  }
  return null
}
