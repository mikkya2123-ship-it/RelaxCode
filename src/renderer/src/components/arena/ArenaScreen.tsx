import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  Check,
  Coins,
  Crown,
  FileText,
  Gavel,
  Globe,
  Loader2,
  Paperclip,
  Plus,
  Swords,
  Trash2,
  X
} from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ArenaStyle } from '@shared/ipc'
import type { ArenaFeedLine } from '@/stores/arena'
import { aiCompanyOf, AiLogo } from '@/components/ui/ai-logo'
import { ModelIcon } from '@/components/ui/model-icon'
import { useArenaStore } from '@/stores/arena'
import { useSettingsStore } from '@/stores/settings'
import { useT } from '@/lib/i18n'
import {
  createPendingAttachment,
  processAttachment
} from '@/lib/attachments'
import { ATTACHMENT_LIMITS } from '@shared/attachments'
import type { AttachmentRef } from '@shared/attachments'
import { toast } from '@/stores/toast'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The Arena screen: give one task to several agent contestants, each on its
 * own model and creativity, watch them compete, pick the champion. While the
 * tournament runs, the workspace belongs to the contestants — it is rolled
 * back between them and restored to the original state at the end.
 */

const STYLES: ArenaStyle[] = ['careful', 'balanced', 'bold']

interface Entrant {
  providerId: string
  model: string
  style: ArenaStyle
  temperature: number
  thinking: 'off' | 'low' | 'medium' | 'high'
  topP: number
  maxSteps: number
  prompt: string
}

const STYLE_TEMPERATURE: Record<ArenaStyle, number> = {
  careful: 0.15,
  balanced: 0.5,
  bold: 1.0
}

/** Per-slot identity: each contestant wears its own colour across the UI. */
const SLOT_COLORS = [
  { dot: 'bg-blue-500', bar: 'border-l-blue-500', text: 'text-blue-600', accent: '#3b82f6' },
  { dot: 'bg-violet-500', bar: 'border-l-violet-500', text: 'text-violet-600', accent: '#8b5cf6' },
  { dot: 'bg-emerald-500', bar: 'border-l-emerald-500', text: 'text-emerald-600', accent: '#10b981' },
  { dot: 'bg-amber-500', bar: 'border-l-amber-500', text: 'text-amber-600', accent: '#f59e0b' }
]

function slotColor(index: number): (typeof SLOT_COLORS)[number] {
  return SLOT_COLORS[index % SLOT_COLORS.length]
}

function defaultEntrant(model: string | null, style: ArenaStyle = 'balanced'): Entrant {
  return {
    providerId: '',
    model: model ?? '',
    style,
    temperature: STYLE_TEMPERATURE[style],
    thinking: 'off',
    topP: 0,
    maxSteps: 0,
    prompt: ''
  }
}

/** The live work slide: tool calls bold, results colored, screenshots inline. */
function FeedBox({
  lines,
  empty,
  running,
  onOpenImage
}: {
  lines: ArenaFeedLine[]
  empty: string
  running: boolean
  onOpenImage: (src: string) => void
}): JSX.Element {
  const box = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight
  }, [lines])
  return (
    <div
      ref={box}
      className={cn(
        'mt-2.5 h-[280px] flex-1 space-y-1 overflow-y-auto rounded-lg bg-background/60 p-2 text-[11px] leading-snug',
        running && 'ring-1 ring-ring/30'
      )}
    >
      {lines.length === 0 && <p className="text-tertiary">{empty}</p>}
      {lines.map((line, index) => {
        if (line.kind === 'image') {
          return (
            <button
              key={index}
              type="button"
              className="block w-full overflow-hidden rounded-md border border-border"
              onClick={() => line.src && onOpenImage(line.src)}
              title="Открыть предпросмотр"
            >
              <img src={line.src} alt="" className="w-full" />
            </button>
          )
        }
        if (line.kind === 'tool') {
          return (
            <p key={index} className="break-all font-semibold text-foreground">
              ▸ {line.text}
            </p>
          )
        }
        if (line.kind === 'ok') {
          return (
            <p key={index} className="break-all text-success">
              ✓ {line.text}
            </p>
          )
        }
        if (line.kind === 'fail' || line.kind === 'error') {
          return (
            <p key={index} className="break-all font-medium text-destructive">
              ✕ {line.text}
            </p>
          )
        }
        return (
          <p key={index} className="whitespace-pre-wrap break-words text-muted-foreground">
            {line.text}
          </p>
        )
      })}
    </div>
  )
}

export function ArenaScreen(): JSX.Element | null {
  const t = useT()
  const applyContestant = async (contestantId: number): Promise<void> => {
    const result = await window.relaxcode.arena.pick(contestantId)
    if (result.ok) {
      useArenaStore.getState().reset()
      useArenaStore.getState().closeArena()
    } else {
      toast(t('arena.applyFailed'), t(`arena.error.${result.error}` as never), 'error')
    }
  }
  const open = useArenaStore((s) => s.open)
  const closeArena = useArenaStore((s) => s.closeArena)
  const state = useArenaStore((s) => s.state)
  const feeds = useArenaStore((s) => s.feeds)
  const previews = useArenaStore((s) => s.previews)
  const settings = useSettingsStore((s) => s.settings)
  const models = useSettingsStore((s) => s.models)
  const loadModels = useSettingsStore((s) => s.loadModels)

  const [task, setTask] = useState('')
  const [entrants, setEntrants] = useState<Entrant[]>([])
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [applyCandidate, setApplyCandidate] = useState<number | null>(null)
  const [attachments, setAttachments] = useState<AttachmentRef[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [sitePreview, setSitePreview] = useState<string | null>(null)

  const running = state?.status === 'running'
  const finished = state?.status === 'ready'

  // Defaults: the active provider/model plus two creative variants.
  useEffect(() => {
    if (entrants.length > 0 || state) return
    void loadModels()
    const provider = settings?.activeProviderId ?? ''
    setEntrants([
      defaultEntrant(settings?.model ?? null, 'careful'),
      defaultEntrant(settings?.model ?? null, 'balanced'),
      defaultEntrant(settings?.model ?? null, 'bold')
    ].map((entrant) => ({ ...entrant, providerId: provider })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // An entrant whose model never resolved must not reach the start button as
  // an empty string: fill newcomers with the first known model.
  useEffect(() => {
    if (models.length === 0) return
    setEntrants((list) => {
      const known = new Set(models.map((m) => m.id))
      const first = models[0].id
      let changed = false
      const next = list.map((entrant) => {
        if (entrant.model && known.has(entrant.model)) return entrant
        changed = true
        return { ...entrant, model: first }
      })
      return changed ? next : list
    })
  }, [models])

  // Same for the connection: "подключение" must never stay as a placeholder.
  useEffect(() => {
    const provider = settings?.activeProviderId
    if (!provider) return
    setEntrants((list) => {
      if (list.every((entrant) => entrant.providerId)) return list
      return list.map((entrant) => ({ ...entrant, providerId: entrant.providerId || provider }))
    })
  }, [settings?.activeProviderId])

  const providerOptions = useMemo(
    () =>
      (settings?.providers ?? []).map((provider) => ({
        value: provider.id,
        label: provider.name
      })),
    [settings?.providers]
  )

  /**
   * The dropdown never opens empty: when the shared model list is stale or
   * missing, the entrant's current model still shows as a pickable item.
   */
  const modelItems = useMemo(() => {
    const seen = new Set<string>()
    const items: Array<{ id: string }> = []
    for (const model of models) {
      if (!seen.has(model.id)) {
        seen.add(model.id)
        items.push({ id: model.id })
      }
    }
    for (const entrant of entrants) {
      if (entrant.model && !seen.has(entrant.model)) {
        seen.add(entrant.model)
        items.push({ id: entrant.model })
      }
    }
    return items
  }, [models, entrants])

  // The tournament keeps running with the screen closed: a floating pill
  // keeps the live work one click away.
  if (!open) {
    if (state?.status === 'running') {
      const done = state.contestants.filter((c) => c.status !== 'pending').length
      const active = state.contestants.find((c) => c.id === state.activeId)
      return (
        <button
          type="button"
          data-testid="arena-floating"
          onClick={useArenaStore.getState().openArena}
          className="fixed bottom-3 left-3 z-50 flex items-center gap-2.5 rounded-full border border-border bg-card px-4 py-2.5 text-[12.5px] shadow-lg transition-transform hover:scale-[1.02]"
        >
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-amber-400" />
          </span>
          <span className="font-medium">
            {t('arena.title')} · {t('arena.progress', { done, total: state.contestants.length })}
          </span>
          {active && <span className="text-muted-foreground">{active.model}</span>}
        </button>
      )
    }
    return null
  }

  const addFiles = (files: ArrayLike<File>): void => {
    const all = Array.from(files)
    if (all.length === 0) return
    const room = ATTACHMENT_LIMITS.maxCount - attachments.length
    if (room <= 0) return
    const shells = all.slice(0, room).map((file) => ({ file, attachment: createPendingAttachment(file) }))
    setAttachments((prev) => [...prev, ...shells.map((shell) => shell.attachment)])
    for (const shell of shells) {
      if (shell.attachment.status === 'error') continue
      void processAttachment(shell.attachment, shell.file).then((resolved) => {
        setAttachments((prev) =>
          prev.map((item) => (item.id === resolved.id ? resolved : item))
        )
      })
    }
  }

  const start = async (): Promise<void> => {
    if (starting) return
    setStarting(true)
    setError(null)
    const payload = entrants.map((entrant) => ({
      providerId:
        entrant.providerId || settings?.activeProviderId || settings?.providers[0]?.id || '',
      model: entrant.model,
      style: entrant.style,
      temperature: entrant.temperature,
      thinking: entrant.thinking,
      topP: entrant.topP,
      maxSteps: entrant.maxSteps,
      prompt: entrant.prompt
    }))
    const result = await window.relaxcode.arena.start(
      task.trim(),
      attachments.filter((item) => item.status === 'ready'),
      payload
    )
    setStarting(false)
    if (!result.ok) setError(result.error ?? 'error')
  }

  const setEntrant = (index: number, patch: Partial<Entrant>): void => {
    setEntrants((list) => list.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-background" data-testid="arena-screen">
      <header className="flex h-12 shrink-0 items-center gap-3 px-4">
        <Swords className="size-4 text-foreground/80" />
        <h1 className="text-[15px] font-semibold">{t('arena.title')}</h1>
        <p className="hidden text-[12px] text-muted-foreground sm:block">{t('arena.subtitle')}</p>
        <div className="ml-auto flex items-center gap-2">
          {running && (
            <Button
              variant="destructive"
              size="sm"
              className="h-8 text-[13px]"
              onClick={() => window.relaxcode.arena.cancel()}
            >
              {t('arena.cancel')}
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={closeArena}>
            {t('arena.close')}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[980px] px-6 py-5">
          {/* Setup — only before the first run */}
          {!state && (
            <section className="mb-6 rounded-xl border border-border bg-card p-4">
              <textarea
                value={task}
                onChange={(event) => setTask(event.target.value)}
                onDrop={(event) => {
                  if (event.dataTransfer.files.length > 0) {
                    event.preventDefault()
                    addFiles(event.dataTransfer.files)
                  }
                }}
                rows={3}
                placeholder={t('arena.taskPlaceholder')}
                className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-[13px] focus:border-ring focus:outline-none"
              />
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="arena-attach"
                  title={t('arena.attach')}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-[12px] text-muted-foreground transition-colors hover:border-ring/60 hover:text-foreground"
                >
                  <Paperclip className="size-3.5" />
                  {t('arena.attach')}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(event) => {
                    addFiles(event.target.files ?? [])
                    event.target.value = ''
                  }}
                />
                {attachments.map((item) => (
                  <span
                    key={item.id}
                    data-testid="arena-attachment"
                    className="flex items-center gap-1.5 rounded-lg border border-input bg-card py-1 pl-1.5 pr-1 text-[12px]"
                  >
                    {item.kind === 'image' && item.dataUrl ? (
                      <img src={item.dataUrl} alt="" className="size-6 rounded object-cover" />
                    ) : (
                      <FileText className="size-3.5 shrink-0 text-tertiary" />
                    )}
                    <span className="max-w-[180px] truncate">{item.name}</span>
                    {item.status !== 'ready' && (
                      <Loader2 className="size-3 shrink-0 animate-spin text-tertiary" />
                    )}
                    <button
                      type="button"
                      aria-label={t('action.removeItem')}
                      className="rounded p-0.5 text-tertiary transition-colors hover:bg-accent hover:text-foreground"
                      onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== item.id))}
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-3 space-y-3">
                {entrants.map((entrant, index) => (
                  <div
                    key={index}
                    className="relative overflow-hidden rounded-lg border border-input/60 bg-background/50 px-3 py-2.5"
                  >
                   <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white',
                        slotColor(index).dot
                      )}
                    >
                      {index + 1}
                    </span>
                    <Select
                      value={entrant.providerId || undefined}
                      onValueChange={(value) => setEntrant(index, { providerId: value })}
                    >
                      <SelectTrigger
                        className={cn(
                          'h-8 w-[150px] shrink-0 rounded-md px-3 text-[12px]',
                          !entrant.providerId && 'text-tertiary'
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <AiLogo name={entrant.providerId} size={14} />
                          <span className="truncate">
                            {providerOptions.find((provider) => provider.value === entrant.providerId)
                              ?.label ?? t('arena.pickProvider')}
                          </span>
                        </span>
                      </SelectTrigger>
                      <SelectContent className="max-h-[280px]">
                        {providerOptions.map((provider) => (
                            <SelectItem key={provider.value} value={provider.value} className="text-[12.5px]">
                              <span className="flex items-center gap-2">
                                <AiLogo name={provider.label} size={14} />
                                {provider.label}
                              </span>
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={entrant.model || undefined}
                      onValueChange={(value) => setEntrant(index, { model: value })}
                      onOpenChange={(next) => {
                        if (next) void loadModels()
                      }}
                    >
                      <SelectTrigger
                        className={cn(
                          'h-8 min-w-[160px] flex-1 rounded-md px-3 text-[12px]',
                          !entrant.model && 'text-tertiary'
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <AiLogo name={entrant.model} size={14} />
                          {!aiCompanyOf(entrant.model) && entrant.model && (
                            <ModelIcon id={entrant.model} className="size-3.5 shrink-0" />
                          )}
                          <span className="truncate">
                            {entrant.model || t('arena.pickModel')}
                          </span>
                        </span>
                      </SelectTrigger>
                      <SelectContent className="max-h-[280px]">
                        {modelItems.length === 0 && (
                          <div className="px-3 py-2 text-[12px] text-tertiary">
                            {t('arena.modelsUnavailable')}
                          </div>
                        )}
                        {modelItems.map((model) => (
                            <SelectItem key={model.id} value={model.id} className="text-[12.5px]">
                              <span className="flex items-center gap-2">
                                <AiLogo name={model.id} size={14} />
                                {!aiCompanyOf(model.id) && <ModelIcon id={model.id} className="size-3.5 shrink-0" />}
                                {model.id}
                              </span>
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={entrant.style}
                      onValueChange={(value) => {
                        const next = value as ArenaStyle
                        setEntrant(index, { style: next, temperature: STYLE_TEMPERATURE[next] })
                      }}
                    >
                      <SelectTrigger
                        title={t('arena.styleHint')}
                        className="h-8 w-[140px] shrink-0 rounded-md px-3 text-[12px]"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STYLES.map((option) => (
                          <SelectItem key={option} value={option} className="text-[12.5px]">
                            {t(`arena.style.${option}` as never)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {entrants.length > 2 && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('arena.removeContestant')}
                        className="ml-auto shrink-0"
                        onClick={() => setEntrants((list) => list.filter((_, i) => i !== index))}
                      >
                          <Trash2 className="size-3.5" />
                      </Button>
                    )}
                   </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-8">
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {t('arena.temperature')}
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.05}
                        value={entrant.temperature}
                        onChange={(event) =>
                          setEntrant(index, { temperature: Number(event.target.value) })
                        }
                        style={{ accentColor: slotColor(index).accent }}
                        className="h-1 min-w-[140px] flex-1"
                      />
                      <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-foreground">
                        {entrant.temperature.toFixed(2)}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {t('arena.thinking')}
                      </span>
                      <Select
                        value={entrant.thinking}
                        onValueChange={(value) =>
                          setEntrant(index, { thinking: value as Entrant['thinking'] })
                        }
                      >
                        <SelectTrigger className="h-7 w-[130px] shrink-0 rounded-md px-2.5 text-[11.5px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(['off', 'low', 'medium', 'high'] as const).map((level) => (
                            <SelectItem key={level} value={level} className="text-[12px]">
                              {t(`chat.thinking.${level}` as never)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-8">
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {t('arena.topP')}
                      </span>
                      <input
                        type="range"
                        min={0.05}
                        max={1}
                        step={0.05}
                        value={entrant.topP || 1}
                        onChange={(event) =>
                          setEntrant(index, { topP: Number(event.target.value) })
                        }
                        style={{ accentColor: slotColor(index).accent }}
                        className="h-1 min-w-[140px] flex-1"
                      />
                      <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-foreground">
                        {(entrant.topP || 1).toFixed(2)}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {t('arena.maxSteps')}
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={500}
                        value={entrant.maxSteps || ''}
                        placeholder={t('arena.maxStepsDefault')}
                        onChange={(event) => {
                          const parsed = Number(event.target.value)
                          setEntrant(index, {
                            maxSteps: Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0
                          })
                        }}
                        className="h-7 w-[84px] shrink-0 rounded-md border border-input bg-background px-2 text-[11.5px] tabular-nums focus:border-ring focus:outline-none"
                      />
                    </div>
                    <textarea
                      value={entrant.prompt}
                      maxLength={2000}
                      rows={2}
                      placeholder={t('arena.promptPlaceholder')}
                      onChange={(event) => setEntrant(index, { prompt: event.target.value })}
                      className="mt-2 w-full resize-none rounded-lg border border-input bg-background px-2.5 py-1.5 text-[11.5px] text-foreground placeholder:text-tertiary focus:border-ring focus:outline-none"
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between gap-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-[13px]"
                  disabled={entrants.length >= 4}
                  onClick={() =>
                    setEntrants((list) => [
                      ...list,
                      {
                        ...defaultEntrant(settings?.model ?? null),
                        providerId: settings?.activeProviderId ?? ''
                      }
                    ])
                  }
                >
                  <Plus className="size-3.5" />
                  {t('arena.addContestant')}
                </Button>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11.5px] leading-tight text-amber-600 dark:text-amber-400">
                    <Coins className="size-3.5 shrink-0" />
                    {t('arena.tokens', { n: entrants.length })}
                  </span>
                  <Button
                    variant="primary"
                    size="sm"
                    className="h-9 gap-2 text-[13px]"
                    disabled={
                      task.trim().length === 0 ||
                      starting ||
                      attachments.some((item) => item.status !== 'ready') ||
                      entrants.some((entrant) => !entrant.model.trim())
                    }
                    onClick={() => void start()}
                  >
                    {starting ? <Loader2 className="size-4 animate-spin" /> : <Swords className="size-4" />}
                    {t('arena.start')}
                  </Button>
                </div>
              </div>
              {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
              <p className="mt-3 text-[11.5px] leading-snug text-tertiary">{t('arena.warning')}</p>
            </section>
          )}

          {running && state && (
            <div className="mb-4 flex items-center gap-3" data-testid="arena-progress">
              <span className="shrink-0 text-[12px] text-muted-foreground">
                {t('arena.progress', {
                  done: state.contestants.filter((c) => c.status !== 'pending').length,
                  total: state.contestants.length
                })}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/[0.08]">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{
                    width: `${
                      (state.contestants.filter((c) => c.status !== 'pending').length /
                        state.contestants.length) *
                      100
                    }%`
                  }}
                />
              </div>
            </div>
          )}

          {state?.error && (
            <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
              {t(`arena.error.${state.error}` as never) ?? state.error}
            </p>
          )}

          {/* Contestants */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {state?.contestants.map((contestant) => {
              const feedLines = feeds[`${state.id}-c${contestant.id}`] ?? []
              return (
                <div
                  key={contestant.id}
                  data-testid={`arena-card-${contestant.id}`}
                  className={cn(
                    'relative overflow-hidden flex min-h-[220px] flex-col rounded-xl border bg-card p-3.5 transition-colors',
                    state.activeId === contestant.id && 'border-ring/60'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white',
                        slotColor(contestant.id - 1).dot
                      )}
                    >
                      {contestant.id}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                      {contestant.model}
                    </span>
                    <span className="shrink-0 rounded-md bg-accent px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
                      {t(`arena.style.${contestant.style}` as never)}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      {contestant.status === 'running' ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : contestant.status === 'done' ? (
                        <Check className="size-3 text-success" />
                      ) : contestant.status === 'failed' ? (
                        <X className="size-3 text-destructive" />
                      ) : null}
                      {t(`arena.status.${contestant.status}` as never)}
                    </span>
                    <span>
                      {t('arena.steps')}: {contestant.steps}
                    </span>
                    <span>
                      {t('arena.files')}: {contestant.files}
                    </span>
                    {contestant.tests !== 'unknown' && (
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10.5px] font-medium',
                          contestant.tests === 'pass' && 'bg-success/15 text-success',
                          contestant.tests === 'fail' && 'bg-destructive/15 text-destructive',
                          contestant.tests === 'skipped' && 'bg-accent text-muted-foreground'
                        )}
                      >
                        {t(`arena.tests.${contestant.tests}` as never)}
                      </span>
                    )}
                  </div>

                  {(previews[`${state.id}-c${contestant.id}`] ||
                    contestant.status === 'done') && (
                    <button
                      type="button"
                      data-testid={`arena-site-${contestant.id}`}
                      onClick={async () => {
                        const live = previews[`${state.id}-c${contestant.id}`]
                        if (live) {
                          setSitePreview(live)
                          return
                        }
                        const result = await window.relaxcode.arena.preview(contestant.id)
                        if (result.ok && result.url) setSitePreview(result.url)
                        else
                          toast(
                            t('arena.applyFailed'),
                            t(`arena.error.${result.error}` as never),
                            'error'
                          )
                      }}
                      className="mt-2.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-input bg-background text-[12px] text-muted-foreground transition-colors hover:border-ring/60 hover:text-foreground"
                    >
                      <Globe className="size-3.5" />
                      {previews[`${state.id}-c${contestant.id}`]
                        ? t('arena.openSite')
                        : t('arena.openWork')}
                    </button>
                  )}
                  {state.activeId === contestant.id && (
                    <div className="mt-2 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                      <span className="relative flex size-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                        <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
                      </span>
                      {t('arena.liveFeed')}
                    </div>
                  )}
                  <FeedBox
                    lines={feedLines}
                    empty={t('arena.feedEmpty')}
                    running={state.activeId === contestant.id}
                    onOpenImage={setPreview}
                  />

                  {finished && (
                    <Button
                      variant="primary"
                      size="sm"
                      className="mt-2.5 h-8 w-full text-[12.5px]"
                      data-testid={`arena-pick-${contestant.id}`}
                      onClick={() => setApplyCandidate(contestant.id)}
                    >
                      <Crown className="size-3.5" />
                      {t('arena.pick')}
                    </Button>
                  )}
                </div>
              )
            })}
          </div>

          {/* The judge advises; the human decides. */}
          {state?.judge && (
            <aside className="mt-5 rounded-xl border-l-2 border-l-ring/60 bg-accent/40 px-4 py-3">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
                <Gavel className="size-3.5" />
                {t('arena.judge.title')}
                {state.judge.status === 'running' && <Loader2 className="size-3 animate-spin" />}
              </div>
              {state.judge.status === 'done' && (
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                  {state.judge.winnerId !== null && (
                    <span className="font-semibold text-foreground">
                      {t('arena.judge.winner', { n: state.judge.winnerId })} —{' '}
                    </span>
                  )}
                  {state.judge.reason}
                </p>
              )}
              {state.judge.status === 'failed' && (
                <p className="mt-1.5 text-[12px] text-muted-foreground">{state.judge.reason}</p>
              )}
              <p className="mt-1.5 text-[11px] text-tertiary">{t('arena.judge.hint')}</p>
            </aside>
          )}

          {/* The summary fills the quiet state after the tournament. */}
          {finished && state.judge?.status !== 'running' && (
            <section className="mt-4 rounded-xl border border-border bg-card p-4">
              <h3 className="text-[13px] font-semibold">{t('arena.summary.title')}</h3>
              <p className="mt-1.5 text-[12px] text-muted-foreground">{state.task}</p>
              <table className="mt-3 w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[11px] text-tertiary">
                    <th className="pb-1 font-medium">{t('arena.summary.contestant')}</th>
                    <th className="pb-1 font-medium">{t('arena.summary.style')}</th>
                    <th className="pb-1 font-medium">{t('arena.steps')}</th>
                    <th className="pb-1 font-medium">{t('arena.files')}</th>
                    <th className="pb-1 font-medium">{t('arena.summary.tests')}</th>
                    <th className="pb-1" />
                  </tr>
                </thead>
                <tbody>
                  {state.contestants.map((contestant) => (
                    <tr key={contestant.id} className="border-t border-border/60">
                      <td className="py-1.5 pr-2">
                        <span className="text-muted-foreground">#{contestant.id}</span>{' '}
                        <span className="font-medium">{contestant.model}</span>
                      </td>
                      <td className="py-1.5 pr-2 text-muted-foreground">
                        {t(`arena.style.${contestant.style}` as never)}
                      </td>
                      <td className="py-1.5 pr-2 tabular-nums">{contestant.steps}</td>
                      <td className="py-1.5 pr-2 tabular-nums">{contestant.files}</td>
                      <td className="py-1.5 pr-2">{t(`arena.tests.${contestant.tests}` as never)}</td>
                      <td className="py-1.5 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[12px]"
                          onClick={() => setApplyCandidate(contestant.id)}
                        >
                          <Crown className="size-3" />
                          {t('arena.pick')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 flex items-center justify-between gap-4">
                <p className="text-[11px] leading-snug text-tertiary">{t('arena.warning')}</p>
                <Button
                  variant="default"
                  size="sm"
                  className="h-8 shrink-0 text-[12.5px]"
                  onClick={() => useArenaStore.getState().reset()}
                >
                  <Swords className="size-3.5" />
                  {t('arena.newTournament')}
                </Button>
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Applying a champion is destructive for the other contestants. */}
      <Dialog open={applyCandidate !== null} onOpenChange={(next) => !next && setApplyCandidate(null)}>
        <DialogContent className="max-w-[400px] gap-0">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{t('arena.confirm.title', { n: applyCandidate ?? 0 })}</DialogTitle>
            <DialogDescription>{t('arena.confirm.body')}</DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" className="h-8 text-[13px]" onClick={() => setApplyCandidate(null)}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="h-8 text-[13px]"
              onClick={() => {
                const id = applyCandidate
                setApplyCandidate(null)
                if (id !== null) void applyContestant(id)
              }}
            >
              <Crown className="size-3.5" />
              {t('arena.confirm.apply')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Full-size preview of a contestant's screenshot: tall mobile shots fit
          the screen instead of overflowing past the close button. */}
      <Dialog open={preview !== null} onOpenChange={(next) => !next && setPreview(null)}>
        <DialogContent overlayClassName="bg-black/85" className="w-auto max-w-[94vw] border-0 bg-transparent p-2 shadow-none [&>button]:hidden">
          <DialogTitle className="sr-only">{t('arena.preview')}</DialogTitle>
          {preview && (
            <div className="relative inline-flex max-w-[94vw] flex-col">
              <img
                src={preview}
                alt=""
                className="max-h-[82vh] w-auto max-w-full rounded-lg object-contain"
              />
              <button
                type="button"
                onClick={() => setPreview(null)}
                aria-label={t('action.close')}
                className="absolute -right-3 -top-3 rounded-full border border-white/20 bg-black/80 p-1.5 text-white/80 shadow-lg transition-colors hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* The live site: the contestant's dev server, framed and scrollable. */}
      <Dialog
        open={sitePreview !== null}
        onOpenChange={(next) => {
          if (!next) {
            setSitePreview(null)
            window.relaxcode.arena.previewStop()
          }
        }}
      >
        <DialogContent overlayClassName="bg-black/85" className="flex h-[90vh] max-w-[95vw] flex-col gap-0 border-0 bg-transparent p-3 shadow-none">
          <DialogTitle className="sr-only">{t('arena.sitePreview')}</DialogTitle>
          <div className="flex items-center gap-2 pb-2">
            <Globe className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
              {sitePreview}
            </span>
          </div>
          {sitePreview && (
            <iframe
              src={sitePreview}
              title={t('arena.sitePreview')}
              className="min-h-0 w-full flex-1 rounded-lg border border-border bg-white"
              sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

