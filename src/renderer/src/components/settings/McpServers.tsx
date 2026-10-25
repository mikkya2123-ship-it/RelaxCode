import { useEffect, useState, type JSX } from 'react'
import {
  Box,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Pencil,
  Play,
  Plug,
  PlugZap,
  Plus,
  Rocket,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Upload
} from 'lucide-react'
import {
  MCP_NAME_RE,
  MCP_RISKS,
  MCP_TRANSPORTS,
  type McpDetectedApp,
  type McpServerConfig,
  type McpServerState
} from '@shared/mcp'
import { useT } from '@/lib/i18n'
import { toast } from '@/stores/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { SelectInput } from './controls'

/**
 * The MCP section: one card per server from `userData/mcp.json`. Everything is
 * editable in place — command, args, env, per-tool risk — and a server that
 * has never been confirmed shows its exact launch line before it can run.
 */

const STATUS_CLASSES: Record<McpServerState['status'], string> = {
  ready: 'text-emerald-500',
  starting: 'text-amber-500',
  error: 'text-destructive',
  stopped: 'text-muted-foreground'
}

const RISK_LABELS: Record<string, string> = {
  read: 'settings.risk.read',
  write: 'settings.risk.write',
  exec: 'settings.risk.exec',
  delete: 'settings.risk.delete'
}

function emptyDraft(): McpServerConfig {
  return {
    name: '',
    transport: 'stdio',
    command: '',
    args: [],
    env: {},
    cwd: '',
    url: '',
    enabled: true,
    trusted: false,
    defaultRisk: 'exec',
    toolRisk: {},
    disabledTools: [],
    timeoutMs: 60000
  }
}

function linesToArgs(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function argsToLines(args: string[]): string {
  return args.join('\n')
}

function envToLines(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

function linesToEnv(text: string): { env: Record<string, string>; dropped: number } {
  const env: Record<string, string> = {}
  let dropped = 0
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    const eq = line.indexOf('=')
    if (eq <= 0) {
      dropped += 1
      continue
    }
    env[line.slice(0, eq).trim()] = line.slice(eq + 1)
  }
  return { env, dropped }
}

function commandSummary(config: McpServerConfig): string {
  if (config.transport === 'http') return config.url
  return [config.command, ...config.args].join(' ')
}

export function McpServersControl(): JSX.Element {
  const t = useT()
  const [states, setStates] = useState<McpServerState[] | null>(null)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importDraft, setImportDraft] = useState('')

  useEffect(() => {
    let alive = true
    void window.relaxcode.mcp.list().then((list) => {
      if (alive) setStates(list)
    })
    const off = window.relaxcode.mcp.onEvent((event) => {
      if (event.type === 'state') setStates(event.states)
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  const connect = async (name: string): Promise<void> => {
    const result = await window.relaxcode.mcp.connect(name)
    if (!result.ok && result.error && result.error !== 'superseded') {
      toast(t('settings.mcp.startFailed', { error: result.error }), '', 'error')
    }
  }

  const add = (): void => {
    setEditing('new')
  }

  const exportFile = async (): Promise<void> => {
    const result = await window.relaxcode.mcp.exportFile()
    if (result.ok && result.path) toast(t('settings.mcp.exported', { path: result.path }), result.path)
    else if (!result.canceled) toast(t('settings.saveFailed'), result.error ?? '', 'error')
  }

  const runImport = async (): Promise<void> => {
    const result = await window.relaxcode.mcp.import(importDraft)
    if (result.ok) {
      toast(t('settings.mcp.imported', { count: result.added }))
      setImportOpen(false)
      setImportDraft('')
    } else {
      toast(t('settings.saveFailed'), t(`settings.mcp.error.${result.error ?? 'unknown'}` as never), 'error')
    }
  }

  return (
    <div className="space-y-2.5 p-3">
      <div className="flex items-center gap-1.5">
        <Button type="button" variant="muted" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={add}>
          <Plus className="size-3.5" />
          {t('settings.mcp.add')}
        </Button>
        <Button
          type="button"
          variant="muted"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => setImportOpen((open) => !open)}
        >
          <Upload className="size-3.5" />
          {t('settings.mcp.import')}
        </Button>
        <Button type="button" variant="muted" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => void exportFile()}>
          <Download className="size-3.5" />
          {t('settings.mcp.export')}
        </Button>
        <span className="ml-auto text-[11px] text-muted-foreground">
          mcp.json — {t('settings.mcp.claudeCompat')}
        </span>
      </div>

      {importOpen && (
        <div className="rounded-lg border border-border p-3">
          <p className="mb-2 text-[12px] text-muted-foreground">{t('settings.mcp.importHint')}</p>
          <textarea
            value={importDraft}
            spellCheck={false}
            rows={6}
            className="w-full rounded-md border border-input bg-transparent p-2 font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onChange={(event) => setImportDraft(event.target.value)}
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setImportOpen(false)}>
              {t('settings.mcp.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="h-7 text-xs"
              disabled={importDraft.trim().length === 0}
              onClick={() => void runImport()}
            >
              {t('settings.mcp.importAction')}
            </Button>
          </div>
        </div>
      )}

      {states !== null && states.length === 0 && editing === null && (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-[12px] text-muted-foreground">
          {t('settings.mcp.empty')}
        </p>
      )}

      <BlenderWizard />

      {states?.map((state) =>
        editing === state.config.name ? null : (
          <McpServerCard
            key={state.name}
            state={state}
            onConnect={() => void connect(state.name)}
            onEdit={() => setEditing(state.config.name)}
            onRemove={() => setEditing(null)}
          />
        )
      )}

      {editing !== null && (
        <McpServerEditor
          draft={editing === 'new' ? emptyDraft() : (states?.find((s) => s.config.name === editing)?.config ?? emptyDraft())}
          isNew={editing === 'new'}
          takenNames={(states ?? []).map((s) => s.config.name).filter((name) => name !== editing)}
          onCancel={() => setEditing(null)}
          onSave={async (config) => {
            const result = await window.relaxcode.mcp.save(config)
            if (result.ok) {
              setStates(result.states)
              setEditing(null)
              toast(t('settings.mcp.saved'))
            } else {
              toast(t('settings.saveFailed'), t(`settings.mcp.error.${result.error}` as never), 'error')
            }
          }}
        />
      )}
    </div>
  )
}

/** One-click setup for the reference connector: detect Blender, install the runtime and the addon. */
function BlenderWizard(): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [apps, setApps] = useState<McpDetectedApp[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [lines, setLines] = useState<string[]>([])

  useEffect(() => {
    if (!open || apps !== null) return
    void window.relaxcode.mcp.detect('blender').then(setApps)
  }, [open, apps])

  useEffect(
    () =>
      window.relaxcode.mcp.onEvent((event) => {
        if (event.type === 'setup') {
          setLines((current) => [...current.slice(-80), event.level === 'error' ? `✕ ${event.line}` : event.line])
        }
      }),
    []
  )

  const setup = async (): Promise<void> => {
    setBusy(true)
    setDone(false)
    try {
      const result = await window.relaxcode.mcp.setup('blender')
      // Setup errors are human sentences from the connector, not i18n keys.
      if (result.ok) setDone(true)
      else toast(t('settings.mcp.setupFailed'), result.error ?? '', 'error')
    } finally {
      setBusy(false)
    }
  }

  const launch = async (exePath: string): Promise<void> => {
    const result = await window.relaxcode.mcp.launch('blender', exePath)
    if (!result.ok) toast(t('settings.mcp.launchFailed'), result.error ?? '', 'error')
  }

  return (
    <div className="rounded-lg border border-border bg-accent/20 p-3" data-testid="mcp-blender-wizard">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <Box className="size-4 text-foreground/85" />
        <span className="text-[13px] font-medium">{t('settings.mcp.wizard.title')}</span>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          {t('settings.mcp.wizard.toggle')}
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </span>
      </button>

      {open && (
        <div className="mt-2.5 space-y-2">
          {apps === null && <p className="text-[11px] text-muted-foreground">{t('settings.mcp.wizard.detecting')}</p>}
          {apps !== null && apps.length === 0 && (
            <p className="text-[11px] text-muted-foreground">{t('settings.mcp.wizard.notFound')}</p>
          )}
          {apps?.map((item) => (
            <div key={item.exePath} className="flex items-center gap-2">
              <span className="text-[12px] font-medium">{item.label}</span>
              {item.addonInstalled ? (
                <span className="text-[10px] text-emerald-500">{t('settings.mcp.wizard.addonYes')}</span>
              ) : (
                <span className="text-[10px] text-muted-foreground">{t('settings.mcp.wizard.addonNo')}</span>
              )}
              <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground" title={item.exePath}>
                {item.exePath}
              </code>
              <Button
                type="button"
                variant="muted"
                size="sm"
                className="h-6 gap-1 px-2 text-[11px]"
                title={t('settings.mcp.wizard.launchHint')}
                onClick={() => void launch(item.exePath)}
              >
                <Play className="size-3" />
                {t('settings.mcp.wizard.launch')}
              </Button>
            </div>
          ))}

          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={busy}
              onClick={() => void setup()}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />}
              {busy ? t('settings.mcp.wizard.installing') : t('settings.mcp.wizard.install')}
            </Button>
            <span className="text-[10px] text-muted-foreground">{t('settings.mcp.wizard.installHint')}</span>
          </div>

          {done && (
            <p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2 text-[11px] text-foreground">
              {t('settings.mcp.wizard.done')}
            </p>
          )}

          {lines.length > 0 && (
            <pre className="max-h-[160px] overflow-y-auto whitespace-pre-wrap rounded bg-muted/60 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {lines.join('\n')}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

interface McpServerCardProps {
  state: McpServerState
  onConnect: () => void
  onEdit: () => void
  onRemove: () => void
}

function McpServerCard({ state, onConnect, onEdit, onRemove }: McpServerCardProps): JSX.Element {
  const t = useT()
  const [expanded, setExpanded] = useState(state.config.trusted === false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [playbook, setPlaybook] = useState<string | null>(null)
  const [playbookDraft, setPlaybookDraft] = useState<string | null>(null)
  const { config } = state
  const needsTrust = !config.trusted

  // The playbook is loaded once the card is unfolded; saving overwrites the
  // per-server markdown file that the agent reads on the next message.
  useEffect(() => {
    if (!expanded || playbook !== null) return
    void window.relaxcode.mcp.playbookGet(config.name).then((text) => {
      setPlaybook(text)
      setPlaybookDraft(text)
    })
  }, [expanded, playbook, config.name])

  const trustAndConnect = async (): Promise<void> => {
    await window.relaxcode.mcp.trust(config.name)
    onConnect()
  }

  const toggleTool = (tool: string, enabled: boolean): void => {
    const disabledTools = enabled
      ? config.disabledTools.filter((item) => item !== tool)
      : [...config.disabledTools, tool]
    void window.relaxcode.mcp.save({ ...config, disabledTools })
  }

  const setToolRisk = (tool: string, risk: string): void => {
    void window.relaxcode.mcp.save({ ...config, toolRisk: { ...config.toolRisk, [tool]: risk } })
  }

  const busy = state.status === 'starting'

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <span className={cn('size-2 shrink-0 rounded-full', {
          'bg-emerald-500': state.status === 'ready',
          'bg-amber-500 animate-pulse': state.status === 'starting',
          'bg-destructive': state.status === 'error',
          'bg-muted-foreground/40': state.status === 'stopped'
        })} />
        <span className="text-[13px] font-medium">{config.name}</span>
        <span className={cn('text-[11px]', STATUS_CLASSES[state.status])}>
          {t(`settings.mcp.status.${state.status}` as never)}
        </span>
        {state.status === 'starting' && state.restarts > 0 && (
          <span className="text-[11px] text-amber-500">
            {t('settings.mcp.restartIn')} ({state.restarts})
          </span>
        )}
        {state.tools.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {t('settings.mcp.toolCount', { count: state.tools.length })}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {state.status === 'ready' || state.status === 'starting' ? (
            <Button
              type="button"
              variant="muted"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => void window.relaxcode.mcp.disconnect(config.name)}
            >
              <Plug className="size-3.5" />
              {t('settings.mcp.disconnect')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="muted"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              disabled={busy || needsTrust || !config.enabled}
              onClick={onConnect}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
              {t('settings.mcp.connect')}
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t('settings.mcp.edit')} onClick={onEdit}>
            <Pencil className="size-3.5" />
          </Button>
          {confirmRemove ? (
            <span className="flex items-center gap-1">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  void window.relaxcode.mcp.remove(config.name)
                  onRemove()
                }}
              >
                {t('settings.mcp.remove')}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setConfirmRemove(false)}>
                {t('settings.mcp.cancel')}
              </Button>
            </span>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('settings.mcp.remove')}
              onClick={() => setConfirmRemove(true)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('settings.mcp.tools')}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </Button>
        </div>
      </div>

      <p className="mt-1.5 truncate font-mono text-[11px] text-muted-foreground" title={commandSummary(config)}>
        {commandSummary(config)}
      </p>

      {state.status === 'error' && state.error && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-destructive">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" />
          {state.error}
        </p>
      )}

      {needsTrust && expanded && (
        <div className="mt-2.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
            <TriangleAlert className="size-3.5 text-amber-500" />
            {t('settings.mcp.trustTitle')}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">{t('settings.mcp.trustHint')}</p>
          <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded bg-muted/60 p-2 font-mono text-[11px]">
            {commandSummary(config)}
            {Object.entries(config.env).length > 0 && (
              <>
                {'\n'}
                {Object.entries(config.env)
                  .map(([key, value]) => `${key}=${value}`)
                  .join('\n')}
              </>
            )}
          </pre>
          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => void trustAndConnect()}
            >
              <ShieldCheck className="size-3.5" />
              {t('settings.mcp.trustAccept')}
            </Button>
          </div>
        </div>
      )}

      {expanded && (
        <div className="mt-2.5 space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('settings.mcp.tools')}
          </p>
          {state.tools.length === 0 && (
            <p className="text-[11px] text-muted-foreground">{t('settings.mcp.noTools')}</p>
          )}
          {state.tools.map((tool) => {
            const enabled = !config.disabledTools.includes(tool.tool)
            return (
              <div key={tool.name} className="flex items-center gap-2">
                <Switch checked={enabled} onCheckedChange={(next) => toggleTool(tool.tool, next)} />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={tool.description}>
                  {tool.tool}
                </span>
                <div className="w-[120px]">
                  <SelectInput
                    value={tool.risk}
                    options={MCP_RISKS.map((risk) => ({ value: risk, label: RISK_LABELS[risk] as never }))}
                    onChange={(next) => setToolRisk(tool.tool, next)}
                  />
                </div>
              </div>
            )
          })}
          {state.stderr.length > 0 && (
            <>
              <p className="pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('settings.mcp.stderr')}
              </p>
              <pre className="max-h-[140px] overflow-y-auto whitespace-pre-wrap rounded bg-muted/60 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                {state.stderr.join('\n')}
              </pre>
            </>
          )}
          {playbook !== null && (
            <>
              <p className="pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('settings.mcp.playbook')}
              </p>
              <p className="text-[10px] text-muted-foreground">{t('settings.mcp.playbook.hint')}</p>
              <textarea
                value={playbookDraft ?? ''}
                spellCheck={false}
                rows={8}
                data-testid="mcp-playbook"
                className="w-full rounded-md border border-input bg-transparent p-2 font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onChange={(event) => setPlaybookDraft(event.target.value)}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="muted"
                  size="sm"
                  className="h-6 gap-1 px-2 text-[11px]"
                  disabled={playbookDraft === null || playbookDraft === playbook}
                  onClick={() => {
                    if (playbookDraft === null) return
                    void window.relaxcode.mcp.playbookSet(config.name, playbookDraft).then((ok) => {
                      if (ok) {
                        setPlaybook(playbookDraft)
                        toast(t('settings.mcp.playbook.saved'))
                      } else {
                        toast(t('settings.saveFailed'), '', 'error')
                      }
                    })
                  }}
                >
                  {t('settings.mcp.playbook.save')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

interface McpServerEditorProps {
  draft: McpServerConfig
  isNew: boolean
  takenNames: string[]
  onCancel: () => void
  onSave: (config: McpServerConfig) => Promise<void>
}

function McpServerEditor({ draft, isNew, takenNames, onCancel, onSave }: McpServerEditorProps): JSX.Element {
  const t = useT()
  const [form, setForm] = useState(draft)
  const [argsText, setArgsText] = useState(argsToLines(draft.args))
  const [envText, setEnvText] = useState(envToLines(draft.env))
  const [saving, setSaving] = useState(false)

  const nameTaken = takenNames.includes(form.name.trim())
  const nameValid = MCP_NAME_RE.test(form.name.trim())
  const commandFilled = form.transport === 'http' ? /^https?:\/\//i.test(form.url.trim()) : form.command.trim().length > 0
  const valid = nameValid && !nameTaken && commandFilled

  const update = (values: Partial<McpServerConfig>): void => {
    setForm((current) => ({ ...current, ...values }))
  }

  const save = async (): Promise<void> => {
    const { env, dropped } = linesToEnv(envText)
    if (dropped > 0) {
      toast(t('settings.saveFailed'), t('settings.mcp.error.invalid-env'), 'error')
      return
    }
    setSaving(true)
    try {
      await onSave({
        ...form,
        name: form.name.trim(),
        command: form.command.trim(),
        url: form.url.trim(),
        cwd: form.cwd.trim(),
        args: linesToArgs(argsText),
        env
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-primary/50 p-3" data-testid="mcp-editor">
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] text-muted-foreground">{t('settings.mcp.form.name')}</span>
          <Input
            value={form.name}
            spellCheck={false}
            placeholder="blender"
            className={cn('h-7 font-mono text-[11px]', (!nameValid || nameTaken) && 'border-destructive')}
            onChange={(event) => update({ name: event.target.value })}
          />
          {(!nameValid || nameTaken) && (
            <span className="mt-0.5 block text-[10px] text-destructive">
              {nameTaken ? t('settings.mcp.error.name-taken') : t('settings.mcp.form.nameInvalid')}
            </span>
          )}
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-muted-foreground">{t('settings.mcp.form.transport')}</span>
          <SelectInput
            value={form.transport}
            options={MCP_TRANSPORTS.map((value) => ({ value, label: `settings.mcp.transport.${value}` as never }))}
            onChange={(next) => update({ transport: next as McpServerConfig['transport'] })}
          />
        </label>
        {form.transport === 'stdio' ? (
          <>
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted-foreground">{t('settings.mcp.form.command')}</span>
              <Input
                value={form.command}
                spellCheck={false}
                placeholder="uvx"
                className="h-7 font-mono text-[11px]"
                onChange={(event) => update({ command: event.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted-foreground">{t('settings.mcp.form.args')}</span>
              <textarea
                value={argsText}
                spellCheck={false}
                rows={2}
                placeholder={'blender-mcp@latest'}
                className="w-full rounded-md border border-input bg-transparent p-2 font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onChange={(event) => setArgsText(event.target.value)}
              />
            </label>
          </>
        ) : (
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[11px] text-muted-foreground">{t('settings.mcp.form.url')}</span>
            <Input
              value={form.url}
              spellCheck={false}
              placeholder="http://127.0.0.1:8000/mcp"
              className="h-7 font-mono text-[11px]"
              onChange={(event) => update({ url: event.target.value })}
            />
          </label>
        )}
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[11px] text-muted-foreground">{t('settings.mcp.form.env')}</span>
          <textarea
            value={envText}
            spellCheck={false}
            rows={2}
            placeholder={'BLENDER_HOST=127.0.0.1\nAPI_KEY=…'}
            className="w-full rounded-md border border-input bg-transparent p-2 font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onChange={(event) => setEnvText(event.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-muted-foreground">{t('settings.mcp.form.cwd')}</span>
          <Input
            value={form.cwd}
            spellCheck={false}
            className="h-7 font-mono text-[11px]"
            onChange={(event) => update({ cwd: event.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-muted-foreground">{t('settings.mcp.form.defaultRisk')}</span>
          <SelectInput
            value={form.defaultRisk}
            options={MCP_RISKS.map((risk) => ({ value: risk, label: RISK_LABELS[risk] as never }))}
            onChange={(next) => update({ defaultRisk: next as McpServerConfig['defaultRisk'] })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-muted-foreground">{t('settings.mcp.form.timeout')}</span>
          <Input
            type="number"
            value={form.timeoutMs}
            min={1000}
            max={600000}
            step={1000}
            className="h-7 font-mono text-[11px]"
            onChange={(event) => update({ timeoutMs: Number(event.target.value) || 60000 })}
          />
        </label>
        <div className="flex items-center gap-2 pt-4">
          <Switch checked={form.enabled} onCheckedChange={(next) => update({ enabled: next })} />
          <span className="text-[12px]">{t('settings.mcp.form.enabled')}</span>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>
          {t('settings.mcp.cancel')}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={!valid || saving}
          onClick={() => void save()}
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {isNew ? t('settings.mcp.add') : t('settings.mcp.save')}
        </Button>
      </div>
    </div>
  )
}
