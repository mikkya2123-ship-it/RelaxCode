import type { JSX } from 'react'
import { ChevronsDownUp, FilePlus, FolderOpen, FolderPlus, RotateCw } from 'lucide-react'
import { useUiStore } from '@/stores/ui'
import { useExplorerStore } from '@/stores/explorer'
import { useSettingsStore } from '@/stores/settings'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FileTree, useRootLoader } from '@/components/explorer/FileTree'
import { cn, basename } from '@/lib/utils'

export function Sidebar(): JSX.Element {
  const open = useUiStore((s) => s.sidebarOpen)
  const workspace = useUiStore((s) => s.workspace)
  const openWorkspace = useUiStore((s) => s.openWorkspace)
  const rootPath = useExplorerStore((s) => s.rootPath)
  const refreshAll = useExplorerStore((s) => s.refreshAll)
  const collapseAll = useExplorerStore((s) => s.collapseAll)
  const beginCreate = useExplorerStore((s) => s.beginCreate)
  const keymap = useSettingsStore((s) => s.settings?.keymap)
  const t = useT()

  const label = (text: string, combo?: string): string =>
    combo && combo.length > 0 ? `${text} (${combo})` : text

  useRootLoader(workspace?.path ?? null)

  return (
    <aside
      className={cn(
        'relative h-full shrink-0 overflow-hidden bg-background transition-[width] duration-200 ease-out',
        open ? 'w-[272px]' : 'w-0'
      )}
      aria-hidden={!open}
    >
      <div className="flex h-full w-[272px] flex-col">
        <div className="flex h-9 shrink-0 items-center justify-between pl-3 pr-1.5">
          <span className="truncate text-xs font-semibold text-muted-foreground">
            {workspace ? basename(workspace.path) : t('sidebar.title')}
          </span>
          {workspace && (
            <div className="flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('explorer.newFile')}
                    onClick={() => beginCreate('file')}
                    className="text-tertiary hover:text-foreground"
                  >
                    <FilePlus className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {label(t('explorer.newFile'), keymap?.newFile)}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('explorer.newFolder')}
                    onClick={() => beginCreate('dir')}
                    className="text-tertiary hover:text-foreground"
                  >
                    <FolderPlus className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {label(t('explorer.newFolder'), keymap?.newFolder)}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('explorer.collapseAll')}
                    onClick={collapseAll}
                    className="text-tertiary hover:text-foreground"
                  >
                    <ChevronsDownUp className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('explorer.collapseAll')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('sidebar.refresh')}
                    onClick={() => void refreshAll()}
                    disabled={!rootPath}
                    className="text-tertiary hover:text-foreground"
                  >
                    <RotateCw className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('sidebar.refresh')}</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>

        {workspace ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <FileTree root={workspace.path} />
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 pb-10 text-center">
            <div className="flex size-10 items-center justify-center rounded-lg bg-card text-tertiary shadow-xs">
              <FolderOpen className="size-[18px]" />
            </div>
            <div>
              <p className="text-[13px] font-medium text-foreground">{t('sidebar.emptyTitle')}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t('sidebar.emptyHint')}
              </p>
            </div>
            <Button variant="primary" size="sm" onClick={() => void openWorkspace()}>
              {t('sidebar.openFolder')}
            </Button>
          </div>
        )}
      </div>
    </aside>
  )
}
