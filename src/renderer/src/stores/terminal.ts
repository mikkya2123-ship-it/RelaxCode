import { create } from 'zustand'
import type { TerminalSessionInfo } from '@shared/ipc'

/**
 * The IDE terminal panel state: sessions live in the main process (real
 * shells); this store keeps their output lines, the active tab and the
 * command history of the input line.
 */

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g
const MAX_LINES = 3000

interface TerminalState {
  sessions: TerminalSessionInfo[]
  activeId: string | null
  lines: Record<string, string[]>
  running: Record<string, boolean>
  /** Commands typed into the panel, oldest first. */
  history: string[]
  subscribe: () => () => void
  refresh: () => Promise<void>
  create: () => Promise<void>
  close: (id: string) => void
  setActive: (id: string) => void
  input: (line: string) => void
  stop: () => void
  clearActive: () => void
}

function append(map: Record<string, string[]>, id: string, text: string): Record<string, string[]> {
  const current = map[id] ?? []
  const next = text.length > 0 ? [...current, ...text.replace(ANSI_RE, '').split('\n')] : [...current]
  if (next.length > MAX_LINES) next.splice(0, next.length - MAX_LINES)
  return { ...map, [id]: next }
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: [],
  activeId: null,
  lines: {},
  running: {},
  history: [],

  subscribe: () =>
    window.relaxcode.term.onOutput((event) => {
      set((state) => {
        const lines = event.text.length > 0 ? append(state.lines, event.id, event.text) : state.lines
        if (event.done) {
          return { lines, running: { ...state.running, [event.id]: false } }
        }
        return { lines }
      })
    }),

  refresh: async () => {
    const { sessions, agentLog } = await window.relaxcode.term.list()
    set((state) => {
      const lines = { ...state.lines }
      if (agentLog.length > 0 && (lines.agent?.length ?? 0) === 0) {
        lines.agent = agentLog.slice()
      }
      const known = new Set(sessions.map((session) => session.id))
      for (const id of Object.keys(lines)) {
        if (!known.has(id)) delete lines[id]
      }
      const activeId =
        state.activeId && known.has(state.activeId)
          ? state.activeId
          : (sessions.find((session) => session.kind === 'shell')?.id ?? sessions[0]?.id ?? null)
      return { sessions, lines, activeId }
    })
  },

  create: async () => {
    const session = await window.relaxcode.term.create()
    set((state) => ({
      sessions: [...state.sessions.filter((item) => item.id !== session.id), session],
      activeId: session.id,
      lines: { ...state.lines, [session.id]: state.lines[session.id] ?? [] }
    }))
  },

  close: (id) => {
    window.relaxcode.term.close(id)
    set((state) => {
      const sessions = state.sessions.filter((item) => item.id !== id)
      const lines = { ...state.lines }
      delete lines[id]
      return {
        sessions,
        lines,
        activeId: state.activeId === id ? (sessions[0]?.id ?? null) : state.activeId
      }
    })
  },

  setActive: (id) => set({ activeId: id }),

  input: (line) => {
    const id = get().activeId
    if (!id) return
    window.relaxcode.term.input(id, line)
    set((state) => ({
      lines: append(state.lines, id, `❯ ${line}`),
      running: { ...state.running, [id]: true },
      history: [...state.history.filter((item) => item !== line), line].slice(-100)
    }))
  },

  stop: () => {
    const id = get().activeId
    if (id) window.relaxcode.term.stop(id)
  },

  clearActive: () => {
    const id = get().activeId
    if (id) set((state) => ({ lines: { ...state.lines, [id]: [] } }))
  }
}))
