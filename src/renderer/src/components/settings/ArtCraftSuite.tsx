import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react'
import {
  ArrowUpRight,
  Boxes,
  Check,
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  MonitorPlay,
  RefreshCw,
  Sparkles
} from 'lucide-react'
import type { McpDetectedApp, McpServerState } from '@shared/mcp'
import {
  ARTCRAFT_APPS,
  ARTCRAFT_PARTNER_LETTER,
  artCraftGrantedRoot,
  artCraftServerMode,
  isArtCraftAppId,
  sameArtCraftFolder,
  type ArtCraftAppDef,
  type ArtCraftConnectMode
} from '@shared/artcraft'
import { useT } from '@/lib/i18n'
import { toast } from '@/stores/toast'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ArtCraftAppIcon } from '@/components/ui/artcraft-icon'

/**
 * The ArtCraft tab of the connector wizard. Unlike Blender/Godot there is
 * nothing to install for an already-installed app: every Craft app ships its
 * own MCP server as `<app>-cli mcp`. The panel detects the suite, registers a
 * server per app with the open project as the only granted folder, and offers
 * a live bridge for apps whose desktop window can be driven directly (so the
 * agent edits the document the user has open, not a separate copy).
 */

const GITHUB_URL = 'https://github.com/storytold'
const DISCORD_URL = 'https://discord.gg/artcraft'
const SUITE_URL = 'https://getartcraft.com/apps'
const PARTNER_ISSUE_URL =
  'https://github.com/storytold/craft-launcher/issues/new?title=' +
  encodeURIComponent('RelaxCode × ArtCraft: official MCP integration proposal') +
  '&body=' +
  encodeURIComponent(ARTCRAFT_PARTNER_LETTER)

/** The folder a registered connector can read and write, whatever its mode. */
function configuredRoot(app: ArtCraftAppDef, state: McpServerState): string | null {
  const mode = artCraftServerMode(state.config.args)
  if (mode === 'live') return state.config.cwd.trim() || null
  // Apps without confinement flags still get the workspace as their cwd and
  // playbook guard, so use it instead of pretending a root flag is missing.
  if (app.roots === 'none') return state.config.cwd.trim() || null
  return artCraftGrantedRoot(app.id, state.config.args)
}

export function ArtCraftSuitePanel({
  states,
  workspace
}: {
  states: McpServerState[]
  workspace: string
}): JSX.Element {
  const t = useT()
  const [detected, setDetected] = useState<McpDetectedApp[] | null>(null)
  const [scan, setScan] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lines, setLines] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    setDetected(null)
    void window.relaxcode.mcp.detect('artcraft').then(
      (list) => {
        if (alive) setDetected(list)
      },
      () => {
        if (!alive) return
        setDetected([])
        setError(t('settings.mcp.wizard.detectFailed'))
      }
    )
    return () => {
      alive = false
    }
  }, [scan])

  useEffect(
    () =>
      window.relaxcode.mcp.onEvent((event) => {
        if (event.type === 'setup') {
          setLines((current) => [
            ...current.slice(-60),
            event.level === 'error' ? `✕ ${event.line}` : event.line
          ])
        }
      }),
    []
  )

  const byApp = useMemo(() => {
    const map = new Map<string, McpDetectedApp>()
    for (const item of detected ?? []) map.set(item.app, item)
    return map
  }, [detected])

  const byServer = useMemo(() => {
    const map = new Map<string, McpServerState>()
    for (const state of states) map.set(state.config.name, state)
    return map
  }, [states])

  const launcher = byApp.get('artcraft-launcher')
  const foundCount = (detected ?? []).filter((item) => isArtCraftAppId(item.app)).length
  const missingCount = ARTCRAFT_APPS.length - foundCount
  const liveApps = ARTCRAFT_APPS.filter((app) => {
    const found = byApp.get(app.id)
    return Boolean(app.bridge && found?.cliPath && found.guiPath)
  })

  const errorFor = (code: string | null | undefined): string => {
    if (code === 'no-workspace') return t('settings.mcp.artcraft.needWorkspace')
    if (code === 'workspace-missing') return t('settings.mcp.artcraft.folderMissing')
    return code ?? t('settings.mcp.setupFailed')
  }

  const connectAll = async (): Promise<void> => {
    if (!workspace) {
      setError(t('settings.mcp.artcraft.needWorkspace'))
      return
    }
    const targets = (detected ?? []).filter(
      (item) => isArtCraftAppId(item.app) && Boolean(item.cliPath) && !byServer.has(item.app)
    )
    if (targets.length === 0) return
    setBusy('all')
    setNotice(null)
    setError(null)
    let added = 0
    const failures: string[] = []
    try {
      for (const target of targets) {
        if (!isArtCraftAppId(target.app)) continue
        const result = await window.relaxcode.mcp.setup(
          target.app,
          target.cliPath ?? undefined,
          workspace,
          'headless'
        )
        if (result.ok) added += 1
        else failures.push(`${target.label}: ${errorFor(result.error)}`)
      }
    } catch (cause) {
      failures.push(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
    if (added > 0) setNotice(t('settings.mcp.artcraft.done', { count: added }))
    if (failures.length > 0) setError(failures.join('\n'))
  }

  const connectOne = async (app: string, mode: ArtCraftConnectMode = 'headless'): Promise<void> => {
    const found = byApp.get(app)
    if (!found?.cliPath) return
    if (!workspace) {
      setError(t('settings.mcp.artcraft.needWorkspace'))
      return
    }
    setBusy(app)
    setNotice(null)
    setError(null)
    try {
      const result = await window.relaxcode.mcp.setup(app, found.cliPath, workspace, mode)
      if (!result.ok) {
        setError(errorFor(result.error))
        setScan((value) => value + 1)
        return
      }
      const label = ARTCRAFT_APPS.find((entry) => entry.id === app)?.label ?? app
      // Setup only registers the server. Start it here so one click on
      // "Connect live" really produces a working connector instead of a card
      // that silently waits for a second click.
      const started = await window.relaxcode.mcp.connect(app)
      if (started.ok) {
        setNotice(
          mode === 'live'
            ? t('settings.mcp.artcraft.live.connected', { path: workspace })
            : t('settings.mcp.artcraft.connectedNow', { app: label })
        )
      } else if (started.error === 'untrusted' || started.error === 'disabled') {
        // A brand-new server still needs the explicit trust click.
        setNotice(
          mode === 'live'
            ? t('settings.mcp.artcraft.live.done', { app: label })
            : t('settings.mcp.artcraft.done', { count: 1 })
        )
      } else {
        setError(t('settings.mcp.startFailed', { error: started.error ?? '' }))
      }
      setScan((value) => value + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  /** Re-point an already registered connector at the folder open right now. */
  const regrant = async (app: ArtCraftAppDef, state: McpServerState): Promise<void> => {
    const mode = artCraftServerMode(state.config.args)
    await connectOne(app.id, mode)
  }

  const chooseFolder = async (): Promise<void> => {
    setError(null)
    const result = await window.relaxcode.workspace.openFolder()
    if (!result) return
    setNotice(t('settings.mcp.artcraft.folderOpened', { path: result.path }))
  }

  const openLauncher = async (): Promise<void> => {
    if (!launcher) return
    const result = await window.relaxcode.mcp.launch('artcraft-launcher', launcher.exePath)
    if (!result.ok) toast(t('settings.mcp.launchFailed'), result.error ?? '', 'error')
  }

  /** Live connector: launch the registered control window, or set it up now. */
  const openLive = async (app: ArtCraftAppDef, state: McpServerState | undefined): Promise<void> => {
    const found = byApp.get(app.id)
    if (!found?.guiPath) return
    if (!state || artCraftServerMode(state.config.args) !== 'live') {
      await connectOne(app.id, 'live')
      return
    }
    if (!sameArtCraftFolder(configuredRoot(app, state) ?? '', workspace)) {
      await connectOne(app.id, 'live')
      return
    }
    setError(null)
    const result = await window.relaxcode.mcp.launch(app.id, found.guiPath)
    if (!result.ok) setError(result.error ?? t('settings.mcp.launchFailed'))
  }

  const copyLetter = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(ARTCRAFT_PARTNER_LETTER)
      toast(t('settings.mcp.artcraft.partner.copied'))
    } catch {
      toast(t('settings.mcp.artcraft.partner.copyFailed'), '', 'error')
    }
  }

  const canConnectAll =
    busy === null &&
    workspace.length > 0 &&
    (detected ?? []).some(
      (item) => isArtCraftAppId(item.app) && Boolean(item.cliPath) && !byServer.has(item.app)
    )

  return (
    <div className="space-y-2" data-testid="artcraft-suite">
      <div className="rounded-lg border border-border bg-gradient-to-br from-amber-500/10 via-transparent to-violet-500/10 p-3">
        <div className="flex items-center gap-2.5">
          <span className="grid w-[74px] shrink-0 grid-cols-4 gap-0.5">
            {ARTCRAFT_APPS.slice(0, 12).map((app) => (
              <ArtCraftAppIcon key={app.id} app={app.id} className="size-[17px]" />
            ))}
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold leading-tight">
              {t('settings.mcp.artcraft.title')}
            </span>
            <span className="mt-0.5 block text-[10.5px] leading-snug text-muted-foreground">
              {t('settings.mcp.artcraft.subtitle')}
            </span>
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <Badge>{t('settings.mcp.artcraft.count', { count: ARTCRAFT_APPS.length })}</Badge>
          <Badge>{t('settings.mcp.artcraft.badge')}</Badge>
          {detected !== null && foundCount > 0 && (
            <Badge tone="good">
              {t('settings.mcp.artcraft.found')}: {foundCount}
            </Badge>
          )}
          {detected !== null && missingCount > 0 && (
            <Badge tone="muted">
              {t('settings.mcp.artcraft.notInstalled')}: {missingCount}
            </Badge>
          )}
        </div>
      </div>

      <PartnershipCard onCopy={() => void copyLetter()} />

      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-2">
        {launcher ? (
          <>
            <Boxes className="size-4 text-muted-foreground" />
            <span className="text-[11.5px] font-medium">{launcher.label}</span>
            <span className="text-[10px] text-emerald-500">
              {t('settings.mcp.artcraft.launcherFound')}
            </span>
            <Button
              type="button"
              variant="muted"
              size="sm"
              className="ml-auto h-6 gap-1 px-2 text-[11px]"
              onClick={() => void openLauncher()}
            >
              <ArrowUpRight className="size-3" />
              {t('settings.mcp.artcraft.openLauncher')}
            </Button>
          </>
        ) : (
          <>
            <Download className="size-3.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">
              {t('settings.mcp.artcraft.launcherHint')}
            </span>
            <a
              href="https://github.com/storytold/craft-launcher/releases/latest"
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-foreground underline-offset-2 hover:underline"
            >
              {t('settings.mcp.artcraft.install')}
              <ExternalLink className="size-3" />
            </a>
          </>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1 text-[10.5px] leading-snug text-muted-foreground">
          {workspace ? (
            <span className="block truncate" title={workspace}>
              {t('settings.mcp.artcraft.workspace', { path: workspace })}
            </span>
          ) : (
            <span className="text-amber-600 dark:text-amber-400">
              {t('settings.mcp.artcraft.noWorkspace')}
            </span>
          )}
        </div>
        {!workspace && (
          <Button
            type="button"
            variant="muted"
            size="sm"
            className="h-6 shrink-0 gap-1 px-2 text-[11px]"
            onClick={() => void chooseFolder()}
          >
            <FolderOpen className="size-3" />
            {t('settings.mcp.artcraft.openFolder')}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-[11px]"
          onClick={() => setScan((value) => value + 1)}
        >
          <RefreshCw className={cn('size-3', detected === null && 'animate-spin')} />
          {t('settings.mcp.artcraft.rescan')}
        </Button>
      </div>

      {liveApps.map((app) => {
        const found = byApp.get(app.id)
        const state = byServer.get(app.id)
        const live = state !== undefined && artCraftServerMode(state.config.args) === 'live'
        const rootMatches = live && sameArtCraftFolder(configuredRoot(app, state) ?? '', workspace)
        const liveReady =
          live && state?.status === 'ready' && state.config.enabled && state.config.trusted
        const isBusy = busy === app.id
        return (
          <div
            key={`live-${app.id}`}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5"
          >
            <MonitorPlay className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1">
              <div className="text-[11.5px] font-medium">
                {t('settings.mcp.artcraft.live.title', { app: app.label })}
              </div>
              <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                {workspace
                  ? live && rootMatches
                    ? liveReady
                      ? t('settings.mcp.artcraft.live.connected', { path: workspace })
                      : t('settings.mcp.artcraft.live.configured')
                    : t('settings.mcp.artcraft.live.body')
                  : t('settings.mcp.artcraft.needWorkspace')}
              </div>
            </div>
            <Button
              type="button"
              variant="muted"
              size="sm"
              className="h-6 shrink-0 gap-1 px-2 text-[10.5px]"
              disabled={isBusy || busy === 'all' || !workspace || !found?.guiPath}
              onClick={() => void openLive(app, state)}
            >
              {isBusy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <MonitorPlay className="size-3" />
              )}
              {live && rootMatches
                ? t('settings.mcp.artcraft.live.open')
                : t('settings.mcp.artcraft.live.connect')}
            </Button>
          </div>
        )
      })}

      <div className="grid gap-1.5 sm:grid-cols-2">
        {ARTCRAFT_APPS.map((app) => {
          const found = byApp.get(app.id)
          const state = byServer.get(app.id)
          const connected = state?.status === 'ready' && state.config.enabled && state.config.trusted
          const configured = state !== undefined
          const isBusy = busy === app.id || busy === 'all'
          const mode = state ? artCraftServerMode(state.config.args) : null
          const root = state ? configuredRoot(app, state) : null
          const rootMatches = root !== null && sameArtCraftFolder(root, workspace)
          const stale = configured && !rootMatches
          return (
            <div
              key={app.id}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5',
                !found && 'opacity-55'
              )}
            >
              <ArtCraftAppIcon app={app.id} className="size-7" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[11.5px] font-medium">{app.label}</span>
                  {app.community && (
                    <span className="shrink-0 rounded bg-muted px-1 py-px text-[8.5px] uppercase tracking-wide text-muted-foreground">
                      community
                    </span>
                  )}
                </div>
                <div
                  className={cn(
                    'truncate text-[10px] leading-snug',
                    stale ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
                  )}
                  title={stale ? (root ?? undefined) : undefined}
                >
                  {stale
                    ? root
                      ? t('settings.mcp.artcraft.rootChanged')
                      : t('settings.mcp.artcraft.noRoot')
                    : t(`settings.mcp.artcraft.app.${app.id}` as never)}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                {connected ? (
                  <span className="flex items-center gap-0.5 text-[9.5px] text-emerald-500">
                    <Check className="size-2.5" />
                    {t('settings.mcp.artcraft.connected')}
                  </span>
                ) : configured ? (
                  <span className="text-[9.5px] text-amber-500">
                    {t('settings.mcp.artcraft.needsTrust')}
                  </span>
                ) : found?.cliPath ? (
                  <Button
                    type="button"
                    variant="muted"
                    size="sm"
                    className="h-6 px-2 text-[10.5px]"
                    title={t('settings.mcp.artcraft.connectHeadlessHint')}
                    disabled={isBusy || !workspace}
                    onClick={() => void connectOne(app.id, 'headless')}
                  >
                    {isBusy ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      t('settings.mcp.artcraft.connect')
                    )}
                  </Button>
                ) : found ? (
                  <span
                    className="text-[9.5px] text-amber-500"
                    title={t('settings.mcp.artcraft.cliMissing')}
                  >
                    {t('settings.mcp.artcraft.cliMissing')}
                  </span>
                ) : detected === null ? (
                  <Loader2 className="size-3 animate-spin text-muted-foreground" />
                ) : (
                  <span className="text-[9.5px] text-muted-foreground">
                    {t('settings.mcp.artcraft.notInstalled')}
                  </span>
                )}
                {mode && (
                  <span className="text-[9px] text-muted-foreground">
                    {mode === 'live'
                      ? t('settings.mcp.artcraft.modeLive')
                      : t('settings.mcp.artcraft.modeHeadless')}
                  </span>
                )}
                {stale && state && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-5 gap-0.5 px-1 text-[9.5px] text-amber-600 dark:text-amber-400"
                    disabled={isBusy || !workspace}
                    title={t('settings.mcp.artcraft.grantHint')}
                    onClick={() => void regrant(app, state)}
                  >
                    <RefreshCw className="size-2.5" />
                    {t('settings.mcp.artcraft.grant')}
                  </Button>
                )}
                <a
                  href={app.site}
                  target="_blank"
                  rel="noreferrer"
                  title={t('settings.mcp.artcraft.site')}
                  className="flex items-center gap-0.5 text-[9px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {found?.version ? `${app.cli} ${found.version}` : app.site.includes('getartcraft') ? 'getartcraft' : 'GitHub'}
                  <ExternalLink className="size-2.5" />
                </a>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="primary"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={!canConnectAll}
          onClick={() => void connectAll()}
        >
          {busy === 'all' ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          {t('settings.mcp.artcraft.connectAll')}
        </Button>
        {detected !== null && foundCount === 0 && (
          <span className="text-[10px] text-muted-foreground">
            {t('settings.mcp.artcraft.nothingFound')}
          </span>
        )}
      </div>
      <p className="text-[9.5px] leading-snug text-muted-foreground">
        {t('settings.mcp.artcraft.contextHint')}
      </p>

      {notice && (
        <p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2 text-[11px] leading-snug text-foreground">
          {notice}
        </p>
      )}
      {error && (
        <p className="whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/5 p-2 text-[11px] leading-snug text-destructive">
          {error}
        </p>
      )}
      {lines.length > 0 && (
        <pre className="max-h-[140px] overflow-y-auto whitespace-pre-wrap rounded bg-muted/60 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
          {lines.join('\n')}
        </pre>
      )}

      <p className="text-[9.5px] leading-snug text-muted-foreground">
        ArtCraft Craft App Suite © its authors · MIT or Apache-2.0 · SolidCraft Apache-2.0 · icons
        from the apps&apos; own repositories.
      </p>
    </div>
  )
}

function Badge({
  children,
  tone = 'muted'
}: {
  children: ReactNode
  tone?: 'muted' | 'good'
}): JSX.Element {
  return (
    <span
      className={cn(
        'rounded-full border px-1.5 py-px text-[9px] leading-tight',
        tone === 'good'
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'border-border bg-background/60 text-muted-foreground'
      )}
    >
      {children}
    </span>
  )
}

function PartnershipCard({ onCopy }: { onCopy: () => void }): JSX.Element {
  const t = useT()
  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      <div className="flex items-center gap-1.5 text-[12px] font-medium">
        <Sparkles className="size-3.5 text-amber-500" />
        {t('settings.mcp.artcraft.partner.title')}
      </div>
      <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
        {t('settings.mcp.artcraft.partner.body')}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Button
          type="button"
          variant="muted"
          size="sm"
          className="h-6 px-2 text-[10.5px]"
          onClick={onCopy}
        >
          {t('settings.mcp.artcraft.partner.copy')}
        </Button>
        <a
          href={PARTNER_ISSUE_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-[10.5px] font-medium text-foreground underline-offset-2 hover:underline"
        >
          {t('settings.mcp.artcraft.partner.openIssue')}
          <ExternalLink className="size-2.5" />
        </a>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {t('settings.mcp.artcraft.partner.github')}
          <ExternalLink className="size-2.5" />
        </a>
        <a
          href={DISCORD_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {t('settings.mcp.artcraft.partner.discord')}
          <ExternalLink className="size-2.5" />
        </a>
        <a
          href={SUITE_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {t('settings.mcp.artcraft.partner.site')}
          <ExternalLink className="size-2.5" />
        </a>
      </div>
    </div>
  )
}
