import { useEffect, useState, type JSX } from 'react'
import {
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
import { useExplorerStore } from '@/stores/explorer'
import { toast } from '@/stores/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { McpAppIcon } from '@/components/ui/mcp-app-icon'
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

/**
 * One-click presets for the well-known MCP servers. npx presets need
 * Node.js on the machine; uvx presets need the Python uv runner. The user
 * still reviews the exact command in the editor before trusting it.
 */
interface McpPreset {
  key: string
  appName: string
  label: string
  description: string
  needsUv?: boolean
  build: (workspace: string) => McpServerConfig
}

const MCP_PRESETS: McpPreset[] = [
  {
    key: 'filesystem',
    appName: 'vscode',
    label: 'Filesystem',
    description: 'Чтение, поиск и запись файлов в рабочей папке (официальный сервер)',
    build: (workspace) => ({
      ...emptyDraft(),
      name: 'filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', workspace || '.'],
      defaultRisk: 'write'
    })
  },
  {
    key: 'memory',
    appName: 'notion',
    label: 'Memory',
    description: 'Долговременная память агента между чатами (граф знаний)',
    build: () => ({
      ...emptyDraft(),
      name: 'memory',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      defaultRisk: 'read'
    })
  },
  {
    key: 'sequential-thinking',
    appName: 'unity',
    label: 'Sequential Thinking',
    description: 'Пошаговое структурированное рассуждение для сложных задач',
    build: () => ({
      ...emptyDraft(),
      name: 'sequential-thinking',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
      defaultRisk: 'read'
    })
  },
  {
    key: 'puppeteer',
    appName: 'chrome',
    label: 'Puppeteer',
    description: 'Браузер: открывать страницы, кликать, снимать скриншоты',
    build: () => ({
      ...emptyDraft(),
      name: 'puppeteer',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
      defaultRisk: 'exec'
    })
  },
  {
    key: 'git',
    appName: 'unity',
    label: 'Git',
    description: 'История, диффы и коммиты репозитория (нужен Python + uv)',
    needsUv: true,
    build: () => ({
      ...emptyDraft(),
      name: 'git',
      command: 'uvx',
      args: ['mcp-server-git'],
      defaultRisk: 'write'
    })
  },
  {
    key: 'fetch',
    appName: 'chrome',
    label: 'Fetch',
    description: 'Загрузка веб-страниц и API в контекст (нужен Python + uv)',
    needsUv: true,
    build: () => ({
      ...emptyDraft(),
      name: 'fetch',
      command: 'uvx',
      args: ['mcp-server-fetch'],
      defaultRisk: 'read'
    })
  },
  {
    key: 'time',
    appName: 'godot',
    label: 'Time',
    description: 'Текущее время и часовые пояса (нужен Python + uv)',
    needsUv: true,
    build: () => ({
      ...emptyDraft(),
      name: 'time',
      command: 'uvx',
      args: ['mcp-server-time'],
      defaultRisk: 'read'
    })
  }
]

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
  const [presetDraft, setPresetDraft] = useState<McpServerConfig | null>(null)
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

      <AppConnectorsWizard />

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

      {editing === 'new' && (
        <div className="mb-3 rounded-lg border border-border p-3" data-testid="mcp-presets">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('settings.mcp.presets.title')}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {MCP_PRESETS.filter(
              (preset) => !(states ?? []).some((s) => s.config.name === preset.build('').name)
            ).map((preset) => (
              <button
                key={preset.key}
                type="button"
                className="flex items-start gap-2.5 rounded-lg border border-border bg-card p-2.5 text-left transition-colors hover:border-ring/60"
                onClick={() => {
                  const workspace = useExplorerStore.getState().rootPath || ''
                  setPresetDraft(preset.build(workspace))
                }}
              >
                <McpAppIcon name={preset.appName} className="mt-0.5 size-7" />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium">
                    {preset.label}
                    {preset.needsUv && <span className="ml-1.5 text-[10px] text-tertiary">uv</span>}
                  </span>
                  <span className="block text-[11px] leading-snug text-muted-foreground">
                    {preset.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {editing !== null && (
        <McpServerEditor
          key={presetDraft ? `preset-${presetDraft.name}` : 'plain'}
          draft={editing === 'new' ? (presetDraft ?? emptyDraft()) : (states?.find((s) => s.config.name === editing)?.config ?? emptyDraft())}
          isNew={editing === 'new'}
          takenNames={(states ?? []).map((s) => s.config.name).filter((name) => name !== editing)}
          onCancel={() => {
            setEditing(null)
            setPresetDraft(null)
          }}
          onSave={async (config) => {
            const result = await window.relaxcode.mcp.save(config)
            if (result.ok) {
              setStates(result.states)
              setEditing(null)
              setPresetDraft(null)
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
type ConnectorApp = 'blender' | 'godot'

const CONNECTORS: Array<{ app: ConnectorApp; label: string }> = [
  { app: 'blender', label: 'Blender' },
  { app: 'godot', label: 'Godot' }
]

/** The connect-a-desktop-app wizard: detect installed apps, register, launch. */
function AppConnectorsWizard(): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [app, setApp] = useState<ConnectorApp>('blender')
  const [appsByApp, setAppsByApp] = useState<Partial<Record<ConnectorApp, McpDetectedApp[]>>>({})
  const [busy, setBusy] = useState(false)
  const [doneByApp, setDoneByApp] = useState<Partial<Record<ConnectorApp, boolean>>>({})
  const [lines, setLines] = useState<string[]>([])
  const [godotPath, setGodotPath] = useState('')
  const [setupError, setSetupError] = useState<string | null>(null)
  const appLabel = CONNECTORS.find((entry) => entry.app === app)?.label ?? app

  const apps = appsByApp[app] ?? null
  const done = doneByApp[app] ?? false

  useEffect(() => {
    if (!open || apps !== null) return
    void window.relaxcode.mcp.detect(app).then((list) => {
      setAppsByApp((prev) => ({ ...prev, [app]: list }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, app, apps])

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
    setDoneByApp((prev) => ({ ...prev, [app]: false }))
    setSetupError(null)
    try {
      const result = await window.relaxcode.mcp.setup(app, app === 'godot' ? godotPath || undefined : undefined)
      // Setup errors are human sentences from the connector, not i18n keys —
      // and toasts are off, so the failure renders right here.
      if (result.ok) setDoneByApp((prev) => ({ ...prev, [app]: true }))
      else setSetupError(result.error ?? t('settings.mcp.setupFailed'))
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const launch = async (exePath: string): Promise<void> => {
    const result = await window.relaxcode.mcp.launch(app, exePath)
    if (!result.ok) toast(t('settings.mcp.launchFailed'), result.error ?? '', 'error')
  }

  return (
    <div className="rounded-lg border border-border bg-accent/20 p-3" data-testid="mcp-connectors-wizard">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex -space-x-1.5">
          {CONNECTORS.map((entry) => (
            <McpAppIcon key={entry.app} name={entry.app} className="size-7 ring-2 ring-card rounded-[5px]" />
          ))}
        </span>
        <span className="text-[13px] font-medium">
          {t('settings.mcp.wizard.titleApp', { app: appLabel })}
        </span>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          {t('settings.mcp.wizard.toggle')}
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </span>
      </button>

      {open && (
        <div className="mt-2.5 space-y-2">
          <div className="flex items-center gap-1.5">
            {CONNECTORS.map((entry) => (
              <button
                key={entry.app}
                type="button"
                onClick={() => setApp(entry.app)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] transition-colors',
                  entry.app === app
                    ? 'border-ring/60 bg-card text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                <McpAppIcon name={entry.app} className="size-5" />
                {entry.label}
              </button>
            ))}
          </div>

          {apps === null && <p className="text-[11px] text-muted-foreground">{t('settings.mcp.wizard.detectingApp', { app: appLabel })}</p>}
          {apps !== null && apps.length === 0 && (
            <p className="text-[11px] text-muted-foreground">
              {t('settings.mcp.wizard.notFoundApp', { app: appLabel })}
            </p>
          )}
          {app === 'godot' && (
            <div className="flex items-center gap-2">
              <input
                value={godotPath}
                onChange={(event) => setGodotPath(event.target.value)}
                placeholder={t('settings.mcp.wizard.godotPath')}
                className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-[11px] font-mono"
              />
            </div>
          )}
          {apps?.map((item) => (
            <div key={item.exePath} className="flex items-center gap-2">
              <span className="text-[12px] font-medium">{item.label}</span>
              {app === 'blender' && (
                item.addonInstalled ? (
                  <span className="text-[10px] text-emerald-500">{t('settings.mcp.wizard.addonYes')}</span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">{t('settings.mcp.wizard.addonNo')}</span>
                )
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
            <span className="text-[10px] text-muted-foreground">
              {app === 'godot' ? t('settings.mcp.wizard.godotHint') : t('settings.mcp.wizard.installHint')}
            </span>
          </div>

          {done && (
            <p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2 text-[11px] text-foreground">
              {t('settings.mcp.wizard.done')}
            </p>
          )}

          {setupError && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-[11px] leading-snug text-destructive">
              {setupError}
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
      <div className="flex items-center gap-2.5">
        <McpAppIcon name={config.name} className="size-9" />
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
                <div className="w-[150px] shrink-0">
                  <SelectInput
                    value={tool.risk}
                    className="h-7 w-full text-[11px]"
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
