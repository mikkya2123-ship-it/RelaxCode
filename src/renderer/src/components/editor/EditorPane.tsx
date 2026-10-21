import { lazy, Suspense, type JSX } from 'react'
import { useT } from '@/lib/i18n'

const EditorPaneInner = lazy(() => import('./EditorPaneInner'))

export function EditorPane(): JSX.Element {
  const t = useT()
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center bg-card text-xs text-tertiary">
          {t('editor.loading')}
        </div>
      }
    >
      <EditorPaneInner />
    </Suspense>
  )
}
