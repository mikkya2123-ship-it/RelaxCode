import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react'
import { Plus, X } from 'lucide-react'
import type { TKey } from '@shared/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { comboFromEvent, formatCombo, parseCombo, type Combo } from '@/lib/keymap'
import type { SelectOption, SettingDef, Unit } from './catalog'

/* --------------------------------- search --------------------------------- */

const SearchContext = createContext('')

export const SettingsSearchProvider = SearchContext.Provider

export function matchesQuery(query: string, haystack: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const text = haystack.toLowerCase()
  return tokens.every((token) => text.includes(token))
}

/* ---------------------------------- rows ---------------------------------- */

interface RowProps {
  def?: SettingDef
  label?: string
  hint?: string
  keywords?: string
  wide?: boolean
  children: ReactNode
}

/** One settings row: label + hint on the left, the control on the right. */
export function Row({ def, label, hint, keywords, wide, children }: RowProps): JSX.Element | null {
  const query = useContext(SearchContext)
  const t = useT()

  const text = label ?? (def ? t(def.label) : '')
  const description = hint ?? (def?.hint ? t(def.hint) : '')
  const haystack = `${text} ${description} ${keywords ?? def?.keywords ?? ''} ${def?.id ?? ''}`

  if (!matchesQuery(query, haystack)) return null

  return (
    <div
      data-setting={def?.id}
      className={cn(
        'px-5 py-3.5',
        wide ? 'space-y-2' : 'flex items-start justify-between gap-6'
      )}
    >
      <div className="min-w-0">
        <div className="text-[13px] font-medium leading-5 text-foreground">{text}</div>
        {description.length > 0 && (
          <p className="mt-0.5 max-w-[70ch] text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className={cn(wide ? '' : 'shrink-0 pt-0.5')}>{children}</div>
    </div>
  )
}

/* -------------------------------- controls -------------------------------- */

const UNITS: Record<Unit, TKey> = {
  ms: 'settings.unit.ms',
  s: 'settings.unit.s',
  px: 'settings.unit.px',
  kb: 'settings.unit.kb',
  mb: 'settings.unit.mb',
  chars: 'settings.unit.chars',
  tokens: 'settings.unit.tokens'
}

interface NumberInputProps {
  value: number
  min: number
  max: number
  step?: number
  unit?: Unit
  onChange: (value: number) => void
}

/** Keeps a draft while typing and only writes a clamped value on blur/Enter. */
export function NumberInput({ value, min, max, step = 1, unit, onChange }: NumberInputProps): JSX.Element {
  const t = useT()
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commit = (): void => {
    const parsed = Number.parseFloat(draft.replace(',', '.'))
    const next = Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : value
    setDraft(String(next))
    if (next !== value) onChange(next)
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        inputMode="decimal"
        step={step}
        value={draft}
        aria-label={unit ? t(UNITS[unit]) : undefined}
        className="h-8 w-24 text-right text-[13px] tabular-nums"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
            event.currentTarget.blur()
          }
        }}
      />
      {unit && <span className="w-14 text-xs text-muted-foreground">{t(UNITS[unit])}</span>}
    </div>
  )
}

interface SliderInputProps {
  value: number
  min: number
  max: number
  step: number
  format?: (value: number) => string
  onChange: (value: number) => void
}

export function SliderInput({ value, min, max, step, format, onChange }: SliderInputProps): JSX.Element {
  return (
    <div className="flex w-56 items-center gap-3 pt-1.5">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border accent-primary"
      />
      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
        {format ? format(value) : value}
      </span>
    </div>
  )
}

interface SelectInputProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  className?: string
}

export function SelectInput({ value, options, onChange, className }: SelectInputProps): JSX.Element {
  const t = useT()
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn('h-8 w-56 text-[13px]', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="text-[13px]">
            {t(option.label)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Local draft + debounce, so typing does not write to disk on every keystroke. */
function useDebouncedField(
  value: string,
  onChange: (next: string) => void,
  delay = 500
): [string, (next: string) => void, () => void] {
  const [draft, setDraft] = useState(value)
  const timer = useRef<number | null>(null)
  const latest = useRef(onChange)
  latest.current = onChange

  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  const change = useCallback(
    (next: string) => {
      setDraft(next)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        timer.current = null
        latest.current(next)
      }, delay)
    },
    [delay]
  )

  const flush = useCallback(() => {
    if (timer.current === null) return
    window.clearTimeout(timer.current)
    timer.current = null
    latest.current(draft)
  }, [draft])

  return [draft, change, flush]
}

interface TextInputProps {
  value: string
  placeholder?: string
  multiline?: boolean
  rows?: number
  onChange: (value: string) => void
}

export function TextInput({ value, placeholder, multiline, rows, onChange }: TextInputProps): JSX.Element {
  const [draft, change, flush] = useDebouncedField(value, onChange)
  if (multiline) {
    return (
      <Textarea
        value={draft}
        rows={rows ?? 4}
        placeholder={placeholder}
        className="min-h-0 w-full resize-y font-mono text-xs leading-relaxed"
        onChange={(event) => change(event.target.value)}
        onBlur={flush}
      />
    )
  }
  return (
    <Input
      value={draft}
      placeholder={placeholder}
      className="h-8 w-full font-mono text-xs"
      onChange={(event) => change(event.target.value)}
      onBlur={flush}
    />
  )
}

interface ListInputProps {
  value: string[]
  placeholder?: string
  onChange: (value: string[]) => void
}

/** Chip editor for string lists (rules files, excluded folders). */
export function ListInput({ value, placeholder, onChange }: ListInputProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const t = useT()

  const add = (): void => {
    const item = draft.trim()
    if (item.length === 0) return
    if (!value.includes(item)) onChange([...value, item])
    setDraft('')
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((item) => (
        <span
          key={item}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-1 font-mono text-[11px] text-secondary-foreground"
        >
          {item}
          <button
            type="button"
            aria-label={t('action.removeItem', { item })}
            className="rounded-sm text-tertiary transition-colors hover:text-foreground"
            onClick={() => onChange(value.filter((entry) => entry !== item))}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <div className="flex items-center gap-1.5">
        <Input
          value={draft}
          placeholder={placeholder}
          className="h-7 w-44 font-mono text-[11px]"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
        />
        <Button type="button" variant="muted" size="icon-sm" onClick={add}>
          <Plus className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

interface KeyComboInputProps {
  value: string
  onChange: (value: string) => void
  onClear?: () => void
}

/** Click, press the combination, done. */
export function KeyComboInput({ value, onChange, onClear }: KeyComboInputProps): JSX.Element {
  const t = useT()
  const [capturing, setCapturing] = useState(false)

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!capturing) return
    event.preventDefault()
    if (event.key === 'Escape') {
      setCapturing(false)
      return
    }
    if (event.key === 'Backspace') {
      onClear?.()
      setCapturing(false)
      return
    }
    const combo = comboFromEvent(event.nativeEvent)
    if (!combo) return
    onChange(formatCombo(combo))
    setCapturing(false)
  }

  return (
    <button
      type="button"
      onFocus={() => setCapturing(true)}
      onBlur={() => setCapturing(false)}
      onKeyDown={handleKeyDown}
      className={cn(
        'inline-flex h-8 min-w-[9rem] items-center justify-center rounded-md border px-3 font-mono text-xs outline-none transition-colors',
        capturing
          ? 'border-ring bg-card text-foreground ring-2 ring-ring/40'
          : 'border-input bg-card text-muted-foreground hover:text-foreground'
      )}
    >
      {capturing ? t('settings.keymap.listening') : parseCombo(value) ? value : t('settings.keymap.none')}
    </button>
  )
}

/* -------------------------------- keymap row ------------------------------- */

export function comboFromString(value: string): Combo | null {
  return parseCombo(value)
}
