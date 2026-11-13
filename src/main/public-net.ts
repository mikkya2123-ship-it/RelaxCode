import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'
import { isPrivateHostname, safeHttpUrl } from '../shared/web-search.ts'

/**
 * Outbound downloads that must never turn into an SSRF gadget.
 *
 * The guard checks a URL before every hop (redirects are followed by hand, so
 * each new host is checked again), and the body reader stops at the byte cap
 * instead of buffering a few gigabytes first. The same helpers serve chat
 * pictures, generic file downloads and project assets.
 */

export const DOWNLOAD_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'

const MAX_REDIRECTS = 4
const FETCH_TIMEOUT_MS = 60000

/** Throws when the address is not a public http(s) host. */
export async function assertPublicUrl(rawUrl: string, signal: AbortSignal): Promise<void> {
  if (isPrivateHostname(new URL(rawUrl).hostname)) {
    throw new Error('the address is local or private')
  }
  if (signal.aborted) throw new Error('aborted')
  const hostname = new URL(rawUrl).hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname) !== 0) return
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true }).catch((error) => {
    throw new Error(`DNS lookup failed: ${error instanceof Error ? error.message : String(error)}`)
  })
  if (addresses.length === 0) throw new Error('DNS lookup returned no addresses')
  if (addresses.some((entry) => isPrivateHostname(entry.address))) {
    throw new Error('the address resolves to a private network')
  }
}

/** Streams a response but stops reading at the cap instead of buffering it all. */
export async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      const remaining = maxBytes - size
      if (remaining <= 0) {
        await reader.cancel()
        break
      }
      const chunk = value.subarray(0, remaining)
      chunks.push(Buffer.from(chunk))
      size += chunk.length
      if (size >= maxBytes) {
        await reader.cancel()
        break
      }
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}

function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

export interface PublicFile {
  buffer: Buffer
  /** Final URL after redirects. */
  url: string
  /** Declared Content-Type, lowercased and without parameters (may be empty). */
  contentType: string
}

export interface PublicFetchOptions {
  maxBytes: number
  timeoutMs?: number
  /** Sent as the Accept header. */
  accept?: string
  /** What the error messages call the body: "file", "picture", "asset". */
  noun?: string
  /** What the error messages call the remote end: "server", "image server". */
  serverLabel?: string
  /** Extra request headers, e.g. a GitHub API version. */
  headers?: Record<string, string>
}

/**
 * Downloads a public http(s) address with redirects followed by hand, checking
 * every hop against the private-network guard and reading at most `maxBytes`.
 */
export async function fetchPublicFile(
  rawUrl: string,
  signal: AbortSignal,
  options: PublicFetchOptions
): Promise<PublicFile> {
  const noun = options.noun ?? 'file'
  const server = options.serverLabel ?? 'server'
  const maxBytes = Math.max(1, options.maxBytes)
  let current = safeHttpUrl(rawUrl)
  if (!current) throw new Error('only public http(s) links are supported')

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicUrl(current, signal)
    const timeout = AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.any([signal, timeout]),
        headers: {
          'user-agent': DOWNLOAD_USER_AGENT,
          accept: options.accept ?? '*/*',
          referer: new URL(current).origin,
          ...options.headers
        }
      })
    } catch (error) {
      if (timeout.aborted) throw new Error(`the ${server} did not answer in time`)
      if (signal.aborted) throw new Error('aborted')
      throw new Error(error instanceof Error ? error.message : String(error))
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error(`redirect without a location (HTTP ${response.status})`)
      current = safeHttpUrl(new URL(location, current).toString())
      if (!current) throw new Error('redirected to an unsupported address')
      continue
    }
    if (!response.ok) throw new Error(`the ${server} answered HTTP ${response.status}`)

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase().split(';')[0].trim()
    const length = Number(response.headers.get('content-length'))
    if (Number.isFinite(length) && length > maxBytes) {
      await response.body?.cancel()
      throw new Error(`the ${noun} is ${sizeText(length)}, larger than the ${sizeText(maxBytes)} limit`)
    }

    // One byte over the cap is enough to tell a truncated body from a full one.
    const buffer = await readCapped(response, maxBytes + 1)
    if (buffer.length > maxBytes) {
      throw new Error(`the ${noun} is larger than the ${sizeText(maxBytes)} limit`)
    }
    if (buffer.length === 0) throw new Error(`the ${server} returned an empty body`)
    return { buffer, url: current, contentType }
  }
  throw new Error('too many redirects')
}
