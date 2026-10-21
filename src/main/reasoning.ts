/* ------------------------------------------------------------------------- *
 * Reading reasoning out of a stream.
 *
 * Reasoning arrives in three shapes, and a provider may use any of them:
 *   1. `delta.reasoning_content` — DeepSeek, Qwen, GLM, most proxies
 *   2. `delta.reasoning` / `delta.reasoning_details` — OpenRouter, Groq
 *   3. inline ` thinking…</think>` inside `delta.content` — Qwen and R1 builds
 *      served through gateways that do not split it out
 *
 * The third one is why the splitter exists: the tags straddle chunk
 * boundaries, so a tag half-received at the end of a chunk must be held back
 * until the rest of it arrives.
 * ------------------------------------------------------------------------- */

/** A piece of a stream, already classified. */
export interface ReasoningPiece {
  kind: 'text' | 'reasoning'
  text: string
}

const OPEN_TAGS = [' thinking', '<thinking>', '<think>', '<reasoning>', '<thought>']
const CLOSE_TAGS = ['</think>', '</thinking>', '</think>', '</reasoning>', '</thought>']

interface TagHit {
  index: number
  tag: string
}

/** Earliest tag in the buffer; on a tie the longer one wins. */
function findEarliest(buffer: string, tags: readonly string[]): TagHit | null {
  const lower = buffer.toLowerCase()
  let best: TagHit | null = null
  for (const tag of tags) {
    const index = lower.indexOf(tag)
    if (index === -1) continue
    if (!best || index < best.index || (index === best.index && tag.length > best.tag.length)) {
      best = { index, tag }
    }
  }
  return best
}

/** How many trailing characters could still be the beginning of a tag. */
function partialTagSuffix(buffer: string, tags: readonly string[]): number {
  const lower = buffer.toLowerCase()
  let hold = 0
  for (const tag of tags) {
    const max = Math.min(tag.length - 1, lower.length)
    for (let length = max; length > hold; length -= 1) {
      if (lower.endsWith(tag.slice(0, length))) {
        hold = length
        break
      }
    }
  }
  return hold
}

/** Splits `content` deltas into answer text and inline reasoning. */
export class ThinkTagSplitter {
  private buffer = ''
  private inside = false

  push(chunk: string): ReasoningPiece[] {
    if (chunk.length === 0) return []
    this.buffer += chunk
    const out: ReasoningPiece[] = []
    for (;;) {
      const tags = this.inside ? CLOSE_TAGS : OPEN_TAGS
      const hit = findEarliest(this.buffer, tags)
      if (hit) {
        if (hit.index > 0) {
          out.push({ kind: this.inside ? 'reasoning' : 'text', text: this.buffer.slice(0, hit.index) })
        }
        this.buffer = this.buffer.slice(hit.index + hit.tag.length)
        this.inside = !this.inside
        continue
      }
      const emit = this.buffer.length - partialTagSuffix(this.buffer, tags)
      if (emit > 0) {
        out.push({ kind: this.inside ? 'reasoning' : 'text', text: this.buffer.slice(0, emit) })
        this.buffer = this.buffer.slice(emit)
      }
      break
    }
    return out
  }

  /** Whatever is still buffered at the end of a step (a tag that never closed). */
  flush(): ReasoningPiece[] {
    if (this.buffer.length === 0) return []
    const piece: ReasoningPiece = {
      kind: this.inside ? 'reasoning' : 'text',
      text: this.buffer
    }
    this.buffer = ''
    return [piece]
  }
}

interface DeltaLike {
  reasoning?: unknown
  reasoning_content?: unknown
  reasoning_details?: unknown
}

/**
 * The reasoning text carried by one chunk, if any. Only one shape is used per
 * chunk: OpenRouter sends both `reasoning` and `reasoning_details`, and taking
 * both would show every thought twice.
 */
export function reasoningDeltaText(chunk: unknown): string {
  const choices = (chunk as { choices?: Array<{ delta?: DeltaLike }> })?.choices
  const delta = choices?.[0]?.delta
  if (!delta) return ''
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
    return delta.reasoning_content
  }
  if (typeof delta.reasoning === 'string' && delta.reasoning.length > 0) {
    return delta.reasoning
  }
  const details = delta.reasoning_details
  if (Array.isArray(details)) {
    return details
      .map((entry) =>
        typeof (entry as { text?: unknown })?.text === 'string'
          ? ((entry as { text: string }).text as string)
          : ''
      )
      .join('')
  }
  return ''
}

/** How many of the report's completion tokens were spent thinking. */
export function reasoningTokensFrom(chunk: unknown): number {
  const usage = (chunk as { usage?: { completion_tokens_details?: { reasoning_tokens?: unknown } } })
    ?.usage
  const tokens = usage?.completion_tokens_details?.reasoning_tokens
  return typeof tokens === 'number' && Number.isFinite(tokens) ? tokens : 0
}

export type DroppableParam = 'reasoning' | 'sampling'

const UNSUPPORTED_RE = /(unsupported|not supported|invalid|unexpected|unrecognized|unknown|extra)/i

/**
 * A 400 that names a parameter we sent: the provider does not know it. The
 * request is retried once without that group instead of failing.
 */
export function unsupportedParam(message: string, status: number | null): DroppableParam | null {
  if (status !== 400 && status !== 422) return null
  if (!UNSUPPORTED_RE.test(message)) return null
  if (/reasoning|thinking/i.test(message)) return 'reasoning'
  if (/temperature|top_p|top-p/i.test(message)) return 'sampling'
  return null
}
