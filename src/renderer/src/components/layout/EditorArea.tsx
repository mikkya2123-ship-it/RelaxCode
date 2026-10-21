import { useEffect, useState, type JSX } from 'react'
import { FolderOpen } from 'lucide-react'
import { useUiStore } from '@/stores/ui'
import { useEditorStore } from '@/stores/editor'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { AppLogo } from '@/components/ui/app-logo'
import { EditorTabs } from '@/components/editor/EditorTabs'
import { EditorPane } from '@/components/editor/EditorPane'
import { basename } from '@/lib/utils'

function RecentList(): JSX.Element | null {
  const workspace = useUiStore((s) => s.workspace)
  const openRecent = useUiStore((s) => s.openRecent)
  const [recent, setRecent] = useState<string[]>([])
  const t = useT()

  useEffect(() => {
    if (workspace) return
    let cancelled = false
    void window.relaxcode.workspace.recentList().then((list) => {
      if (!cancelled) setRecent(list)
    })
    return () => {
      cancelled = true
    }
  }, [workspace])

  if (workspace || recent.length === 0) return null

  return (
    <div className="mt-8 w-full max-w-sm">
      <p className="mb-2 text-center text-xs font-medium text-tertiary">{t('recent.title')}</p>
      <div className="flex flex-col gap-1">
        {recent.slice(0, 5).map((path) => (
          <button
            key={path}
            type="button"
            onClick={() =>
              void openRecent(path).then((ok) => {
                if (!ok) void window.relaxcode.workspace.recentList().then(setRecent)
              })
            }
            className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-left transition-colors duration-150 hover:border-border hover:bg-primary/[0.02]"
          >
            <FolderOpen className="size-4 shrink-0 text-tertiary" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-medium text-foreground">
                {basename(path)}
              </span>
              <span className="truncate text-[11px] text-tertiary">{path}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function WelcomeScreen(): JSX.Element {
  const openWorkspace = useUiStore((s) => s.openWorkspace)
  const t = useT()

  return (
    <div className="flex h-full min-w-0 flex-1 items-center justify-center bg-card animate-fade-in">
      <div className="-mt-12 flex w-full max-w-md flex-col items-center px-6 text-center">
        <AppLogo className="size-20 rounded-[18px] shadow-xs ring-1 ring-black/[0.06] dark:ring-white/10" />
        <h1 className="mt-5 text-xl font-semibold tracking-[-0.02em]">RelaxCode</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">{t('welcome.subtitle')}</p>
        <Button variant="primary" className="mt-6" onClick={() => void openWorkspace()}>
          <FolderOpen className="size-4" />
          {t('welcome.openFolder')}
        </Button>
        <p className="mt-6 text-xs text-tertiary">{t('welcome.hint')}</p>
        <RecentList />
      </div>
    </div>
  )
}

export function EditorArea(): JSX.Element {
  const filesCount = useEditorStore((s) => s.files.length)
  const workspace = useUiStore((s) => s.workspace)
  const openWorkspace = useUiStore((s) => s.openWorkspace)
  const t = useT()

  if (filesCount > 0) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col bg-card">
        <EditorTabs />
        <div className="min-h-0 flex-1">
          <EditorPane />
        </div>
      </div>
    )
  }

  if (workspace) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-center bg-card animate-fade-in">
        <div className="flex size-10 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
          <FolderOpen className="size-[18px]" />
        </div>
        <p className="mt-3 text-[13px] font-medium text-foreground">{t('workspace.opened')}</p>
        <p className="mt-1 max-w-sm truncate px-6 text-xs text-muted-foreground">{workspace.path}</p>
        <p className="mt-4 text-xs text-tertiary">{t('workspace.selectFile')}</p>
        <Button variant="default" className="mt-5" onClick={() => void openWorkspace()}>
          <FolderOpen className="size-4" />
          {t('welcome.openFolder')}
        </Button>
      </div>
    )
  }

  return <WelcomeScreen />
}
