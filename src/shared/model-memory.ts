/* ------------------------------------------------------------------------- *
 * What a model has taught us about itself.
 *
 * Some weak models cannot handle the reasoning channel at all: asked to think,
 * they repeat one sentence until the turn runs out (see main/repetition.ts).
 * Paying for that discovery twice is a waste of the user's time, so the
 * connection remembers the loop and the next request asks for less thinking —
 * and, after a repeated loop, for none at all.
 *
 * This half is pure: the rule and the key. The file-backed store lives in the
 * main process, so the rule can be tested without touching the user's disk.
 * ------------------------------------------------------------------------- */

import type { ThinkingLevel } from './reasoning'

/** Loops a connection gets before reasoning is switched off for it. */
export const LOOPS_BEFORE_OFF = 2

/** Old loops are forgotten: the model behind an endpoint may be updated. */
export const MEMORY_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Newest connections kept; the rest are dropped so the file cannot grow. */
export const MEMORY_LIMIT = 50

export interface ReasoningMemory {
  /** How many times this connection looped while reasoning. */
  loops: number
  /** The level it looped at, for the record. */
  level: ThinkingLevel
  /** When the loop was last seen (ms since epoch). */
  at: number
}

/**
 * Signs of a weak tool-caller, accumulated per connection: tool calls printed
 * as text, arguments that were not valid JSON, unknown tool names. A strong
 * model stays at 0 forever and keeps its raw tools; a clumsy one crosses the
 * threshold and the app starts holding its hand (Blender recipes instead of
 * raw bpy, for now).
 */
export interface WeaknessMemory {
  fails: number
  at: number
}

/** Fails before a connection is treated as a weak tool-caller. */
export const WEAKNESS_THRESHOLD = 3

const RANK: Record<ThinkingLevel, number> = { off: 0, low: 1, medium: 2, high: 3 }
const BY_RANK: readonly ThinkingLevel[] = ['off', 'low', 'medium', 'high']

/**
 * One entry per connection: the same model served by another endpoint is a
 * different model as far as loops are concerned. A trailing slash and the case
 * of the address must not create a second identity for the same connection.
 */
export function memoryKey(baseUrl: string, model: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '').toLowerCase()
  return `${base}|${model.trim().toLowerCase()}`
}

export function isMemoryFresh(
  entry: ReasoningMemory | undefined,
  now = Date.now()
): entry is ReasoningMemory {
  return (
    !!entry &&
    Number.isFinite(entry.loops) &&
    Number.isFinite(entry.at) &&
    Math.abs(now - entry.at) < MEMORY_TTL_MS
  )
}

export function isWeaknessFresh(
  entry: WeaknessMemory | undefined,
  now = Date.now()
): entry is WeaknessMemory {
  return (
    !!entry && Number.isFinite(entry.fails) && Number.isFinite(entry.at) && Math.abs(now - entry.at) < MEMORY_TTL_MS
  )
}

/** The fail count that is still remembered for this connection (0 = clean). */
export function weaknessOf(entry: WeaknessMemory | undefined, now = Date.now()): number {
  return isWeaknessFresh(entry, now) ? entry.fails : 0
}

/** A connection crosses the line into "hand-holding" territory. */
export function isWeakToolCaller(entry: WeaknessMemory | undefined, now = Date.now()): boolean {
  return weaknessOf(entry, now) >= WEAKNESS_THRESHOLD
}

/**
 * The level to actually ask for. One loop costs a step of depth; a second one
 * ends the experiment — a model that loops twice is not going to be talked out
 * of it, and the user is better served by a plain answer.
 */
export function levelAfterLoops(level: ThinkingLevel, loops: number): ThinkingLevel {
  if (loops <= 0) return level
  if (loops >= LOOPS_BEFORE_OFF) return 'off'
  return BY_RANK[Math.max(0, RANK[level] - 1)]
}

/** Drops stale entries and keeps the newest `limit`. */
export function pruneMemory(
  entries: Record<string, ReasoningMemory>,
  now = Date.now(),
  limit = MEMORY_LIMIT
): Record<string, ReasoningMemory> {
  const fresh = Object.entries(entries).filter(([, entry]) => isMemoryFresh(entry, now))
  fresh.sort((a, b) => b[1].at - a[1].at)
  return Object.fromEntries(fresh.slice(0, limit))
}

export function pruneWeakness(
  entries: Record<string, WeaknessMemory>,
  now = Date.now(),
  limit = MEMORY_LIMIT
): Record<string, WeaknessMemory> {
  const fresh = Object.entries(entries).filter(([, entry]) => isWeaknessFresh(entry, now))
  fresh.sort((a, b) => b[1].at - a[1].at)
  return Object.fromEntries(fresh.slice(0, limit))
}
