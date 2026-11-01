import { create } from 'zustand'
import type { ArenaEvent, ArenaState } from '@shared/ipc'

/**
 * The Arena store: the tournament state pushed from main plus a structured
 * live feed per contestant — every tool call, every result and every frame
 * the contestant captures of its own work.
 */

/** One line (or picture) of the contestant's live work. */
export interface ArenaFeedLine {
  kind: 'tool' | 'ok' | 'fail' | 'error' | 'text' | 'image'
  text?: string
  /** Screenshot the contestant took of its own site (data URL). */
  src?: string
}

interface ArenaStore {
  state: ArenaState | null
  feeds: Record<string, ArenaFeedLine[]>
  /** Run id → the dev-server URL the contestant currently serves. */
  previews: Record<string, string>
  /** Renderer clock of the moment the tournament started. */
  tournamentStart: number | null
  open: boolean
  applyEvent: (event: ArenaEvent) => void
  openArena: () => void
  closeArena: () => void
  reset: () => void
}

const FEED_LINES = 150
const FEED_TEXT_CAP = 5000

export const useArenaStore = create<ArenaStore>((set) => ({
  state: null,
  feeds: {},
  previews: {},
  tournamentStart: null,
  open: false,

  applyEvent: (event) => {
    if (event.kind === 'state') {
      // The tournament start also anchors the clock: a server born after it is
      // a contestant's own; anything older is leftover garbage.
      return set((s) => ({
        state: event.state,
        tournamentStart:
          s.tournamentStart ?? (event.state.status === 'running' ? Date.now() : s.tournamentStart)
      }))
    }
    if (event.event.type === 'processes') {
      const runId = event.runId
      const started = useArenaStore.getState().tournamentStart ?? 0
      const fresh = event.event.processes.filter(
        (p) => p.running && p.port !== null && p.startedAt >= started
      )
      const url = fresh.length > 0 ? `http://localhost:${fresh[0].port}` : ''
      return set((s) => ({ previews: { ...s.previews, [runId]: url } }))
    }
    const { runId, event: chatEvent } = event
    set((s) => {
      const lines = s.feeds[runId] ?? []
      const push = (line: ArenaFeedLine): ArenaFeedLine[] =>
        [...lines, line].slice(-FEED_LINES)

      if (chatEvent.type === 'delta') {
        // Words stream into the current text line; tools open new lines.
        const last = lines[lines.length - 1]
        if (last?.kind === 'text' && (last.text?.length ?? 0) < FEED_TEXT_CAP) {
          const next = lines.slice(0, -1)
          next.push({ kind: 'text', text: (last.text ?? '') + chatEvent.text })
          return { feeds: { ...s.feeds, [runId]: next } }
        }
        return { feeds: { ...s.feeds, [runId]: push({ kind: 'text', text: chatEvent.text }) } }
      }
      if (chatEvent.type === 'tool-start') {
        const args = chatEvent.args.trim().slice(0, 90)
        return {
          feeds: {
            ...s.feeds,
            [runId]: push({ kind: 'tool', text: `${chatEvent.name}${args ? ' ' + args : ''}` })
          }
        }
      }
      if (chatEvent.type === 'tool-result') {
        const next = [...lines]
        // A screenshot the contestant took of its own page: show it inline.
        const meta = chatEvent.meta
        if (meta && meta.kind === 'image') {
          next.push({ kind: 'image', src: meta.src })
        }
        next.push({ kind: chatEvent.ok ? 'ok' : 'fail', text: chatEvent.summary })
        return { feeds: { ...s.feeds, [runId]: next.slice(-FEED_LINES) } }
      }
      if (chatEvent.type === 'error') {
        return { feeds: { ...s.feeds, [runId]: push({ kind: 'error', text: chatEvent.message }) } }
      }
      return s
    })
  },

  openArena: () => set({ open: true }),
  closeArena: () => set({ open: false }),
  reset: () => set({ state: null, feeds: {}, previews: {}, tournamentStart: null })
}))
