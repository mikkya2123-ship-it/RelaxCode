import { CONFIG_FILE } from './paths.mjs'
import { atomicWrite, readJson } from './util.mjs'

export const DEFAULT_CONFIG = {
  /** Loopback only: the dashboard contains prompts, answers and file paths. */
  host: '127.0.0.1',
  port: 7777,
  /** Filled by --user-data or auto-detected at startup. */
  userData: null,
  workspace: null,
  /** Redact key-like strings before anything is stored or shown. */
  redact: true,
  /** Keep the state file bounded. Full exchange JSON stays in data/archive. */
  retention: {
    runs: 400,
    events: 20_000,
    incidents: 3_000,
    archives: 800
  },
  scanIntervalMs: 3_000,
  /** Live telemetry through the IDE's own DevTools port. */
  live: {
    enabled: true,
    ports: [9222, 9223, 9333, 9444],
    injectEveryMs: 5_000,
    terminalFeed: true
  },
  /** After this long without events a run or a step is called stalled. */
  stale: {
    runSec: 45,
    runCriticalSec: 180,
    stepSec: 90,
    stepCriticalSec: 300
  },
  /** Rewrite out/SITUATION.md this often while the collector runs (0 = off). */
  autoDigestMinutes: 5
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function merge(base, value) {
  if (!isObject(value)) return base
  const out = { ...base }
  for (const [key, child] of Object.entries(value)) {
    if (!(key in base)) continue
    out[key] = isObject(base[key]) && isObject(child) ? merge(base[key], child) : child
  }
  return out
}

export async function loadConfig() {
  const stored = await readJson(CONFIG_FILE, {})
  return merge(DEFAULT_CONFIG, stored)
}

export async function saveConfig(config) {
  await atomicWrite(CONFIG_FILE, JSON.stringify(config, null, 2))
  return config
}

export function applyCliOverrides(config, options = {}) {
  const next = merge(config, {})
  if (options.port) next.port = Number(options.port)
  if (options.host) next.host = String(options.host)
  if (options.userData) next.userData = options.userData
  if (options.workspace) next.workspace = options.workspace
  if (options.noLive) next.live = { ...next.live, enabled: false }
  if (options.redact === false) next.redact = false
  return next
}
