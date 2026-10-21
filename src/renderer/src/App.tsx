import { useEffect, useRef, type JSX } from 'react'
import { useUiStore } from '@/stores/ui'
import { useExplorerStore } from '@/stores/explorer'
import { useEditorStore } from '@/stores/editor'
import { useChatStore, clearStoredChats } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { applyAppearance, watchSystemTheme } from '@/lib/appearance'
import { matchesCombo } from '@/lib/keymap'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/toaster'
import { TitleBar } from '@/components/layout/TitleBar'
import { Sidebar } from '@/components/layout/Sidebar'
import { EditorArea } from '@/components/layout/EditorArea'
import { ChatPanel } from '@/components/layout/ChatPanel'
import { StatusBar } from '@/components/layout/StatusBar'
import { SettingsScreen } from '@/components/settings/SettingsScreen'

/** Keys pressed inside a field belong to that field, not to the IDE. */
function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

export default function App(): JSX.Element {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const toggleChat = useUiStore((s) => s.toggleChat)
  const settings = useSettingsStore((s) => s.settings)
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const configured = useRef(false)

  // Shortcuts come from the settings; the defaults are the old hard-coded ones.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const keymap = useSettingsStore.getState().settings?.keymap
      if (!keymap) return
      const inSettings = useUiStore.getState().settingsOpen
      if (matchesCombo(event, keymap.openSettings) && !inSettings) {
        event.preventDefault()
        useUiStore.getState().openSettings()
        return
      }
      if (inSettings) return
      if (matchesCombo(event, keymap.toggleSidebar)) {
        event.preventDefault()
        toggleSidebar()
      } else if (matchesCombo(event, keymap.toggleChat)) {
        event.preventDefault()
        toggleChat()
      } else if (matchesCombo(event, keymap.save)) {
        event.preventDefault()
        void useEditorStore.getState().saveActive()
      } else if (matchesCombo(event, keymap.newChat)) {
        event.preventDefault()
        useUiStore.setState({ chatOpen: true })
        useChatStore.getState().newChat()
      }

      if (keymap.closeTab && matchesCombo(event, keymap.closeTab)) {
        event.preventDefault()
        void useEditorStore.getState().closeActive()
        return
      }

      // File operations act on the explorer, so a focused field keeps its keys.
      if (isTextInput(event.target)) return
      const explorer = useExplorerStore.getState()
      if (!explorer.rootPath || explorer.inline) return

      if (keymap.newFile && matchesCombo(event, keymap.newFile)) {
        event.preventDefault()
        explorer.beginCreate('file')
      } else if (keymap.newFolder && matchesCombo(event, keymap.newFolder)) {
        event.preventDefault()
        explorer.beginCreate('dir')
      } else if (keymap.rename && matchesCombo(event, keymap.rename)) {
        const entry = explorer.getEntry(explorer.selectedPath)
        if (entry) {
          event.preventDefault()
          explorer.beginRename(entry)
        }
      } else if (keymap.deleteEntry && matchesCombo(event, keymap.deleteEntry)) {
        const entry = explorer.getEntry(explorer.selectedPath)
        if (entry) {
          event.preventDefault()
          explorer.requestDelete(entry)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleSidebar, toggleChat])

  // `system` theme has to follow the OS while the app runs.
  useEffect(() => {
    const reapply = (): void => {
      const current = useSettingsStore.getState().settings
      if (current) applyAppearance(current)
    }
    return watchSystemTheme(reapply)
  }, [])

  // Every settings patch is applied to the interface immediately.
  useEffect(() => {
    if (settings) applyAppearance(settings)
  }, [settings])

  // Toggling hidden files or the excluded names has to redraw the tree now.
  const filesSignature = useRef<string | null>(null)
  useEffect(() => {
    if (!settings) return
    const signature = JSON.stringify(settings.files)
    if (filesSignature.current !== null && filesSignature.current !== signature) {
      const explorer = useExplorerStore.getState()
      if (explorer.rootPath) void explorer.loadDir(explorer.rootPath, true)
      for (const dir of Object.keys(explorer.expanded)) {
        if (explorer.expanded[dir]) void explorer.loadDir(dir, true)
      }
    }
    filesSignature.current = signature
  }, [settings])

  // Panel visibility is only taken from the settings on the first load, so a
  // toggle during the session is not undone by an unrelated patch.
  useEffect(() => {
    if (!settings || configured.current) return
    configured.current = true
    useUiStore.setState({ sidebarOpen: settings.ui.sidebarOpen, chatOpen: settings.ui.chatOpen })
    if (!settings.chat.persist) clearStoredChats()
  }, [settings])

  useEffect(() => {
    return window.relaxcode.workspace.onChanged((dirs) => {
      useExplorerStore.getState().handleExternalChange(dirs)
    })
  }, [])

  useEffect(() => {
    void useSettingsStore.getState().load()
    void useChatStore.getState().loadProcesses()
    return window.relaxcode.chat.onEvent((event) => {
      useChatStore.getState().handleEvent(event)
    })
  }, [])

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <TitleBar />
        <div className="relative flex min-h-0 flex-1">
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col">
            <EditorArea />
          </main>
          <ChatPanel />
          {settingsOpen && <SettingsScreen />}
        </div>
        <StatusBar />
      </div>
      <Toaster />
    </TooltipProvider>
  )
}
