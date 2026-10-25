import { useEffect, useRef, useState, type JSX } from 'react'
import {
  Check,
  CircleAlert,
  KeyRound,
  Lightbulb,
  Loader2,
  Plus,
  RefreshCw,
  Trash2
} from 'lucide-react'
import type { ModelInfo, SettingsPatch } from '@shared/ipc'
import { normalizeBaseUrl } from '@shared/base-url'
import {
  TOOL_CATALOG,
  type AccentName,
  type KeymapSettings,
  type ProviderInput,
  type PublicProvider,
  type PublicSettings,
  type ToolRiskLevel,
  type ToolsSettings
} from '@shared/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ProviderLogo } from '@/components/ui/provider-logo'
import { ModelIcon } from '@/components/ui/model-icon'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useT, useTranslateError } from '@/lib/i18n'
import { catalogForBaseUrl, suggestApiBaseUrl } from '@/lib/provider-catalog'
import { cn } from '@/lib/utils'
import { KeyComboInput } from './controls'
import { AddProviderDialog } from './ProviderCatalog'

/* -------------------------------- providers -------------------------------- */

const ACCENT_SWATCHES: Array<{ name: AccentName; color: string }> = [
  { name: 'default', color: '#1c1c1e' },
  { name: 'blue', color: '#2f6fdb' },
  { name: 'violet', color: '#7c5cd6' },
  { name: 'green', color: '#2f8f5b' },
  { name: 'orange', color: '#c96a1f' },
  { name: 'rose', color: '#cf3f6c' }
]

interface AccentControlProps {
  value: AccentName
  onChange: (value: AccentName) => void
}

export function AccentControl({ value, onChange }: AccentControlProps): JSX.Element {
  const t = useT()
  return (
    <div className="flex items-center gap-2 pt-0.5">
      {ACCENT_SWATCHES.map((swatch) => (
        <button
          key={swatch.name}
          type="button"
          title={t(`settings.ui.accent.${swatch.name}` as const)}
          aria-label={t(`settings.ui.accent.${swatch.name}` as const)}
          onClick={() => onChange(swatch.name)}
          className={cn(
            'size-6 rounded-full border transition-transform hover:scale-110',
            value === swatch.name ? 'border-foreground ring-2 ring-ring/40' : 'border-border'
          )}
          style={{ backgroundColor: swatch.color }}
        />
      ))}
      <span className="ml-1 text-xs text-muted-foreground">{t(`settings.ui.accent.${value}` as const)}</span>
    </div>
  )
}

/* ---------------------------------- tools ---------------------------------- */

const RISK_LABEL: Record<ToolRiskLevel, string> = {
  read: 'settings.risk.read',
  write: 'settings.risk.write',
  exec: 'settings.risk.exec',
  delete: 'settings.risk.delete'
}

/** Tool names and risk levels build their i18n keys at runtime. */
type LooseTranslate = (key: string, params?: Record<string, string | number>) => string

interface ToolsControlProps {
  tools: ToolsSettings
  patch: (values: Partial<ToolsSettings>) => void
}

export function ToolsControl({ tools, patch }: ToolsControlProps): JSX.Element {
  const t = useT() as unknown as LooseTranslate

  const approvalOf = (name: string): 'default' | 'allow' | 'deny' => {
    if (tools.alwaysDeny.includes(name)) return 'deny'
    if (tools.alwaysAllow.includes(name)) return 'allow'
    return 'default'
  }

  const setApproval = (name: string, value: 'default' | 'allow' | 'deny'): void => {
    const alwaysAllow = tools.alwaysAllow.filter((item) => item !== name)
    const alwaysDeny = tools.alwaysDeny.filter((item) => item !== name)
    if (value === 'allow') alwaysAllow.push(name)
    if (value === 'deny') alwaysDeny.push(name)
    patch({ alwaysAllow, alwaysDeny })
  }

  const setEnabled = (name: string, enabled: boolean): void => {
    patch({
      disabled: enabled
        ? tools.disabled.filter((item) => item !== name)
        : [...tools.disabled, name]
    })
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {TOOL_CATALOG.map((tool) => {
        const enabled = !tools.disabled.includes(tool.name)
        return (
          <div key={tool.name} className="flex items-center gap-3 px-3 py-2.5">
            <Switch
              checked={enabled}
              aria-label={tool.name}
              onCheckedChange={(value) => setEnabled(tool.name, value)}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <code className="font-mono text-[12px] text-foreground">{tool.name}</code>
                <Badge variant="outline" className="px-1.5 py-0 text-[10px] uppercase">
                  {t(RISK_LABEL[tool.risk])}
                </Badge>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {t(`settings.tool.${tool.name}`)}
              </p>
            </div>
            <Select
              value={approvalOf(tool.name)}
              onValueChange={(value) => setApproval(tool.name, value as 'default' | 'allow' | 'deny')}
            >
              <SelectTrigger className="h-7 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default" className="text-xs">
                  {t('settings.tools.policy.default')}
                </SelectItem>
                <SelectItem value="allow" className="text-xs">
                  {t('settings.tools.policy.allow')}
                </SelectItem>
                <SelectItem value="deny" className="text-xs">
                  {t('settings.tools.policy.deny')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        )
      })}
    </div>
  )
}

/* --------------------------------- keymap ---------------------------------- */

const KEYMAP_ROWS: Array<{ key: keyof KeymapSettings; label: string }> = [
  { key: 'toggleSidebar', label: 'settings.keymap.toggleSidebar' },
  { key: 'toggleChat', label: 'settings.keymap.toggleChat' },
  { key: 'toggleScreen', label: 'settings.keymap.toggleScreen' },
  { key: 'newFile', label: 'settings.keymap.newFile' },
  { key: 'newFolder', label: 'settings.keymap.newFolder' },
  { key: 'rename', label: 'settings.keymap.rename' },
  { key: 'deleteEntry', label: 'settings.keymap.deleteEntry' },
  { key: 'save', label: 'settings.keymap.save' },
  { key: 'closeTab', label: 'settings.keymap.closeTab' },
  { key: 'toggleTerminal', label: 'settings.keymap.toggleTerminal' },
  { key: 'newChat', label: 'settings.keymap.newChat' },
  { key: 'openSettings', label: 'settings.keymap.openSettings' }
]

interface KeymapControlProps {
  keymap: KeymapSettings
  patch: (values: Partial<KeymapSettings>) => void
}

export function KeymapControl({ keymap, patch }: KeymapControlProps): JSX.Element {
  const t = useT() as unknown as LooseTranslate
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {KEYMAP_ROWS.map((row) => (
        <div key={row.key} className="flex items-center justify-between gap-4 px-3 py-2.5">
          <span className="text-[13px] text-foreground">{t(row.label)}</span>
          <KeyComboInput
            value={keymap[row.key]}
            onChange={(value) => patch({ [row.key]: value })}
            onClear={() => patch({ [row.key]: '' })}
          />
        </div>
      ))}
    </div>
  )
}

/* -------------------------------- providers -------------------------------- */

interface ProviderCardProps {
  provider: PublicProvider
  isActive: boolean
  onlyOne: boolean
  highlight?: boolean
  patch: (values: SettingsPatch) => void
}

function ProviderCard({
  provider,
  isActive,
  onlyOne,
  highlight,
  patch
}: ProviderCardProps): JSX.Element {
  const t = useT()
  const translateError = useTranslateError()
  const catalog = catalogForBaseUrl(provider.baseUrl)
  const [keyDraft, setKeyDraft] = useState('')
  // The address is edited in a draft: a half-typed URL is not something to save
  // and not something to complain about, so the field is only judged on blur.
  const [urlDraft, setUrlDraft] = useState(provider.baseUrl)
  const [urlNotice, setUrlNotice] = useState<string | null>(null)
  // The draft and the saved address are also read from event handlers that
  // outlive a render (blur, unmount), so the latest values live in refs.
  const draftRef = useRef(urlDraft)
  draftRef.current = urlDraft
  const storedRef = useRef(provider.baseUrl)
  storedRef.current = provider.baseUrl
  const commitRef = useRef<() => void>(() => {})
  const suggestion = suggestApiBaseUrl(provider.baseUrl)
  const [models, setModels] = useState<ModelInfo[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)

  useEffect(() => {
    setUrlDraft(provider.baseUrl)
  }, [provider.baseUrl])

  const urlProblem = normalizeBaseUrl(urlDraft)
  const urlError = urlProblem.ok ? null : t(`settings.providers.urlError.${urlProblem.reason}`)

  const update = (values: Partial<ProviderInput>): void => {
    patch({ providerUpdate: { id: provider.id, ...values } })
  }

  /** Saves the repaired address; keeps what was typed when it cannot be read. */
  const commitUrl = (): void => {
    const normalized = normalizeBaseUrl(draftRef.current)
    if (!normalized.ok) {
      setUrlNotice(null)
      return
    }
    setUrlDraft(normalized.value)
    setUrlNotice(normalized.fixed ? t('settings.providers.urlFixed', { url: normalized.value }) : null)
    if (normalized.value !== storedRef.current) update({ baseUrl: normalized.value })
  }

  // Closing the panel is not a reason to lose what was just typed.
  useEffect(() => () => commitRef.current(), [])
  commitRef.current = commitUrl

  /**
   * Checks the address that is on screen, not the last saved one: typing a new
   * endpoint and pressing Check must not report on the previous connection.
   */
  const check = async (): Promise<void> => {
    const normalized = normalizeBaseUrl(urlDraft)
    if (!normalized.ok) return
    setChecking(true)
    setCheckError(null)
    try {
      const result = await window.relaxcode.models.list({
        providerId: provider.id,
        baseUrl: normalized.value
      })
      if (result.ok) {
        setModels(result.models)
      } else {
        setModels(null)
        setCheckError(result.error)
      }
    } catch (error) {
      setModels(null)
      setCheckError(error instanceof Error ? error.message : String(error))
    } finally {
      setChecking(false)
    }
  }

  return (
    <div
      data-provider={provider.id}
      className={cn(
        'rounded-lg border p-3 transition-[color,background-color,border-color,box-shadow] duration-300',
        highlight && 'border-primary ring-2 ring-ring/30',
        !highlight && isActive && 'border-ring bg-accent/40',
        !highlight && !isActive && 'border-border'
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={t('settings.providers.activate')}
          title={t('settings.providers.activate')}
          onClick={() => patch({ activeProviderId: provider.id })}
          className={cn(
            'flex size-4 items-center justify-center rounded-full border transition-colors',
            isActive ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card'
          )}
        >
          {isActive && <Check className="size-2.5" />}
        </button>
        {catalog && <ProviderLogo id={catalog.id} className="ml-0.5 size-5 text-foreground/85" />}
        <Input
          value={provider.name}
          className="h-7 max-w-[220px] text-[13px] font-medium"
          onChange={(event) => update({ name: event.target.value })}
        />
        {isActive && <Badge variant="outline">{t('settings.providers.active')}</Badge>}
        {provider.hasApiKey && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <KeyRound className="size-3" />
            {t('settings.providers.keySaved')}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant="muted"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            disabled={checking || urlProblem.ok === false}
            title={urlError ?? undefined}
            onClick={() => void check()}
          >
            {checking ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {t('settings.providers.check')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={onlyOne}
            aria-label={t('settings.providers.remove')}
            onClick={() => patch({ providerRemove: provider.id })}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] text-muted-foreground">
            {t('settings.providers.baseUrl')}
          </span>
          <Input
            data-testid={`provider-url-${provider.id}`}
            value={urlDraft}
            spellCheck={false}
            placeholder="https://api.openai.com/v1"
            aria-invalid={urlError !== null}
            className={cn(
              'h-7 w-full font-mono text-[11px]',
              urlError && 'border-destructive focus-visible:ring-destructive/40'
            )}
            onChange={(event) => {
              setUrlDraft(event.target.value)
              setUrlNotice(null)
            }}
            onBlur={commitUrl}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitUrl()
            }}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-muted-foreground">
            {t('settings.providers.model')}
          </span>
          <Input
            value={provider.model ?? ''}
            spellCheck={false}
            placeholder="gpt-4o-mini"
            className="h-7 w-full font-mono text-[11px]"
            onChange={(event) => update({ model: event.target.value || null })}
          />
        </label>
      </div>

      {urlError && (
        <p
          data-testid={`provider-url-error-${provider.id}`}
          className="mt-1.5 flex items-start gap-1.5 text-[11px] text-destructive"
        >
          <CircleAlert className="mt-0.5 size-3 shrink-0" />
          <span className="break-all">{urlError}</span>
        </p>
      )}

      {!urlError && urlNotice && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Check className="mt-0.5 size-3 shrink-0" />
          <span className="break-all">{urlNotice}</span>
        </p>
      )}

      {!urlError && suggestion && (
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <Lightbulb className="size-3 shrink-0" />
          <span>{t('settings.providers.urlSuggestion')}</span>
          <button
            type="button"
            data-testid={`provider-url-suggestion-${provider.id}`}
            className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] text-foreground transition-colors hover:bg-accent"
            onClick={() => {
              setUrlDraft(suggestion.baseUrl)
              setUrlNotice(null)
              update({ baseUrl: suggestion.baseUrl })
            }}
          >
            {suggestion.baseUrl}
          </button>
        </p>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        <Input
          type="password"
          value={keyDraft}
          placeholder={t('settings.providers.apiKey')}
          className="h-7 max-w-[320px] font-mono text-[11px]"
          onChange={(event) => setKeyDraft(event.target.value)}
        />
        <Button
          type="button"
          variant="muted"
          size="sm"
          className="h-7 text-xs"
          disabled={keyDraft.trim().length === 0}
          onClick={() => {
            update({ apiKey: keyDraft.trim() })
            setKeyDraft('')
          }}
        >
          {t('settings.providers.saveKey')}
        </Button>
        {provider.hasApiKey && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => update({ apiKey: null })}
          >
            {t('settings.providers.clearKey')}
          </Button>
        )}
      </div>

      {checkError && (
        <p
          data-testid={`provider-check-error-${provider.id}`}
          className="mt-2 flex items-start gap-1.5 text-[11px] text-destructive"
        >
          <CircleAlert className="mt-0.5 size-3 shrink-0" />
          <span className="break-all">{translateError(checkError)}</span>
        </p>
      )}

      {models && (
        <div className="mt-2.5">
          <p className="mb-1 text-[11px] text-muted-foreground">
            {t('settings.providers.models', { count: models.length })}
          </p>
          <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
            {models.slice(0, 200).map((model) => (
              <button
                key={model.id}
                type="button"
                onClick={() => update({ model: model.id })}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] transition-colors',
                  provider.model === model.id
                    ? 'border-ring bg-accent text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                <ModelIcon id={model.id} className="size-3.5" />
                {model.id}
                {model.free ? ` · ${t('chat.model.free')}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface ProvidersControlProps {
  settings: PublicSettings
  patch: (values: SettingsPatch) => void
}

export function ProvidersControl({ settings, patch }: ProvidersControlProps): JSX.Element {
  const t = useT()
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [highlight, setHighlight] = useState<string | null>(null)

  useEffect(() => {
    if (!highlight) return
    const timer = window.setTimeout(() => setHighlight(null), 2400)
    return () => window.clearTimeout(timer)
  }, [highlight])

  const handleAdded = (id: string): void => {
    setHighlight(id)
    window.setTimeout(() => {
      document
        .querySelector(`[data-provider="${id}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 80)
  }

  return (
    <div className="space-y-2.5 w-full">
      {settings.providers.map((provider) => (
        <ProviderCard
          key={provider.id}
          provider={provider}
          isActive={provider.id === settings.activeProviderId}
          onlyOne={settings.providers.length <= 1}
          highlight={provider.id === highlight}
          patch={patch}
        />
      ))}

      <Button
        type="button"
        variant="muted"
        size="sm"
        className="gap-1.5 text-xs"
        data-testid="provider-catalog-open"
        onClick={() => setCatalogOpen(true)}
      >
        <Plus className="size-3.5" />
        {t('settings.providers.addTitle')}
      </Button>

      <AddProviderDialog open={catalogOpen} onOpenChange={setCatalogOpen} onAdded={handleAdded} />
    </div>
  )
}

/** Search-provider key. Kept out of the visible settings values, like model keys. */
export function WebSearchKeyControl({
  settings,
  patch
}: {
  settings: PublicSettings
  patch: (values: SettingsPatch) => void
}): JSX.Element {
  const t = useT()
  const [draft, setDraft] = useState('')
  const needsKey =
    settings.webSearch.provider !== 'auto' &&
    settings.webSearch.provider !== 'duckduckgo' &&
    settings.webSearch.provider !== 'bing'
  const saved = settings.hasSearchApiKey

  return (
    <div className="w-full space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="password"
          value={draft}
          spellCheck={false}
          autoComplete="off"
          placeholder={t('settings.webSearch.apiKey.placeholder')}
          className="h-8 max-w-[360px] font-mono text-[11px]"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || draft.trim().length === 0) return
            patch({ webSearchApiKey: draft.trim() })
            setDraft('')
          }}
        />
        <Button
          type="button"
          variant="muted"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={draft.trim().length === 0}
          onClick={() => {
            patch({ webSearchApiKey: draft.trim() })
            setDraft('')
          }}
        >
          <KeyRound className="size-3.5" />
          {t('settings.providers.saveKey')}
        </Button>
        {saved && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => patch({ webSearchApiKey: null })}
          >
            <Trash2 className="size-3.5" />
            {t('settings.providers.clearKey')}
          </Button>
        )}
      </div>

      {saved ? (
        <p className="flex items-center gap-1.5 text-[11px] text-success">
          <Check className="size-3.5" />
          {t('settings.webSearch.apiKey.saved')}
        </p>
      ) : needsKey ? (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-500">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          {t('settings.webSearch.apiKey.required')}
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {t('settings.webSearch.apiKey.optional')}
        </p>
      )}
    </div>
  )
}
