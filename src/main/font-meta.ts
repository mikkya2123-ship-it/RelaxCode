import { inflateSync } from 'node:zlib'

/**
 * Font identification without a font library.
 *
 * A downloaded "font" is often a web page, a zip or a woff2 that a desktop app
 * cannot open. Reading the container and the name table is enough to tell the
 * model what it actually got: family, style, weight and glyph count.
 *
 * Only metadata is read; the file is never executed or rasterised.
 */

export type FontFormat =
  | 'TrueType'
  | 'OpenType'
  | 'WOFF'
  | 'WOFF2'
  | 'TrueType Collection'
  | 'Type 1'
  | 'unknown'

export interface FontInfo {
  format: FontFormat
  /** Family name from the name table. */
  family?: string
  subfamily?: string
  fullName?: string
  postScriptName?: string
  /** CSS-style weight: 100…900. */
  weight?: number
  italic?: boolean
  /** Number of glyphs in the font. */
  glyphs?: number
  /** Fonts inside a collection. */
  collections?: number
}

const u16 = (data: Uint8Array, offset: number): number =>
  (data[offset]! << 8) | data[offset + 1]!
const u32 = (data: Uint8Array, offset: number): number =>
  ((data[offset]! << 24) | (data[offset + 1]! << 16) | (data[offset + 2]! << 8) | data[offset + 3]!) >>> 0
const tag = (data: Uint8Array, offset: number): string =>
  String.fromCharCode(data[offset]!, data[offset + 1]!, data[offset + 2]!, data[offset + 3]!)

function latin1(data: Uint8Array): string {
  let out = ''
  for (const byte of data) out += String.fromCharCode(byte)
  return out
}

function utf16be(data: Uint8Array): string {
  let out = ''
  for (let index = 0; index + 1 < data.length; index += 2) {
    out += String.fromCharCode(u16(data, index))
  }
  return out
}

function clean(value: string): string | undefined {
  const text = value.replace(/\0/g, '').trim()
  return text.length > 0 ? text : undefined
}

interface FontTables {
  [tag: string]: Uint8Array
}

/** Finds a table inside an sfnt (TrueType/OpenType) at `base`. */
function readSfntTables(buffer: Uint8Array, base: number): FontTables | null {
  if (base + 12 > buffer.length) return null
  const version = u32(buffer, base)
  if (
    version !== 0x00010000 &&
    version !== 0x4f54544f && // OTTO
    version !== 0x74727565 && // true
    version !== 0x74797031 // typ1
  ) {
    return null
  }
  const numTables = u16(buffer, base + 4)
  if (numTables === 0 || numTables > 512) return null
  const tables: FontTables = {}
  for (let index = 0; index < numTables; index += 1) {
    const record = base + 12 + index * 16
    if (record + 16 > buffer.length) break
    const name = tag(buffer, record)
    const offset = u32(buffer, record + 8)
    const length = u32(buffer, record + 12)
    if (offset + length > buffer.length) continue
    tables[name] = buffer.subarray(offset, offset + length)
  }
  return tables
}

interface NameRecord {
  platform: number
  language: number
  nameId: number
  value?: string
}

function readNameTable(table: Uint8Array | undefined): Map<number, string> {
  const names = new Map<number, string>()
  if (!table || table.length < 6) return names
  const count = u16(table, 2)
  const stringOffset = u16(table, 4)
  const records: NameRecord[] = []
  for (let index = 0; index < count; index += 1) {
    const record = 6 + index * 12
    if (record + 12 > table.length) break
    const platform = u16(table, record)
    const language = u16(table, record + 4)
    const nameId = u16(table, record + 6)
    const length = u16(table, record + 8)
    const offset = u16(table, record + 10)
    const start = stringOffset + offset
    if (start + length > table.length) continue
    const bytes = table.subarray(start, start + length)
    records.push({ platform, language, nameId, value: platform === 0 || platform === 3 ? utf16be(bytes) : latin1(bytes) })
  }
  // English Windows names first, then any Windows name, then the Mac ones.
  const rank = (record: NameRecord): number =>
    record.platform === 3 && (record.language === 0x409 || record.language === 0)
      ? 0
      : record.platform === 3
        ? 1
        : record.platform === 0
          ? 2
          : 3
  for (const record of [...records].sort((a, b) => rank(a) - rank(b))) {
    const value = record.value ? clean(record.value) : undefined
    if (value && !names.has(record.nameId)) names.set(record.nameId, value)
  }
  return names
}

function describeTables(tables: FontTables, format: FontFormat): FontInfo {
  const names = readNameTable(tables.name)
  const info: FontInfo = { format }

  const family = names.get(16) ?? names.get(1)
  const subfamily = names.get(17) ?? names.get(2)
  const fullName = names.get(4)
  const postScriptName = names.get(6)
  if (family) info.family = family
  if (subfamily) info.subfamily = subfamily
  if (fullName) info.fullName = fullName
  if (postScriptName) info.postScriptName = postScriptName

  const os2 = tables['OS/2']
  if (os2 && os2.length >= 64) {
    const weight = u16(os2, 4)
    if (weight >= 1 && weight <= 1000) info.weight = weight
    const selection = u16(os2, 62)
    info.italic = (selection & 0x01) !== 0
    if (!info.weight) info.weight = (selection & 0x20) !== 0 ? 700 : 400
  }

  const head = tables.head
  if (head && head.length >= 46) {
    const style = u16(head, 44)
    if (style & 0x02) info.italic = true
    if (info.weight === undefined) info.weight = (style & 0x01) !== 0 ? 700 : 400
  }

  const maxp = tables.maxp
  if (maxp && maxp.length >= 6) {
    const glyphs = u16(maxp, 4)
    if (glyphs > 0) info.glyphs = glyphs
  }

  return info
}

function readWoff(buffer: Uint8Array): FontInfo | null {
  if (buffer.length < 44) return null
  const flavor = u32(buffer, 4)
  const numTables = u16(buffer, 12)
  if (numTables === 0 || numTables > 512) return null
  const tables: FontTables = {}
  for (let index = 0; index < numTables; index += 1) {
    const record = 44 + index * 20
    if (record + 20 > buffer.length) break
    const name = tag(buffer, record)
    const offset = u32(buffer, record + 4)
    const compressed = u32(buffer, record + 8)
    const original = u32(buffer, record + 12)
    if (offset + compressed > buffer.length) continue
    const raw = buffer.subarray(offset, offset + compressed)
    if (compressed === original) {
      tables[name] = raw
      continue
    }
    try {
      tables[name] = new Uint8Array(inflateSync(raw))
    } catch {
      // A corrupt table only costs its metadata, not the whole report.
    }
  }
  const info = describeTables(tables, 'WOFF')
  if (flavor === 0x4f54544f) info.format = 'WOFF'
  return info
}

/**
 * Identifies a downloaded font from its bytes. Returns null when the file is
 * not a font at all, which is the common case for an HTML error page.
 */
export function sniffFont(buffer: Uint8Array): FontInfo | null {
  if (buffer.length < 16) return null
  const signature = tag(buffer, 0)

  if (signature === 'wOFF') return readWoff(buffer)
  if (signature === 'wOF2') return { format: 'WOFF2' }
  if (signature === 'ttcf') {
    const collections = u32(buffer, 8)
    const first = u32(buffer, 12)
    const tables = first < buffer.length ? readSfntTables(buffer, first) : null
    const info = tables ? describeTables(tables, 'TrueType Collection') : { format: 'TrueType Collection' as const }
    if (collections > 0) info.collections = collections
    return info
  }

  const version = u32(buffer, 0)
  const isSfnt =
    version === 0x00010000 || version === 0x4f54544f || version === 0x74727565 || version === 0x74797031
  if (isSfnt) {
    const tables = readSfntTables(buffer, 0)
    if (!tables) return null
    const format: FontFormat =
      version === 0x4f54544f ? 'OpenType' : version === 0x74797031 ? 'Type 1' : 'TrueType'
    return describeTables(tables, format)
  }

  const text = latin1(buffer.subarray(0, 64))
  if (text.startsWith('%!PS-AdobeFont') || text.startsWith('%!FontType1')) return { format: 'Type 1' }
  return null
}

/** One line a model can put in its reasoning: "Inter SemiBold, 2,345 glyphs". */
export function fontLine(info: FontInfo): string {
  const name = [info.family, info.subfamily].filter(Boolean).join(' ')
  const weight = info.weight ? `, weight ${info.weight}` : ''
  const italic = info.italic ? ', italic' : ''
  const glyphs = info.glyphs ? `, ${info.glyphs.toLocaleString('en-US')} glyphs` : ''
  const collection = info.collections ? `, ${info.collections} fonts` : ''
  return `${name || info.fullName || info.postScriptName || 'unnamed font'} — ${info.format}${weight}${italic}${glyphs}${collection}`
}
