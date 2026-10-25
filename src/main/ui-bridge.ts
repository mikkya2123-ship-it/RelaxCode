import type { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { IPC } from '@shared/ipc'

/**
 * The one place the main process talks to the renderer window. Tool code lives
 * in plain modules without window access; everything a tool needs to show or
 * ask the user goes through here.
 *
 * Push events are fire-and-forget (a missing window means "nobody is
 * looking"). `request` is a push plus a timed wait for the renderer's reply,
 * which arrives on the UI_REPLY invoke channel.
 */

let window: BrowserWindow | null = null

export function setUiWindow(next: BrowserWindow | null): void {
  window = next
}

export function hasUiWindow(): boolean {
  return !!window && !window.isDestroyed()
}

/** Sends an event to the renderer; false when there is no window to show it. */
export function pushUi(channel: string, payload?: unknown): boolean {
  if (!hasUiWindow()) return false
  window?.webContents.send(channel, payload)
  return true
}

const replies = new Map<string, { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }>()

/** Resolves a pending `request` — called by the UI_REPLY ipc handler. */
export function resolveUiReply(replyId: string, value: unknown): void {
  const pending = replies.get(replyId)
  if (!pending) return
  replies.delete(replyId)
  clearTimeout(pending.timer)
  pending.resolve(value)
}

/**
 * Push an event and wait for the renderer's answer. Resolves null when the
 * window is gone or the renderer does not answer in time.
 */
export function requestUi<T>(channel: string, payload: Record<string, unknown>, timeoutMs = 30000): Promise<T | null> {
  if (!hasUiWindow()) return Promise.resolve(null)
  const replyId = randomUUID()
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => {
      replies.delete(replyId)
      resolve(null)
    }, timeoutMs)
    replies.set(replyId, { resolve: resolve as (value: unknown) => void, timer })
    window?.webContents.send(channel, { replyId, ...payload })
  })
}

/** Fires a chat message from the main process (schedulers, watchers). */
export function pushAgentPrompt(text: string): boolean {
  return pushUi(IPC.UI_AGENT_PROMPT, { text })
}
