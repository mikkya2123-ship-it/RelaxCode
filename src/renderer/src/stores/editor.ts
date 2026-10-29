import { create } from 'zustand'
import type { FileErrorReason } from '@shared/ipc'
import { isPathInside, isSamePath, nameOf, stripTrailingSeparators } from '@shared/entries'
import { languageForFile } from '@/lib/language'
import { dictionaries } from '@shared/i18n'
import { toast } from '@/stores/toast'
import { useI18nStore } from '@/lib/i18n'

export interface OpenFile {
  path: string
  name: string
  content: string
  savedContent: string
  language: string
}

interface EditorState {
  files: OpenFile[]
  activePath: string | null
  openFile: (path: string, name: string) => Promise<void>
  closeFile: (path: string) => Promise<void>
  setActive: (path: string) => void
  updateContent: (path: string, content: string) => void
  saveFile: (path: string) => Promise<boolean>
  saveActive: () => Promise<boolean>
  /** Explorer rename/move: open tabs follow their file to the new path. */
  remapPaths: (from: string, to: string) => void
  /** Explorer delete: tabs of the removed entry are dropped without saving. */
  discardPathsUnder: (path: string) => void
  closeOthers: (path: string) => Promise<void>
  closeAll: () => Promise<void>
  closeActive: () => Promise<void>
}

function reasonToText(reason: FileErrorReason): string {
  const locale = useI18nStore.getState().locale
  const dict = dictionaries[locale]
  const key = `file.reason.${reason}` as const
  return dict[key] ?? dict['file.reason.unknown']
}

export const useEditorStore = create<EditorState>((set, get) => ({
  files: [],
  activePath: null,

  openFile: async (path, name) => {
    const existing = get().files.find((f) => f.path === path)
    if (existing) {
      set({ activePath: path })
      return
    }
    const result = await window.relaxcode.file.read(path)
    if (!result.ok) {
      toast(reasonToText(result.reason), path)
      return
    }
    const file: OpenFile = {
      path,
      name: result.name || name,
      content: result.content,
      savedContent: result.content,
      language: languageForFile(result.name || name)
    }
    set((s) => ({ files: [...s.files, file], activePath: path }))
  },

  closeFile: async (path) => {
    const file = get().files.find((f) => f.path === path)
    if (file && file.content !== file.savedContent) {
      await get().saveFile(path)
    }
    set((s) => {
      const files = s.files.filter((f) => f.path !== path)
      let activePath = s.activePath
      if (activePath === path) {
        const index = s.files.findIndex((f) => f.path === path)
        const next = files[Math.min(index, files.length - 1)]
        activePath = next?.path ?? null
      }
      return { files, activePath }
    })
  },

  setActive: (path) => set({ activePath: path }),

  updateContent: (path, content) =>
    set((s) => ({
      files: s.files.map((f) => (f.path === path ? { ...f, content } : f))
    })),

  saveFile: async (path) => {
    const file = get().files.find((f) => f.path === path)
    if (!file) return false
    if (file.content === file.savedContent) return true
    const result = await window.relaxcode.file.write(path, file.content)
    if (!result.ok) {
      const locale = useI18nStore.getState().locale
      toast(dictionaries[locale]['editor.saveFailed'], path, 'error')
      return false
    }
    set((s) => ({
      files: s.files.map((f) => (f.path === path ? { ...f, savedContent: f.content } : f))
    }))
    return true
  },

  saveActive: async () => {
    const active = get().activePath
    if (!active) return false
    return get().saveFile(active)
  },

  remapPaths: (from, to) =>
    set((s) => {
      const remap = (path: string): string => {
        if (isSamePath(path, from)) return to
        if (!isPathInside(from, path)) return path
        return to + path.slice(stripTrailingSeparators(from).length)
      }
      const files = s.files.map((file) => {
        const path = remap(file.path)
        if (path === file.path) return file
        const name = nameOf(path)
        return { ...file, path, name, language: languageForFile(name) }
      })
      return { files, activePath: s.activePath ? remap(s.activePath) : null }
    }),

  discardPathsUnder: (path) =>
    set((s) => {
      const gone = (candidate: string): boolean =>
        isSamePath(candidate, path) || isPathInside(path, candidate)
      const files = s.files.filter((file) => !gone(file.path))
      let activePath = s.activePath
      if (activePath && gone(activePath)) {
        const index = s.files.findIndex((file) => file.path === activePath)
        const next = files[Math.min(Math.max(index, 0), files.length - 1)] ?? null
        activePath = next?.path ?? null
      }
      return { files, activePath }
    }),

  closeOthers: async (path) => {
    const others = get().files.filter((file) => file.path !== path)
    for (const file of others) await get().closeFile(file.path)
  },

  closeAll: async () => {
    const all = [...get().files]
    for (const file of all) await get().closeFile(file.path)
  },

  closeActive: async () => {
    const active = get().activePath
    if (!active) return
    await get().closeFile(active)
  }
}))
