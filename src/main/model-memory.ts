/* ------------------------------------------------------------------------- *
 * The disk half of "this model loops when asked to think".
 *
 * Kept in its own file next to settings.json instead of inside it: this is not
 * something the user configured, it is something the app observed, and a reset
 * of the settings must not wipe it (nor must a corrupt entry break settings).
 *
 * Every call takes the user-data directory, so the layer can be tested on a
 * temporary folder and the main process stays the only thing that knows where
 * Electron put it.
 * ------------------------------------------------------------------------- */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ThinkingLevel } from '../shared/reasoning'
import {
  isMemoryFresh,
  isWeakToolCaller,
  levelAfterLoops,
  memoryKey,
  pruneMemory,
  pruneWeakness,
  weaknessOf,
  type ReasoningMemory,
  type WeaknessMemory
} from '../shared/model-memory.ts'

interface MemoryFile {
  version: 2
  entries: Record<string, ReasoningMemory>
  /** Weak-tool-caller counters; absent in files written before version 2. */
  weak: Record<string, WeaknessMemory>
}

const FILE_NAME = 'model-memory.json'

function filePath(dir: string): string {
  return join(dir, FILE_NAME)
}

function read(dir: string): MemoryFile {
  try {
    const raw: unknown = JSON.parse(readFileSync(filePath(dir), 'utf8'))
    const entries =
      raw && typeof raw === 'object' ? (raw as { entries?: unknown }).entries : undefined
    const weak = raw && typeof raw === 'object' ? (raw as { weak?: unknown }).weak : undefined
    return {
      version: 2,
      entries:
        entries && typeof entries === 'object'
          ? (entries as Record<string, ReasoningMemory>)
          : {},
      weak: weak && typeof weak === 'object' ? (weak as Record<string, WeaknessMemory>) : {}
    }
  } catch {
    // No file yet, or a damaged one: nothing is remembered, which is safe.
    return { version: 2, entries: {}, weak: {} }
  }
}

function write(dir: string, data: MemoryFile): void {
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(filePath(dir), JSON.stringify(data, null, 1), 'utf8')
  } catch {
    // Memory is best-effort; it must never cost the user a run.
  }
}

/** How many times this connection has looped while reasoning (0 when clean). */
export function rememberedLoops(baseUrl: string, model: string, dir: string): number {
  const entry = read(dir).entries[memoryKey(baseUrl, model)]
  return isMemoryFresh(entry) ? entry.loops : 0
}

/** Records one more loop for the connection and returns the new count. */
export function rememberLoop(
  baseUrl: string,
  model: string,
  level: ThinkingLevel,
  dir: string
): number {
  const data = read(dir)
  const key = memoryKey(baseUrl, model)
  const previous = data.entries[key]
  const loops = (isMemoryFresh(previous) ? previous.loops : 0) + 1
  data.entries[key] = { loops, level, at: Date.now() }
  write(dir, { ...data, entries: pruneMemory(data.entries) })
  return loops
}

/** The connection's current weak-tool-caller fail count (0 = clean). */
export function rememberedWeakness(baseUrl: string, model: string, dir: string): number {
  return weaknessOf(read(dir).weak[memoryKey(baseUrl, model)])
}

/**
 * Records one more weak-tool-caller sign (text tool calls, broken JSON
 * arguments, unknown tool names) and returns the new count.
 */
export function rememberWeakFail(baseUrl: string, model: string, dir: string): number {
  const data = read(dir)
  const key = memoryKey(baseUrl, model)
  const fails = rememberedWeakness(baseUrl, model, dir) + 1
  data.weak[key] = { fails, at: Date.now() }
  write(dir, { ...data, weak: pruneWeakness(data.weak) })
  return fails
}

/** True when this connection has proven itself too clumsy for raw tools. */
export function isWeakModel(baseUrl: string, model: string, dir: string): boolean {
  return isWeakToolCaller(read(dir).weak[memoryKey(baseUrl, model)])
}

/**
 * The level to put on the wire for this connection, lowered by what it did
 * before. `loops` is 0 for a connection that has never looped.
 */
export function thinkingWithMemory(
  level: ThinkingLevel,
  baseUrl: string,
  model: string,
  dir: string
): { level: ThinkingLevel; loops: number } {
  const loops = rememberedLoops(baseUrl, model, dir)
  return { level: levelAfterLoops(level, loops), loops }
}
