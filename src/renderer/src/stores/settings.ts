import { create } from 'zustand'
import type { ModelInfo, PublicSettings, SettingsPatch } from '@shared/ipc'

export type ModelsState = 'idle' | 'loading' | 'ok' | 'error'

/** What a write produced, so the screen can toast the reason of a refusal. */
export interface SaveOutcome {
  ok: boolean
  error?: string
}

/**
 * The model list belongs to one connection. Comparing this key tells us when a
 * cached list is from another provider and has to be fetched again.
 */
function connectionKey(settings: PublicSettings | null): string {
  return settings ? `${settings.activeProviderId}|${settings.baseUrl}|${settings.hasApiKey}` : ''
}

interface SettingsState {
  settings: PublicSettings | null
  loaded: boolean
  saving: boolean
  /** Models available to the current connection, free ones first. */
  models: ModelInfo[]
  modelsState: ModelsState
  /** Why the list is empty, when the last attempt failed. */
  modelsError: string | null
  load: () => Promise<PublicSettings>
  save: (patch: SettingsPatch) => Promise<SaveOutcome>
  /** Applies a patch and returns the fresh settings (used by the settings screen). */
  apply: (patch: SettingsPatch) => Promise<SaveOutcome>
  /** Stores settings from the main process; drops a model list from another connection. */
  applySettings: (settings: PublicSettings) => void
  resetAll: () => Promise<SaveOutcome>
  exportFile: () => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
  importFile: () => Promise<SaveOutcome>
  setModels: (models: ModelInfo[]) => void
  loadModels: (force?: boolean) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  loaded: false,
  saving: false,
  models: [],
  modelsState: 'idle',
  modelsError: null,

  load: async () => {
    const settings = await window.relaxcode.settings.get()
    get().applySettings(settings)
    return settings
  },

  save: async (patch) => {
    const result = await window.relaxcode.settings.set(patch)
    if (result.ok) {
      get().applySettings(result.settings)
      return { ok: true }
    }
    return { ok: false, error: result.error }
  },

  apply: async (patch) => {
    set({ saving: true })
    try {
      return await get().save(patch)
    } finally {
      set({ saving: false })
    }
  },

  applySettings: (next) => {
    const stale = connectionKey(get().settings) !== connectionKey(next)
    set({
      settings: next,
      loaded: true,
      ...(stale ? { models: [], modelsState: 'idle' as ModelsState, modelsError: null } : {})
    })
  },

  resetAll: async () => {
    const settings = await window.relaxcode.settings.reset()
    get().applySettings(settings)
    return { ok: true }
  },

  exportFile: async () => {
    return await window.relaxcode.settings.exportFile()
  },

  importFile: async () => {
    const result = await window.relaxcode.settings.importFile()
    if (result.ok) {
      get().applySettings(result.settings)
      return { ok: true }
    }
    return { ok: false, error: result.error }
  },

  setModels: (models) => set({ models, modelsState: 'ok' }),

  /**
   * Fetches the model list once and keeps it for the chat panel. The list is
   * cached until a connection fails, so opening the picker stays instant.
   */
  loadModels: async (force = false) => {
    const state = get()
    if (state.modelsState === 'loading') return
    if (!force && state.modelsState === 'ok') return

    set({ modelsState: 'loading', modelsError: null })
    try {
      const settings = state.settings ?? (await get().load())
      const result = await window.relaxcode.models.list({ baseUrl: settings.baseUrl })
      if (result.ok) set({ models: result.models, modelsState: 'ok', modelsError: null })
      else set({ models: [], modelsState: 'error', modelsError: result.error ?? null })
    } catch (error) {
      set({
        models: [],
        modelsState: 'error',
        modelsError: error instanceof Error ? error.message : String(error)
      })
    }
  }
}))
