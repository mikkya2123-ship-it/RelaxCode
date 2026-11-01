import { create } from 'zustand'
import type { TeamEvent, TeamState } from '@shared/team'

/** The Friendly Development team: state pushed from main plus the log tail. */

interface TeamStore {
  state: TeamState | null
  log: string[]
  open: boolean
  /** The working UI is locked until the mode ships; only the info screen shows. */
  locked: boolean
  unlocked: boolean
  applyEvent: (event: TeamEvent) => void
  openTeam: () => void
  closeTeam: () => void
  unlock: () => void
}

export const useTeamStore = create<TeamStore>((set) => ({
  state: null,
  log: [],
  open: false,
  locked: true,
  unlocked: false,

  applyEvent: (event) => {
    if (event.kind === 'state') {
      set({ state: event.state })
      return
    }
    set((s) => ({
      log: [...s.log.slice(-80), (event.level === 'error' ? '✕ ' : '') + event.line]
    }))
  },

  openTeam: () => set({ open: true }),
  closeTeam: () => set({ open: false }),
  unlock: () => set({ unlocked: true })
}))
