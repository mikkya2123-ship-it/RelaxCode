import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope'
import './styles/globals.css'
import App from './App'
import { TrayMenu } from './components/tray/TrayMenu'
import { useUiStore } from './stores/ui'
import { useEditorStore } from './stores/editor'
import { useExplorerStore } from './stores/explorer'
import { useToastStore } from './stores/toast'
import { useSettingsStore } from './stores/settings'
import { useChatStore } from './stores/chat'

// The tray popup loads the same bundle with '#tray-menu' and renders only the
// compact cosmic menu, not the whole IDE.
if (window.location.hash === '#tray-menu') {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <TrayMenu />
    </React.StrictMode>
  )
} else {
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__relaxcode = {
      ui: useUiStore,
      editor: useEditorStore,
      explorer: useExplorerStore,
      toast: useToastStore,
      settings: useSettingsStore,
      chat: useChatStore
    }
  }

  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
