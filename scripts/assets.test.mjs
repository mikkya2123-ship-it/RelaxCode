/**
 * Asset pipeline checks: what the bytes really are, font metadata, safe names
 * and the pixel report the model reads.
 * Run with: npm run test:assets
 */
import { analysePixels, checkExpectations, formatImageReport } from '../src/shared/image-analysis.ts'
import { assetBaseName, detectAsset, sanitizeAssetName } from '../src/main/assets.ts'
import { fontLine, sniffFont } from '../src/main/font-meta.ts'

let failed = 0
function check(label, condition, extra) {
  if (condition) {
    console.log('ok   -', label)
  } else {
    failed += 1
    console.log('FAIL -', label, extra === undefined ? '' : JSON.stringify(extra))
  }
}

/* -------------------------------- fixtures -------------------------------- */

/** 1×1 transparent PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

const u16 = (value) => Buffer.from([(value >> 8) & 0xff, value & 0xff])
const u32 = (value) => Buffer.from([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff])
const utf16be = (text) => {
  const out = Buffer.alloc(text.length * 2)
  for (let index = 0; index < text.length; index += 1) out.writeUInt16BE(text.charCodeAt(index), index * 2)
  return out
}

function buildSfnt(tables) {
  const header = Buffer.concat([u32(0x00010000), u16(tables.length), u16(0), u16(0), u16(0)])
  const records = []
  const bodies = []
  let offset = 12 + tables.length * 16
  for (const [tag, body] of tables) {
    records.push(Buffer.concat([Buffer.from(tag, 'latin1'), u32(0), u32(offset), u32(body.length)]))
    bodies.push(body)
    offset += body.length
    const pad = (4 - (body.length % 4)) % 4
    if (pad > 0) bodies.push(Buffer.alloc(pad))
    offset += pad
  }
  return Buffer.concat([header, ...records, ...bodies])
}

function nameTable(family, subfamily) {
  const first = utf16be(family)
  const second = utf16be(subfamily)
  const strings = Buffer.concat([first, second])
  const header = Buffer.concat([u16(0), u16(2), u16(6 + 2 * 12)])
  const record = (nameId, length, offset) =>
    Buffer.concat([u16(3), u16(1), u16(0x409), u16(nameId), u16(length), u16(offset)])
  return Buffer.concat([header, record(1, first.length, 0), record(2, second.length, first.length), strings])
}

const head = Buffer.alloc(54)
head.writeUInt32BE(0x00010000, 0)
const maxp = Buffer.alloc(6)
maxp.writeUInt32BE(0x00010000, 0)
maxp.writeUInt16BE(123, 4)
const os2 = Buffer.alloc(64)
os2.writeUInt16BE(4, 0)
os2.writeUInt16BE(600, 4)
os2.writeUInt16BE(0x20, 62)

const TTF = buildSfnt([
  ['name', nameTable('Test Sans', 'Bold')],
  ['head', head],
  ['maxp', maxp],
  ['OS/2', os2]
])

/* --------------------------------- fonts ---------------------------------- */

const font = sniffFont(TTF)
check('a TrueType font is recognised', font?.format === 'TrueType', font)
check('the family comes from the name table', font?.family === 'Test Sans', font)
check('the style comes from the name table', font?.subfamily === 'Bold', font)
check('the weight comes from OS/2', font?.weight === 600, font)
check('the glyph count comes from maxp', font?.glyphs === 123, font)
check('the font line names the family and style', fontLine(font ?? { format: 'unknown' }).includes('Test Sans Bold'), fontLine(font ?? { format: 'unknown' }))
check('an HTML page is not a font', sniffFont(Buffer.from('<!doctype html><html><body>nope')) === null)

/* ------------------------------ asset kinds ------------------------------- */

const png = detectAsset(PNG, 'image/png', 'https://example.com/logo.png')
check('a PNG is an image', png.kind === 'image' && png.mime === 'image/png' && png.extension === '.png', png)
check('the image label carries its size', png.label.includes('1×1'), png.label)

const html = detectAsset(Buffer.from('<!DOCTYPE html><html><body>Sign in</body></html>'), 'text/html', 'https://example.com/x.png')
check('an HTML page is not saved as an asset', html.kind === 'html', html)

const svg = detectAsset(
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32"/></svg>'),
  'image/svg+xml',
  'https://example.com/mark.svg'
)
check('an SVG is an image with a size', svg.kind === 'image' && svg.mime === 'image/svg+xml', svg)
check('the SVG size comes from the root element', svg.svgSize?.width === 64 && svg.svgSize?.height === 32, svg.svgSize)

const fontAsset = detectAsset(TTF, 'application/octet-stream', 'https://example.com/TestSans.ttf')
check('a TTF is a font asset', fontAsset.kind === 'font' && fontAsset.extension === '.ttf', fontAsset)
check('the font asset carries its metadata', fontAsset.font?.family === 'Test Sans', fontAsset.font)

const woff2 = detectAsset(Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(64)]), '', 'https://example.com/font.woff2')
check('a WOFF2 is recognised as a font', woff2.kind === 'font' && woff2.extension === '.woff2', woff2)

const zip = detectAsset(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]), 'application/zip', 'https://example.com/pack.zip')
check('a ZIP is an archive', zip.kind === 'archive' && zip.extension === '.zip', zip)

check(
  'a binary that merely contains <html is not mistaken for a page',
  detectAsset(Buffer.from([0, 1, 2, 3, 0x3c, 0x68, 0x74, 0x6d, 0x6c, 0, 0]), '', '').kind !== 'html'
)

/* -------------------------------- names ---------------------------------- */

check('a URL name loses its extension and query', assetBaseName('https://example.com/a/My%20Logo.png?x=1') === 'My-Logo')
check('a reserved Windows name is prefixed', assetBaseName('https://example.com/con.png') === '_con')
check('a URL without a name falls back', assetBaseName('https://example.com/') === 'asset')
check('a rule-breaking name is made safe', !/[<>:"/\\|?*]/.test(assetBaseName('https://example.com/a<b>c.png')))
check('a user-supplied name is made safe', sanitizeAssetName('Hero Image') === 'Hero-Image')
check('a user-supplied reserved name is prefixed', sanitizeAssetName('nul') === '_nul')

/* ------------------------------ image report ------------------------------ */

function image(width, height, pixel) {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const [r, g, b, a] = pixel(x, y)
      data.set([r, g, b, a], index)
    }
  }
  return { width, height, data }
}

const solid = image(16, 16, () => [200, 30, 40, 255])
let analysis = analysePixels(solid)
check('the analysis reads the real size', analysis.width === 16 && analysis.height === 16, analysis)
check('an opaque image reports no transparency', analysis.hasAlpha === false && analysis.transparentShare === 0, analysis)
const dominant = analysis.dominant[0]
check(
  'the dominant colour is the fill',
  Boolean(dominant) && Math.abs(dominant.r - 200) <= 8 && Math.abs(dominant.g - 30) <= 8 && Math.abs(dominant.b - 40) <= 8,
  dominant
)
check('a solid image is classified as flat art or an icon', ['flat illustration', 'icon or logo', 'line art'].includes(analysis.classification.kind), analysis.classification)

const scaled = analysePixels({ ...solid, sourceWidth: 4000, sourceHeight: 2000 })
check('a downscaled preview keeps the real size', scaled.width === 4000 && scaled.height === 2000, scaled)
check('a downscaled preview keeps the real orientation', scaled.orientation === 'landscape' && scaled.megapixels === 8, scaled)
check('the content box is scaled back to the original', scaled.content?.width === 4000, scaled.content)

const transparent = image(16, 16, (x) => (x < 7 ? [20, 120, 220, 255] : [0, 0, 0, 0]))
analysis = analysePixels(transparent)
check('transparent pixels are counted', Math.abs(analysis.transparentShare - 9 / 16) < 0.01, analysis.transparentShare)
check('the content box covers only the visible part', analysis.content?.width === 7, analysis.content)
check('the quality note mentions a subject touching an edge', analysis.warnings.some((warning) => warning.includes('touches an edge')), analysis.warnings)

const pass = checkExpectations(analysis, { minWidth: 16, maxWidth: 64, transparent: true, orientation: 'square' })
check('fit checks pass for matching requirements', pass.fits === true, pass.checks)
const fail = checkExpectations(analysis, { minWidth: 100, orientation: 'landscape' })
check('fit checks fail for wrong requirements', fail.fits === false && fail.checks.length === 2, fail.checks)

const report = formatImageReport(analysis, {
  source: 'assets/test.png',
  bytes: 1024,
  format: 'PNG 16×16',
  detail: 'brief',
  verdict: pass
})
check('the report names the source and the size', report.includes('assets/test.png') && report.includes('16×16'), report)
check('the report carries the silhouette', report.includes('Transparency silhouette'), report)
check('the report carries the fit verdict', report.includes('Fit check: PASS'), report)
check('the report says what pixels cannot prove', report.includes('cannot confirm'), report)

if (failed > 0) {
  console.error(`\n${failed} asset check(s) failed`)
  process.exit(1)
}
console.log('\nALL ASSET CHECKS PASSED')
