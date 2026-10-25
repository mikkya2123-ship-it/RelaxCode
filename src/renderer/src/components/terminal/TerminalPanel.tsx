import { useEffect, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Ban, Bot, Plus, TerminalSquare, Trash2, X } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { useTerminalStore } from '@/stores/terminal'
import { useUiStore } from '@/stores/ui'
import { cn } from '@/lib/utils'

/**
 * The terminal dock at the bottom of the editor area: real shells in tabs
 * plus the read-only feed of the AI's commands. The top edge is rounded and
 * draggable; the height is clamped to the editor area, so the panel never
 * outgrows the window.
 */

const MIN_HEIGHT = 140
const MAX_SHARE = 0.8

export function TerminalPanel(): JSX.Element {
  const t = useT()
  const sessions = useTerminalStore((s) => s.sessions)
  const activeId = useTerminalStore((s) => s.activeId)
  const lines = useTerminalStore((s) => s.lines)
  const running = useTerminalStore((s) => s.running)
  const create = useTerminalStore((s) => s.create)
  const close = useTerminalStore((s) => s.close)
  const setActive = useTerminalStore((s) => s.setActive)
  const input = useTerminalStore((s) => s.input)
  const stop = useTerminalStore((s) => s.stop)
  const clearActive = useTerminalStore((s) => s.clearActive)
  const refresh = useTerminalStore((s) => s.refresh)
  const height = useUiStore((s) => s.terminalHeight)
  const setHeight = useUiStore((s) => s.setTerminalHeight)
  const toggleTerminal = useUiStore((s) => s.toggleTerminal)

  const [draft, setDraft] = useState('')
  const [historyIndex, setHistoryIndex] = useState(-1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const active = sessions.find((session) => session.id === activeId) ?? null
  const isAgent = active?.kind === 'agent'
  const isRunning = activeId !== null && (running[activeId] ?? false)
  const activeLines = (activeId !== null ? lines[activeId] : undefined) ?? []

  useEffect(() => {
    void refresh().then(() => {
      // The first opening starts with one live shell ready to type into.
      if (useTerminalStore.getState().sessions.length === 0) return void useTerminalStore.getState().create()
    })
  }, [refresh])

  // Stick to the bottom while output streams, like a real terminal.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [activeLines])

  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const container = panelRef.current?.parentElement
    if (!container) return
    const containerTop = container.getBoundingClientRect().top
    const maxHeight = Math.max(MIN_HEIGHT, Math.floor(container.clientHeight * MAX_SHARE))
    const move = (moveEvent: PointerEvent): void => {
      const next = Math.min(Math.max(containerTop + container.clientHeight - moveEvent.clientY, MIN_HEIGHT), maxHeight)
      setHeight(next)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const submit = (): void => {
    const line = draft.trim()
    if (line === '' || !active || isAgent) return
    input(line)
    setDraft('')
    setHistoryIndex(-1)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
      return
    }
    const history = useTerminalStore.getState().history
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      const next = Math.min(historyIndex + 1, history.length - 1)
      if (next >= 0 && next !== historyIndex) {
        setHistoryIndex(next)
        setDraft(history[history.length - 1 - next] ?? '')
      }
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const next = historyIndex - 1
      if (next < 0) {
        setHistoryIndex(-1)
        setDraft('')
      } else {
        setHistoryIndex(next)
        setDraft(history[history.length - 1 - next] ?? '')
      }
    }
  }

  return (
    <div
      ref={panelRef}
      className="relative flex shrink-0 flex-col overflow-hidden rounded-t-[12px] border border-b-0 border-border bg-panel shadow-[0_-4px_16px_rgba(0,0,0,0.06)]"
      style={{ height }}
      data-testid="terminal-panel"
    >
      {/* The grabbable top edge. */}
      <div
        onPointerDown={onResizeStart}
        className="absolute inset-x-0 top-0 z-10 h-1.5 cursor-row-resize"
        aria-hidden="true"
      />

      <div className="flex h-8 shrink-0 select-none items-center gap-1 border-b border-border/60 px-2">
        <TerminalSquare className="mr-1 size-3.5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                'group/tab flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors duration-100',
                session.id === activeId
                  ? 'border-border bg-card text-foreground shadow-xs'
                  : 'border-transparent text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground'
              )}
            >
              {session.kind === 'agent' && <Bot className="size-3 shrink-0 text-primary" />}
              <button
                type="button"
                onClick={() => setActive(session.id)}
                className="max-w-[140px] truncate"
                title={session.title}
              >
                {session.kind === 'agent' ? t('terminal.agent') : session.title}
              </button>
              {session.kind === 'shell' && (
                <button
                  type="button"
                  aria-label={t('terminal.close')}
                  className="rounded p-0.5 opacity-0 transition-opacity group-hover/tab:opacity-100 hover:bg-foreground/[0.08]"
                  onClick={() => close(session.id)}
                >
                  <X className="size-2.5" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            title={t('terminal.new')}
            aria-label={t('terminal.new')}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            onClick={() => void create()}
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {isRunning && !isAgent && (
            <button
              type="button"
              title={t('terminal.stop')}
              aria-label={t('terminal.stop')}
              className="rounded-md p-1 text-amber-600 transition-colors hover:bg-foreground/[0.06] dark:text-amber-500"
              onClick={stop}
            >
              <Ban className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            title={t('terminal.clear')}
            aria-label={t('terminal.clear')}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            onClick={clearActive}
          >
            <Trash2 className="size-3.5" />
          </button>
          <button
            type="button"
            title={t('terminal.hide')}
            aria-label={t('terminal.hide')}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            onClick={toggleTerminal}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-1.5 font-mono text-[11.5px] leading-[1.5]"
        onClick={() => !isAgent && inputRef.current?.focus()}
      >
        {activeLines.length === 0 && (
          <p className="text-tertiary">{isAgent ? t('terminal.agentEmpty') : t('terminal.empty')}</p>
        )}
        {activeLines.map((line, index) => (
          <div
            key={index}
            className={cn(
              'whitespace-pre-wrap break-all',
              line.startsWith('❯') && 'text-foreground',
              line.trim().startsWith('↳') && 'text-destructive',
              !line.startsWith('❯') && line.trim().startsWith('  ') && 'text-muted-foreground'
            )}
          >
            {line || '\u00a0'}
          </div>
        ))}
        {isRunning && <div className="animate-pulse text-tertiary">▍</div>}
      </div>

      {!isAgent && (
        <div className="flex shrink-0 items-center gap-2 border-t border-border/60 px-3 py-1.5 font-mono text-[12px]">
          <span className={cn('shrink-0', isRunning ? 'text-amber-500' : 'text-primary')}>❯</span>
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
            placeholder={isRunning ? t('terminal.runningHint') : t('terminal.inputPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-foreground caret-foreground outline-none placeholder:text-tertiary"
          />
        </div>
      )}
    </div>
  )
}
