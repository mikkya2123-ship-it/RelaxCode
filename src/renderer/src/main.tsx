import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope'
import './styles/globals.css'
import App from './App'
import { useUiStore } from './stores/ui'
import { useEditorStore } from './stores/editor'
import { useExplorerStore } from './stores/explorer'
import { useToastStore } from './stores/toast'
import { useSettingsStore } from './stores/settings'
import { useChatStore } from './stores/chat'

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
