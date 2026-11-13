import { extname } from 'node:path'
import { IMAGE_MIME_BY_EXTENSION, imageSize, sniffImageMime } from '../shared/image-magic.ts'
import { sniffFont, type FontInfo } from './font-meta.ts'

/**
 * What a downloaded file really is.
 *
 * URLs lie: a "photo.jpg" can be an HTML login page, a "font.ttf" can be a zip.
 * The bytes decide. Images and fonts get the deepest checks because those are
 * the assets the Craft apps consume; everything else is labelled so the model
 * can still save a texture pack or an audio sting honestly.
 */

export type AssetKind = 'image' | 'font' | 'audio' | 'video' | 'model' | 'archive' | 'html' | 'other'

export interface AssetFormat {
  kind: AssetKind
  /** MIME from the bytes when known, else the declared one. */
  mime?: string
  /** Suggested extension, including the dot. */
  extension?: string
  /** Human label: "PNG image", "TrueType font", "HTML page". */
  label: string
  font?: FontInfo
  /** SVG width/height in px, when the root element declares them. */
  svgSize?: { width: number; height: number } | null
}

const TEXT_PREFIX_BYTES = 4096

function ascii(buffer: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...buffer.subarray(start, Math.min(end, buffer.length)))
}

function leadingText(buffer: Uint8Array): string {
  let start = 0
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) start = 3
  return ascii(buffer, start, start + TEXT_PREFIX_BYTES).trimStart().toLowerCase()
}

/** Text sniffing must not mistake a binary that happens to contain "<html" for a page. */
function isProbablyText(buffer: Uint8Array): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024))
  if (sample.includes(0)) return false
  let printable = 0
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte !== 127)) printable += 1
  }
  return sample.length > 0 && printable / sample.length > 0.9
}

function looksLikeHtml(buffer: Uint8Array): boolean {
  if (!isProbablyText(buffer)) return false
  const text = leadingText(buffer)
  return (
    text.startsWith('<!doctype html') ||
    text.startsWith('<html') ||
    text.startsWith('<head') ||
    text.startsWith('<body') ||
    (text.includes('<html') && text.indexOf('<html') < 256)
  )
}

function svgSize(text: string): { width: number; height: number } | null {
  const root = text.slice(0, TEXT_PREFIX_BYTES)
  if (!root.includes('<svg')) return null
  const width = /<svg[^>]*\bwidth=["']?\s*([\d.]+)/i.exec(root)
  const height = /<svg[^>]*\bheight=["']?\s*([\d.]+)/i.exec(root)
  if (width && height) {
    const w = Math.round(Number(width[1]))
    const h = Math.round(Number(height[1]))
    if (w > 0 && h > 0) return { width: w, height: h }
  }
  const viewBox = /<svg[^>]*\bviewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/i.exec(root)
  if (viewBox) {
    const w = Math.round(Number(viewBox[1]))
    const h = Math.round(Number(viewBox[2]))
    if (w > 0 && h > 0) return { width: w, height: h }
  }
  return null
}

function looksLikeSvg(buffer: Uint8Array): boolean {
  if (!isProbablyText(buffer)) return false
  const text = leadingText(buffer)
  if (!text.startsWith('<?xml') && !text.startsWith('<svg')) return false
  return text.includes('<svg')
}

function extensionForImage(mime: string): string {
  for (const [extension, value] of Object.entries(IMAGE_MIME_BY_EXTENSION)) {
    if (value === mime) return extension === '.jpeg' || extension === '.jfif' ? '.jpg' : extension
  }
  return '.img'
}

function extensionForFont(font: FontInfo): string {
  switch (font.format) {
    case 'OpenType':
      return '.otf'
    case 'WOFF':
      return '.woff'
    case 'WOFF2':
      return '.woff2'
    case 'TrueType Collection':
      return '.ttc'
    case 'Type 1':
      return '.pfb'
    default:
      return '.ttf'
  }
}

function declaredKind(mime: string): AssetKind | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('font/') || mime.includes('font')) return 'font'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  if (mime.includes('model') || mime.includes('gltf')) return 'model'
  if (mime.includes('zip') || mime.includes('archive') || mime.includes('compressed')) return 'archive'
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html'
  return null
}

/** Classifies bytes, using the declared type and URL only as fallbacks. */
export function detectAsset(buffer: Buffer, declaredMime = '', sourceUrl = ''): AssetFormat {
  const mime = declaredMime.toLowerCase().split(';')[0].trim()
  const urlExtension = extname(new URL(sourceUrl, 'https://example.invalid').pathname).toLowerCase()

  if (looksLikeHtml(buffer)) return { kind: 'html', mime: 'text/html', extension: '.html', label: 'HTML page' }

  if (looksLikeSvg(buffer)) {
    const size = svgSize(leadingText(buffer))
    return {
      kind: 'image',
      mime: 'image/svg+xml',
      extension: '.svg',
      label: size ? `SVG vector ${size.width}×${size.height}` : 'SVG vector',
      svgSize: size
    }
  }

  const imageMime = sniffImageMime(buffer)
  if (imageMime) {
    const size = imageSize(buffer, imageMime)
    return {
      kind: 'image',
      mime: imageMime,
      extension: extensionForImage(imageMime),
      label: `${imageMime.replace('image/', '').toUpperCase()}${size ? ` ${size.width}×${size.height}` : ''}`
    }
  }

  const font = sniffFont(buffer)
  if (font) {
    return {
      kind: 'font',
      mime: mime.startsWith('font/') ? mime : undefined,
      extension: extensionForFont(font),
      label: font.format,
      font
    }
  }

  const zip = buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
  if (zip) return { kind: 'archive', mime: 'application/zip', extension: '.zip', label: 'ZIP archive' }
  if (ascii(buffer, 0, 4) === 'Rar!') return { kind: 'archive', mime: 'application/vnd.rar', extension: '.rar', label: 'RAR archive' }
  if (buffer[0] === 0x37 && buffer[1] === 0x7a && buffer[2] === 0xbc && buffer[3] === 0xaf) {
    return { kind: 'archive', mime: 'application/x-7z-compressed', extension: '.7z', label: '7z archive' }
  }

  if (ascii(buffer, 0, 3) === 'ID3') return { kind: 'audio', mime: 'audio/mpeg', extension: '.mp3', label: 'MP3 audio' }
  if (ascii(buffer, 0, 4) === 'fLaC') return { kind: 'audio', mime: 'audio/flac', extension: '.flac', label: 'FLAC audio' }
  if (ascii(buffer, 0, 4) === 'OggS') return { kind: 'audio', mime: 'audio/ogg', extension: '.ogg', label: 'Ogg audio' }
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WAVE') {
    return { kind: 'audio', mime: 'audio/wav', extension: '.wav', label: 'WAV audio' }
  }
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'AVI ') {
    return { kind: 'video', mime: 'video/x-msvideo', extension: '.avi', label: 'AVI video' }
  }
  if (ascii(buffer, 4, 8) === 'ftyp') {
    const brand = ascii(buffer, 8, 12).trim()
    if (/^(M4A|M4B|M4P)/i.test(brand)) return { kind: 'audio', mime: 'audio/mp4', extension: '.m4a', label: 'M4A audio' }
    return { kind: 'video', mime: 'video/mp4', extension: '.mp4', label: `MP4 video (${brand || 'isobmff'})` }
  }
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return { kind: 'video', mime: 'video/x-matroska', extension: '.mkv', label: 'Matroska video' }
  }

  if (ascii(buffer, 0, 4) === 'glTF') return { kind: 'model', mime: 'model/gltf-binary', extension: '.glb', label: 'glTF binary model' }
  if (ascii(buffer, 0, 18) === 'Kaydara FBX Binary') {
    return { kind: 'model', mime: 'application/octet-stream', extension: '.fbx', label: 'FBX model' }
  }
  const textHead = leadingText(buffer)
  if (textHead.startsWith('{') && textHead.includes('"asset"') && textHead.includes('"version"')) {
    return { kind: 'model', mime: 'model/gltf+json', extension: '.gltf', label: 'glTF JSON model' }
  }

  const fallback = declaredKind(mime)
  if (fallback) {
    const extension = urlExtension || (fallback === 'image' ? '.img' : '.bin')
    return { kind: fallback, mime: mime || undefined, extension, label: mime || `${fallback} file` }
  }

  if (urlExtension && /^[.][a-z0-9]{1,6}$/.test(urlExtension)) {
    return { kind: 'other', mime: mime || undefined, extension: urlExtension, label: mime || `${urlExtension.slice(1).toUpperCase()} file` }
  }
  return { kind: 'other', mime: mime || undefined, label: mime || 'unrecognised file' }
}

const RESERVED_WINDOWS_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9'
])

/** A filesystem-safe base name derived from the URL (no extension). */
export function sanitizeAssetName(value: string, fallback = 'asset'): string {
  let base = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[.\s]+$/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 70)
  if (!base) base = fallback
  if (RESERVED_WINDOWS_NAMES.has(base.toLowerCase())) base = `_${base}`
  return base
}

/** A filesystem-safe base name derived from the URL (no extension). */
export function assetBaseName(rawUrl: string, fallback = 'asset'): string {
  let pathname = fallback
  try {
    pathname = decodeURIComponent(new URL(rawUrl).pathname)
  } catch {
    // A malformed URL keeps the fallback.
  }
  const file = pathname.split('/').pop() ?? ''
  return sanitizeAssetName(file.replace(/\.[a-z0-9]{1,8}$/i, ''), fallback)
}
