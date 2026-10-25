import { useEffect, useMemo, useState, type JSX } from 'react'
import { ArrowLeft, ChevronRight, ExternalLink, Loader2, Plus, Search } from 'lucide-react'
import {
  CUSTOM_PROVIDER_BASE_URL,
  PROVIDER_CATALOG,
  PROVIDER_CATALOG_STATS,
  type CatalogProvider
} from '@shared/provider-catalog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ProviderLogo } from '@/components/ui/provider-logo'
import { normalizeBaseUrl } from '@shared/base-url'
import { useT, useI18nStore, useTranslateSettingsError } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settings'
import { toast } from '@/stores/toast'

/** "https://api.groq.com/openai/v1" → "api.groq.com". */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

function searchText(provider: CatalogProvider): string {
  return [provider.name, provider.id, provider.baseUrl, provider.docs ?? '', ...provider.top]
    .join(' ')
    .toLowerCase()
}

const SEARCH_INDEX = PROVIDER_CATALOG.map((provider) => ({
  provider,
  text: searchText(provider)
}))

interface ProviderRowProps {
  provider: CatalogProvider
  format: (value: number) => string
  onPick: () => void
}

function ProviderRow({ provider, format, onPick }: ProviderRowProps): JSX.Element {
  return (
    <button
      type="button"
      data-testid={`provider-row-${provider.id}`}
      onClick={onPick}
      className="group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left outline-none transition-colors duration-150 hover:bg-accent focus-visible:bg-accent"
    >
      <ProviderLogo id={provider.id} className="text-foreground/85" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground">
          {provider.name}
        </span>
        <span className="block truncate font-mono text-[11px] text-tertiary">
          {hostOf(provider.baseUrl)}
        </span>
      </span>
      {provider.models > 0 && (
        <span className="shrink-0 tabular-nums text-[11px] text-tertiary">
          {format(provider.models)}
        </span>
      )}
      <ChevronRight className="size-3.5 shrink-0 text-tertiary transition-transform duration-150 group-hover:translate-x-0.5" />
    </button>
  )
}

interface AddProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the id of the profile that was just created. */
  onAdded?: (id: string) => void
}

/**
 * The catalogue is the main way to add a connection: pick a provider and only
 * type the key. Anything not listed goes through the "custom provider" row,
 * which is the same form with an empty base URL.
 */
export function AddProviderDialog({
  open,
  onOpenChange,
  onAdded
}: AddProviderDialogProps): JSX.Element {
  const t = useT()
  const translateError = useTranslateSettingsError()
  const locale = useI18nStore((state) => state.locale)
  const apply = useSettingsStore((state) => state.apply)
  const formatCount = (value: number): string => new Intl.NumberFormat(locale).format(value)

  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<CatalogProvider | 'custom' | null>(null)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setPicked(null)
    setName('')
    setBaseUrl('')
    setModel('')
    setApiKey('')
    setSaving(false)
  }, [open])

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle) {
      const words = needle.split(/\s+/)
      const found = SEARCH_INDEX.filter((entry) =>
        words.every((word) => entry.text.includes(word))
      ).map((entry) => entry.provider)
      return found.length > 0
        ? [{ key: 'search', label: '', items: found }]
        : []
    }
    const popular = PROVIDER_CATALOG.filter((provider) => provider.popular)
    const russian = PROVIDER_CATALOG.filter((provider) => provider.region === 'ru')
    const local = PROVIDER_CATALOG.filter((provider) => provider.local)
    const rest = PROVIDER_CATALOG.filter(
      (provider) => !provider.popular && !provider.region && !provider.local
    )
    return [
      { key: 'popular', label: t('settings.providers.group.popular'), items: popular },
      { key: 'ru', label: t('settings.providers.group.ru'), items: russian },
      { key: 'local', label: t('settings.providers.group.local'), items: local },
      { key: 'all', label: t('settings.providers.group.all'), items: rest }
    ].filter((group) => group.items.length > 0)
  }, [query, t])

  const pick = (provider: CatalogProvider | 'custom'): void => {
    setPicked(provider)
    setApiKey('')
    if (provider === 'custom') {
      setName('')
      // Empty on purpose: a prefilled address is what a paste lands on top of.
      setBaseUrl('')
      setModel('')
      return
    }
    setName(provider.name)
    setBaseUrl(provider.baseUrl)
    setModel(provider.top[0] ?? '')
  }

  const trimmedUrl = baseUrl.trim()
  const normalizedUrl = normalizeBaseUrl(baseUrl)

  const submit = async (): Promise<void> => {
    if (!normalizedUrl.ok || saving) return
    setSaving(true)
    try {
      const before = new Set(
        useSettingsStore.getState().settings?.providers.map((provider) => provider.id) ?? []
      )
      const key = apiKey.trim()
      const result = await apply({
        providerAdd: {
          name: name.trim() || undefined,
          baseUrl: normalizedUrl.value,
          model: model.trim() || null,
          ...(key ? { apiKey: key } : {})
        }
      })
      if (!result.ok) {
        toast(t('settings.saveFailed'), result.error ? translateError(result.error) : '', 'error')
        return
      }

      // A provider added from the catalogue is the one the user wants to use,
      // otherwise they would have to find the new card and switch to it.
      const added = useSettingsStore
        .getState()
        .settings?.providers.find((provider) => !before.has(provider.id))
      if (added) {
        await apply({ activeProviderId: added.id })
        onAdded?.(added.id)
      }

      toast(t('settings.providers.added'), name.trim() || hostOf(normalizedUrl.value))
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        data-testid="provider-catalog"
        className={cn('max-w-2xl gap-0 p-0', picked === null && 'h-[min(620px,86vh)]')}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && picked && !saving) {
            event.preventDefault()
            void submit()
          }
        }}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            {picked !== null && picked !== 'custom' && (
              <ProviderLogo id={picked.id} className="mt-[-1px] size-6 text-foreground/85" />
            )}
            <div className="min-w-0">
              <DialogTitle>
                {picked === 'custom'
                  ? t('settings.providers.custom')
                  : picked
                    ? picked.name
                    : t('settings.providers.catalog')}
              </DialogTitle>
              <DialogDescription className="mt-1 text-[12px]">
                {picked === 'custom'
                  ? t('settings.providers.custom.hint')
                  : t('settings.providers.catalog.stats', {
                      providers: PROVIDER_CATALOG_STATS.providers,
                      models: formatCount(PROVIDER_CATALOG_STATS.models)
                    })}
              </DialogDescription>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onOpenChange(false)}
          >
            {t('action.cancel')}
          </Button>
        </div>

        {picked === null ? (
          <>
            <div className="px-5 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-tertiary" />
                <Input
                  autoFocus
                  data-testid="provider-catalog-search"
                  value={query}
                  spellCheck={false}
                  placeholder={t('settings.providers.catalog.search')}
                  className="h-8 pl-8 text-[13px]"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
              <button
                type="button"
                data-testid="provider-catalog-custom"
                onClick={() => pick('custom')}
                className="group mb-1 flex w-full items-center gap-2.5 rounded-md border border-dashed border-border px-2.5 py-2 text-left transition-colors duration-150 hover:border-ring hover:bg-accent"
              >
                <Plus className="size-4 shrink-0 text-tertiary" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-foreground">
                    {t('settings.providers.custom')}
                  </span>
                  <span className="block truncate text-[11px] text-tertiary">
                    {t('settings.providers.custom.hint')}
                  </span>
                </span>
              </button>

              {groups.length === 0 && (
                <p className="px-2.5 py-6 text-center text-[12px] text-tertiary">
                  {t('settings.providers.catalog.empty')}
                </p>
              )}

              {groups.map((group) => (
                <div key={group.key}>
                  {group.label && (
                    <p className="px-2.5 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.06em] text-tertiary">
                      {group.label}
                    </p>
                  )}
                  {group.items.map((provider) => (
                    <ProviderRow
                      key={provider.id}
                      provider={provider}
                      format={formatCount}
                      onPick={() => pick(provider)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="mb-3 inline-flex items-center gap-1 text-[12px] text-tertiary transition-colors duration-150 hover:text-foreground"
              >
                <ArrowLeft className="size-3" />
                {t('settings.providers.back')}
              </button>

              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-muted-foreground">
                    {t('settings.providers.name')}
                  </span>
                  <Input
                    value={name}
                    placeholder={picked === 'custom' ? hostOf(normalizedUrl.ok ? normalizedUrl.value : trimmedUrl) : picked.name}
                    className="h-8 text-[13px]"
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-[11px] text-muted-foreground">
                    {t('settings.providers.endpoint')}
                  </span>
                  <Input
                    data-testid="provider-catalog-url"
                    value={baseUrl}
                    spellCheck={false}
                    placeholder={CUSTOM_PROVIDER_BASE_URL}
                    aria-invalid={!normalizedUrl.ok}
                    className={cn(
                      'h-8 font-mono text-[11px]',
                      !normalizedUrl.ok && 'border-destructive/60'
                    )}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    onBlur={() => {
                      if (normalizedUrl.ok && normalizedUrl.value !== baseUrl.trim()) {
                        setBaseUrl(normalizedUrl.value)
                      }
                    }}
                  />
                  {!normalizedUrl.ok && (
                    <span className="mt-1 block text-[11px] text-destructive">
                      {t(`settings.providers.urlError.${normalizedUrl.reason}`)}
                    </span>
                  )}
                </label>

                <label className="block">
                  <span className="mb-1 block text-[11px] text-muted-foreground">
                    {t('settings.providers.modelId')}
                  </span>
                  <Input
                    value={model}
                    list="provider-catalog-models"
                    spellCheck={false}
                    placeholder={picked === 'custom' ? 'gpt-4o-mini' : ''}
                    className="h-8 font-mono text-[11px]"
                    onChange={(event) => setModel(event.target.value)}
                  />
                  <datalist id="provider-catalog-models">
                    {(picked === 'custom' ? [] : picked.top).map((id) => (
                      <option key={id} value={id} />
                    ))}
                  </datalist>
                  <span className="mt-1 block text-[10px] text-tertiary">
                    {t('settings.providers.modelHint')}
                  </span>
                </label>

                <label className="block">
                  <span className="mb-1 block text-[11px] text-muted-foreground">
                    {t('settings.providers.apiKey')}
                  </span>
                  <Input
                    type="password"
                    value={apiKey}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="sk-…"
                    className="h-8 font-mono text-[11px]"
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                  <span className="mt-1 block text-[10px] text-tertiary">
                    {t('settings.providers.keyHint')}
                  </span>
                </label>

                <div className="flex flex-wrap items-center gap-3 pt-0.5">
                  {picked !== 'custom' && picked.models > 0 && (
                    <span className="text-[11px] text-tertiary">
                      {t('settings.providers.registryModels', {
                        count: formatCount(picked.models)
                      })}
                    </span>
                  )}
                  {picked !== 'custom' && picked.docs && (
                    <a
                      href={picked.docs}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                    >
                      {t('settings.providers.docs')}
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                data-testid="provider-catalog-back"
                onClick={() => setPicked(null)}
              >
                {t('settings.providers.back')}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                className="h-8 min-w-[104px] text-xs"
                data-testid="provider-catalog-submit"
                disabled={!normalizedUrl.ok || saving}
                onClick={() => void submit()}
              >
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                {t('settings.providers.add')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
