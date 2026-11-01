import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type JSX,
  type MouseEvent
} from 'react'
import {
  ChevronsDownUp,
  ChevronRight,
  Copy,
  ExternalLink,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
  Trash2
} from 'lucide-react'
import type { DirEntry } from '@shared/ipc'
import { isPathInside, isSamePath, parentDirOf, relativeTo, splitExtension } from '@shared/entries'
import { useExplorerStore, type InlineEdit } from '@/stores/explorer'
import { useEditorStore } from '@/stores/editor'
import { useSettingsStore } from '@/stores/settings'
import { useT } from '@/lib/i18n'
import { FileIcon } from '@/components/explorer/FileIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

function ToolButton({
  title,
  onClick,
  children
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      {children}
    </button>
  )
}

/* ------------------------------ inline editing ----------------------------- */

/**
 * One row of the tree replaced by a text field — the way VS Code creates and
 * renames entries. It validates as the user types, commits on Enter (or when
 * the field loses focus) and cancels on Escape.
 */
function InlineRow({ inline }: { inline: InlineEdit }): JSX.Element {
  const [value, setValue] = useState(inline.initialValue)
  const error = useExplorerStore((s) => s.inlineError)
  const commit = useExplorerStore((s) => s.commitInline)
  const cancel = useExplorerStore((s) => s.cancelInline)
  const compact = useSettingsStore((s) => s.settings?.ui.density === 'compact')
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const busy = useRef(false)

  // Focus, then select the name without its extension: typing `index` keeps
  // `.ts`, which is what makes renaming a file quick.
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    const { base } = splitExtension(inline.initialValue)
    input.setSelectionRange(0, base.length)
  }, [inline.initialValue])

  const submit = async (): Promise<void> => {
    if (busy.current) return
    const name = value.trim()
    if (name.length === 0) {
      cancel()
      return
    }
    busy.current = true
    const ok = await commit(name)
    busy.current = false
    if (!ok) inputRef.current?.focus()
  }

  return (
    <div onContextMenu={(event) => event.stopPropagation()}>
      <div
        className={cn('flex items-center gap-2 pr-1.5', compact ? 'h-5' : 'h-7')}
        style={{ paddingLeft: inline.depth * 12 + 4 }}
      >
        {inline.entryKind === 'dir' ? (
          <Folder className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <FileIcon name={value || 'file'} className="size-4 shrink-0 text-tertiary" />
        )}
        <Input
          ref={inputRef}
          value={value}
          spellCheck={false}
          autoComplete="off"
          aria-label={
            inline.kind === 'rename'
              ? t('explorer.rename')
              : inline.entryKind === 'dir'
                ? t('explorer.newFolder')
                : t('explorer.newFile')
          }
          aria-invalid={error !== null}
          placeholder={inline.entryKind === 'dir' ? t('explorer.folderPlaceholder') : t('explorer.filePlaceholder')}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            // Typing in the tree must not trigger the app-wide shortcuts.
            event.stopPropagation()
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              cancel()
            }
          }}
          onBlur={() => {
            if (error) cancel()
            else void submit()
          }}
          className={cn(
            'min-w-0 flex-1 rounded-md px-1.5 py-0 text-[12.5px]',
            compact ? 'h-5' : 'h-6',
            error &&
              'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30'
          )}
        />
      </div>
      {error && (
        <p
          className="pb-1 text-[11px] leading-4 text-destructive"
          style={{ paddingLeft: inline.depth * 12 + 28 }}
        >
          {error}
        </p>
      )}
    </div>
  )
}

/* ------------------------------- context menu ------------------------------ */

interface MenuTarget {
  /** null: the empty area of the tree, i.e. the workspace root itself. */
  entry: DirEntry | null
  x: number
  y: number
}

function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text)
}

function ExplorerMenu({
  target,
  root,
  onClose
}: {
  target: MenuTarget | null
  root: string
  onClose: () => void
}): JSX.Element {
  const t = useT()
  const keymap = useSettingsStore((s) => s.settings?.keymap)
  const beginCreate = useExplorerStore((s) => s.beginCreate)
  const beginRename = useExplorerStore((s) => s.beginRename)
  const requestDelete = useExplorerStore((s) => s.requestDelete)
  const duplicateEntry = useExplorerStore((s) => s.duplicateEntry)

  const entry = target?.entry ?? null
  const multiSelected = useExplorerStore((st) => st.multiSelected)
  const requestMultiDelete = useExplorerStore((st) => st.requestMultiDelete)
  const batchDelete = entry !== null && multiSelected.includes(entry.path) && multiSelected.length > 1
  const isRoot = !entry || isSamePath(entry.path, root)
  const parent = entry ? (entry.isDirectory ? entry.path : parentDirOf(entry.path)) : root
  const relative = entry ? relativeTo(root, entry.path) : ''

  const copy = (): void => {
    void copyText(entry ? relative : root).catch(() => {})
  }

  return (
    <DropdownMenu
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          tabIndex={-1}
          className="fixed size-px"
          style={{ left: target?.x ?? 0, top: target?.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" sideOffset={2} className="min-w-[212px]">
        <DropdownMenuItem onSelect={() => beginCreate('file', parent)}>
          <FilePlus />
          {t('explorer.newFile')}
          {keymap?.newFile && <DropdownMenuShortcut>{keymap.newFile}</DropdownMenuShortcut>}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => beginCreate('dir', parent)}>
          <FolderPlus />
          {t('explorer.newFolder')}
          {keymap?.newFolder && <DropdownMenuShortcut>{keymap.newFolder}</DropdownMenuShortcut>}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={isRoot} onSelect={() => entry && beginRename(entry)}>
          <Pencil />
          {t('explorer.rename')}
          {keymap?.rename && <DropdownMenuShortcut>{keymap.rename}</DropdownMenuShortcut>}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isRoot}
          onSelect={() => {
            if (entry) void duplicateEntry(entry)
          }}
        >
          <Copy />
          {t('explorer.duplicate')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={copy}>
          <Copy />
          {t('explorer.copyPath')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            window.relaxcode.entries.reveal(entry ? entry.path : root)
          }}
        >
          <ExternalLink />
          {t('explorer.reveal')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {batchDelete ? (
          <DropdownMenuItem
            onSelect={() => requestMultiDelete(multiSelected)}
            className="text-destructive data-[highlighted]:bg-destructive/10"
          >
            <Trash2 />
            {t('explorer.deleteSelected', { n: multiSelected.length })}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={isRoot}
            onSelect={() => requestDelete(entry)}
            className="text-destructive data-[highlighted]:bg-destructive/10"
          >
            <Trash2 />
            {t('explorer.delete')}
            {keymap?.deleteEntry && (
              <DropdownMenuShortcut>{keymap.deleteEntry}</DropdownMenuShortcut>
            )}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* ---------------------------------- nodes ---------------------------------- */

interface TreeNodeProps {
  entry: DirEntry
  depth: number
  onMenu: (entry: DirEntry, event: MouseEvent) => void
}

function TreeNode({ entry, depth, onMenu }: TreeNodeProps): JSX.Element {
  const isOpen = useExplorerStore((s) => !!s.expanded[entry.path])
  const children = useExplorerStore((s) => s.childrenByDir[entry.path])
  const selected = useExplorerStore((s) => s.selectedPath === entry.path)
  const multiSelected = useExplorerStore((s) => s.multiSelected.includes(entry.path))
  const toggleMultiSelect = useExplorerStore((st) => st.toggleMultiSelect)
  const clearMultiSelect = useExplorerStore((st) => st.clearMultiSelect)
  const inline = useExplorerStore((s) => s.inline)
  const dragging = useExplorerStore((s) => s.draggingPath)
  const draggingEntry = useExplorerStore((s) =>
    s.draggingPath ? s.getEntry(s.draggingPath) : null
  )
  const select = useExplorerStore((s) => s.select)
  const toggleDir = useExplorerStore((s) => s.toggleDir)
  const setDragging = useExplorerStore((s) => s.setDragging)
  const moveEntry = useExplorerStore((s) => s.moveEntry)
  const compact = useSettingsStore((s) => s.settings?.ui.density === 'compact')
  const [over, setOver] = useState(false)

  const renaming =
    inline?.kind === 'rename' && inline.targetPath !== null && isSamePath(inline.targetPath, entry.path)
  const createHere = inline?.kind === 'create' && isSamePath(inline.parentPath, entry.path)
  const rowHeight = compact ? 'h-5 text-[12px]' : 'h-7'

  // A folder only accepts a drop when the dragged entry is not that folder or
  // one of its parents — the main process checks again, this is just the hint.
  const canDrop =
    entry.isDirectory &&
    dragging !== null &&
    !isSamePath(dragging, entry.path) &&
    !(draggingEntry?.isDirectory && isPathInside(dragging, entry.path))

  // Windows semantics: one click only selects (a folder also expands), a
  // double click opens the file. No accidental half-open editors while you
  // are just picking your way through the tree.
  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (event.ctrlKey || event.metaKey) {
      toggleMultiSelect(entry)
      return
    }
    clearMultiSelect()
    select(entry)
  }

  const handleDoubleClick = (): void => {
    if (entry.isDirectory) {
      toggleDir(entry.path)
      return
    }
    void useEditorStore.getState().openFile(entry.path, entry.name)
  }

  const handleChevronClick = (event: MouseEvent): void => {
    event.stopPropagation()
    toggleDir(entry.path)
  }

  const handleDragStart = (event: DragEvent<HTMLButtonElement>): void => {
    event.dataTransfer.setData('text/plain', entry.path)
    event.dataTransfer.effectAllowed = 'move'
    setDragging(entry.path)
  }

  const handleDrop = (event: DragEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    setOver(false)
    const source = event.dataTransfer.getData('text/plain') || dragging
    setDragging(null)
    if (source) void moveEntry(source, entry.path)
  }

  const childDepth = depth + 1

  return (
    <div>
      {renaming && inline ? (
        <InlineRow inline={inline} />
      ) : (
        <button
          type="button"
          data-path={entry.path}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onContextMenu={(event) => onMenu(entry, event)}
          draggable
          onDragStart={handleDragStart}
          onDragEnd={() => setDragging(null)}
          onDragOver={(event) => {
            if (!canDrop) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={handleDrop}
          className={cn(
            'group flex w-full items-center gap-2 rounded-md pr-1.5 text-left text-[13px] text-foreground/90 transition-colors duration-100',
            rowHeight,
            selected || multiSelected
              ? 'bg-pressed text-foreground'
              : 'hover:bg-foreground/[0.05]',
            multiSelected && !selected && 'ring-1 ring-inset ring-ring/40',
            over && 'bg-primary/[0.07] ring-1 ring-inset ring-ring/50'
          )}
          style={{ paddingLeft: depth * 12 + 4 }}
        >
          {entry.isDirectory ? (
            <span
              onClick={handleChevronClick}
              className="flex size-4 shrink-0 items-center justify-center rounded-sm text-tertiary hover:text-foreground"
            >
              <ChevronRight
                className={cn(
                  'size-3.5 transition-transform duration-150 ease-out',
                  isOpen && 'rotate-90'
                )}
              />
            </span>
          ) : (
            <span className="size-4 shrink-0" />
          )}

          {entry.isDirectory ? (
            isOpen ? (
              <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <Folder className="size-4 shrink-0 text-muted-foreground" />
            )
          ) : (
            <FileIcon name={entry.name} className="size-4 shrink-0 text-tertiary" />
          )}

          <span className="truncate">{entry.name}</span>
        </button>
      )}

      {entry.isDirectory && isOpen && (
        <div>
          {createHere && inline && <InlineRow inline={inline} />}
          {children?.map((child) => (
            <TreeNode key={child.path} entry={child} depth={childDepth} onMenu={onMenu} />
          ))}
        </div>
      )}
    </div>
  )
}

/* -------------------------------- delete dialog ----------------------------- */

function DeleteDialog(): JSX.Element {
  const pending = useExplorerStore((s) => s.pendingDelete)
  const pendingMulti = useExplorerStore((s) => s.pendingMultiDelete)
  const deleteError = useExplorerStore((s) => s.deleteError)
  const confirmDelete = useExplorerStore((s) => s.confirmDelete)
  const confirmMultiDelete = useExplorerStore((s) => s.confirmMultiDelete)
  const cancelDelete = useExplorerStore((s) => s.cancelDelete)
  const useTrash = useSettingsStore((s) => s.settings?.files.useTrash ?? true)
  const t = useT()

  if (pendingMulti !== null) {
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) cancelDelete()
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('explorer.deleteMultiTitle', { n: pendingMulti.length })}</DialogTitle>
            <DialogDescription>
              {useTrash
                ? t('explorer.deleteMultiToTrash', { n: pendingMulti.length })
                : t('explorer.deleteMultiPermanently', { n: pendingMulti.length })}
            </DialogDescription>
            {deleteError && (
              <p className="text-[12px] leading-relaxed text-destructive">{deleteError}</p>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button variant="default" onClick={cancelDelete}>
              {t('action.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void confirmMultiDelete()}>
              {t('explorer.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) cancelDelete()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {pending?.isDirectory ? t('explorer.deleteFolderTitle') : t('explorer.deleteFileTitle')}
          </DialogTitle>
          <DialogDescription>
            {useTrash
              ? t('explorer.deleteToTrash', { name: pending?.name ?? '' })
              : t('explorer.deletePermanently', { name: pending?.name ?? '' })}
          </DialogDescription>
          {deleteError && (
            <p className="text-[12px] leading-relaxed text-destructive">{deleteError}</p>
          )}
        </DialogHeader>
        <DialogFooter>
          <Button variant="default" onClick={cancelDelete}>
            {t('action.cancel')}
          </Button>
          <Button variant="destructive" onClick={() => void confirmDelete()}>
            {t('explorer.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------- file tree -------------------------------- */

interface FileTreeProps {
  root: string
}

export function FileTree({ root }: FileTreeProps): JSX.Element {
  const children = useExplorerStore((s) => s.childrenByDir[root])
  const loading = useExplorerStore((s) => !!s.loading[root])
  const inline = useExplorerStore((s) => s.inline)
  const dragging = useExplorerStore((s) => s.draggingPath)
  const moveEntry = useExplorerStore((s) => s.moveEntry)
  const setDragging = useExplorerStore((s) => s.setDragging)
  const expanded = useExplorerStore((s) => s.expanded)
  const childrenByDir = useExplorerStore((s) => s.childrenByDir)
  const selectedPath = useExplorerStore((s) => s.selectedPath)
  const toggleDir = useExplorerStore((s) => s.toggleDir)
  const selectEntry = useExplorerStore((s) => s.select)
  const beginCreate = useExplorerStore((s) => s.beginCreate)
  const collapseAll = useExplorerStore((s) => s.collapseAll)
  const refreshAll = useExplorerStore((s) => s.refreshAll)
  const clearMultiSelect = useExplorerStore((s) => s.clearMultiSelect)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  const [rootOver, setRootOver] = useState(false)
  const compact = useSettingsStore((s) => s.settings?.ui.density === 'compact')
  const t = useT()

  /** The rows the user can see right now, top to bottom — for arrow keys. */
  const flatRows = useMemo(() => {
    const out: DirEntry[] = []
    const walk = (dir: string): void => {
      for (const entry of childrenByDir[dir] ?? []) {
        out.push(entry)
        if (entry.isDirectory && expanded[entry.path]) walk(entry.path)
      }
    }
    walk(root)
    return out
  }, [childrenByDir, expanded, root])

  // Keyboard selection scrolls the row into view.
  useEffect(() => {
    if (!selectedPath) return
    const row = containerRef.current?.querySelector(`[data-path="${CSS.escape(selectedPath)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [selectedPath])

  const moveSelection = (offset: number): void => {
    if (flatRows.length === 0) return
    const idx = flatRows.findIndex((entry) => entry.path === selectedPath)
    const next = idx === -1 ? (offset > 0 ? 0 : flatRows.length - 1) : Math.min(flatRows.length - 1, Math.max(0, idx + offset))
    clearMultiSelect()
    selectEntry(flatRows[next])
  }

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (inline) return // typing in a name must not move the selection
    const current = flatRows.find((entry) => entry.path === selectedPath) ?? null
    if (event.ctrlKey && (event.key === 'a' || event.key === 'A')) {
      event.preventDefault()
      useExplorerStore.setState({ multiSelected: flatRows.filter((entry) => !isSamePath(entry.path, root)).map((entry) => entry.path) })
      return
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        moveSelection(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        moveSelection(-1)
        break
      case 'ArrowRight':
        event.preventDefault()
        if (current?.isDirectory) {
          if (!expanded[current.path]) toggleDir(current.path)
          else {
            const first = (childrenByDir[current.path] ?? [])[0]
            if (first) {
              clearMultiSelect()
              selectEntry(first)
            }
          }
        }
        break
      case 'ArrowLeft':
        event.preventDefault()
        if (current?.isDirectory && expanded[current.path]) toggleDir(current.path)
        break
      case 'Enter':
        event.preventDefault()
        if (current) {
          if (current.isDirectory) toggleDir(current.path)
          else void useEditorStore.getState().openFile(current.path, current.name)
        }
        break
      case 'Home':
        event.preventDefault()
        if (flatRows[0]) {
          clearMultiSelect()
          selectEntry(flatRows[0])
        }
        break
      case 'End':
        event.preventDefault()
        if (flatRows.length > 0) {
          clearMultiSelect()
          selectEntry(flatRows[flatRows.length - 1])
        }
        break
      default:
        break
    }
  }

  const rootInline = inline?.kind === 'create' && isSamePath(inline.parentPath, root)

  const openEntryMenu = (entry: DirEntry, event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    // Selecting on right click shows what the menu is about without toggling
    // a folder (which a normal click would do).
    useExplorerStore.setState({ selectedPath: entry.path })
    setMenu({ entry, x: event.clientX, y: event.clientY })
  }

  const openRootMenu = (event: MouseEvent): void => {
    event.preventDefault()
    setMenu({ entry: null, x: event.clientX, y: event.clientY })
  }

  if (!children) {
    return (
      <div className="min-h-full px-3 py-2" onContextMenu={openRootMenu}>
        {loading ? (
          <div className={cn('flex flex-col', compact ? 'gap-1' : 'gap-1.5')}>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={cn(
                  'animate-pulse rounded-md bg-foreground/[0.06]',
                  compact ? 'h-4' : 'h-5'
                )}
                style={{ width: `${70 - i * 8}%` }}
              />
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {/* The Windows-style strip: the everyday actions, one click away. */}
      <div className="flex items-center gap-0.5 border-b border-border px-2 py-1">
        <ToolButton title={t('explorer.newFile')} onClick={() => beginCreate('file')}>
          <FilePlus className="size-4" />
        </ToolButton>
        <ToolButton title={t('explorer.newFolder')} onClick={() => beginCreate('dir')}>
          <FolderPlus className="size-4" />
        </ToolButton>
        <ToolButton title={t('explorer.refresh')} onClick={() => void refreshAll()}>
          <RefreshCw className="size-4" />
        </ToolButton>
        <ToolButton title={t('explorer.collapseAll')} onClick={() => collapseAll()}>
          <ChevronsDownUp className="size-4" />
        </ToolButton>
      </div>
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleTreeKeyDown}
        className={cn(
          'flex min-h-full flex-1 flex-col px-2 pb-3 outline-none',
          rootOver && 'bg-primary/[0.03] ring-1 ring-inset ring-ring/40'
        )}
        onContextMenu={openRootMenu}
      onDragOver={(event) => {
        if (!dragging) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        if (event.target === event.currentTarget) setRootOver(true)
      }}
      onDragLeave={(event) => {
        if (event.target === event.currentTarget) setRootOver(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setRootOver(false)
        const source = event.dataTransfer.getData('text/plain') || dragging
        setDragging(null)
        if (source && event.target === event.currentTarget) void moveEntry(source, root)
      }}
    >
      {rootInline && inline && <InlineRow inline={inline} />}

      {children.map((entry) => (
        <TreeNode key={entry.path} entry={entry} depth={0} onMenu={openEntryMenu} />
      ))}

      {children.length === 0 && !rootInline && (
        <p className="px-3 py-2 text-xs text-tertiary">{t('explorer.emptyFolder')}</p>
      )}

      <ExplorerMenu target={menu} root={root} onClose={() => setMenu(null)} />
      <DeleteDialog />
      </div>
    </div>
  )
}

export function useRootLoader(rootPath: string | null): void {
  useEffect(() => {
    const store = useExplorerStore.getState()
    if (!rootPath) {
      store.reset(null)
      return
    }
    if (store.rootPath === rootPath && store.childrenByDir[rootPath]) return
    store.reset(rootPath)
    void store.loadDir(rootPath)
  }, [rootPath])
}
