import { useEffect, useRef, useState, type JSX } from 'react'
import { Images, Monitor, Play, RefreshCw, Trash2, Video, VideoOff, X } from 'lucide-react'
import type { McpServerState } from '@shared/mcp'
import type { ScreenFrame } from '@/stores/screen'
import { useScreenStore } from '@/stores/screen'
import { useSettingsStore } from '@/stores/settings'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/**
 * The Screen dock: a live view of a connected application's window plus a
 * captioned history of frames captured after each of the agent's tool calls.
 * The live stream is the human's picture; the frames are also what a
 * vision-capable model could be shown later.
 */

type ScreenMode = 'live' | 'frames'

interface LiveState {
  status: 'idle' | 'connecting' | 'streaming' | 'error'
  error: string | null
  title: string | null
}

export function ScreenPanel({ open }: { open: boolean }): JSX.Element {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const [servers, setServers] = useState<McpServerState[] | null>(null)
  const [activeServer, setActiveServer] = useState<string | null>(null)
  const [mode, setMode] = useState<ScreenMode>('live')
  const [dragWidth, setDragWidth] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    void window.relaxcode.mcp.list().then((list) => {
      if (!alive) return
      setServers(list)
      setActiveServer((current) => current ?? list.find((s) => s.status === 'ready')?.config.name ?? null)
    })
    return window.relaxcode.mcp.onEvent((event) => {
      if (event.type !== 'state') return
      setServers(event.states)
      setActiveServer((selected) => {
        if (selected && event.states.some((s) => s.config.name === selected)) return selected
        return event.states.find((s) => s.status === 'ready')?.config.name ?? null
      })
    })
  }, [])

  // The left edge is a drag handle: resize live, persist on release.
  const startResize = (event: React.MouseEvent): void => {
    event.preventDefault()
    const onMove = (move: MouseEvent): void => {
      setDragWidth(Math.min(720, Math.max(280, window.innerWidth - move.clientX)))
    }
    const onUp = (up: MouseEvent): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const width = Math.min(720, Math.max(280, window.innerWidth - up.clientX))
      setDragWidth(null)
      void useSettingsStore.getState().apply({ ui: { screenWidth: width } })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const ready = (servers ?? []).filter((s) => s.config.enabled && s.config.trusted)
  const active = ready.find((s) => s.config.name === activeServer) ?? null
  const width = dragWidth ?? settings?.ui.screenWidth ?? 360

  return (
    <aside
      data-testid="screen-panel"
      // Always mounted: the width collapses to 0 when closed, so opening reads
      // as the same smooth slide the chat panel makes.
      className="relative h-full shrink-0 overflow-hidden bg-background transition-[width] duration-200 ease-out"
      style={{ width: open ? width : 0 }}
    >
      <div className="relative flex h-full w-[var(--screen-width)] flex-col border-l border-border" style={{ '--screen-width': `${width}px` } as React.CSSProperties}>
      <div
        onMouseDown={startResize}
        className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize hover:bg-primary/30"
        aria-hidden
      />
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2.5">
        <Monitor className="size-4 text-foreground/85" />
        <span className="text-[13px] font-semibold">{t('screen.title')}</span>
        {active && (
          <span
            className={cn('size-2 rounded-full', {
              'bg-emerald-500': active.status === 'ready',
              'bg-amber-500 animate-pulse': active.status === 'starting',
              'bg-destructive': active.status === 'error'
            })}
          />
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('screen.mode.live')}
            title={t('screen.mode.live')}
            className={cn('text-muted-foreground', mode === 'live' && 'bg-pressed text-foreground')}
            onClick={() => setMode('live')}
          >
            <Video className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('screen.mode.frames')}
            title={t('screen.mode.frames')}
            className={cn('text-muted-foreground', mode === 'frames' && 'bg-pressed text-foreground')}
            onClick={() => setMode('frames')}
          >
            <Images className="size-4" />
          </Button>
        </div>
      </header>

      {ready.length > 0 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
          {ready.map((item) => (
            <button
              key={item.config.name}
              type="button"
              data-testid={`screen-tab-${item.config.name}`}
              onClick={() => setActiveServer(item.config.name)}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] transition-colors',
                item.config.name === activeServer
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/60'
              )}
            >
              {item.config.name}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {!active ? (
          <ScreenHint text={t('screen.noServers')} hint={t('screen.noServersHint')} />
        ) : mode === 'live' ? (
          <LiveView server={active.name} />
        ) : (
          <FramesFeed server={active.name} />
        )}
      </div>
      </div>
    </aside>
  )
}

/** Explains itself instead of showing a dead panel. */
function ScreenHint({
  text,
  hint,
  action
}: {
  text: string
  hint?: string
  action?: JSX.Element
}): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
      <VideoOff className="size-5 text-muted-foreground/70" />
      <p className="text-[12px] text-foreground">{text}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {action && <div className="pt-1.5">{action}</div>}
    </div>
  )
}

function LiveView({ server }: { server: string }): JSX.Element {
  const t = useT()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [state, setState] = useState<LiveState>({ status: 'idle', error: null, title: null })
  const [attempt, setAttempt] = useState(0)
  const [launching, setLaunching] = useState(false)
  const lastSourceId = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let stream: MediaStream | null = null

    const start = async (): Promise<void> => {
      setState({ status: 'connecting', error: null, title: null })
      const source = await window.relaxcode.screen.getSource(server)
      if (cancelled) return
      if (!source.ok) {
        setState({ status: 'error', error: 'not-found', title: null })
        return
      }
      lastSourceId.current = source.sourceId
      try {
        // Desktop capture inside Electron: the main process hands us the
        // window id, the renderer turns it into a MediaStream. No resolution
        // caps — the stream comes at the window's native pixel size.
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: source.sourceId,
              maxFrameRate: 30
            }
          }
        } as unknown as MediaStreamConstraints)
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play().catch(() => {})
        }
        setState({ status: 'streaming', error: null, title: source.title })
      } catch {
        if (!cancelled) setState({ status: 'error', error: 'denied', title: null })
      }
    }

    void start()
    // Apps like Godot swap windows mid-session (editor ↔ project manager):
    // the old capture goes black. A light poll re-resolves the source and
    // restarts the stream whenever the window identity changes.
    const watcher = window.setInterval(async () => {
      if (cancelled) return
      const source = await window.relaxcode.screen.getSource(server)
      if (cancelled) return
      if (!source.ok) return // transient: keep the current stream alive
      if (source.sourceId !== lastSourceId.current) {
        setAttempt((value) => value + 1)
      }
    }, 2500)

    return () => {
      cancelled = true
      window.clearInterval(watcher)
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [server, attempt])

  /** One click from the hint: detect the installed app and start it. */
  const launchFromHint = async (): Promise<void> => {
    setLaunching(true)
    try {
      const apps = await window.relaxcode.mcp.detect(server)
      if (apps[0]) {
        const result = await window.relaxcode.mcp.launch(server, apps[0].exePath)
        if (result.ok) window.setTimeout(() => setAttempt((value) => value + 1), 6000)
      }
    } finally {
      setLaunching(false)
    }
  }

  if (state.status === 'error') {
    return (
      <ScreenHint
        text={state.error === 'not-found' ? t('screen.live.notFound') : t('screen.live.denied')}
        hint={t('screen.live.hint')}
        action={
          state.error === 'not-found' ? (
            <Button
              type="button"
              variant="muted"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={launching}
              onClick={() => void launchFromHint()}
            >
              {launching ? <RefreshCw className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              {t('screen.live.launch')}
            </Button>
          ) : undefined
        }
      />
    )
  }

  return (
    <div className="relative flex h-full flex-col">
      <video
        ref={videoRef}
        muted
        autoPlay
        className={cn('min-h-0 w-full flex-1 bg-black object-contain', state.status !== 'streaming' && 'opacity-0')}
        onEnded={() => setState({ status: 'error', error: 'not-found', title: null })}
      />
      {state.status !== 'streaming' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <RefreshCw className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {state.status === 'streaming' && (
        <p className="shrink-0 truncate border-t border-border px-2.5 py-1.5 text-[10px] text-muted-foreground" title={state.title ?? undefined}>
          {t('screen.live.liveLabel')}
          {state.title ? ` — ${state.title}` : ''}
        </p>
      )}
    </div>
  )
}

function FramesFeed({ server }: { server: string }): JSX.Element {
  const t = useT()
  const frames = useScreenStore((s) => s.frames).filter((frame) => frame.server === server)
  const clearFrames = useScreenStore((s) => s.clearFrames)
  const [selected, setSelected] = useState<ScreenFrame | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [frames.length])

  if (frames.length === 0) {
    return <ScreenHint text={t('screen.frames.empty')} hint={t('screen.frames.hint')} />
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex justify-end px-2 pt-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
          onClick={() => clearFrames(server)}
        >
          <Trash2 className="size-3" />
          {t('screen.frames.clear')}
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-2.5 pb-3">
        {frames.map((frame) => (
          <figure key={frame.id} className="overflow-hidden rounded-lg border border-border">
            <button
              type="button"
              className="block w-full cursor-zoom-in"
              onClick={() => setSelected(frame)}
              aria-label={t('screen.frames.openLarge')}
            >
              <img src={frame.dataUrl} alt={frame.caption} className="w-full bg-black object-contain" />
            </button>
            <figcaption className="flex items-baseline gap-2 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[10px] text-foreground" title={frame.caption}>
                {frame.caption}
              </span>
              <time className="shrink-0 text-[10px] text-muted-foreground">{formatTime(frame.at)}</time>
            </figcaption>
          </figure>
        ))}
        <div ref={bottomRef} />
      </div>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent overlayClassName="bg-black/85" className="w-auto max-w-[94vw] border-0 bg-transparent p-2 shadow-none [&>button]:hidden">
          <DialogTitle className="sr-only">{selected?.caption ?? t('screen.frames.openLarge')}</DialogTitle>
          {selected && (
            <div className="relative inline-flex max-w-[94vw] flex-col">
              <img
                src={selected.dataUrl}
                alt={selected.caption}
                className="max-h-[82vh] w-auto max-w-full rounded-lg bg-black object-contain"
              />
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label={t('action.close')}
                className="absolute -right-3 -top-3 rounded-full border border-white/20 bg-black/80 p-1.5 text-white/80 shadow-lg transition-colors hover:text-white"
              >
                <X className="size-4" />
              </button>
              <div className="flex items-center gap-2 px-1 pt-2 text-[11px] text-white/60">
                <span className="min-w-0 flex-1 truncate text-white/80" title={selected.caption}>
                  {selected.caption}
                </span>
                <span className="shrink-0 tabular-nums">{formatTime(selected.at)}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
