/**
 * A Base URL is typed or pasted into a text field, so it arrives malformed more
 * often than not: a whole address pasted on top of the scheme that was already
 * there (`http:/https://gen-api.ru`), no scheme at all (`proxy.gen-api.ru/v1`),
 * the endpoint from the docs instead of the API root, quotes, spaces, a
 * trailing slash. One function decides what is usable and repairs what it can.
 */

/** Endpoints people copy from the docs where the API root was meant. */
const ENDPOINT_SEGMENTS = [
  'chat/completions',
  'completions',
  'responses',
  'embeddings',
  'models',
  'images/generations',
  'audio/transcriptions',
  'audio/speech',
  'rerank'
]

const LOCAL_HOST = /^(localhost$|127\.|0\.0\.0\.0$|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fe80:|fd[0-9a-f]{2}:)/i

export type BaseUrlProblem = 'empty' | 'invalid' | 'scheme' | 'host'

export type BaseUrlResult =
  | { ok: true; value: string; fixed: boolean }
  | { ok: false; reason: BaseUrlProblem }

/** `http://localhost:11434`, `api`, `10.0.0.4:8000` — address on this machine. */
function isLocal(value: string): boolean {
  const authority = value.split('/')[0].replace(/^\[|\]$/g, '')
  const host = authority.replace(/:\d+$/, '')
  return LOCAL_HOST.test(host) || /\.local$/i.test(host) || !host.includes('.')
}

/** `…/v1/chat/completions` becomes `…/v1`: the endpoint is added back later. */
function stripEndpoint(path: string): string {
  const clean = path.replace(/\/+$/, '')
  const lower = clean.toLowerCase()
  for (const segment of ENDPOINT_SEGMENTS) {
    if (lower.endsWith(`/${segment}`)) {
      return clean.slice(0, clean.length - segment.length - 1).replace(/\/+$/, '')
    }
  }
  return clean
}

export function normalizeBaseUrl(input: string | null | undefined): BaseUrlResult {
  const raw = typeof input === 'string' ? input : ''
  // Pasted addresses drag quotes, newlines and zero-width characters along.
  let value = raw.replace(/[\u200b-\u200d\ufeff]/g, '').trim()
  value = value.replace(/^[<"'`(]+/, '').replace(/[>"'`),;]+$/, '')
  value = value.replace(/\/+$/, '')
  if (value.length === 0) return { ok: false, reason: 'empty' }
  // A space inside an address is never there on purpose: it is two things glued
  // together, and guessing which one was meant would be worse than saying so.
  if (/\s/.test(value)) return { ok: false, reason: 'invalid' }

  // A full address pasted into a field that already carried a scheme:
  // `http://https://gen-api.ru` and `http:/https://gen-api.ru`.
  for (let round = 0; round < 3; round += 1) {
    const doubled = /^https?:\/+(?=https?:\/\/)/i.exec(value)
    if (!doubled) break
    value = value.slice(doubled[0].length)
  }

  // Any other scheme is a mistake, not something to glue `https://` in front of.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) {
    return { ok: false, reason: 'scheme' }
  }

  // No scheme: assume a local address is plain http and anything else https.
  if (!/^https?:\/\//i.test(value)) {
    value = `${isLocal(value) ? 'http' : 'https'}://${value.replace(/^\/+/, '')}`
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'scheme' }
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (hostname.length === 0 || hostname.includes('..')) return { ok: false, reason: 'host' }

  // The fingerprint of a doubled address: the host is the scheme that got eaten,
  // as in `https://https//gen-api.ru`. Everything after it is the real address.
  if (hostname === 'http' || hostname === 'https') {
    const rest = `${parsed.pathname}${parsed.search}${parsed.hash}`.replace(/^\/+/, '')
    if (rest.length > 0) {
      const repaired = normalizeBaseUrl(`${parsed.protocol}//${rest}`)
      if (repaired.ok) return { ...repaired, fixed: true }
    }
    return { ok: false, reason: 'host' }
  }

  // `https://api.openai.com/v1https://gen-api.ru` — pasted at the end of a
  // prefilled field. A second address in the path is never meant as a path.
  if (parsed.pathname.includes('://')) {
    const lower = value.toLowerCase()
    const index = Math.max(lower.lastIndexOf('http://'), lower.lastIndexOf('https://'))
    if (index > 0 && !value.slice(0, index).includes('?')) {
      const repaired = normalizeBaseUrl(value.slice(index))
      if (repaired.ok) return { ...repaired, fixed: true }
    }
    return { ok: false, reason: 'host' }
  }

  // The query and hash of a Base URL mean nothing: every request appends a path.
  const result = `${parsed.origin}${stripEndpoint(parsed.pathname)}`
  return { ok: true, value: result, fixed: result !== raw.trim() }
}
