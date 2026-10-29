/**
 * Keyboard shortcuts are stored as text (`"Ctrl+B"`) and matched against real
 * keyboard events, so the settings screen can offer a capture box for them.
 */

export interface Combo {
  ctrl: boolean
  alt: boolean
  shift: boolean
  key: string
}

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'CapsLock', 'Dead'])

const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape',
  escape: 'Escape',
  space: 'Space',
  spacebar: 'Space',
  del: 'Delete',
  delete: 'Delete',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight'
}

export function normalizeKey(key: string): string {
  const alias = KEY_ALIASES[key.toLowerCase()]
  if (alias) return alias
  return key.length === 1 ? key.toLowerCase() : key
}

export function parseCombo(text: string): Combo | null {
  const parts = text.split('+').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) return null
  const combo: Combo = { ctrl: false, alt: false, shift: false, key: '' }
  for (const part of parts) {
    const lower = part.toLowerCase()
    if (lower === 'ctrl' || lower === 'control' || lower === 'cmdorctrl') combo.ctrl = true
    else if (lower === 'alt' || lower === 'option') combo.alt = true
    else if (lower === 'shift') combo.shift = true
    else combo.key = normalizeKey(part)
  }
  return combo.key.length > 0 ? combo : null
}

export function formatCombo(combo: Combo): string {
  const parts: string[] = []
  if (combo.ctrl) parts.push('Ctrl')
  if (combo.alt) parts.push('Alt')
  if (combo.shift) parts.push('Shift')
  parts.push(combo.key.length === 1 ? combo.key.toUpperCase() : combo.key)
  return parts.join('+')
}

/**
 * Editing keys that are meaningful on their own in a shortcut field: F2 to
 * rename, Delete to remove. Plain letters still need a modifier, so the
 * capture box cannot steal a normal keystroke.
 */
const BARE_KEYS = new Set(['Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Escape'])

/** Returns null while only modifiers are held, or when no modifier is used. */
export function comboFromEvent(event: KeyboardEvent): Combo | null {
  if (MODIFIER_KEYS.has(event.key)) return null
  const key = normalizeKey(event.key)
  const isFunctionKey = /^F\d{1,2}$/.test(key)
  if (!event.ctrlKey && !event.altKey && !isFunctionKey && !BARE_KEYS.has(key)) return null
  return {
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    key
  }
}

export function matchesCombo(event: KeyboardEvent, text: string): boolean {
  const combo = parseCombo(text)
  if (!combo) return false
  if (combo.ctrl !== event.ctrlKey) return false
  if (combo.alt !== event.altKey) return false
  if (combo.shift !== event.shiftKey) return false
  return combo.key.toLowerCase() === normalizeKey(event.key).toLowerCase()
}
