/* ------------------------------------------------------------------------- *
 * Token saving — three modes, one honest rule each.
 *
 * The point is NOT to send a worse conversation. It is to stop paying for the
 * parts of it the model has already used: old tool dumps it will never read
 * again, turns that are already summarised in the code and in the files, and
 * thinking nobody asked to keep.
 *
 * The window that survives is chosen so the model still knows:
 *   - what the user asked for at the start (the goal),
 *   - what the user asked last (the instruction being worked on),
 *   - the step in flight (an assistant tool call with its results, unbroken —
 *     splitting those makes providers reject the whole request),
 * and a short, generated digest of everything that was left out.
 *
 * The module is shared: the main process builds the request from it and the UI
 * explains it, so the description on screen cannot drift from the wire.
 * ------------------------------------------------------------------------- */

import type { ThinkingLevel } from './reasoning'

export type TokenSaving = 'off' | 'on' | 'super'

/** Ordered from "send everything" to "the tightest window that still works". */
export const TOKEN_SAVING_MODES: readonly TokenSaving[] = ['off', 'on', 'super']

export interface SavingPlan {
  /**
   * Most messages (history only, the system prompt is not counted) sent to the
   * model. 0 = no cap beyond the user's own "history" setting.
   */
  maxMessages: number
  /** Character budget for the kept history. 0 = unlimited. */
  maxChars: number
  /** Old tool results are cut to this many characters. 0 = left untouched. */
  toolResultChars: number
  /** The deepest thinking this mode allows; null = whatever the chat asks for. */
  thinkingCap: ThinkingLevel | null
}

export const SAVING_PLANS: Record<TokenSaving, SavingPlan> = {
  // Everything the user asked for, nothing hidden.
  off: { maxMessages: 0, maxChars: 0, toolResultChars: 0, thinkingCap: null },
  // Roughly six turns of conversation and tool results that stay readable.
  on: { maxMessages: 14, maxChars: 18_000, toolResultChars: 3_500, thinkingCap: null },
  // The goal, the current step and a digest — plus thinking kept at its floor,
  // because reasoning tokens are the biggest single cost of a reasoning model.
  super: { maxMessages: 8, maxChars: 7_000, toolResultChars: 1_200, thinkingCap: 'low' }
}

/** A mode that arrives over IPC is checked, not trusted. */
export function isTokenSaving(value: unknown): value is TokenSaving {
  return typeof value === 'string' && (TOKEN_SAVING_MODES as readonly string[]).includes(value)
}

export function savingPlan(mode: TokenSaving | undefined): SavingPlan {
  return SAVING_PLANS[isTokenSaving(mode) ? mode : 'off']
}

/** True when the mode touches the request at all — for hints and switches. */
export function savingIsActive(mode: TokenSaving | undefined): boolean {
  return isTokenSaving(mode) && mode !== 'off'
}

const LEVEL_RANK: Record<ThinkingLevel, number> = { off: 0, low: 1, medium: 2, high: 3 }

/**
 * What actually goes on the wire for a chat's level: a saving mode may lower it,
 * never raise it. Shown in the thinking sheet so the slider cannot lie.
 */
export function effectiveThinking(level: ThinkingLevel, mode: TokenSaving | undefined): ThinkingLevel {
  const cap = savingPlan(mode).thinkingCap
  if (!cap) return level
  return LEVEL_RANK[level] <= LEVEL_RANK[cap] ? level : cap
}
