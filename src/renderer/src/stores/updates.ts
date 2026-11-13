import { create } from 'zustand'
import type { UpdateState } from '@shared/updater'

/**
 * The renderer side of the updater: main owns the real state and pushes every
 * change, the store only mirrors it and exposes the three actions the dialog
 * needs.
 */
interface UpdatesState {
  state: UpdateState | null
  apply: (state: UpdateState) => void
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
}

export const useUpdatesStore = create<UpdatesState>((set) => ({
  state: null,

  apply: (state) => set({ state }),

  check: async () => {
    set({ state: await window.relaxcode.updates.check() })
  },

  download: async () => {
    set({ state: await window.relaxcode.updates.download() })
  },

  install: async () => {
    await window.relaxcode.updates.install()
  }
}))

/** Subscribes to the main process; returns the unsubscribe callback. */
export function subscribeUpdates(): () => void {
  const apply = (state: UpdateState): void => useUpdatesStore.getState().apply(state)
  void window.relaxcode.updates
    .get()
    .then(apply)
    .catch(() => {
      // The bridge is absent only in a broken build; the button stays hidden.
    })
  return window.relaxcode.updates.onState(apply)
}
