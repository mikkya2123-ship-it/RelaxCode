import { inflateRawSync } from 'node:zlib'

/**
 * Minimal ZIP reader for the document tools: DOCX and XLSX are ZIP archives,
 * and Node already knows how to inflate. Only what those formats need is
 * implemented: entries found via the end-of-central-directory record, stored
 * and deflated payloads, files small enough to read whole.
 */

export interface ZipEntry {
  name: string
  data: Buffer
}

function findEocd(buffer: Buffer): number {
  // The record is at most 22 bytes + comment (capped at 65535 by the format).
  const from = Math.max(0, buffer.length - 22 - 65535)
  for (let index = buffer.length - 22; index >= from; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) return index
  }
  return -1
}

export function readZip(buffer: Buffer): ZipEntry[] {
  const eocd = findEocd(buffer)
  if (eocd < 0) throw new Error('not a ZIP archive (end-of-central-directory not found)')
  const entries = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const out: ZipEntry[] = []

  for (let index = 0; index < entries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')

    // The local header repeats the sizes but sometimes zeroes them (streamed
    // archives); the central directory is the source of truth, so its sizes
    // win and only the local name lengths are needed to find the payload.
    if (buffer.readUInt32LE(localOffset) === 0x04034b50) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26)
      const localExtraLength = buffer.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + localNameLength + localExtraLength
      const raw = buffer.subarray(dataStart, dataStart + compressedSize)
      try {
        const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw)
        out.push({ name, data })
      } catch {
        // A single broken entry must not sink the whole document.
      }
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  return out
}

/** Decodes XML character data and the handful of entities Word and Excel use. */
export function decodeXmlText(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
}
