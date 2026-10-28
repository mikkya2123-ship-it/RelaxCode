import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR, STATE_FILE } from './paths.mjs'
import { atomicWrite, hash, newestFirst, readJson } from './util.mjs'

const VERSION = 3
const SAVE_DEBOUNCE_MS = 400

function emptyState() {
  return {
    version: VERSION,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    meta: {
      sources: {},
      settings: null,
      servers: [],
      mcpServers: [],
      modelMemory: { entries: [], weak: [] },
      probe: { attached: false, lastSeen: null, port: null, target: null, reason: 'нет подключения' },
      lastScan: null,
      logOffset: 0,
      ingested: {},
      archiveIndex: {},
      framesSeen: {}
    },
    runs: {},
    events: [],
    incidents: []
  }
}

function stepKey(step, index) {
  return step?.callId || `${step?.name ?? 'tool'}:${index}`
}

function mergeSteps(previous, next) {
  const byKey = new Map()
  const order = []
  const put = (step, index, prefer) => {
    if (!step || typeof step !== 'object') return
    const key = stepKey(step, index)
    const current = byKey.get(key)
    if (!current) {
      byKey.set(key, { ...step, index: step.index ?? index })
      order.push(key)
      return
    }
    const merged = { ...current }
    for (const [field, value] of Object.entries(step)) {
      if (value === undefined || value === null) continue
      if (prefer || merged[field] === undefined) merged[field] = value
    }
    merged.index = current.index ?? step.index ?? index
    merged.startedAt = current.startedAt ?? step.startedAt
    merged.endedAt = current.endedAt ?? step.endedAt
    if (current.durationMs != null) merged.durationMs = current.durationMs
    else if (step.durationMs != null) merged.durationMs = step.durationMs
    byKey.set(key, merged)
  }
  previous.forEach((step, index) => put(step, index, false))
  next.forEach((step, index) => put(step, index, true))
  return order
    .map((key) => byKey.get(key))
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((step, index) => ({ ...step, index }))
}

function uniqueBy(items, keyOf) {
  const seen = new Set()
  const out = []
  for (const item of items ?? []) {
    if (!item) continue
    const key = keyOf(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function mergeRun(previous, next) {
  const merged = { ...previous, ...next }
  merged.startedAt = Math.min(previous.startedAt ?? Infinity, next.startedAt ?? Infinity)
  if (!Number.isFinite(merged.startedAt)) merged.startedAt = next.startedAt ?? Date.now()
  const ends = [previous.endedAt, next.endedAt].filter((value) => Number.isFinite(value))
  if (ends.length > 0) merged.endedAt = Math.max(...ends)
  if (merged.endedAt && merged.startedAt) merged.durationMs = merged.endedAt - merged.startedAt
  merged.steps = mergeSteps(previous.steps ?? [], next.steps ?? [])
  merged.notices = uniqueBy(
    [...(previous.notices ?? []), ...(next.notices ?? [])],
    (notice) => `${notice.kind}:${notice.text}`
  )
  merged.approvals = uniqueBy(
    [...(previous.approvals ?? []), ...(next.approvals ?? [])],
    (approval) => `${approval.tool}:${approval.preview}`
  )
  merged.files = uniqueBy(
    [...(previous.files ?? []), ...(next.files ?? [])],
    (file) => `${file.action}:${file.path}:${file.at ?? ''}`
  )
  merged.commands = uniqueBy(
    [...(previous.commands ?? []), ...(next.commands ?? [])],
    (command) => `${command.command}:${command.at ?? ''}`
  )
  merged.frames = uniqueBy(
    [...(previous.frames ?? []), ...(next.frames ?? [])],
    (frame) => frame.file
  )
  if (!next.todos?.length && previous.todos?.length) merged.todos = previous.todos
  if (next.source === 'exchange') {
    merged.source = 'exchange'
    merged.live = false
  } else if (previous.source === 'exchange') {
    merged.source = 'exchange'
  }
  merged.lastEventAt = Math.max(previous.lastEventAt ?? 0, next.lastEventAt ?? 0) || undefined
  merged.counts = countRun(merged)
  return merged
}

export function countRun(run) {
  const steps = run.steps ?? []
  return {
    steps: steps.length,
    ok: steps.filter((step) => step.ok === true).length,
    failed: steps.filter((step) => step.ok === false).length,
    pending: steps.filter((step) => step.ok === null || step.ok === undefined).length,
    files: run.files?.length ?? 0,
    commands: run.commands?.length ?? 0,
    notices: run.notices?.length ?? 0
  }
}

export class Store {
  constructor(dataDir = DATA_DIR) {
    this.dataDir = dataDir
    this.file = join(dataDir, 'state.json')
    this.state = emptyState()
    this.eventIds = new Set()
    this.saveTimer = null
    this.saving = null
    this.listeners = new Set()
  }

  async load() {
    const raw = await readJson(this.file, null)
    if (raw && typeof raw === 'object' && raw.version === VERSION) {
      this.state = { ...emptyState(), ...raw, meta: { ...emptyState().meta, ...(raw.meta ?? {}) } }
    } else if (raw) {
      // Older or hand-edited state: keep runs that still look usable.
      this.state = emptyState()
      if (raw.runs && typeof raw.runs === 'object') this.state.runs = raw.runs
      if (Array.isArray(raw.events)) this.state.events = raw.events
      if (Array.isArray(raw.incidents)) this.state.incidents = raw.incidents
      if (raw.meta && typeof raw.meta === 'object') this.state.meta = { ...this.state.meta, ...raw.meta }
    } else if (existsSync(this.file)) {
      // A corrupt file is preserved for inspection instead of silently deleted.
      await fs.copyFile(this.file, `${this.file}.corrupt-${Date.now()}`).catch(() => {})
    }
    this.eventIds = new Set(this.state.events.map((event) => event.id).filter(Boolean))
    this.prune()
    return this
  }

  onChange(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  notify(kind, payload) {
    for (const listener of this.listeners) {
      try {
        listener(kind, payload)
      } catch {
        // A dashboard connection must never break collection.
      }
    }
  }

  get meta() {
    return this.state.meta
  }

  getRun(id) {
    return this.state.runs[id] ?? null
  }

  listRuns() {
    return Object.values(this.state.runs).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
  }

  findRunByRequestId(requestId) {
    return this.listRuns().find((run) => run.requestId === requestId) ?? null
  }

  upsertRun(run) {
    if (!run?.id) return { run: null, created: false }
    const previous = this.state.runs[run.id]
    const next = previous ? mergeRun(previous, run) : { ...run, counts: countRun(run) }
    this.state.runs[run.id] = next
    this.touch()
    this.notify(previous ? 'run-updated' : 'run-created', next)
    return { run: next, created: !previous }
  }

  addEvent(event) {
    if (!event) return null
    const id = event.id || hash(`${event.at}:${event.kind}:${event.title}:${event.runId ?? ''}`)
    if (this.eventIds.has(id)) return null
    const item = { ...event, id }
    this.eventIds.add(id)
    this.state.events.push(item)
    if (this.state.events.length > 5_000) this.pruneEvents()
    this.touch()
    this.notify('event', item)
    return item
  }

  addIncident(incident) {
    if (!incident?.fingerprint) return { incident: null, created: false }
    const existing = this.state.incidents.find((item) => item.fingerprint === incident.fingerprint)
    if (existing) {
      existing.lastSeenAt = incident.at ?? Date.now()
      existing.count = (existing.count ?? 1) + 1
      existing.evidence = incident.evidence ?? existing.evidence
      this.touch()
      return { incident: existing, created: false }
    }
    const item = {
      ...incident,
      id: hash(incident.fingerprint),
      at: incident.at ?? Date.now(),
      lastSeenAt: incident.at ?? Date.now(),
      count: 1
    }
    this.state.incidents.push(item)
    if (this.state.incidents.length > 3_000) this.pruneIncidents()
    this.touch()
    this.notify('incident', item)
    return { incident: item, created: true }
  }

  setMeta(patch) {
    const next = { ...this.state.meta, ...patch }
    for (const [key, value] of Object.entries(patch)) {
      if (value && typeof value === 'object' && !Array.isArray(value) && next[key]) {
        next[key] = { ...next[key], ...value }
      }
    }
    this.state.meta = next
    this.touch()
  }

  setProbe(probe) {
    this.state.meta.probe = { ...this.state.meta.probe, ...probe }
    this.touch()
    this.notify('probe', this.state.meta.probe)
  }

  touch() {
    this.state.updatedAt = Date.now()
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.flush()
    }, SAVE_DEBOUNCE_MS)
  }

  async flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.saving) return this.saving
    this.saving = (async () => {
      this.prune()
      this.state.updatedAt = Date.now()
      await atomicWrite(this.file, JSON.stringify(this.state))
    })().finally(() => {
      this.saving = null
    })
    return this.saving
  }

  prune() {
    this.pruneEvents()
    this.pruneRuns()
    this.pruneIncidents()
    const ingested = Object.entries(this.state.meta.ingested ?? {})
    if (ingested.length > 2_000) {
      ingested.sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0))
      this.state.meta.ingested = Object.fromEntries(ingested.slice(0, 2_000))
    }
    const frames = Object.keys(this.state.meta.framesSeen ?? {})
    if (frames.length > 5_000) {
      const keep = new Set(frames.slice(-5_000))
      this.state.meta.framesSeen = Object.fromEntries(
        Object.entries(this.state.meta.framesSeen).filter(([key]) => keep.has(key))
      )
    }
  }

  pruneEvents() {
    const limit = 20_000
    if (this.state.events.length <= limit) return
    this.state.events.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
    const removed = this.state.events.splice(0, this.state.events.length - limit)
    for (const event of removed) this.eventIds.delete(event.id)
  }

  pruneRuns() {
    const limit = 400
    const runs = Object.values(this.state.runs)
    if (runs.length <= limit) return
    runs.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    const keep = new Set(runs.slice(0, limit).map((run) => run.id))
    for (const id of Object.keys(this.state.runs)) {
      if (!keep.has(id)) delete this.state.runs[id]
    }
    for (const id of Object.keys(this.state.meta.archiveIndex ?? {})) {
      if (!this.state.runs[id]) delete this.state.meta.archiveIndex[id]
    }
  }

  pruneIncidents() {
    const limit = 3_000
    if (this.state.incidents.length <= limit) return
    this.state.incidents.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    this.state.incidents.splice(limit)
  }

  events({ limit = 200, before = null, kind = null, level = null, runId = null, query = '' } = {}) {
    let items = this.state.events
    if (before) items = items.filter((event) => (event.at ?? 0) < before)
    if (kind) items = items.filter((event) => event.kind === kind)
    if (level) items = items.filter((event) => event.level === level)
    if (runId) items = items.filter((event) => event.runId === runId)
    if (query) {
      const needle = query.toLowerCase()
      items = items.filter((event) =>
        `${event.title ?? ''} ${event.detail ?? ''}`.toLowerCase().includes(needle)
      )
    }
    return newestFirst(items).slice(0, limit)
  }

  incidents({ limit = 200, severity = null, kind = null, runId = null, since = null } = {}) {
    let items = this.state.incidents
    if (severity) items = items.filter((item) => item.severity === severity)
    if (kind) items = items.filter((item) => item.kind === kind)
    if (runId) items = items.filter((item) => item.runId === runId)
    if (since) items = items.filter((item) => (item.at ?? 0) >= since)
    return newestFirst(items).slice(0, limit)
  }

  search(query, limit = 50) {
    const needle = query.toLowerCase().trim()
    if (!needle) return { runs: [], incidents: [] }
    const runs = this.listRuns()
      .filter((run) =>
        `${run.user ?? ''} ${run.answer ?? ''} ${run.model ?? ''} ${run.provider ?? ''} ${run.error ?? ''}`
          .toLowerCase()
          .includes(needle)
      )
      .slice(0, limit)
    const incidents = this.incidents({ limit })
      .filter((item) => `${item.title ?? ''} ${item.detail ?? ''}`.toLowerCase().includes(needle))
    return { runs, incidents }
  }

  stats() {
    const runs = this.listRuns()
    return {
      runs: runs.length,
      liveRuns: runs.filter((run) => run.live).length,
      events: this.state.events.length,
      incidents: this.state.incidents.length,
      archived: runs.filter((run) => run.archiveFile).length
    }
  }
}
