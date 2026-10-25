/* ------------------------------------------------------------------------- *
 * A small line diff (LCS) for the file-tool cards: turn "before" and "after"
 * into a unified patch plus the +added/−removed counts shown on the row.
 * Dependency-free and capped, so a model pasting a huge file cannot make the
 * chat pay for it.
 * ------------------------------------------------------------------------- */

export interface DiffCounts {
  added: number
  removed: number
}

export interface DiffResult extends DiffCounts {
  /** Unified-diff text (`@@`, `-`, `+` lines) or '' when there is nothing to show. */
  patch: string
}

/** Both sides must fit under this for the O(n·m) table; larger files degrade. */
const LCS_CAP = 1500
const PATCH_LINE_CAP = 500
const CONTEXT = 3

type Op = { kind: 'same' | 'add' | 'remove'; line: string }

function diffOps(a: string[], b: string[]): Op[] {
  // Whole-block fallback for oversized inputs: one remove hunk plus one add.
  if (a.length > LCS_CAP || b.length > LCS_CAP) {
    return [
      ...a.map((line) => ({ kind: 'remove' as const, line })),
      ...b.map((line) => ({ kind: 'add' as const, line }))
    ]
  }
  const width = b.length + 1
  const table = new Int32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'same', line: a[i] })
      i += 1
      j += 1
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      ops.push({ kind: 'remove', line: a[i] })
      i += 1
    } else {
      ops.push({ kind: 'add', line: b[j] })
      j += 1
    }
  }
  while (i < a.length) {
    ops.push({ kind: 'remove', line: a[i] })
    i += 1
  }
  while (j < b.length) {
    ops.push({ kind: 'add', line: b[j] })
    j += 1
  }
  return ops
}

/** Unified diff with a few context lines, like `diff -U3`. */
export function diffText(oldText: string, newText: string, path = ''): DiffResult {
  if (oldText === newText) return { patch: '', added: 0, removed: 0 }
  // An empty side is zero lines, not one empty line.
  const a = oldText === '' ? [] : oldText.split('\n')
  const b = newText === '' ? [] : newText.split('\n')
  const ops = diffOps(a, b)
  const added = ops.filter((op) => op.kind === 'add').length
  const removed = ops.filter((op) => op.kind === 'remove').length

  const lines: string[] = []
  if (path !== '') lines.push(`--- ${path}`, `+++ ${path}`)

  let position = 0
  let oldLine = 1
  let newLine = 1
  while (position < ops.length) {
    // Find the next change; keep the previous CONTEXT lines with it.
    while (position < ops.length && ops[position].kind === 'same') {
      position += 1
      oldLine += 1
      newLine += 1
    }
    if (position >= ops.length) break
    const hunkStart = position
    const contextStart = Math.max(0, hunkStart - CONTEXT)
    // Positions at the start of the hunk context.
    let hOld = oldLine
    let hNew = newLine
    for (let back = hunkStart - 1; back >= contextStart; back -= 1) {
      hOld -= ops[back].kind === 'add' ? 0 : 1
      hNew -= ops[back].kind === 'remove' ? 0 : 1
    }
    // The hunk runs until CONTEXT unchanged lines after the last change.
    let end = hunkStart
    let lastChange = hunkStart
    while (end < ops.length) {
      if (ops[end].kind !== 'same') {
        lastChange = end
        end += 1
        continue
      }
      let quiet = 0
      while (end + quiet < ops.length && ops[end + quiet].kind === 'same') quiet += 1
      if (quiet > CONTEXT * 2 || end + quiet >= ops.length) break
      end += quiet
    }
    const hunkEnd = Math.min(ops.length, Math.max(end, lastChange + 1) + CONTEXT)
    let countOld = 0
    let countNew = 0
    const body: string[] = []
    for (let at = contextStart; at < hunkEnd; at += 1) {
      const op = ops[at]
      if (op.kind === 'same') {
        body.push(` ${op.line}`)
        countOld += 1
        countNew += 1
      } else if (op.kind === 'remove') {
        body.push(`-${op.line}`)
        countOld += 1
      } else {
        body.push(`+${op.line}`)
        countNew += 1
      }
    }
    lines.push(`@@ -${hOld},${countOld} +${hNew},${countNew} @@`, ...body)
    // Advance the outer position/coordinates past the hunk.
    for (let at = hunkStart; at < hunkEnd; at += 1) {
      if (ops[at].kind !== 'add') oldLine += 1
      if (ops[at].kind !== 'remove') newLine += 1
    }
    position = hunkEnd
    if (lines.length > PATCH_LINE_CAP) {
      lines.push('… [diff truncated]')
      break
    }
  }

  return { patch: lines.join('\n'), added, removed }
}

/** The badge text for a card row: "+12 −3" or '' when nothing changed. */
export function diffCountsLabel(counts: DiffCounts): string {
  if (counts.added === 0 && counts.removed === 0) return ''
  return `+${counts.added} −${counts.removed}`
}
