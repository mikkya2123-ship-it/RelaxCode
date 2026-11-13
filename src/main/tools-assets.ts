import { promises as fs } from 'node:fs'
import { basename, dirname, extname } from 'node:path'
import {
  analysePixels,
  checkExpectations,
  formatImageReport,
  formatImageSummary,
  type ImageExpectation,
  type ImageVerdict
} from '../shared/image-analysis.ts'
import type { ImageMeta } from '../shared/tool-meta.ts'
import { detectAsset, assetBaseName, sanitizeAssetName, type AssetFormat } from './assets.ts'
import { fontLine } from './font-meta.ts'
import { decodeImageBuffer } from './image-inspect.ts'
import { fetchPublicFile } from './public-net.ts'
import { formatBytes, toDataUrl } from './visuals.ts'
import { getWorkspaceRoot } from './workspace.ts'
import {
  argBool,
  argString,
  NO_WORKSPACE,
  relPath,
  resolveInWorkspace,
  ToolError,
  type ToolDef,
  type ToolResult
} from './tool-utils.ts'

/**
 * Project assets: pictures, fonts, textures, icons, models and audio.
 *
 * The agent works with text, so "download this photo and use it" is not enough:
 * it needs to know whether the bytes really are a PNG, how big it is, whether
 * the background is transparent and whether the result fits the brief. The
 * tools here download once, verify the bytes and hand back facts the model can
 * reason about — and never write over an existing file by accident.
 */

const MAX_ASSET_BYTES = 100 * 1024 * 1024
const MAX_IMAGE_ASSET_BYTES = 30 * 1024 * 1024
const MAX_FONT_ASSET_BYTES = 25 * 1024 * 1024
const MAX_ANALYSIS_BYTES = 25 * 1024 * 1024
const SHOW_MAX_BYTES = 8 * 1024 * 1024

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.jfif',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.ico',
  '.tif',
  '.tiff',
  '.svg'
])
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2', '.ttc', '.otc', '.pfb'])

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function expectation(args: Record<string, unknown>): ImageExpectation | null {
  const raw = args.expect
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const expect: ImageExpectation = {}
  const minWidth = positiveNumber(source.min_width)
  const minHeight = positiveNumber(source.min_height)
  const maxWidth = positiveNumber(source.max_width)
  const maxHeight = positiveNumber(source.max_height)
  const minContrast = positiveNumber(source.min_contrast)
  const minDetail = positiveNumber(source.min_detail)
  if (minWidth) expect.minWidth = minWidth
  if (minHeight) expect.minHeight = minHeight
  if (maxWidth) expect.maxWidth = maxWidth
  if (maxHeight) expect.maxHeight = maxHeight
  if (source.orientation === 'square' || source.orientation === 'portrait' || source.orientation === 'landscape') {
    expect.orientation = source.orientation
  }
  if (source.brightness === 'light' || source.brightness === 'dark') expect.brightness = source.brightness
  if (minContrast) expect.minContrast = minContrast
  if (minDetail) expect.minDetail = minDetail
  if (source.transparent === true || source.transparent === false) expect.transparent = source.transparent
  const kinds = ['photo', 'illustration', 'icon', 'screenshot', 'line-art'] as const
  if (typeof source.kind === 'string' && (kinds as readonly string[]).includes(source.kind)) {
    expect.kind = source.kind as (typeof kinds)[number]
  }
  return Object.keys(expect).length > 0 ? expect : null
}

function kindCap(kindArg: string, url: string): number {
  if (kindArg === 'image') return MAX_IMAGE_ASSET_BYTES
  if (kindArg === 'font') return MAX_FONT_ASSET_BYTES
  const extension = extname(new URL(url, 'https://example.invalid').pathname).toLowerCase()
  if (IMAGE_EXTENSIONS.has(extension)) return MAX_IMAGE_ASSET_BYTES
  if (FONT_EXTENSIONS.has(extension)) return MAX_FONT_ASSET_BYTES
  return MAX_ASSET_BYTES
}

async function uniqueTarget(target: string): Promise<string> {
  const extension = extname(target)
  const stem = target.slice(0, target.length - extension.length)
  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const candidate = attempt === 1 ? target : `${stem}-${attempt}${extension}`
    if (!(await fs.stat(candidate).catch(() => null))) return candidate
  }
  throw new ToolError('There are too many files with that name already; pass an explicit path.')
}

function imageMeta(buffer: Buffer, mime: string, name: string, source: string, bytes: number): ImageMeta | null {
  if (buffer.length > SHOW_MAX_BYTES) return null
  const meta: ImageMeta = {
    kind: 'image',
    src: toDataUrl(mime, buffer),
    alt: name,
    mime,
    bytes
  }
  const sourceUrl = source.startsWith('http') ? source : undefined
  if (sourceUrl) meta.sourceUrl = sourceUrl
  return meta
}

function detailFor(
  format: AssetFormat,
  buffer: Buffer,
  target: string,
  source: string,
  expect: ImageExpectation | null
): {
  text: string
  verdict: ImageVerdict | null
  meta: ImageMeta | null
  showable: boolean
} {
  if (format.kind === 'image') {
    if (format.mime === 'image/svg+xml') {
      const size = format.svgSize ? `${format.svgSize.width}×${format.svgSize.height}` : 'size not declared'
      return {
        text: `Vector SVG (${size}). SVG is not rasterised here, so transparency, palette and fit checks do not apply; inspect the markup with read_file if the shape matters.`,
        verdict: null,
        meta: null,
        showable: false
      }
    }
    if (buffer.length > MAX_ANALYSIS_BYTES) {
      return {
        text: `The picture is ${formatBytes(buffer.length)}, above the ${formatBytes(MAX_ANALYSIS_BYTES)} analysis cap. It was saved; pixel facts and fit checks are unavailable.`,
        verdict: null,
        meta: null,
        showable: false
      }
    }
    const pixels = decodeImageBuffer(buffer)
    if (!pixels) {
      return {
        text: `The bytes are a ${format.label}, but Electron could not decode this variant for pixel analysis, so fit checks did not run. The file is saved and valid; use show_image to display it if the user should see it.`,
        verdict: null,
        meta: format.mime ? imageMeta(buffer, format.mime, basename(target), source, buffer.length) : null,
        showable: true
      }
    }
    const analysis = analysePixels(pixels)
    const verdict = expect ? checkExpectations(analysis, expect) : null
    const label = relPath(target)
    const verdictText = verdict
      ? `Fit check: ${verdict.fits ? 'PASS' : 'FAIL'} — ${verdict.checks
          .map((entry) => `${entry.ok ? 'ok' : 'NO'} ${entry.label}: expected ${entry.expected}, got ${entry.actual}`)
          .join('; ')}`
      : ''
    const report = [
      formatImageSummary(analysis, { source: label, bytes: buffer.length, format: format.label }),
      verdictText
    ]
      .filter(Boolean)
      .join('\n')
    return {
      text: report,
      verdict,
      meta: format.mime ? imageMeta(buffer, format.mime, basename(target), source, buffer.length) : null,
      showable: true
    }
  }

  if (format.kind === 'font') {
    const info = format.font
    const lines = [info ? fontLine(info) : 'Unrecognised font container.']
    if (info?.format === 'WOFF2') {
      lines.push('WOFF2 is a web font container: desktop editors usually want the TTF/OTF build of the same family.')
    }
    if (info?.format === 'TrueType Collection') {
      lines.push('This is a collection: the app may ask which face to use.')
    }
    lines.push('The file is saved in the project; import it through the app instead of referencing the web URL.')
    return { text: lines.join('\n'), verdict: null, meta: null, showable: false }
  }

  return {
    text: `${format.label}${format.mime ? ` (${format.mime})` : ''}, ${formatBytes(buffer.length)}. The bytes match the declared type, so there is nothing more to verify automatically.`,
    verdict: null,
    meta: null,
    showable: false
  }
}

/* ------------------------------- download -------------------------------- */

const downloadAssetTool: ToolDef = {
  name: 'download_asset',
  description:
    'Download a picture, texture, icon, font, 3D model, audio clip or archive from a public http(s) link straight into the project, verify what the bytes really are, and report facts you can work with. Use it whenever the task needs an asset you do not have — instead of asking the user to download it, and instead of saving a web page by mistake. Pictures are decoded and analysed (size, transparency, palette, content box, sharpness) and can be checked against requirements; fonts report family, style, weight and glyph count. It never overwrites an existing file: a numbered name is chosen. The URL and final path are returned for attribution. Always record the source and its licence, and prefer public-domain/CC0 sources or the app’s own asset library.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Direct public http(s) link to the asset' },
      path: {
        type: 'string',
        description: 'Workspace path to save as (default: assets/<name>.<ext>). An existing file is not overwritten.'
      },
      name: { type: 'string', description: 'Base file name without extension (default: from the URL)' },
      kind: {
        type: 'string',
        enum: ['auto', 'image', 'font', 'audio', 'video', 'model', 'archive', 'other'],
        description: 'Expected asset kind (default auto). The bytes still decide; a mismatch is reported.'
      },
      expect: {
        type: 'object',
        description: 'Optional requirements for a picture; a mismatch is reported as a failed fit check.',
        properties: {
          min_width: { type: 'number' },
          min_height: { type: 'number' },
          max_width: { type: 'number' },
          max_height: { type: 'number' },
          orientation: { type: 'string', enum: ['square', 'portrait', 'landscape'] },
          transparent: { type: 'boolean', description: 'Require real transparency (alpha)' },
          brightness: { type: 'string', enum: ['light', 'dark'] },
          min_contrast: { type: 'number', description: '0…255 luminance standard deviation' },
          min_detail: { type: 'number', description: '0…1 share of edge pixels' },
          kind: { type: 'string', enum: ['photo', 'illustration', 'icon', 'screenshot', 'line-art'] }
        }
      },
      overwrite: { type: 'boolean', description: 'Replace the exact path if it exists (default false)' },
      show: { type: 'boolean', description: 'Also show a downloaded picture in the chat (default false)' }
    },
    required: ['url']
  },
  risk: 'write',
  execute: async (args, ctx) => {
    const root = getWorkspaceRoot()
    if (!root) throw new ToolError(NO_WORKSPACE)

    const url = argString(args, 'url').trim()
    const kindArg = argString(args, 'kind', false).trim() || 'auto'
    const requested = argString(args, 'path', false).trim()
    const requestedName = argString(args, 'name', false).trim()
    const expect = expectation(args)
    const overwrite = argBool(args, 'overwrite')
    const show = argBool(args, 'show')

    const file = await fetchPublicFile(url, ctx.signal, {
      maxBytes: kindCap(kindArg, url),
      noun: 'asset',
      serverLabel: 'asset server',
      accept: 'image/*,font/*,audio/*,video/*,model/*,application/octet-stream,application/zip,*/*;q=0.8'
    })
    const format = detectAsset(file.buffer, file.contentType, file.url)

    if (format.kind === 'html') {
      return {
        ok: false,
        summary: 'the link returned an HTML page',
        detail:
          `The server sent ${file.contentType || 'HTML'} instead of an asset. This is usually a login wall, a consent page or a wrong direct link.\n` +
          'Open the page with fetch_url or web_search to find the real file link (the "Download" button often points at a CDN), then call download_asset again with that direct URL.'
      }
    }
    if (kindArg !== 'auto' && kindArg !== format.kind) {
      return {
        ok: false,
        summary: `expected ${kindArg}, got ${format.kind}`,
        detail: `The bytes are a ${format.label}${format.mime ? ` (${format.mime})` : ''}, not a ${kindArg}. Nothing was written. Check the URL and try the direct file link.`
      }
    }
    if (format.kind === 'image' && file.buffer.length > MAX_IMAGE_ASSET_BYTES) {
      return {
        ok: false,
        summary: 'picture too large',
        detail: `The picture is ${formatBytes(file.buffer.length)}; the asset cap for pictures is ${formatBytes(MAX_IMAGE_ASSET_BYTES)}. Downscale it or choose a smaller rendition.`
      }
    }
    if (format.kind === 'font' && file.buffer.length > MAX_FONT_ASSET_BYTES) {
      return {
        ok: false,
        summary: 'font too large',
        detail: `The font is ${formatBytes(file.buffer.length)}; the asset cap for fonts is ${formatBytes(MAX_FONT_ASSET_BYTES)}.`
      }
    }

    const extension = format.extension ?? ''
    const rawName = requestedName || assetBaseName(file.url || url)
    const baseName =
      extension && rawName.toLowerCase().endsWith(extension.toLowerCase())
        ? rawName.slice(0, rawName.length - extension.length)
        : rawName
    const suggested = `${sanitizeAssetName(baseName)}${extension}`
    let relative = requested
    if (!relative) relative = `assets/${suggested}`
    else if (relative.endsWith('/') || relative.endsWith('\\')) relative = `${relative}${suggested}`
    else if (!extname(relative)) relative = `${relative}${format.extension ?? ''}`

    let target = resolveInWorkspace(relative)
    if (!overwrite) target = await uniqueTarget(target)
    await fs.mkdir(dirname(target), { recursive: true })
    await fs.writeFile(target, file.buffer)

    const details = detailFor(format, file.buffer, target, file.url, expect)
    const saved = relPath(target)
    const fit = details.verdict ? (details.verdict.fits ? 'fit check passed' : 'fit check FAILED') : ''
    const summary = `saved ${saved} (${format.label}, ${formatBytes(file.buffer.length)})${fit ? ` — ${fit}` : ''}`

    const lines = [
      `Saved: ${saved}`,
      `Source: ${file.url}${file.url === url ? '' : ` (redirected from ${url})`}`,
      `Type: ${format.label}${format.mime ? ` (${format.mime})` : ''}, ${formatBytes(file.buffer.length)}`,
      '',
      details.text,
      '',
      'Licence: not checked automatically. Keep the source URL with the asset, prefer CC0/public-domain or the app’s own library, and tell the user which licence applies before shipping.'
    ]
    if (details.verdict && !details.verdict.fits) {
      lines.push('', 'The saved file does not meet every requirement above. Use it only if the user accepts the mismatch, or download a better candidate.')
    }

    const result: ToolResult = {
      ok: true,
      summary,
      detail: lines.join('\n')
    }
    if (show && details.meta) result.meta = details.meta
    return result
  }
}

/* -------------------------------- inspect -------------------------------- */

const inspectImageTool: ToolDef = {
  name: 'inspect_image',
  description:
    'Read a picture without seeing it: report its real format and size, transparency and content box, dominant colours and palette, brightness/contrast, edge detail, a coarse lightness map, an alpha silhouette, quality warnings and an optional fit check. Use it after download_asset, or on any workspace image or public image URL, to decide whether a picture is suitable before placing it in a Craft app or a page. It reports pixel facts, not the subject or any text: it cannot confirm that the picture shows what the user asked for.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Image file inside the workspace (instead of url)' },
      url: { type: 'string', description: 'Direct public http(s) image link (instead of path)' },
      detail: { type: 'string', enum: ['brief', 'full'], description: 'brief (default) or full with zones and percentiles' },
      expect: {
        type: 'object',
        description: 'Requirements to check the picture against.',
        properties: {
          min_width: { type: 'number' },
          min_height: { type: 'number' },
          max_width: { type: 'number' },
          max_height: { type: 'number' },
          orientation: { type: 'string', enum: ['square', 'portrait', 'landscape'] },
          transparent: { type: 'boolean' },
          brightness: { type: 'string', enum: ['light', 'dark'] },
          min_contrast: { type: 'number' },
          min_detail: { type: 'number' },
          kind: { type: 'string', enum: ['photo', 'illustration', 'icon', 'screenshot', 'line-art'] }
        }
      },
      show: { type: 'boolean', description: 'Also show the picture in the chat (default false)' }
    }
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const path = argString(args, 'path', false).trim()
    const url = argString(args, 'url', false).trim()
    if ((path.length === 0) === (url.length === 0)) {
      throw new ToolError('Pass exactly one of path (a workspace file) or url (a public image link)')
    }

    let buffer: Buffer
    let source: string
    let declared = ''
    if (path.length > 0) {
      const target = resolveInWorkspace(path)
      const stat = await fs.stat(target).catch(() => null)
      if (!stat || !stat.isFile()) throw new ToolError('the file was not found')
      if (stat.size > MAX_IMAGE_ASSET_BYTES) {
        throw new ToolError(`the picture is ${formatBytes(stat.size)}, larger than the ${formatBytes(MAX_IMAGE_ASSET_BYTES)} analysis cap`)
      }
      buffer = await fs.readFile(target)
      source = relPath(target)
    } else {
      const file = await fetchPublicFile(url, ctx.signal, {
        maxBytes: MAX_IMAGE_ASSET_BYTES,
        noun: 'picture',
        serverLabel: 'image server',
        accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml,image/*;q=0.8'
      })
      buffer = file.buffer
      declared = file.contentType
      source = file.url
    }

    const format = detectAsset(buffer, declared, source)
    if (format.kind !== 'image') {
      throw new ToolError(`this is a ${format.label}, not a picture`)
    }

    const expect = expectation(args)
    const full = argString(args, 'detail', false) === 'full'

    if (format.mime === 'image/svg+xml') {
      const size = format.svgSize ? `${format.svgSize.width}×${format.svgSize.height}` : 'size not declared'
      return {
        ok: true,
        summary: `SVG vector (${size})`,
        detail:
          `Picture: ${source} — SVG vector, ${size}.\n` +
          'SVG is a text format: pixel analysis, transparency share and palette do not apply. Read the markup with read_file when the shapes, colours or embedded fonts matter. SVG is not shown with show_image; rasterise it in the target app first.'
      }
    }

    const pixels = decodeImageBuffer(buffer)
    if (!pixels) {
      const fallback = format.mime ? format.label : 'image'
      return {
        ok: true,
        summary: `${fallback} (pixels not decoded)`,
        detail:
          `Picture: ${source} — ${format.label}${format.mime ? ` (${format.mime})` : ''}, ${formatBytes(buffer.length)}.\n` +
          'The bytes are a valid picture, but this variant could not be decoded for pixel analysis. Use show_image if the user should see it, or convert it to PNG/JPEG and inspect again.'
      }
    }

    const analysis = analysePixels(pixels)
    const verdict = expect ? checkExpectations(analysis, expect) : undefined
    const report = formatImageReport(analysis, {
      source,
      bytes: buffer.length,
      format: format.label,
      detail: full ? 'full' : 'brief',
      ...(verdict ? { verdict } : {})
    })
    const summary = `${analysis.width}×${analysis.height} ${analysis.classification.kind}${verdict ? (verdict.fits ? ' — fit check passed' : ' — fit check FAILED') : ''}`

    const result: ToolResult = { ok: true, summary, detail: report }
    if (argBool(args, 'show') && format.mime) {
      const label = source.startsWith('http') ? assetBaseName(source) : basename(source)
      const meta = imageMeta(buffer, format.mime, label, source, buffer.length)
      if (meta) result.meta = meta
    }
    return result
  }
}

export const ASSET_TOOLS: ToolDef[] = [downloadAssetTool, inspectImageTool]
