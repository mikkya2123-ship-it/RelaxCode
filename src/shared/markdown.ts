/**
 * A small, tolerant markdown renderer for chat answers: headings, lists,
 * fenced code, quotes and the inline basics (bold, italic, code, `[n]`
 * citations). It is deliberately line-based and never throws — the assistant
 * text arrives as a live stream, so a half-typed `**` must render as text,
 * not crash or swallow the rest.
 */

export type MdInline =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'code'; text: string }
  /** A `[n]` marker; whether it is a real citation is decided by the caller. */
  | { type: 'cite'; text: string; cite: number }

export type MdBlock =
  | { type: 'p'; lines: MdInline[][] }
  | { type: 'h'; level: 1 | 2 | 3; lines: MdInline[][] }
  | { type: 'ul'; items: MdInline[][] }
  | { type: 'ol'; items: MdInline[][]; start: number }
  | { type: 'quote'; lines: MdInline[][] }
  | { type: 'code'; lang: string; text: string }

const UL_DOUBLE = /^[-–—]{2}\s*(.*)$/
const UL_SINGLE = /^[-*•–]\s+(.*)$/
const OL_MARK = /^(\d{1,2})[.)]\s+(.*)$/
const HEADING = /^(#{1,3})\s+(.*)$/
const FENCE_OPEN = /^```\s*([\w+-]*)\s*$/
const FENCE_CLOSE = /^```\s*$/
const CITE = /^\[(\d{1,2})\]/

/**
 * List marker of a line, if any. A single dash needs a space after it (so a
 * negative number like "-5" stays text), but the doubled dash weak models
 * emit ("--**Пункт:** …") is always a marker, space or not.
 */
function ulContent(line: string): string | null {
  const doubled = UL_DOUBLE.exec(line)
  if (doubled) return doubled[1]
  const single = UL_SINGLE.exec(line)
  if (single) return single[1]
  return null
}

export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = []
  let plain = ''
  const flush = (): void => {
    if (plain.length > 0) {
      out.push({ type: 'text', text: plain })
      plain = ''
    }
  }
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '`') {
      const end = text.indexOf('`', i + 1)
      if (end > i + 0 && end > i) {
        flush()
        out.push({ type: 'code', text: text.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    if (ch === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2)
      if (end > i) {
        flush()
        out.push({ type: 'bold', text: text.slice(i + 2, end) })
        i = end + 2
        continue
      }
    }
    if (ch === '*') {
      const end = text.indexOf('*', i + 1)
      if (end > i + 1) {
        flush()
        out.push({ type: 'italic', text: text.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    const cite = CITE.exec(text.slice(i))
    if (cite) {
      flush()
      out.push({ type: 'cite', text: cite[0], cite: Number(cite[1]) })
      i += cite[0].length
      continue
    }
    plain += ch
    i += 1
  }
  flush()
  return out
}

export function parseMarkdown(text: string): MdBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MdBlock[] = []
  let paragraph: string[] = []
  const flushParagraph = (): void => {
    if (paragraph.length > 0) blocks.push({ type: 'p', lines: paragraph.map(parseInline) })
    paragraph = []
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (FENCE_OPEN.test(line.trim())) {
      flushParagraph()
      const lang = (FENCE_OPEN.exec(line.trim())?.[1] ?? '').toLowerCase()
      const body: string[] = []
      i += 1
      // An unclosed fence renders as code to the end: that is what a stream
      // mid-typing looks like, and it reads better than raw backticks.
      while (i < lines.length && !FENCE_CLOSE.test(lines[i].trim())) {
        body.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1
      while (body.length > 0 && body[body.length - 1].trim().length === 0) body.pop()
      blocks.push({ type: 'code', lang, text: body.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flushParagraph()
      blocks.push({ type: 'h', level: heading[1].length as 1 | 2 | 3, lines: [parseInline(heading[2])] })
      i += 1
      continue
    }

    if (/^>\s?/.test(line)) {
      flushParagraph()
      const body: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^>\s?/, ''))
        i += 1
      }
      blocks.push({ type: 'quote', lines: body.map(parseInline) })
      continue
    }

    if (ulContent(line) !== null) {
      flushParagraph()
      const items: MdInline[][] = []
      while (i < lines.length) {
        const content = ulContent(lines[i])
        if (content === null) break
        items.push(parseInline(content))
        i += 1
      }
      blocks.push({ type: 'ul', items })
      continue
    }

    const ordered = OL_MARK.exec(line)
    if (ordered) {
      flushParagraph()
      const items: MdInline[][] = []
      const start = Number(ordered[1])
      while (i < lines.length) {
        const match = OL_MARK.exec(lines[i])
        if (!match) break
        items.push(parseInline(match[2]))
        i += 1
      }
      blocks.push({ type: 'ol', items, start })
      continue
    }

    if (line.trim().length === 0) {
      flushParagraph()
      i += 1
      continue
    }

    paragraph.push(line)
    i += 1
  }
  flushParagraph()
  return blocks
}
