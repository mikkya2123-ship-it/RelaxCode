import { create } from 'zustand'

export interface Workspace {
  path: string
}

interface UiState {
  sidebarOpen: boolean
  chatOpen: boolean
  /** The Screen dock right of the chat. */
  screenOpen: boolean
  /** The terminal dock at the bottom of the editor. */
  terminalOpen: boolean
  terminalHeight: number
  settingsOpen: boolean
  /** The detailed token/context report opened from the context ring. */
  usageOpen: boolean
  workspace: Workspace | null
  toggleSidebar: () => void
  toggleChat: () => void
  toggleScreen: () => void
  toggleTerminal: () => void
  setTerminalHeight: (height: number) => void
  openSettings: () => void
  closeSettings: () => void
  openUsage: () => void
  closeUsage: () => void
  openWorkspace: () => Promise<void>
  openRecent: (path: string) => Promise<boolean>
  setWorkspace: (workspace: Workspace | null) => void
}

const applyWorkspace = (path: string): void => {
  useUiStore.setState({ workspace: { path } })
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  chatOpen: true,
  screenOpen: false,
  terminalOpen: false,
  terminalHeight: 260,
  settingsOpen: false,
  usageOpen: false,
  workspace: null,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
  toggleScreen: () => set((s) => ({ screenOpen: !s.screenOpen })),
  toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),
  setTerminalHeight: (height) => set({ terminalHeight: Math.max(140, Math.round(height)) }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openUsage: () => set({ usageOpen: true }),
  closeUsage: () => set({ usageOpen: false }),
  openWorkspace: async () => {
    const result = await window.relaxcode.workspace.openFolder()
    if (result) applyWorkspace(result.path)
  },
  openRecent: async (path) => {
    const result = await window.relaxcode.workspace.openPath(path)
    if (!result) return false
    applyWorkspace(result.path)
    return true
  },
  setWorkspace: (workspace) => set({ workspace })
}))
