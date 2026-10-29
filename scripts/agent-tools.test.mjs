/**
 * Unit tests for the new agent-tool plumbing that is pure enough to run in
 * Node: the diagram layout/SVG renderer, the ZIP reader (DOCX/XLSX are ZIPs)
 * and the PDF text extractor.
 *
 * Run with: npm run test:agenttools
 */
import { deflateRawSync } from 'node:zlib'
import { diagramLayers, renderDiagramSvg } from '../src/shared/diagram.ts'
import { decodeXmlText, readZip } from '../src/main/zip-reader.ts'
import { extractPdfText } from '../src/main/pdf-text.ts'

let failed = 0
function check(label, condition, extra) {
  if (condition) {
    console.log('ok   -', label)
  } else {
    failed += 1
    console.log('FAIL -', label, extra === undefined ? '' : JSON.stringify(extra))
  }
}

// --- diagram ----------------------------------------------------------------

const spec = {
  title: 'shop',
  nodes: [
    { id: 'ui', label: 'Browser', sub: 'React' },
    { id: 'api', label: 'API', sub: 'Express' },
    { id: 'db', label: 'Database', sub: 'PostgreSQL' },
    { id: 'cache', label: 'Cache', sub: 'Redis' }
  ],
  edges: [
    { from: 'ui', to: 'api', label: 'https' },
    { from: 'api', to: 'db' },
    { from: 'api', to: 'cache' }
  ]
}

const layers = diagramLayers(spec)
check('three layers for a linear chain', layers.length === 3, layers)
check('browser is alone in layer 0', layers[0].length === 1 && layers[0][0].id === 'ui')
check(
  'db and cache share the deepest layer',
  layers[2].map((n) => n.id).sort().join(',') === 'cache,db',
  layers[2]
)

const cyclic = {
  nodes: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' }
  ],
  edges: [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'a' }
  ]
}
check('cycles do not hang', Array.isArray(diagramLayers(cyclic)))

const svg = renderDiagramSvg(spec)
check('svg has a viewBox', svg.includes('viewBox="0 0'))
check('labels are escaped in', !svg.includes('<script'))
check('edge label drawn', svg.includes('https'))

// --- zip reader ---------------------------------------------------------------

/** Minimal ZIP writer: stored + deflated entries, local headers + central dir. */
function buildZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const { name, data, deflate } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const payload = deflate ? deflateRawSync(data) : data
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(deflate ? 8 : 0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, payload)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(deflate ? 8 : 0, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + payload.length
  }
  const centralStart = offset
  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(centralStart, 16)
  return Buffer.concat([...locals, centralBuf, eocd])
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]
  return (crc ^ -1) >>> 0
}

const zipBuffer = buildZip([
  { name: 'stored.txt', data: Buffer.from('hello stored'), deflate: false },
  { name: 'dir/deflated.bin', data: Buffer.from('hello deflated and longer'), deflate: true }
])
const entries = readZip(zipBuffer)
check('both entries parsed', entries.length === 2, entries.map((e) => e.name))
check('stored entry data', entries.find((e) => e.name === 'stored.txt')?.data.toString() === 'hello stored')
check('deflated entry data', entries.find((e) => e.name === 'dir/deflated.bin')?.data.toString() === 'hello deflated and longer')
check('garbage is rejected', (() => { try { readZip(Buffer.from('not a zip at all')); return false } catch { return true } })())
check('xml entities decode', decodeXmlText('a &lt; b &amp;&amp; c &#65;') === 'a < b && c A')

// --- pdf text ------------------------------------------------------------------

function pdfWith(content, deflate) {
  const payload = deflate ? deflateRawSync(Buffer.from(content)) : Buffer.from(content)
  const header = Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${payload.length} ${deflate ? '/Filter /FlateDecode ' : ''}>>\nstream\n`)
  const footer = Buffer.from('\nendstream\nendobj\n%%EOF\n')
  return Buffer.concat([header, payload, footer])
}

const plain = pdfWith('BT (Hello plain world) Tj ET', false)
check('plain text extracted', extractPdfText(plain, 10000) === 'Hello plain world', extractPdfText(plain, 10000))

const zipped = pdfWith('BT (Hello zipped) Tj ET\n[(K) (er) (ned)] TJ ET', true)
const zippedText = extractPdfText(zipped, 10000) ?? ''
check('deflated text extracted', zippedText.includes('Hello zipped'), zippedText)
check('TJ arrays assembled', zippedText.includes('Kerned'), zippedText)

check('no text layer is honest', extractPdfText(Buffer.from('%PDF-1.4 fake with no streams'), 10000) === null)
check('escapes decode', extractPdfText(pdfWith('BT (line \\(1\\) of \\062) Tj ET', false), 10000) === 'line (1) of 2')

console.log(failed === 0 ? '\nall ok' : `\n${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
