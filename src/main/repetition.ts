/* ------------------------------------------------------------------------- *
 * Catching a model that thinks in circles.
 *
 * A weak model at a low temperature can fall into a repetition loop: it writes
 * one sentence, then the same sentence again, then again. In the answer that
 * costs tokens; in the *reasoning* channel it costs the whole turn, because the
 * step never ends and the user waits for an answer that is never written. One
 * real run spent 57 s producing 21 000 characters of two alternating sentences
 * and no answer at all.
 *
 * The guard watches the tail of the stream and reports the cycle as soon as a
 * fragment repeats back to back. The caller keeps one copy, drops the rest and
 * stops the stream, so the thinking block stays readable and the turn can be
 * salvaged instead of hanging.
 * ------------------------------------------------------------------------- */

export interface RepetitionHit {
  /** Length of the fragment that repeats. */
  period: number
  /** How many times the fragment repeated, back to back. */
  repeats: number
  /** Characters beyond the first copy — how much of the tail is redundant. */
  extraChars: number
}

export interface RepetitionOptions {
  /** Shortest fragment worth calling a loop. */
  minPeriod?: number
  /** Longest fragment worth calling a loop. */
  maxPeriod?: number
  /** Repeats needed before the stream is cut. */
  minRepeats?: number
  /** How much of the tail is inspected. */
  tailChars?: number
}

const DEFAULTS: Required<RepetitionOptions> = {
  minPeriod: 12,
  maxPeriod: 240,
  minRepeats: 5,
  // Same ceiling as the thinking block the UI keeps: a loop longer than this is
  // already unwatchable, and the tail is what tells us how many copies to drop.
  tailChars: 20000
}

/**
 * The earliest period in the tail of `input` that repeats `minRepeats` times or
 * more, or `null`. A short period is preferred: a fragment repeated twice as
 * long is the same loop described in bigger blocks.
 */
export function findRepetition(
  input: string,
  options: RepetitionOptions = {}
): RepetitionHit | null {
  const { minPeriod, maxPeriod, minRepeats, tailChars } = { ...DEFAULTS, ...options }
  const tail = input.length > tailChars ? input.slice(-tailChars) : input
  const longest = Math.min(maxPeriod, Math.floor(tail.length / minRepeats))
  for (let period = minPeriod; period <= longest; period += 1) {
    const last = tail.slice(-period)
    if (tail.slice(-2 * period, tail.length - period) !== last) continue
    // Count the whole run, not just enough to prove a loop: the caller drops
    // `repeats - 1` copies, so a partial count would leave copies behind.
    let repeats = 2
    for (;;) {
      const end = tail.length - repeats * period
      if (end - period < 0) break
      if (tail.slice(end - period, end) !== last) break
      repeats += 1
    }
    if (repeats >= minRepeats) return { period, repeats, extraChars: (repeats - 1) * period }
  }
  return null
}

/** Same check, but fed chunk by chunk as a stream arrives. */
export class RepetitionGuard {
  private readonly options: Required<RepetitionOptions>
  private tail = ''
  private pending = 0

  constructor(options: RepetitionOptions = {}) {
    this.options = { ...DEFAULTS, ...options }
  }

  push(text: string): RepetitionHit | null {
    if (text.length === 0) return null
    this.tail = (this.tail + text).slice(-this.options.tailChars)
    this.pending += text.length
    // The scan is not free and a single chunk rarely changes the outcome, so it
    // runs once roughly a whole fragment has arrived.
    if (this.pending < this.options.minPeriod) return null
    if (this.tail.length < this.options.minPeriod * this.options.minRepeats) return null
    this.pending = 0
    return findRepetition(this.tail, this.options)
  }

  reset(): void {
    this.tail = ''
    this.pending = 0
  }
}
