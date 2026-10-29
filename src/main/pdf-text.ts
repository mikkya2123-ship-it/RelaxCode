import { inflateRawSync } from 'node:zlib'

/**
 * Dependency-free PDF text extraction. It walks the raw objects, inflates
 * FlateDecode streams and pulls the strings out of the text operators
 * (`(…) Tj` and `[(…)…] TJ`). This covers the majority of text PDFs
 * (documentation, invoices, e-books exported from text). Scanned PDFs have
 * no text layer at all, and exotic font encodings may produce garbage — the
 * caller caps and reports honestly instead of pretending.
 */

const STREAM_BUF_CAP = 8 * 1024 * 1024

function decodePdfLiteral(text: string): string {
  // \( \) \\ and \ddd octal escapes inside PDF string literals.
  return text.replace(/\\([0-7]{1,3}|.)/g, (_match, seq: string) => {
    if (/^[0-7]+$/.test(seq)) return String.fromCharCode(parseInt(seq, 8))
    if (seq === 'n') return '\n'
    if (seq === 'r') return '\r'
    if (seq === 't') return '\t'
    return seq
  })
}

function textFromContentStream(content: string): string {
  const out: string[] = []
  // `[…] TJ` arrays hold per-glyph runs; each literal is a piece of the line.
  const arrayRegex = /\[((?:[^\][\\]|\\.)*)\]\s*TJ/g
  for (const match of content.matchAll(arrayRegex)) {
    const pieces = [...match[1].matchAll(/\((?:[^()\\]|\\.)*\)/g)].map((piece) =>
      decodePdfLiteral(piece[0].slice(1, -1))
    )
    // Negative kerning numbers inside TJ mean "same word, keep going".
    out.push(pieces.join(''))
  }
  content = content.replace(arrayRegex, ' ')
  const literalRegex = /\(((?:[^()\\]|\\.)*)\)\s*Tj/g
  for (const match of content.matchAll(literalRegex)) {
    out.push(decodePdfLiteral(match[1]))
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Extracts up to `maxChars` characters of text. Returns null when no text
 * could be pulled out (a scanned or font-mangled PDF) — the caller turns
 * that into an honest "cannot read this file" instead of an empty success.
 */
export function extractPdfText(buffer: Buffer, maxChars: number): string | null {
  const raw = buffer.toString('latin1')
  const collected: string[] = []
  let total = 0

  const streamRegex = /stream\r?\n?/g
  for (const match of raw.matchAll(streamRegex)) {
    if (total >= maxChars) break
    const start = match.index + match[0].length
    const end = raw.indexOf('endstream', start)
    if (end < 0) continue
    if (end - start > STREAM_BUF_CAP) continue
    const chunk = Buffer.from(raw.slice(start, end), 'latin1')

    let text = ''
    try {
      const inflated = inflateRawSync(chunk).toString('latin1')
      if (/(Tj|TJ)\s*$|TJ\b/.test(inflated)) text = textFromContentStream(inflated)
    } catch {
      // Not deflated — might be a plain (uncompressed) content stream.
      const asIs = chunk.toString('latin1')
      if (/(Tj|TJ)\b/.test(asIs)) text = textFromContentStream(asIs)
    }
    if (text.length > 0) {
      collected.push(text)
      total += text.length
    }
  }

  const joined = collected.join('\n\n').replace(/[^\S\n]+/g, ' ').trim()
  if (joined.length < 10) return null
  return joined.slice(0, maxChars)
}
