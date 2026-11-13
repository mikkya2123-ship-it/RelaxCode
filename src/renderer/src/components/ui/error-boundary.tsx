import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RotateCw, TriangleAlert } from 'lucide-react'
import { translate } from '@/lib/i18n'
import { useI18nStore } from '@/lib/i18n'

interface ErrorBoundaryState {
  error: unknown
}

/**
 * A failed render normally unmounts the whole tree and leaves an empty window,
 * which reads as the app dying. This keeps a card on screen instead, logs the
 * error once and offers a reload — the window itself never disappears.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[renderer] render failed', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children
    const t = (key: Parameters<typeof translate>[1]): string =>
      translate(useI18nStore.getState().locale, key)
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-background px-8 text-center">
        <div className="flex size-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
          <TriangleAlert className="size-5" />
        </div>
        <p className="text-[13px] font-medium text-foreground">{t('app.error.title')}</p>
        <p className="max-w-[320px] text-[12px] leading-relaxed text-muted-foreground">
          {t('app.error.hint')}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-input bg-card px-3 py-1.5 text-[12px] text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <RotateCw className="size-3.5" />
          {t('app.error.reload')}
        </button>
      </div>
    )
  }
}
