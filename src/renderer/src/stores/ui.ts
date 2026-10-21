import { create } from 'zustand'

export interface Workspace {
  path: string
}

interface UiState {
  sidebarOpen: boolean
  chatOpen: boolean
  settingsOpen: boolean
  workspace: Workspace | null
  toggleSidebar: () => void
  toggleChat: () => void
  openSettings: () => void
  closeSettings: () => void
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
  settingsOpen: false,
  workspace: null,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
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
