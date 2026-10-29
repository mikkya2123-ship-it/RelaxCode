import { useCallback, useMemo, useState, type JSX } from 'react'
import {
  Bell,
  Bot,
  Code,
  FolderTree,
  Globe,
  Image as ImageIcon,
  Keyboard,
  Monitor,
  Zap,
  MessagesSquare,
  Palette,
  Plug,
  RotateCcw,
  Search,
  Server,
  SlidersHorizontal,
  Sparkles,
  Wrench,
  X
} from 'lucide-react'
import type { SettingsPatch } from '@shared/ipc'
import { DEFAULT_SETTINGS, type SettingsValues } from '@shared/settings'
import { useSettingsStore } from '@/stores/settings'
import { useChatStore } from '@/stores/chat'
import { useUiStore } from '@/stores/ui'
import { toast } from '@/stores/toast'
import { useT, useTranslateSettingsError } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { SECTIONS, SETTINGS_CATALOG, type SectionId, type SettingDef } from './catalog'
import {
  ListInput,
  NumberInput,
  Row,
  SelectInput,
  SettingsSearchProvider,
  SliderInput,
  TextInput
} from './controls'
import {
  AccentControl,
  KeymapControl,
  ProvidersControl,
  ToolsControl,
  WebSearchKeyControl
} from './special'
import { McpServersControl } from './McpServers'
import { SkillsControl } from './SkillsControl'

const ICONS: Record<string, JSX.Element> = {
  plug: <Plug className="size-4" />,
  sparkles: <Sparkles className="size-4" />,
  bot: <Bot className="size-4" />,
  wrench: <Wrench className="size-4" />,
  globe: <Globe className="size-4" />,
  image: <ImageIcon className="size-4" />,
  code: <Code className="size-4" />,
  palette: <Palette className="size-4" />,
  messages: <MessagesSquare className="size-4" />,
  folder: <FolderTree className="size-4" />,
  server: <Server className="size-4" />,
  monitor: <Monitor className="size-4" />,
  bell: <Bell className="size-4" />,
  keyboard: <Keyboard className="size-4" />,
  sliders: <SlidersHorizontal className="size-4" />
}

const ACTION_LABELS: Record<string, string> = {
  export: 'settings.advanced.export',
  import: 'settings.advanced.import',
  reveal: 'settings.advanced.reveal',
  reset: 'settings.advanced.reset',
  clearChats: 'settings.chat.clearAll'
}

export function SettingsScreen(): JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const closeSettings = useUiStore((s) => s.closeSettings)
  const [query, setQuery] = useState('')
  const [section, setSection] = useState<SectionId>('connection')
  const t = useT()
  const translateError = useTranslateSettingsError()

  const patch = useCallback(
    async (values: SettingsPatch): Promise<void> => {
      const result = await useSettingsStore.getState().apply(values)
      if (!result.ok) {
        toast(
          t('settings.saveFailed'),
          result.error ? translateError(result.error) : '',
          'error'
        )
      }
    },
    [t, translateError]
  )

  const onAction = useCallback(
    async (action: string): Promise<void> => {
      if (action === 'export') {
        const result = await useSettingsStore.getState().exportFile()
        if (result.ok) toast(t('settings.advanced.exported'), result.path)
        else if (!result.canceled) {
          toast(t('settings.saveFailed'), result.error ? translateError(result.error) : '', 'error')
        }
        return
      }
      if (action === 'import') {
        const result = await useSettingsStore.getState().importFile()
        if (result.ok) toast(t('settings.advanced.imported'))
        else if (result.error !== 'canceled') {
          toast(t('settings.saveFailed'), result.error ? translateError(result.error) : '', 'error')
        }
        return
      }
      if (action === 'reveal') {
        window.relaxcode.settings.reveal()
        return
      }
      if (action === 'reset') {
        await useSettingsStore.getState().resetAll()
        toast(t('settings.advanced.resetDone'))
        return
      }
      if (action === 'clearChats') {
        useChatStore.getState().clearAll()
        toast(t('settings.chat.cleared'))
      }
    },
    [t]
  )

  const visibleSections = useMemo(
    () => (query.trim().length > 0 ? SECTIONS : SECTIONS.filter((item) => item.id === section)),
    [query, section]
  )

  if (!settings) {
    return (
      <div className="absolute inset-0 z-40 flex items-center justify-center bg-background text-sm text-muted-foreground">
        {t('chat.models.loading')}
      </div>
    )
  }

  return (
    <SettingsSearchProvider value={query}>
      <div className="absolute inset-0 z-40 flex flex-col bg-background" data-testid="settings-screen">
        <header className="flex h-12 shrink-0 items-center gap-3 px-4">
          <h1 className="text-[15px] font-semibold text-foreground">{t('settings.title')}</h1>
          <div className="relative ml-2 w-[320px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-tertiary" />
            <Input
              value={query}
              data-testid="settings-search"
              placeholder={t('settings.search')}
              className="h-8 pl-8 pr-8 text-[13px]"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // Escape clears the query first, then leaves the screen.
                if (event.key !== 'Escape') return
                event.preventDefault()
                if (query.length > 0) setQuery('')
                else closeSettings()
              }}
            />
            {query.length > 0 && (
              <button
                type="button"
                aria-label={t('action.close')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-tertiary hover:text-foreground"
                onClick={() => setQuery('')}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
              <Zap className="size-3.5" />
              {t('settings.appliesImmediately')}
            </span>
            <Button
              variant="primary"
              size="sm"
              data-testid="settings-close"
              onClick={closeSettings}
            >
              {t('settings.done')}
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav className="w-[220px] shrink-0 overflow-y-auto p-2">
            {SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                data-testid={`settings-nav-${item.id}`}
                onClick={() => {
                  setSection(item.id)
                  setQuery('')
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors',
                  item.id === section && query.trim().length === 0
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                )}
              >
                {ICONS[item.icon]}
                {t(item.label)}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="settings-body">
            <div className="mx-auto max-w-[880px] px-6 py-5">
              {visibleSections.map((item) => {
                const rows = SETTINGS_CATALOG.filter((def) => def.section === item.id)
                const resettable =
                  query.trim().length === 0 &&
                  item.id !== 'connection' &&
                  item.id in DEFAULT_SETTINGS
                return (
                  <section key={item.id} className="mb-8">
                    <div className="mb-2 flex items-center justify-between gap-4">
                      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t(item.label)}
                      </h2>
                      {resettable && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1.5 text-xs text-muted-foreground"
                          onClick={() =>
                            void patch({
                              [item.id]: DEFAULT_SETTINGS[item.id as keyof SettingsValues]
                            } as SettingsPatch)
                          }
                        >
                          <RotateCcw className="size-3" />
                          {t('settings.resetSection')}
                        </Button>
                      )}
                    </div>
                    <div className="overflow-hidden rounded-xl border border-border bg-card">
                      {rows.map((def) => (
                        <CatalogRow
                          key={def.id}
                          def={def}
                          settings={settings}
                          patch={patch}
                          onAction={onAction}
                        />
                      ))}
                    </div>
                  </section>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </SettingsSearchProvider>
  )
}

interface CatalogRowProps {
  def: SettingDef
  settings: SettingsValues
  patch: (values: SettingsPatch) => Promise<void>
  onAction: (action: string) => Promise<void>
}

function CatalogRow({ def, settings, patch, onAction }: CatalogRowProps): JSX.Element | null {
  const t = useT()

  const group = def.group ? (settings as unknown as Record<string, unknown>)[def.group] : undefined
  const value =
    def.flat || !def.key
      ? group
      : group
        ? (group as Record<string, unknown>)[def.key]
        : undefined

  const write = (next: unknown): void => {
    if (!def.group) return
    if (def.flat) {
      void patch({ [def.group]: next } as SettingsPatch)
      return
    }
    void patch({ [def.group]: { [def.key as string]: next } } as SettingsPatch)
  }

  const control = def.control

  switch (control.kind) {
    case 'providers':
      return (
        <Row def={def} wide>
          <ProvidersControl settings={settings as never} patch={(values) => void patch(values)} />
        </Row>
      )
    case 'tools':
      return (
        <Row def={def} wide>
          <ToolsControl
            tools={settings.tools}
            patch={(values) => void patch({ tools: values })}
          />
        </Row>
      )
    case 'skills':
      return (
        <Row def={def} wide>
          <SkillsControl
            settings={settings.skills}
            patch={(values) => void patch(values)}
          />
        </Row>
      )
    case 'mcpServers':
      return (
        <Row def={def} wide>
          <McpServersControl />
        </Row>
      )
    case 'webSearchKey':
      return (
        <Row def={def} wide>
          <WebSearchKeyControl
            settings={settings as never}
            patch={(values) => void patch(values)}
          />
        </Row>
      )
    case 'keymap':
      return (
        <Row def={def} wide>
          <KeymapControl
            keymap={settings.keymap}
            patch={(values) => void patch({ keymap: values })}
          />
        </Row>
      )
    case 'accent':
      return (
        <Row def={def}>
          <AccentControl value={settings.ui.accent} onChange={(next) => write(next)} />
        </Row>
      )
    case 'action':
      return (
        <Row def={def}>
          <Button
            variant={control.action === 'reset' ? 'destructive' : 'default'}
            size="sm"
            className="h-8 text-[13px]"
            data-testid={`settings-action-${control.action}`}
            onClick={() => void onAction(control.action)}
          >
            {t(ACTION_LABELS[control.action] as never)}
          </Button>
        </Row>
      )
    case 'switch':
      return (
        <Row def={def}>
          <SwitchRow checked={value === true} onChange={write} />
        </Row>
      )
    case 'select':
      return (
        <Row def={def}>
          <SelectInput
            value={String(value ?? '')}
            options={control.options}
            onChange={write}
          />
        </Row>
      )
    case 'number':
      return (
        <Row def={def}>
          <NumberInput
            value={Number(value ?? control.min)}
            min={control.min}
            max={control.max}
            step={control.step}
            unit={control.unit}
            onChange={write}
          />
        </Row>
      )
    case 'slider':
      return (
        <Row def={def}>
          <SliderInput
            value={Number(value ?? control.min)}
            min={control.min}
            max={control.max}
            step={control.step}
            format={def.id === 'ui.scale' ? (v) => `${Math.round(v * 100)}%` : (v) => v.toFixed(2)}
            onChange={write}
          />
        </Row>
      )
    case 'text':
      return (
        <Row def={def}>
          <div className="w-[320px]">
            <TextInput
              value={String(value ?? '')}
              placeholder={control.placeholder}
              onChange={write}
            />
          </div>
        </Row>
      )
    case 'textarea':
      return (
        <Row def={def} wide>
          <TextInput
            value={String(value ?? '')}
            multiline
            rows={control.rows}
            onChange={write}
          />
        </Row>
      )
    case 'list':
      return (
        <Row def={def} wide>
          <ListInput value={(value as string[]) ?? []} onChange={write} />
        </Row>
      )
    default:
      return null
  }
}

/** Radix switch with a plain boolean callback, so rows stay tiny. */
function SwitchRow({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (value: boolean) => void
}): JSX.Element {
  return (
    <Switch checked={checked} onCheckedChange={onChange} />
  )
}
