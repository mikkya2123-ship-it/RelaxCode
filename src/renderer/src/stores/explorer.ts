import { create } from 'zustand'
import type { DirEntry, EntryOpFailure, EntryOpResult } from '@shared/ipc'
import type { EntryKind } from '@shared/entries'
import type { TKey } from '@shared/i18n'
import {
  createPathSegments,
  entryNameIssue,
  isPathInside,
  isSamePath,
  joinPath,
  nameOf,
  parentDirOf,
  relativeTo,
  stripTrailingSeparators
} from '@shared/entries'
import { useSettingsStore } from '@/stores/settings'
import { useEditorStore } from '@/stores/editor'
import { translate, useI18nStore } from '@/lib/i18n'

/** The row that is being typed into: a new entry or a new name for one. */
export interface InlineEdit {
  kind: 'create' | 'rename'
  /** Folder icon vs file icon while creating. */
  entryKind: EntryKind
  /** Directory the new entry lands in (for rename: the parent of the target). */
  parentPath: string
  /** Existing entry for rename, null for create. */
  targetPath: string | null
  initialValue: string
  /** Indent level of the input row in the tree (0 = workspace root). */
  depth: number
}

interface ExplorerState {
  childrenByDir: Record<string, DirEntry[]>
  expanded: Record<string, boolean>
  loading: Record<string, boolean>
  selectedPath: string | null
  rootPath: string | null
  inline: InlineEdit | null
  /** Validation message shown under the inline input. */
  inlineError: string | null
  /** Entry waiting for the delete confirmation dialog. */
  pendingDelete: DirEntry | null
  /** Why the last delete was refused, shown inside the dialog. */
  deleteError: string | null
  /** Entry being dragged over the tree, so a folder can refuse itself. */
  draggingPath: string | null
  loadDir: (path: string, force?: boolean) => Promise<void>
  toggleDir: (path: string) => void
  select: (entry: DirEntry) => void
  handleExternalChange: (dirs: string[]) => void
  reset: (rootPath: string | null) => void
  /** The loaded node for a path (the root itself counts as a folder). */
  getEntry: (path: string | null) => DirEntry | null
  /** Folder a new entry should be created in, following the selection. */
  parentForCreate: () => string | null
  beginCreate: (kind: EntryKind, parentPath?: string) => void
  beginRename: (entry?: DirEntry) => void
  commitInline: (value: string) => Promise<boolean>
  cancelInline: () => void
  requestDelete: (entry: DirEntry | null) => void
  confirmDelete: () => Promise<void>
  cancelDelete: () => void
  duplicateEntry: (entry: DirEntry) => Promise<void>
  moveEntry: (path: string, targetDir: string) => Promise<void>
  setDragging: (path: string | null) => void
  refreshAll: () => Promise<void>
  collapseAll: () => void
}

/** i18n inside the store: the toast and the input are not React components. */
function tr(key: TKey, params?: Record<string, string | number>): string {
  return translate(useI18nStore.getState().locale, key, params)
}

function failureText(result: EntryOpFailure): string {
  if (result.reason === 'invalid-name' && result.issue) {
    return tr(`explorer.nameIssue.${result.issue}` as TKey)
  }
  return tr(`explorer.error.${result.reason}` as TKey)
}

function issueText(issue: string): string {
  return tr(`explorer.nameIssue.${issue}` as TKey)
}

/** How deep a path sits under the workspace root (root itself is 0). */
function depthOf(root: string | null, path: string): number {
  if (!root) return 0
  const relative = relativeTo(root, path)
  if (relative.length === 0 || relative === path) return 0
  return relative.split(/[\\/]+/).filter(Boolean).length
}

/** `path` moved from `from` to `to`, or untouched when it is elsewhere. */
function remapPath(path: string, from: string, to: string): string {
  if (isSamePath(path, from)) return to
  if (!isPathInside(from, path)) return path
  return to + path.slice(stripTrailingSeparators(from).length)
}

function remapState(state: ExplorerState, from: string, to: string): Partial<ExplorerState> {
  const childrenByDir: Record<string, DirEntry[]> = {}
  for (const [dir, entries] of Object.entries(state.childrenByDir)) {
    childrenByDir[remapPath(dir, from, to)] = entries.map((entry) => {
      const path = remapPath(entry.path, from, to)
      if (path === entry.path) return entry
      return { ...entry, path, name: isSamePath(entry.path, from) ? nameOf(to) : entry.name }
    })
  }

  const remapRecord = (record: Record<string, boolean>): Record<string, boolean> => {
    const out: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(record)) out[remapPath(key, from, to)] = value
    return out
  }

  return {
    childrenByDir,
    expanded: remapRecord(state.expanded),
    loading: remapRecord(state.loading),
    selectedPath: state.selectedPath ? remapPath(state.selectedPath, from, to) : null
  }
}

/** Opens every folder between the root and `path`, so the entry is visible. */
function expandTo(path: string): void {
  const state = useExplorerStore.getState()
  const root = state.rootPath
  if (!root) return
  const relative = relativeTo(root, path)
  if (relative.length === 0 || relative === path) return

  const parts = relative.split(/[\\/]+/).filter(Boolean)
  let current = root
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = joinPath(current, parts[index])
    const dir = current
    useExplorerStore.setState((s) => ({ expanded: { ...s.expanded, [dir]: true } }))
    void state.loadDir(dir)
  }
}

function forgetState(state: ExplorerState, path: string): Partial<ExplorerState> {
  const gone = (candidate: string): boolean =>
    isSamePath(candidate, path) || isPathInside(path, candidate)
  const childrenByDir: Record<string, DirEntry[]> = {}
  for (const [dir, entries] of Object.entries(state.childrenByDir)) {
    if (!gone(dir)) childrenByDir[dir] = entries.filter((entry) => !gone(entry.path))
  }
  const expanded = Object.fromEntries(
    Object.entries(state.expanded).filter(([dir]) => !gone(dir))
  )
  const loading = Object.fromEntries(Object.entries(state.loading).filter(([dir]) => !gone(dir)))
  return {
    childrenByDir,
    expanded,
    loading,
    selectedPath: state.selectedPath && gone(state.selectedPath) ? null : state.selectedPath
  }
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  childrenByDir: {},
  expanded: {},
  loading: {},
  selectedPath: null,
  rootPath: null,
  inline: null,
  inlineError: null,
  pendingDelete: null,
  deleteError: null,
  draggingPath: null,

  loadDir: async (path, force = false) => {
    if (!force && get().childrenByDir[path]) return
    set((s) => ({ loading: { ...s.loading, [path]: true } }))
    try {
      const entries = await window.relaxcode.workspace.readDir(path)
      set((s) => {
        // A file removed outside the IDE must not keep a phantom selection that
        // later becomes the parent of a "new file" row nobody can see.
        const selected = s.selectedPath
        const staleSelection =
          selected !== null &&
          isSamePath(parentDirOf(selected), path) &&
          !entries.some((entry) => isSamePath(entry.path, selected))
        return {
          childrenByDir: { ...s.childrenByDir, [path]: entries },
          loading: { ...s.loading, [path]: false },
          ...(staleSelection ? { selectedPath: null } : {})
        }
      })
    } catch {
      set((s) => ({ loading: { ...s.loading, [path]: false } }))
    }
  },

  toggleDir: (path) => {
    const open = !!get().expanded[path]
    set((s) => ({ expanded: { ...s.expanded, [path]: !open } }))
    if (!open) void get().loadDir(path)
  },

  select: (entry) => {
    set({ selectedPath: entry.path })
    if (entry.isDirectory) get().toggleDir(entry.path)
  },

  handleExternalChange: (dirs) => {
    if (!(useSettingsStore.getState().settings?.files.autoRefresh ?? true)) return
    const { childrenByDir, loadDir } = get()
    for (const dir of dirs) {
      if (childrenByDir[dir]) void loadDir(dir, true)
    }
  },

  reset: (rootPath) =>
    set({
      childrenByDir: {},
      expanded: {},
      loading: {},
      selectedPath: null,
      rootPath,
      inline: null,
      inlineError: null,
      pendingDelete: null,
      deleteError: null,
      draggingPath: null
    }),

  getEntry: (path) => {
    if (!path) return null
    const state = get()
    for (const entries of Object.values(state.childrenByDir)) {
      const found = entries.find((entry) => isSamePath(entry.path, path))
      if (found) return found
    }
    const root = state.rootPath
    if (root && isSamePath(root, path)) {
      return { name: nameOf(root), path: root, isDirectory: true }
    }
    return null
  },

  parentForCreate: () => {
    const state = get()
    const root = state.rootPath
    if (!root) return null
    if (!state.selectedPath) return root
    const selected = state.getEntry(state.selectedPath)
    const candidate = selected?.isDirectory
      ? selected.path
      : parentDirOf(state.selectedPath)
    // The selection can point at something deleted outside the IDE; only a
    // folder the tree actually knows can host a visible "new file" row.
    if (isSamePath(candidate, root) || state.getEntry(candidate)?.isDirectory) return candidate
    return root
  },

  beginCreate: (kind, parentPath) => {
    const state = get()
    const root = state.rootPath
    if (!root) return
    const requested = parentPath ?? state.parentForCreate() ?? root
    const known =
      isSamePath(requested, root) || state.getEntry(requested)?.isDirectory === true
    const parent = known ? requested : root
    set((s) => ({
      expanded: { ...s.expanded, [parent]: true },
      inline: {
        kind: 'create',
        entryKind: kind,
        parentPath: parent,
        targetPath: null,
        initialValue: '',
        depth: depthOf(root, parent)
      },
      inlineError: null
    }))
    void get().loadDir(parent)
  },

  beginRename: (entry) => {
    const state = get()
    const root = state.rootPath
    const target = entry ?? state.getEntry(state.selectedPath)
    if (!root || !target || isSamePath(target.path, root)) return
    set({
      inline: {
        kind: 'rename',
        entryKind: target.isDirectory ? 'dir' : 'file',
        parentPath: parentDirOf(target.path),
        targetPath: target.path,
        initialValue: target.name,
        depth: depthOf(root, target.path)
      },
      inlineError: null
    })
  },

  commitInline: async (value) => {
    const state = get()
    const inline = state.inline
    const root = state.rootPath
    if (!inline || !root) return false

    const name = value.trim()
    let result: EntryOpResult

    if (inline.kind === 'rename') {
      if (!inline.targetPath) return false
      const issue = entryNameIssue(name)
      if (issue) {
        set({ inlineError: issueText(issue) })
        return false
      }
      // Renaming to the same name is not an error worth a round-trip.
      if (name === nameOf(inline.targetPath)) {
        set({ inline: null, inlineError: null })
        return true
      }
      result = await window.relaxcode.entries.rename(inline.targetPath, name)
    } else {
      const parsed = createPathSegments(name)
      if (!parsed.ok) {
        set({ inlineError: issueText(parsed.issue) })
        return false
      }
      result = await window.relaxcode.entries.create(inline.entryKind, inline.parentPath, name)
    }

    if (!result.ok) {
      set({ inlineError: failureText(result) })
      return false
    }

    const nextPath = result.path
    set({ inline: null, inlineError: null })

    if (inline.kind === 'rename' && inline.targetPath) {
      const oldPath = inline.targetPath
      set((s) => remapState(s, oldPath, nextPath))
      useEditorStore.getState().remapPaths(oldPath, nextPath)
    }

    await get().loadDir(parentDirOf(nextPath), true)
    expandTo(nextPath)
    set({ selectedPath: nextPath })

    if (inline.kind === 'create' && inline.entryKind === 'file') {
      void useEditorStore.getState().openFile(nextPath, nameOf(nextPath))
    }
    return true
  },

  cancelInline: () => set({ inline: null, inlineError: null }),

  requestDelete: (entry) => {
    if (!entry) return
    const root = get().rootPath
    if (root && isSamePath(entry.path, root)) return
    set({ pendingDelete: entry, deleteError: null })
  },

  confirmDelete: async () => {
    const entry = get().pendingDelete
    if (!entry) return

    const result = await window.relaxcode.entries.remove(entry.path)
    if (!result.ok) {
      // The dialog stays open with the reason instead of a popup: the user is
      // already looking at the action that failed.
      set({ deleteError: failureText(result) })
      return
    }

    set({ pendingDelete: null, deleteError: null })
    useEditorStore.getState().discardPathsUnder(entry.path)
    set((s) => forgetState(s, entry.path))
    await get().loadDir(parentDirOf(entry.path), true)
  },

  cancelDelete: () => set({ pendingDelete: null, deleteError: null }),

  duplicateEntry: async (entry) => {
    const result = await window.relaxcode.entries.duplicate(entry.path)
    if (!result.ok) return
    await get().loadDir(parentDirOf(entry.path), true)
    expandTo(result.path)
    set({ selectedPath: result.path })
    if (!entry.isDirectory) {
      void useEditorStore.getState().openFile(result.path, nameOf(result.path))
    }
  },

  moveEntry: async (path, targetDir) => {
    const source = get().getEntry(path)
    if (!source) return
    if (source.isDirectory && (isSamePath(path, targetDir) || isPathInside(path, targetDir))) {
      return
    }
    if (isSamePath(parentDirOf(path), targetDir)) return

    const result = await window.relaxcode.entries.move(path, targetDir)
    if (!result.ok) return

    set((s) => {
      const next = remapState(s, path, result.path)
      return { ...next, expanded: { ...next.expanded, [targetDir]: true } }
    })
    useEditorStore.getState().remapPaths(path, result.path)
    await get().loadDir(parentDirOf(path), true)
    await get().loadDir(targetDir, true)
    expandTo(result.path)
    set({ selectedPath: result.path })
  },

  setDragging: (path) => set({ draggingPath: path }),

  refreshAll: async () => {
    const state = get()
    if (!state.rootPath) return
    const dirs = new Set([state.rootPath, ...Object.keys(state.childrenByDir)])
    await Promise.all([...dirs].map((dir) => state.loadDir(dir, true)))
  },

  collapseAll: () => {
    const state = get()
    if (!state.rootPath) return
    set({ expanded: {} })
  }
}))
