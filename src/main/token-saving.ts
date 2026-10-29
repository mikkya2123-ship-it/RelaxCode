/* ------------------------------------------------------------------------- *
 * The wire-side half of token saving.
 *
 * `trimForWire` is pure: it takes the system prompt and the conversation, and
 * returns the exact array that should be sent. Nothing is deleted from the
 * chat — the renderer keeps the full transcript; only the request shrinks.
 *
 * Two rules make this safe rather than cheap:
 *   1. An assistant tool call and its results are never separated. A provider
 *      rejects the request outright if it sees a tool result whose call is gone.
 *   2. The goal (first user message), the instruction being worked on (last user
 *      message) and the current tool round always go out in full. What is left
 *      out is described in a short digest, so the model does not silently lose
 *      the thread and start inventing continuity.
 * ------------------------------------------------------------------------- */

import type { SavingPlan } from '../shared/token-saving'

/** The minimum of the OpenAI message shape this module looks at. */
export interface WireMessage {
  role: string
  content?: unknown
  tool_calls?: unknown
  tool_call_id?: string
}

export interface TrimmedWire<T extends WireMessage> {
  /** The system prompt, with the digest of what was left out appended. */
  system: string
  messages: T[]
  /** Messages that did not go out. */
  dropped: number
  /** Characters those messages held. */
  droppedChars: number
  /** Old tool results that were cut down before sending. */
  shortened: number
  /** Characters cut out of them. */
  shortenedChars: number
}

interface ToolCallShape {
  function?: { name?: unknown; arguments?: unknown }
}

function textOf(message: WireMessage): string {
  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && 'text' in part
          ? String((part as { text?: unknown }).text ?? '')
          : ''
      )
      .join(' ')
  }
  return ''
}

/**
 * One block is one message, except that an assistant message with tool calls
 * carries its tool results with it. Keeping blocks whole is what lets the
 * window start anywhere without breaking the call/result pairs.
 */
function groupBlocks<T extends WireMessage>(history: readonly T[]): T[][] {
  const blocks: T[][] = []
  for (const message of history) {
    const last = blocks[blocks.length - 1]
    if (last && last[0].role === 'assistant' && message.role === 'tool') {
      last.push(message)
    } else {
      blocks.push([message])
    }
  }
  return blocks
}

function clip(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean
}

function callArgs(raw: unknown): { name: string; args: Record<string, unknown> } | null {
  const call = raw as ToolCallShape
  const name = typeof call?.function?.name === 'string' ? call.function.name : ''
  if (!name) return null
  let args: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(String(call.function?.arguments ?? '{}'))
    if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>
  } catch {
    // A half-streamed or broken argument list is not worth a digest line.
  }
  return { name, args }
}

function callsOf(message: WireMessage): Array<{ name: string; args: Record<string, unknown> }> {
  if (!Array.isArray(message.tool_calls)) return []
  return message.tool_calls
    .map((raw) => callArgs(raw))
    .filter((call): call is { name: string; args: Record<string, unknown> } => call !== null)
}

function labelOf(call: { name: string; args: Record<string, unknown> }): string {
  const first = ['path', 'from', 'command', 'query', 'url', 'pattern', 'file']
    .map((key) => call.args[key])
    .find((value): value is string => typeof value === 'string' && value.length > 0)
  return first ? `${call.name} ${clip(first, 60)}` : call.name
}

/** What a dropped stretch of the conversation did, in a handful of tokens. */
function digestOf(dropped: readonly WireMessage[][]): string {
  const flat = dropped.flat()
  if (flat.length === 0) return ''

  const toolResults = flat.filter((message) => message.role === 'tool')
  const actions: string[] = []
  const touched = new Set<string>()

  for (const block of dropped) {
    const [head] = block
    const calls = head ? callsOf(head) : []
    if (calls.length === 0) continue
    const result = block.find((message) => message.role === 'tool')
    const status = result
      ? textOf(result).startsWith('ERROR')
        ? ' — failed'
        : textOf(result).startsWith('OK')
          ? ' — ok'
          : ''
      : ''
    actions.push(calls.map(labelOf).join(', ') + status)
    for (const call of calls) {
      if (call.name !== 'write_file' && call.name !== 'edit_file' && call.name !== 'create_folder') {
        continue
      }
      const path = call.args.path
      if (typeof path === 'string' && path.length > 0) touched.add(path)
    }
  }

  const lastUser = [...flat].reverse().find((message) => message.role === 'user')
  const lines: string[] = [
    '[Token saving: the middle of this conversation is not attached in full.]',
    `Left out: ${flat.length} earlier messages${toolResults.length > 0 ? `, ${toolResults.length} of them tool results` : ''}.`
  ]
  if (lastUser) {
    lines.push(`The user's request in that stretch: "${clip(textOf(lastUser), 180)}"`)
  }
  if (actions.length > 0) {
    lines.push(`Steps already run: ${actions.slice(-10).join('; ')}.`)
  }
  if (touched.size > 0) {
    lines.push(`Files already written or edited: ${[...touched].slice(-10).join(', ')}.`)
  }
  lines.push(
    'Do not assume anything about the omitted part; re-read a file if you need its current contents.'
  )
  return lines.join('\n')
}

export function trimForWire<T extends WireMessage>(
  system: string,
  history: readonly T[],
  plan: SavingPlan
): TrimmedWire<T> {
  const untouched: TrimmedWire<T> = {
    system,
    messages: history as T[],
    dropped: 0,
    droppedChars: 0,
    shortened: 0,
    shortenedChars: 0
  }
  if (plan.maxChars <= 0 && plan.maxMessages <= 0 && plan.toolResultChars <= 0) return untouched
  if (history.length === 0) return untouched

  const blocks = groupBlocks(history)
  const sizes = blocks.map((block) =>
    block.reduce((total, message) => total + textOf(message).length, 0)
  )
  const keep = new Set<number>()
  const last = blocks.length - 1

  // The step in flight, the instruction it serves and the original goal.
  keep.add(last)
  for (let index = last; index >= 0; index -= 1) {
    if (blocks[index].some((message) => message.role === 'user')) {
      keep.add(index)
      break
    }
  }
  for (let index = 0; index <= last; index += 1) {
    if (blocks[index].some((message) => message.role === 'user')) {
      keep.add(index)
      break
    }
  }

  let chars = [...keep].reduce((total, index) => total + sizes[index], 0)
  let keptCount = [...keep].reduce((total, index) => total + blocks[index].length, 0)
  for (let index = last; index >= 0; index -= 1) {
    if (keep.has(index)) continue
    if (plan.maxChars > 0 && chars + sizes[index] > plan.maxChars) continue
    if (plan.maxMessages > 0 && keptCount + blocks[index].length > plan.maxMessages) continue
    keep.add(index)
    chars += sizes[index]
    keptCount += blocks[index].length
  }

  const keptBlocks: T[][] = []
  const droppedBlocks: T[][] = []
  let dropped = 0
  let droppedChars = 0
  blocks.forEach((block, index) => {
    if (keep.has(index)) {
      keptBlocks.push(block)
    } else {
      droppedBlocks.push(block)
      dropped += block.length
      droppedChars += sizes[index]
    }
  })

  // Copy, so the caller's array (and what the UI keeps) stays untouched.
  const messages = keptBlocks.flatMap((block) => block.map((message) => ({ ...message })))

  let shortened = 0
  let shortenedChars = 0
  if (plan.toolResultChars > 0) {
    // The last kept block is the round in flight: its results are exactly what
    // the model is about to act on, so they are never cut.
    const liveFrom = messages.length - (keptBlocks[keptBlocks.length - 1]?.length ?? 0)
    for (let index = 0; index < liveFrom; index += 1) {
      const message = messages[index]
      if (message.role !== 'tool') continue
      const text = textOf(message)
      if (text.length <= plan.toolResultChars) continue
      const head = Math.max(1, Math.round(plan.toolResultChars * 0.6))
      const tail = Math.max(0, plan.toolResultChars - head)
      const cut = text.length - head - tail
      message.content = `${text.slice(0, head)}\n… [${cut} characters cut by token saving] …\n${tail > 0 ? text.slice(-tail) : ''}`
      shortened += 1
      shortenedChars += cut
    }
  }

  const digest = digestOf(droppedBlocks)
  return {
    system: digest ? `${system}\n\n${digest}` : system,
    messages,
    dropped,
    droppedChars,
    shortened,
    shortenedChars
  }
}
