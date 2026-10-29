import {
  CdpConnection,
  discoverTarget,
  networkTarget,
  summarizeConsoleParams,
  summarizeException,
  summarizeLogEntry
} from './cdp.mjs'
import { detectDevToolsPort } from './paths.mjs'

/**
 * This function is serialized with `toString()` and evaluated inside the IDE's
 * renderer. It must be completely self-contained: no imports, no outer
 * variables. It only *subscribes* to APIs the preload already exposes.
 */
function probeMain(cfg) {
  if (window.__snitchProbeInstalled) return 'already'
  window.__snitchProbeInstalled = true

  const cap = (value, limit) => {
    const text = typeof value === 'string' ? value : value == null ? '' : String(value)
    return text.length > limit ? text.slice(0, limit) + '…' : text
  }
  // HTTP is the fast path. If the page's CSP blocks loopback requests, events
  // go into localStorage instead and the collector drains them over CDP.
  const bufferKey = 'snitch.buffer.v1'
  let buffered = false
  const pushBuffer = (body) => {
    try {
      const list = JSON.parse(localStorage.getItem(bufferKey) || '[]')
      list.push(body)
      localStorage.setItem(bufferKey, JSON.stringify(list.slice(-300)))
    } catch {
      // Quota or disabled storage: the event is simply lost.
    }
  }
  const post = (kind, payload) => {
    let body = ''
    try {
      body = JSON.stringify({ kind, at: Date.now(), ...(payload || {}) })
      if (buffered) {
        pushBuffer(body)
        return
      }
      fetch(cfg.url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body
      }).catch(() => {
        buffered = true
        pushBuffer(body)
      })
    } catch {
      // The page is going away; nothing to do.
    }
  }
  window.__snitchDrain = () => {
    try {
      const raw = localStorage.getItem(bufferKey)
      localStorage.removeItem(bufferKey)
      return raw
    } catch {
      return null
    }
  }

  const aggregates = new Map()
  let flushTimer = null
  const flushAggregates = () => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    for (const [requestId, item] of aggregates) {
      post('chat-aggregate', { requestId, ...item })
    }
    aggregates.clear()
  }
  const scheduleFlush = () => {
    if (flushTimer) return
    flushTimer = setTimeout(flushAggregates, 1500)
  }
  const aggregate = (requestId, field, text) => {
    if (!requestId) return
    const item =
      aggregates.get(requestId) || { deltaChars: 0, reasoningChars: 0, preview: '' }
    item[field] += String(text || '').length
    if (field === 'deltaChars') item.preview = cap(`${item.preview}${text}`, 600)
    aggregates.set(requestId, item)
    scheduleFlush()
  }

  const sentContext = new Set()
  const readContext = () => {
    try {
      const raw =
        localStorage.getItem('relaxcode.chats.v1') || localStorage.getItem('easycode.chats.v1')
      if (!raw) return null
      const data = JSON.parse(raw)
      if (!data || !Array.isArray(data.chats)) return null
      const chat = data.chats.find((item) => item.id === data.activeChatId) || data.chats[0]
      if (!chat) return null
      const lastUser = [...(chat.messages || [])].reverse().find((item) => item.role === 'user')
      const text = ((lastUser && lastUser.parts) || [])
        .filter((part) => part && part.kind === 'text')
        .map((part) => part.text)
        .join('\n')
      return {
        user: cap(text, 4000),
        title: cap(chat.title || '', 160),
        mode: chat.mode || null,
        thinking: chat.thinking || null
      }
    } catch {
      return null
    }
  }

  const packMeta = (meta) => {
    if (!meta || typeof meta !== 'object') return meta
    switch (meta.kind) {
      case 'image':
        return {
          kind: 'image',
          alt: cap(meta.alt, 200),
          caption: cap(meta.caption, 200),
          bytes: meta.bytes,
          width: meta.width,
          height: meta.height
        }
      case 'figure':
        return {
          kind: 'figure',
          title: cap(meta.title, 200),
          results: Array.isArray(meta.results) ? meta.results.slice(0, 8) : [],
          warnings: Array.isArray(meta.warnings) ? meta.warnings.slice(0, 5) : []
        }
      case 'diff':
        return { kind: 'diff', file: meta.file, patch: cap(meta.patch, 2000) }
      case 'timelapse':
        return {
          kind: 'timelapse',
          frames: Array.isArray(meta.frames) ? meta.frames.length : 0,
          intervalSec: meta.intervalSec
        }
      case 'diagram':
        return { kind: 'diagram', title: cap(meta.title, 200), caption: cap(meta.caption, 200) }
      case 'table':
        return {
          kind: 'table',
          title: cap(meta.title, 200),
          columns: Array.isArray(meta.columns) ? meta.columns.slice(0, 12) : [],
          rows: Array.isArray(meta.rows) ? meta.rows.slice(0, 5) : []
        }
      case 'websearch':
        return {
          kind: 'websearch',
          query: cap(meta.query, 200),
          sources: Array.isArray(meta.sources)
            ? meta.sources.slice(0, 8).map((source) => ({
                n: source.n,
                title: cap(source.title, 200),
                url: source.url
              }))
            : []
        }
      default:
        return { kind: meta.kind || 'other' }
    }
  }

  const packEvent = (event) => {
    if (!event || typeof event !== 'object') return event
    const out = { ...event }
    if (out.detail) out.detail = cap(out.detail, 4000)
    if (out.args) out.args = cap(out.args, 3000)
    if (out.text) out.text = cap(out.text, 4000)
    if (out.meta) out.meta = packMeta(out.meta)
    if (out.frames) delete out.frames
    return out
  }

  const api = window.relaxcode
  if (!api || typeof api !== 'object') {
    window.__snitchProbeInstalled = false
    return 'no-api'
  }

  const installers = []
  const on = (target, method, handler) => {
    try {
      if (target && typeof target[method] === 'function') {
        const off = target[method](handler)
        if (typeof off === 'function') installers.push(off)
      }
    } catch {
      // An older preload may not have this channel.
    }
  }

  on(api.chat, 'onEvent', (event) => {
    if (!event || typeof event !== 'object') return
    if (event.requestId && !sentContext.has(event.requestId)) {
      sentContext.add(event.requestId)
      if (sentContext.size > 40) sentContext.delete(sentContext.values().next().value)
      const context = readContext()
      if (context) post('chat-context', { requestId: event.requestId, ...context })
    }
    if (event.type === 'delta') {
      aggregate(event.requestId, 'deltaChars', event.text || '')
      return
    }
    if (event.type === 'reasoning') {
      aggregate(event.requestId, 'reasoningChars', event.text || '')
      return
    }
    if (event.type === 'done' || event.type === 'error') flushAggregates()
    post('chat-event', { event: packEvent(event) })
  })

  on(api.workspace, 'onChanged', (dirs) => {
    post('workspace-changed', { dirs: Array.isArray(dirs) ? dirs.slice(0, 30) : [] })
  })

  on(api.mcp, 'onEvent', (event) => {
    if (!event || typeof event !== 'object') return
    if (event.type === 'frame') {
      post('mcp', {
        event: {
          type: 'frame',
          server: event.server,
          caption: cap(event.caption, 300),
          at: event.at,
          hasImage: typeof event.dataUrl === 'string' && event.dataUrl.length > 0
        }
      })
      return
    }
    if (event.type === 'state') {
      post('mcp', {
        event: {
          type: 'state',
          states: (event.states || []).map((state) => ({
            name: state.name,
            status: state.status,
            error: cap(state.error, 300),
            tools: Array.isArray(state.tools) ? state.tools.length : 0,
            pid: state.pid ?? null,
            restarts: state.restarts ?? 0
          }))
        }
      })
      return
    }
    post('mcp', {
      event: {
        type: event.type,
        name: event.name,
        line: cap(event.line, 600),
        level: event.level
      }
    })
  })

  if (cfg.terminalFeed) {
    on(api.term, 'onOutput', (event) => {
      if (!event || event.id !== 'agent' || !event.text) return
      post('terminal', { text: cap(event.text, 2000) })
    })
  }

  window.addEventListener('error', (event) => {
    post('renderer-error', {
      message: cap(event.message, 1000),
      stack: cap(event.error && event.error.stack, 4000),
      source: event.filename,
      line: event.lineno
    })
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    post('renderer-error', {
      message: cap((reason && reason.message) || String(reason), 1000),
      stack: cap(reason && reason.stack, 4000),
      source: 'unhandledrejection'
    })
  })

  let lastServers = ''
  const pollServers = () => {
    try {
      if (!api.servers || typeof api.servers.list !== 'function') return
      Promise.resolve(api.servers.list())
        .then((list) => {
          const key = JSON.stringify(list)
          if (key === lastServers) return
          lastServers = key
          post('servers', { processes: list })
        })
        .catch(() => {})
    } catch {
      // ignore
    }
  }
  pollServers()
  setInterval(pollServers, 5000)

  let lastSettings = ''
  const pollSettings = () => {
    try {
      if (!api.settings || typeof api.settings.get !== 'function') return
      Promise.resolve(api.settings.get())
        .then((settings) => {
          if (!settings) return
          const snapshot = {
            approvalMode: settings.approvalMode,
            model: settings.model,
            providerName:
              (settings.providers || []).find((item) => item.id === settings.activeProviderId)
                ?.name || null,
            logLevel: settings.notifications && settings.notifications.logLevel,
            uiLanguage: settings.ui && settings.ui.language,
            baseUrl: settings.baseUrl
          }
          const key = JSON.stringify(snapshot)
          if (key === lastSettings) return
          lastSettings = key
          post('settings', { settings: snapshot })
        })
        .catch(() => {})
    } catch {
      // ignore
    }
  }
  pollSettings()
  setInterval(pollSettings, 30000)

  setInterval(() => post('heartbeat', {}), 10000)
  post('probe-ready', {
    href: location.href,
    userAgent: navigator.userAgent,
    version: cfg.version
  })

  window.__snitchProbeUninstall = () => {
    for (const off of installers) {
      try {
        off()
      } catch {
        // ignore
      }
    }
    installers.length = 0
    window.__snitchProbeInstalled = false
  }
  return 'installed'
}

export function buildProbeScript({ url, version = '0.1.0', terminalFeed = true }) {
  const cfg = JSON.stringify({ url, version, terminalFeed })
  return `(${probeMain.toString()})(${cfg})`
}

export class ProbeManager {
  constructor({ config, userData, onCdp = null, onBuffered = null, onStatus = null, log = null }) {
    this.config = config
    this.userData = userData
    this.onCdp = onCdp
    this.onBuffered = onBuffered
    this.onStatus = onStatus
    this.log = log ?? (() => {})
    this.connection = null
    this.target = null
    this.lastAttemptAt = 0
    this.lastInjectAt = 0
    this.injectionState = 'idle'
    this.status = {
      attached: false,
      port: null,
      target: null,
      reason: 'живой режим ещё не подключался',
      lastInjectAt: null,
      attempts: 0
    }
  }

  setConfig(config, userData = this.userData) {
    this.config = config
    this.userData = userData
  }

  snapshot() {
    return { ...this.status, connection: this.connection != null }
  }

  publish(reason = null) {
    if (reason) this.status.reason = reason
    this.onStatus?.(this.snapshot())
  }

  async discover() {
    const port = detectDevToolsPort(this.userData)
    return discoverTarget({ ports: this.config.live?.ports ?? [], preferredPort: port })
  }

  async attach({ force = false } = {}) {
    if (this.connection) return true
    if (!this.config.live?.enabled) {
      this.publish('живой режим выключен в конфиге')
      return false
    }
    const now = Date.now()
    if (!force && now - this.lastAttemptAt < 6_000) return false
    this.lastAttemptAt = now
    this.status.attempts += 1
    const found = await this.discover()
    if (!found) {
      this.publish('IDE с открытым DevTools-портом не найден (нужен RELAXCODE_DEBUG_PORT)')
      this.onStatus?.(this.snapshot())
      return false
    }
    try {
      const connection = new CdpConnection(found.target.webSocketDebuggerUrl, {
        onEvent: (method, params) => this.handleEvent(method, params),
        onClose: () => {
          this.connection = null
          this.status.attached = false
          this.publish('соединение с окном IDE закрылось')
        }
      })
      await connection.connect()
      await connection.enable({ network: true })
      this.connection = connection
      this.target = found.target
      this.status.port = found.port
      this.status.target = {
        title: found.target.title,
        url: found.target.url
      }
      this.status.attached = true
      const state = await this.inject()
      await this.drainBuffer()
      this.publish(
        state === 'installed'
          ? 'зонд установлен'
          : state === 'already'
            ? 'зонд уже был установлен'
            : state === 'no-api'
              ? 'окно найдено, но window.relaxcode недоступен'
              : 'зонд не установился'
      )
      this.log(`CDP attached to ${found.target.url} on port ${found.port}: ${state}`)
      return true
    } catch (error) {
      this.connection?.close()
      this.connection = null
      this.status.attached = false
      this.publish(`не удалось подключиться: ${error.message}`)
      this.onStatus?.(this.snapshot())
      return false
    }
  }

  async inject() {
    if (!this.connection) return 'no-connection'
    const port = this.status.port
    const script = buildProbeScript({
      url: `http://127.0.0.1:${port}/ingest`,
      version: this.config.version ?? '0.1.0',
      terminalFeed: this.config.live?.terminalFeed !== false
    })
    try {
      const result = await this.connection.evaluate(script)
      this.injectionState = typeof result === 'string' ? result : 'unknown'
      this.lastInjectAt = Date.now()
      this.status.lastInjectAt = this.lastInjectAt
      return this.injectionState
    } catch (error) {
      this.injectionState = `error: ${error.message}`
      this.publish(`внедрение зонда не удалось: ${error.message}`)
      return this.injectionState
    }
  }

  async ensureInjected() {
    if (!this.connection) return
    try {
      const installed = await this.connection.evaluate(
        'Boolean(window.__snitchProbeInstalled === true)'
      )
      if (!installed) await this.inject()
      await this.drainBuffer()
    } catch {
      this.connection?.close()
      this.connection = null
      this.status.attached = false
      this.publish('соединение потеряно, переподключаюсь')
    }
  }

  /** Recovers events the page could not POST (CSP, server restart, reload). */
  async drainBuffer() {
    if (!this.connection || !this.onBuffered) return
    let raw = null
    try {
      raw = await this.connection.evaluate(
        'window.__snitchDrain ? window.__snitchDrain() : null'
      )
    } catch {
      return
    }
    if (typeof raw !== 'string' || raw.length === 0) return
    let list = null
    try {
      list = JSON.parse(raw)
    } catch {
      // A torn write is dropped: the next flush writes a fresh array.
      return
    }
    if (!Array.isArray(list)) return
    for (const payload of list) {
      try {
        this.onBuffered(payload)
      } catch {
        // One bad payload must not block the rest.
      }
    }
    this.log(`drained ${list.length} buffered probe event(s)`)
  }

  handleEvent(method, params) {
    if (method === 'Runtime.exceptionThrown') {
      this.onCdp?.('exception', summarizeException(params))
      return
    }
    if (method === 'Runtime.consoleAPICalled') {
      if (!['error', 'assert', 'warning'].includes(params.type)) return
      this.onCdp?.('console', summarizeConsoleParams(params))
      return
    }
    if (method === 'Log.entryAdded') {
      const entry = summarizeLogEntry(params)
      if (entry.level === 'error' || entry.level === 'warning') this.onCdp?.('log', entry)
      return
    }
    if (method === 'Page.loadEventFired') {
      // The dev server reloads the page often; reinstall the probe after it.
      setTimeout(() => void this.ensureInjected(), 800)
      return
    }
    if (method.startsWith('Network.')) {
      const data = networkTarget(method, params, this.requests ?? (this.requests = new Map()))
      if (data) this.onCdp?.('network', data)
    }
  }

  async tick() {
    if (!this.config.live?.enabled) return
    if (!this.connection) {
      await this.attach()
      return
    }
    await this.ensureInjected()
  }

  stop() {
    this.connection?.close()
    this.connection = null
    this.status.attached = false
    this.publish('остановлено')
  }
}
