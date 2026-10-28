import { createReadStream, promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { computeCommandStats, computeFileStats, computeOverview, computeToolStats, detectStalls } from './analyze.mjs'
import { buildAiBrief } from './brief.mjs'
import { buildDigest, writeDigest } from './digest.mjs'
import { collectSources } from './ingest.mjs'
import { applyProbePayload } from './live.mjs'
import {
  DATA_DIR,
  OUT_DIR,
  PUBLIC_DIR,
  SNITCH_ROOT,
  detectDevToolsPort,
  detectLogFile,
  detectUserDataDir,
  detectWorkspace,
  exchangesDir,
  framesDir,
  mcpFile,
  statSafe
} from './paths.mjs'
import { ProbeManager } from './probe.mjs'
import { Store } from './store.mjs'
import { formatDuration, sleep } from './util.mjs'

export const VERSION = '0.1.0'
const BODY_LIMIT = 1024 * 1024
const SSE_HEARTBEAT_MS = 15_000
const PROBE_TICK_MS = 4_000
const STALL_TICK_MS = 10_000

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8'
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function hostOf(req) {
  return String(req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase()
}

function isLoopbackHost(req) {
  return LOCAL_HOSTS.has(hostOf(req))
}

function isSameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname.toLowerCase())
  } catch {
    return false
  }
}

function sendJson(res, status, value, extra = {}) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra
  })
  res.end(body)
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra
  })
  res.end(text)
}

function readBody(req, limit = BODY_LIMIT) {
  return new Promise((resolveBody, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function queryOf(url) {
  return Object.fromEntries(url.searchParams.entries())
}

function numberParam(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function slimRun(run) {
  return {
    id: run.id,
    requestId: run.requestId,
    source: run.source,
    live: run.live === true,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs: run.durationMs,
    mode: run.mode,
    model: run.model,
    provider: run.provider,
    baseUrlHost: run.baseUrlHost,
    title: run.title ?? null,
    user: run.user,
    answerPreview: (run.answer ?? '').slice(0, 280),
    error: run.error,
    counts: run.counts,
    tags: run.tags,
    usage: run.usage,
    lastEventAt: run.lastEventAt,
    archiveFile: run.archiveFile ?? null,
    files: (run.files ?? []).length,
    commands: (run.commands ?? []).length,
    approvals: (run.approvals ?? []).length,
    notices: (run.notices ?? []).length,
    thinking: run.thinking ?? null
  }
}

function safeMeta(meta) {
  const { ingested, framesSeen, ...rest } = meta ?? {}
  return {
    ...rest,
    ingestedCount: Object.keys(ingested ?? {}).length,
    framesSeenCount: Object.keys(framesSeen ?? {}).length
  }
}

export class SnitchServer {
  constructor({ config, userData = null, workspace = null, quiet = false } = {}) {
    this.config = config
    this.quiet = quiet
    this.userData = userData
    this.workspace = workspace
    this.store = new Store(config.dataDir || DATA_DIR)
    this.server = null
    this.port = null
    this.startedAt = Date.now()
    this.scanPromise = null
    this.lastDigestAt = 0
    this.timers = []
    this.sseClients = new Set()
    this.errors = []
    this.probe = null
    this.scanSummary = null
    this.logFile = null
  }

  log(message) {
    if (!this.quiet) console.log(`[snitch] ${message}`)
  }

  recordError(message) {
    this.errors.push({ at: Date.now(), message: String(message).slice(0, 500) })
    if (this.errors.length > 50) this.errors.shift()
    this.log(`error: ${message}`)
  }

  async start() {
    await fs.mkdir(DATA_DIR, { recursive: true })
    await fs.mkdir(OUT_DIR, { recursive: true })
    await this.store.load()
    this.userData = this.config.userData || this.userData || detectUserDataDir() || null
    this.workspace =
      this.config.workspace || this.workspace || (await detectWorkspace(this.userData)) || null
    this.logFile = detectLogFile(this.userData)
    if (this.userData) this.config.userData = this.userData
    if (this.workspace) this.config.workspace = this.workspace

    this.store.setMeta({
      sources: {
        userData: this.userData,
        workspace: this.workspace,
        exchangeDir: exchangesDir(this.userData),
        framesDir: framesDir(this.userData),
        logFile: this.logFile,
        snitchRoot: SNITCH_ROOT
      }
    })

    this.probe = new ProbeManager({
      config: this.config,
      userData: this.userData,
      log: (message) => this.log(message),
      onCdp: (kind, payload) => this.receive({ ...payload, kind, at: Date.now() }),
      onBuffered: (payload) => this.receive(payload),
      onStatus: (status) => {
        this.store.setProbe({
          attached: status.attached,
          reason: status.reason,
          port: status.port,
          target: status.target?.url ?? status.target ?? null,
          lastAttemptAt: status.attempts ? Date.now() : this.store.meta.probe?.lastAttemptAt,
          lastInjectAt: status.lastInjectAt ?? this.store.meta.probe?.lastInjectAt ?? null
        })
        this.broadcast('probe', {
          attached: status.attached,
          reason: status.reason,
          port: status.port
        })
      }
    })

    this.server = createServer((req, res) => {
      this.handle(req, res).catch((error) => {
        this.recordError(`${req.method} ${req.url}: ${error.stack ?? error.message}`)
        if (!res.headersSent) sendJson(res, 500, { error: error.message })
        else res.end()
      })
    })

    await new Promise((resolveListen, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.config.port, this.config.host, () => {
        this.port = this.server.address().port
        resolveListen()
      })
    })

    this.startTimers()
    await this.scan({ initial: true })
    this.log(
      `панель: http://${this.config.host}:${this.port} · профиль: ${this.userData ?? 'не найден'} · папка: ${
        this.workspace ?? 'не открыта'
      }`
    )
    return this
  }

  startTimers() {
    const scanMs = Math.max(1_000, this.config.scanIntervalMs ?? 3_000)
    this.timers.push(setInterval(() => void this.scan().catch(() => {}), scanMs))
    this.timers.push(
      setInterval(() => {
        this.store
          .flush()
          .catch((error) => this.recordError(`flush: ${error.message}`))
      }, 5_000)
    )
    this.timers.push(
      setInterval(() => {
        if (!this.config.live?.enabled) return
        void this.probe?.tick().catch((error) => this.recordError(`probe: ${error.message}`))
      }, PROBE_TICK_MS)
    )
    this.timers.push(
      setInterval(() => {
        try {
          detectStalls(this.store, Date.now(), this.config.stale ?? {})
        } catch (error) {
          this.recordError(`stalls: ${error.message}`)
        }
      }, STALL_TICK_MS)
    )
    const minutes = Number(this.config.autoDigestMinutes) || 0
    if (minutes > 0) {
      this.timers.push(
        setInterval(
          () => {
            void this.writeDigest().catch((error) => this.recordError(`digest: ${error.message}`))
          },
          minutes * 60_000
        )
      )
    }
  }

  async scan({ initial = false } = {}) {
    if (this.scanPromise) return this.scanPromise
    this.scanPromise = (async () => {
      const summary = await collectSources(this.store, {
        userData: this.userData,
        workspace: this.workspace,
        logFile: this.logFile,
        doRedact: this.config.redact !== false,
        retention: this.config.retention
      })
      try {
        detectStalls(this.store, Date.now(), this.config.stale ?? {})
      } catch {
        // A stale check is advisory.
      }
      this.scanSummary = summary
      this.store.setMeta({ lastScan: summary })
      await this.store.flush()
      if (initial || Date.now() - this.lastDigestAt > 60_000) {
        this.lastDigestAt = Date.now()
        await this.writeDigest().catch(() => {})
      }
      if (summary.newRuns || summary.updatedRuns || summary.logLines || summary.frames) {
        this.broadcast('scan', {
          at: summary.at,
          newRuns: summary.newRuns,
          updatedRuns: summary.updatedRuns,
          logLines: summary.logLines,
          frames: summary.frames
        })
      }
      return summary
    })().finally(() => {
      this.scanPromise = null
    })
    return this.scanPromise
  }

  receive(payload) {
    try {
      if (!payload || typeof payload !== 'object') return null
      return applyProbePayload(this.store, payload, {
        doRedact: this.config.redact !== false,
        terminalFeed: this.config.live?.terminalFeed !== false,
        port: this.port
      })
    } catch (error) {
      this.recordError(`probe payload: ${error.message}`)
      return null
    }
  }

  async writeDigest(hours = 24) {
    const result = await writeDigest(this.store, { hours, outDir: OUT_DIR })
    this.broadcast('digest', { at: Date.now() })
    return result
  }

  broadcast(kind, payload) {
    const data = `event: ${kind}\ndata: ${JSON.stringify(payload ?? {})}\n\n`
    for (const res of this.sseClients) {
      try {
        res.write(data)
      } catch {
        this.sseClients.delete(res)
      }
    }
  }

  async handle(req, res) {
    if (!isLoopbackHost(req)) {
      sendJson(res, 403, { error: 'Snitch принимает запросы только с loopback-адреса' })
      return
    }
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
    const pathname = decodeURIComponent(url.pathname)

    if (pathname === '/ingest') {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      try {
        const body = await readBody(req)
        const payload = JSON.parse(body)
        this.receive(payload)
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*' })
        res.end()
      } catch (error) {
        this.recordError(`ingest: ${error.message}`)
        res.writeHead(400, { 'Access-Control-Allow-Origin': '*' })
        res.end()
      }
      return
    }

    if (pathname.startsWith('/api/')) {
      await this.handleApi(req, res, url, pathname)
      return
    }

    await this.serveStatic(req, res, pathname)
  }

  async handleApi(req, res, url, pathname) {
    if (req.method === 'POST' && !isSameOrigin(req)) {
      sendJson(res, 403, { error: 'чужой Origin' })
      return
    }
    const params = queryOf(url)
    const hours = Math.min(Math.max(numberParam(params.hours, 24), 1), 24 * 30)
    const runs = () => this.store.listRuns()

    if (pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        version: VERSION,
        startedAt: this.startedAt,
        uptimeMs: Date.now() - this.startedAt,
        port: this.port,
        probe: this.probe?.snapshot() ?? null,
        stats: this.store.stats(),
        lastScan: this.scanSummary
      })
      return
    }

    if (pathname === '/api/overview' && req.method === 'GET') {
      const overview = computeOverview(this.store, { hours })
      sendJson(res, 200, {
        ...overview,
        app: {
          version: VERSION,
          startedAt: this.startedAt,
          port: this.port,
          host: this.config.host,
          scanning: this.scanPromise != null,
          lastScan: this.scanSummary,
          config: {
            live: this.config.live?.enabled !== false,
            host: this.config.host,
            port: this.port,
            redact: this.config.redact !== false
          }
        }
      })
      return
    }

    if (pathname === '/api/meta' && req.method === 'GET') {
      sendJson(res, 200, {
        meta: safeMeta(this.store.meta),
        stats: this.store.stats(),
        storage: {
          dataDir: DATA_DIR,
          outDir: OUT_DIR,
          stateFile: this.store.file,
          stateBytes: statSafe(this.store.file)?.size ?? null
        }
      })
      return
    }

    if (pathname === '/api/diagnostics' && req.method === 'GET') {
      const counts = await this.countSources()
      sendJson(res, 200, {
        version: VERSION,
        node: process.version,
        platform: `${process.platform} ${process.arch}`,
        startedAt: this.startedAt,
        uptimeMs: Date.now() - this.startedAt,
        paths: {
          snitchRoot: SNITCH_ROOT,
          dataDir: DATA_DIR,
          outDir: OUT_DIR,
          publicDir: PUBLIC_DIR,
          userData: this.userData,
          workspace: this.workspace,
          exchanges: exchangesDir(this.userData),
          frames: framesDir(this.userData),
          log: this.logFile,
          mcp: mcpFile(this.userData),
          state: this.store.file
        },
        counts,
        lastScan: this.scanSummary,
        probe: {
          ...(this.probe?.snapshot() ?? {}),
          detectedPort: detectDevToolsPort(this.userData),
          configuredPorts: this.config.live?.ports ?? [],
          meta: this.store.meta.probe ?? {}
        },
        config: {
          scanIntervalMs: this.config.scanIntervalMs,
          retention: this.config.retention,
          stale: this.config.stale,
          redact: this.config.redact !== false,
          live: this.config.live,
          autoDigestMinutes: this.config.autoDigestMinutes
        },
        errors: this.errors.slice(-20),
        stats: this.store.stats()
      })
      return
    }

    if (pathname === '/api/runs' && req.method === 'GET') {
      const limit = Math.min(Math.max(numberParam(params.limit, 100), 1), 500)
      const status = params.status || null
      const source = params.source || null
      const query = (params.query || '').toLowerCase().trim()
      const since = hours ? Date.now() - hours * 3_600_000 : 0
      let items = runs()
      if (since) items = items.filter((run) => (run.startedAt ?? 0) >= since)
      if (status === 'live') items = items.filter((run) => run.live)
      else if (status) items = items.filter((run) => run.status === status)
      if (source) items = items.filter((run) => run.source === source)
      if (query) {
        items = items.filter((run) =>
          `${run.user ?? ''} ${run.answer ?? ''} ${run.model ?? ''} ${run.provider ?? ''} ${
            run.error ?? ''
          }`
            .toLowerCase()
            .includes(query)
        )
      }
      sendJson(res, 200, {
        total: items.length,
        runs: items.slice(0, limit).map(slimRun)
      })
      return
    }

    if (pathname.startsWith('/api/runs/') && req.method === 'GET') {
      const rest = pathname.slice('/api/runs/'.length)
      const [id, sub] = rest.split('/')
      const decoded = decodeURIComponent(id ?? '')
      let run =
        this.store.getRun(decoded) ??
        runs().find((item) => item.requestId === decoded) ??
        runs().find((item) => String(item.id).startsWith(decoded))
      if (!run) {
        sendJson(res, 404, { error: 'запуск не найден' })
        return
      }
      if (sub === 'archive') {
        if (!run.archiveFile) {
          sendJson(res, 404, { error: 'архив для этого запуска не сохранён' })
          return
        }
        const absolute = resolve(SNITCH_ROOT, run.archiveFile)
        if (!absolute.startsWith(resolve(DATA_DIR) + sep)) {
          sendJson(res, 403, { error: 'путь архива вне данных Snitch' })
          return
        }
        const raw = await fs.readFile(absolute, 'utf8').catch(() => null)
        if (raw == null) {
          sendJson(res, 404, { error: 'файл архива не читается' })
          return
        }
        sendText(res, 200, raw, 'application/json; charset=utf-8', {
          'Content-Disposition': `inline; filename="${run.id}.json"`
        })
        return
      }
      if (sub) {
        sendJson(res, 404, { error: 'неизвестный подресурс' })
        return
      }
      sendJson(res, 200, { run, incidentIds: this.store.incidents({ runId: run.id, limit: 100 }).map((item) => item.id) })
      return
    }

    if (pathname === '/api/events' && req.method === 'GET') {
      const events = this.store.events({
        limit: Math.min(Math.max(numberParam(params.limit, 200), 1), 1_000),
        before: params.before ? Number(params.before) : null,
        kind: params.kind || null,
        level: params.level || null,
        runId: params.runId || null,
        query: params.query || ''
      })
      sendJson(res, 200, { total: this.store.state.events.length, events })
      return
    }

    if (pathname === '/api/incidents' && req.method === 'GET') {
      const incidents = this.store.incidents({
        limit: Math.min(Math.max(numberParam(params.limit, 200), 1), 1_000),
        severity: params.severity || null,
        kind: params.kind || null,
        runId: params.runId || null,
        since: params.since ? Number(params.since) : null
      })
      sendJson(res, 200, { total: this.store.state.incidents.length, incidents })
      return
    }

    if (pathname === '/api/tools' && req.method === 'GET') {
      const since = Date.now() - hours * 3_600_000
      const inWindow = runs().filter((run) => (run.startedAt ?? 0) >= since)
      sendJson(res, 200, { hours, tools: computeToolStats(inWindow) })
      return
    }

    if (pathname === '/api/files' && req.method === 'GET') {
      const since = Date.now() - hours * 3_600_000
      const inWindow = runs().filter((run) => (run.startedAt ?? 0) >= since)
      sendJson(res, 200, {
        hours,
        files: computeFileStats(inWindow).slice(0, Math.min(numberParam(params.limit, 200), 1_000))
      })
      return
    }

    if (pathname === '/api/commands' && req.method === 'GET') {
      const since = Date.now() - hours * 3_600_000
      const inWindow = runs().filter((run) => (run.startedAt ?? 0) >= since)
      sendJson(res, 200, {
        hours,
        commands: computeCommandStats(inWindow).slice(
          0,
          Math.min(numberParam(params.limit, 200), 1_000)
        )
      })
      return
    }

    if (pathname === '/api/mcp' && req.method === 'GET') {
      sendJson(res, 200, {
        configured: this.store.meta.mcpServers ?? [],
        runtime: this.store.meta.mcpRuntime ?? [],
        events: this.store.events({ kind: 'mcp', limit: 100 }).reverse()
      })
      return
    }

    if (pathname === '/api/probe' && req.method === 'GET') {
      sendJson(res, 200, {
        live: this.probe?.snapshot() ?? null,
        meta: this.store.meta.probe ?? {},
        enabled: this.config.live?.enabled !== false,
        ports: this.config.live?.ports ?? [],
        detectedPort: detectDevToolsPort(this.userData),
        servers: this.store.meta.servers ?? [],
        settings: this.store.meta.settings ?? null
      })
      return
    }

    if (pathname === '/api/brief' && req.method === 'GET') {
      const markdown = buildAiBrief(this.store, { hours })
      const download = params.download === '1'
      sendText(res, 200, markdown, 'text/markdown; charset=utf-8', download
        ? { 'Content-Disposition': 'attachment; filename="SNITCH-BRIEF.md"' }
        : {})
      return
    }

    if (pathname === '/api/digest') {
      if (req.method === 'GET') {
        const format = params.format || 'json'
        if (format === 'md' || format === 'markdown') {
          const { markdown } = buildDigest(this.store, { hours })
          sendText(res, 200, markdown, 'text/markdown; charset=utf-8')
          return
        }
        sendJson(res, 200, buildDigest(this.store, { hours }).json)
        return
      }
      if (req.method === 'POST') {
        const result = await this.writeDigest(hours)
        sendJson(res, 200, {
          ok: true,
          markdownPath: result.markdownPath,
          jsonPath: result.jsonPath,
          at: Date.now()
        })
        return
      }
    }

    if (pathname === '/api/export' && req.method === 'GET') {
      const body = JSON.stringify(
        {
          exportedAt: Date.now(),
          version: VERSION,
          meta: safeMeta(this.store.meta),
          runs: runs(),
          events: this.store.state.events,
          incidents: this.store.state.incidents
        },
        null,
        1
      )
      sendText(res, 200, body, 'application/json; charset=utf-8', {
        'Content-Disposition': `attachment; filename="snitch-export-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`
      })
      return
    }

    if (pathname === '/api/stream' && req.method === 'GET') {
      this.openStream(req, res)
      return
    }

    if (pathname === '/api/scan' && req.method === 'POST') {
      const summary = await this.scan()
      sendJson(res, 200, { ok: true, summary })
      return
    }

    if (pathname === '/api/attach' && req.method === 'POST') {
      const attached = await this.probe?.attach({ force: true })
      sendJson(res, 200, { ok: true, attached, probe: this.probe?.snapshot() ?? null })
      return
    }

    sendJson(res, 404, { error: `неизвестный маршрут ${pathname}` })
  }

  openStream(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    res.write(
      `event: hello\ndata: ${JSON.stringify({
        at: Date.now(),
        version: VERSION,
        probe: this.probe?.snapshot() ?? null,
        stats: this.store.stats()
      })}\n\n`
    )
    this.sseClients.add(res)
    const heartbeat = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`)
      } catch {
        // closed
      }
    }, SSE_HEARTBEAT_MS)
    req.on('close', () => {
      clearInterval(heartbeat)
      this.sseClients.delete(res)
    })
  }

  async serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method not allowed' })
      return
    }
    const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
    if (relativePath.includes('..') || relativePath.startsWith('.')) {
      sendJson(res, 404, { error: 'not found' })
      return
    }
    const absolute = resolve(PUBLIC_DIR, relativePath)
    if (!absolute.startsWith(resolve(PUBLIC_DIR) + sep) && absolute !== resolve(PUBLIC_DIR)) {
      sendJson(res, 404, { error: 'not found' })
      return
    }
    const stat = await fs.stat(absolute).catch(() => null)
    if (!stat?.isFile()) {
      sendJson(res, 404, { error: 'not found' })
      return
    }
    const type = MIME[extname(absolute).toLowerCase()] ?? 'application/octet-stream'
    const headers = {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'"
    }
    res.writeHead(200, headers)
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(absolute).pipe(res)
  }

  async countSources() {
    const exchanges = exchangesDir(this.userData)
    const archive = join(DATA_DIR, 'archive', 'exchanges')
    const frames = framesDir(this.userData)
    const list = async (dir) => {
      if (!dir) return { files: 0, bytes: 0 }
      const names = await fs.readdir(dir).catch(() => [])
      let bytes = 0
      let files = 0
      for (const name of names) {
        if (name === 'latest.json') continue
        const stat = statSafe(join(dir, name))
        if (stat?.isFile()) {
          files += 1
          bytes += stat.size
        }
      }
      return { files, bytes }
    }
    return {
      exchanges: await list(exchanges),
      archived: await list(archive),
      frames: (await list(frames)).files,
      log: this.logFile
        ? { path: this.logFile, bytes: statSafe(this.logFile)?.size ?? null }
        : null,
      state: {
        bytes: statSafe(this.store.file)?.size ?? null,
        runs: this.store.listRuns().length,
        events: this.store.state.events.length,
        incidents: this.store.state.incidents.length
      }
    }
  }

  apiUrl(path = '/') {
    return `http://${this.config.host}:${this.port}${path}`
  }

  async close() {
    for (const timer of this.timers) clearInterval(timer)
    this.timers = []
    for (const res of this.sseClients) {
      try {
        res.end()
      } catch {
        // closed
      }
    }
    this.sseClients.clear()
    this.probe?.stop()
    await this.store.flush().catch(() => {})
    if (this.server) {
      await new Promise((resolveClose) => this.server.close(resolveClose))
      this.server = null
    }
    // Give any debounced write a chance to finish before tests unlink the folder.
    await sleep(50)
  }
}

export async function startSnitch(options = {}) {
  const server = new SnitchServer(options)
  await server.start()
  return server
}

export function openBrowser(url) {
  const command =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore' })
    child.unref()
  } catch {
    // The URL is printed anyway.
  }
}
