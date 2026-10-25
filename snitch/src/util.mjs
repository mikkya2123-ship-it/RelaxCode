import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

export const now = () => Date.now()

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export function truncate(value, limit = 2000, suffix = '…') {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value)
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - suffix.length))}${suffix}`
}

export function hash(value, length = 12) {
  return createHash('sha1').update(String(value)).digest('hex').slice(0, length)
}

export function safeJson(text, fallback = null) {
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
  return dir
}

/** Write through a temp file so a crash never leaves half a state file. */
export async function atomicWrite(file, text) {
  await ensureDir(dirname(file))
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, text, 'utf8')
  await fs.rename(tmp, file)
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} мс`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} с`
  if (ms < 3_600_000) {
    const minutes = Math.floor(ms / 60_000)
    const seconds = Math.round((ms % 60_000) / 1000)
    return `${minutes} мин ${seconds} с`
  }
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.round((ms % 3_600_000) / 60_000)
  return `${hours} ч ${minutes} мин`
}

export function percentile(values, p) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (clean.length === 0) return null
  const index = clamp(Math.ceil((p / 100) * clean.length) - 1, 0, clean.length - 1)
  return clean[index]
}

export function groupBy(items, keyOf) {
  const map = new Map()
  for (const item of items) {
    const key = keyOf(item)
    const list = map.get(key)
    if (list) list.push(item)
    else map.set(key, [item])
  }
  return map
}

export function dayKey(at) {
  return new Date(at).toISOString().slice(0, 10)
}

export function hourKey(at) {
  return new Date(at).toISOString().slice(0, 13)
}

export function minutesAgo(ms) {
  return Math.round(ms / 60_000)
}

export function uniqueBy(items, keyOf) {
  const seen = new Set()
  const out = []
  for (const item of items) {
    const key = keyOf(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/** Sort newest first without mutating the input. */
export function newestFirst(items, keyOf = (item) => item.at ?? item.startedAt ?? 0) {
  return items.slice().sort((a, b) => keyOf(b) - keyOf(a))
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function firstLine(value, limit = 160) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return truncate(text, limit)
}
