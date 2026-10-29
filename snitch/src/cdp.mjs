/**
 * The IDE already exposes a DevTools endpoint when it is started with
 * RELAXCODE_DEBUG_PORT (or EASYCODE_DEBUG_PORT). Snitch connects to that
 * endpoint, listens to console/network events and evaluates one small probe in
 * the renderer. No source file of the IDE is touched.
 */

const PAGE_TIMEOUT_MS = 1_200

async function fetchJson(url, timeoutMs = PAGE_TIMEOUT_MS) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

function targetScore(target) {
  const url = String(target.url ?? '')
  const title = String(target.title ?? '')
  let score = 0
  if (/localhost:5173|127\.0\.0\.1:5173/.test(url)) score += 10
  if (/RelaxCode/i.test(title)) score += 6
  if (url.startsWith('file:')) score += 3
  if (url.startsWith('devtools:')) score -= 20
  return score
}

/** Finds the IDE's renderer page on one of the configured debug ports. */
export async function discoverTarget({ ports = [], preferredPort = null } = {}) {
  const unique = [...new Set([preferredPort, ...ports].filter((port) => Number.isInteger(port) && port > 0))]
  for (const port of unique) {
    const list = await fetchJson(`http://127.0.0.1:${port}/json/list`)
    if (!Array.isArray(list)) continue
    const pages = list
      .filter((target) => target?.type === 'page' && target.webSocketDebuggerUrl)
      .sort((a, b) => targetScore(b) - targetScore(a))
    const page = pages[0]
    if (!page) continue
    return {
      port,
      target: {
        id: page.id,
        title: page.title ?? '',
        url: page.url ?? '',
        webSocketDebuggerUrl: page.webSocketDebuggerUrl
      }
    }
  }
  return null
}

export class CdpConnection {
  constructor(webSocketUrl, handlers = {}) {
    this.webSocketUrl = webSocketUrl
    this.handlers = handlers
    this.ws = null
    this.nextId = 1
    this.pending = new Map()
    this.closed = false
    this.requests = new Map()
  }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false
      const ws = new WebSocket(this.webSocketUrl)
      this.ws = ws
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        try {
          ws.close()
        } catch {
          // ignore
        }
        reject(new Error('CDP connect timeout'))
      }, 5_000)

      ws.addEventListener('open', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(this)
      })
      ws.addEventListener('message', (event) => this.onMessage(event))
      ws.addEventListener('error', () => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(new Error('CDP connection failed'))
        }
      })
      ws.addEventListener('close', () => {
        this.closed = true
        for (const { reject: rejectPending } of this.pending.values()) {
          rejectPending(new Error('CDP connection closed'))
        }
        this.pending.clear()
        this.handlers.onClose?.()
      })
    })
  }

  onMessage(event) {
    let message = null
    try {
      message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
    } catch {
      return
    }
    if (message.id != null) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message ?? 'CDP error'))
      else pending.resolve(message.result)
      return
    }
    if (!message.method) return
    try {
      this.handlers.onEvent?.(message.method, message.params ?? {}, this)
    } catch {
      // A handler failure must not take the connection down.
    }
  }

  send(method, params = {}, timeoutMs = 10_000) {
    if (this.closed || !this.ws) return Promise.reject(new Error('CDP is not connected'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP ${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      })
      try {
        this.ws.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
      allowUnsafeEvalBlockedByCSP: true
    })
    if (result?.exceptionDetails) {
      const message =
        result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        'evaluation failed'
      throw new Error(message)
    }
    return result?.result?.value
  }

  async enable({ network = true } = {}) {
    await Promise.allSettled([
      this.send('Runtime.enable'),
      this.send('Page.enable'),
      this.send('Log.enable'),
      network ? this.send('Network.enable') : Promise.resolve()
    ])
  }

  close() {
    this.closed = true
    try {
      this.ws?.close()
    } catch {
      // already closed
    }
    this.ws = null
  }
}

export function summarizeConsoleParams(params) {
  const args = Array.isArray(params.args) ? params.args : []
  const text = args
    .map((arg) => {
      if (arg?.value !== undefined) {
        return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value)
      }
      return arg?.description ?? arg?.unserializableValue ?? arg?.type ?? ''
    })
    .filter(Boolean)
    .join(' ')
  return {
    level: params.type === 'warning' ? 'warning' : 'error',
    text: text.slice(0, 4_000),
    url: params.stackTrace?.callFrames?.[0]?.url ?? null,
    line: params.stackTrace?.callFrames?.[0]?.lineNumber ?? null
  }
}

export function summarizeException(params) {
  const details = params.exceptionDetails ?? {}
  const description = details.exception?.description ?? details.text ?? 'Исключение в окне'
  return {
    message: String(description).split('\n')[0].slice(0, 1_000),
    stack: String(description).slice(0, 4_000)
  }
}

export function summarizeLogEntry(params) {
  const entry = params.entry ?? {}
  return {
    level: entry.level === 'error' ? 'error' : 'warning',
    text: String(entry.text ?? '').slice(0, 4_000),
    url: entry.url ?? null,
    line: entry.lineNumber ?? null
  }
}

export function networkTarget(method, params, requests) {
  if (method === 'Network.requestWillBeSent') {
    const url = String(params.request?.url ?? '')
    if (!/^https?:/i.test(url)) return null
    requests.set(params.requestId, { at: Date.now(), method: params.request?.method ?? 'GET', url })
    if (requests.size > 500) {
      const oldest = requests.keys().next().value
      if (oldest) requests.delete(oldest)
    }
    return null
  }
  if (method === 'Network.responseReceived') {
    const status = Number(params.response?.status) || 0
    if (status < 400) {
      requests.delete(params.requestId)
      return null
    }
    const url = String(params.response?.url ?? '')
    if (!/^https?:/i.test(url)) return null
    const started = requests.get(params.requestId)
    requests.delete(params.requestId)
    return {
      url,
      status,
      method: started?.method ?? 'GET',
      durationMs: started ? Date.now() - started.at : null,
      failed: false
    }
  }
  if (method === 'Network.loadingFailed') {
    const errorText = String(params.errorText ?? '')
    if (/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(errorText)) {
      requests.delete(params.requestId)
      return null
    }
    const started = requests.get(params.requestId)
    requests.delete(params.requestId)
    if (!started) return null
    return {
      url: started.url,
      status: null,
      method: started.method,
      durationMs: Date.now() - started.at,
      failed: true,
      error: errorText
    }
  }
  return null
}
