import { useState, type JSX } from 'react'
import { Copy, ExternalLink, X } from 'lucide-react'
import { relativeTo } from '@shared/entries'
import { useEditorStore } from '@/stores/editor'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useT } from '@/lib/i18n'
import { FileIcon } from '@/components/explorer/FileIcon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface TabMenu {
  path: string
  x: number
  y: number
}

export function EditorTabs(): JSX.Element {
  const files = useEditorStore((s) => s.files)
  const activePath = useEditorStore((s) => s.activePath)
  const setActive = useEditorStore((s) => s.setActive)
  const closeFile = useEditorStore((s) => s.closeFile)
  const closeOthers = useEditorStore((s) => s.closeOthers)
  const closeAll = useEditorStore((s) => s.closeAll)
  const workspace = useUiStore((s) => s.workspace)
  const keymap = useSettingsStore((s) => s.settings?.keymap)
  const [menu, setMenu] = useState<TabMenu | null>(null)
  const t = useT()

  const root = workspace?.path ?? null
  const menuFile = menu ? files.find((file) => file.path === menu.path) : null

  const copyPath = (): void => {
    if (!menuFile) return
    const value = root ? relativeTo(root, menuFile.path) : menuFile.path
    void navigator.clipboard.writeText(value).catch(() => {})
  }

  return (
    <div className="flex h-[38px] shrink-0 items-end gap-0.5 overflow-x-auto bg-panel px-1.5 pt-1">
      {files.map((file) => {
        const isActive = file.path === activePath
        const dirty = file.content !== file.savedContent
        return (
          <div
            key={file.path}
            role="tab"
            aria-selected={isActive}
            tabIndex={0}
            onClick={() => setActive(file.path)}
            onAuxClick={(event) => {
              if (event.button === 1) void closeFile(file.path)
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              setActive(file.path)
              setMenu({ path: file.path, x: event.clientX, y: event.clientY })
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') setActive(file.path)
            }}
            className={cn(
              'group mb-[-1px] flex h-[30px] max-w-[200px] min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-t-[10px] px-3 text-[12.5px] transition-colors duration-100',
              isActive
                ? 'bg-card text-foreground'
                : 'border border-transparent text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'
            )}
          >
            <FileIcon name={file.name} className="size-3.5 shrink-0 text-tertiary" />
            <span className="truncate">{file.name}</span>
            <button
              type="button"
              aria-label={t('tabs.close')}
              onClick={(event) => {
                event.stopPropagation()
                void closeFile(file.path)
              }}
              className={cn(
                'ml-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm transition-colors duration-100 hover:bg-foreground/[0.08]',
                dirty ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              )}
            >
              {dirty && (
                <span className="size-[7px] rounded-full bg-current opacity-70 group-hover:hidden" />
              )}
              <X className={cn('size-3', dirty && 'hidden group-hover:block')} />
            </button>
          </div>
        )
      })}

      <DropdownMenu
        open={menu !== null}
        onOpenChange={(open) => {
          if (!open) setMenu(null)
        }}
      >
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            tabIndex={-1}
            className="fixed size-px"
            style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="start" sideOffset={2} className="min-w-[196px]">
          <DropdownMenuItem
            onSelect={() => {
              if (menu) void closeFile(menu.path)
            }}
          >
            {t('tabs.close')}
            {keymap?.closeTab && <DropdownMenuShortcut>{keymap.closeTab}</DropdownMenuShortcut>}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              if (menu) void closeOthers(menu.path)
            }}
          >
            {t('tabs.closeOthers')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void closeAll()}>{t('tabs.closeAll')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={copyPath}>
            <Copy />
            {t('explorer.copyPath')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              if (menu) window.relaxcode.entries.reveal(menu.path)
            }}
          >
            <ExternalLink />
            {t('explorer.reveal')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
