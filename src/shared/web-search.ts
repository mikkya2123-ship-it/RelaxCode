/**
 * Shared web-search contracts and pure parsing helpers.
 *
 * Everything here runs in both processes (and in plain Node tests): no Electron,
 * no network. The main process adds the actual providers and page fetcher on top.
 */

export const WEB_SEARCH_PROVIDERS = [
  'auto',
  'tavily',
  'brave',
  'serper',
  'duckduckgo',
  'bing'
] as const

export type WebSearchProvider = (typeof WEB_SEARCH_PROVIDERS)[number]

export type WebSearchStage = 'searching' | 'reading' | 'done' | 'error'
export type WebSearchSourceStatus = 'found' | 'reading' | 'read' | 'failed'

/** One result, and what happened when the agent opened it. */
export interface WebSearchSource {
  /** Stable citation number for the whole run; answers cite it as `[n]`. */
  number: number
  title: string
  url: string
  domain: string
  snippet: string
  /** Short beginning of the extracted page text, when it was read. */
  excerpt?: string
  /** Characters of readable text extracted from the page. */
  chars?: number
  status: WebSearchSourceStatus
  error?: string
  /** Publication date as reported by the provider, when there is one. */
  published?: string
  /**
   * Preview picture the page advertises (`og:image`), when the agent read it.
   * The model can pass it to `show_image` to put it in the chat.
   */
  image?: string
}

/** Structured progress of one `web_search` call, streamed to the chat card. */
export interface WebSearchMeta {
  kind: 'web-search'
  query: string
  /** Human label of the provider that answered (Bing, Tavily, …). */
  provider: string
  stage: WebSearchStage
  sources: WebSearchSource[]
  /** Configured page-read limit for this call. */
  readPages: number
  error?: string
}

export interface ParsedSearchResult {
  title: string
  url: string
  snippet: string
  published?: string
}

/* ------------------------------------------------------------------------- *
 * Text and URL hygiene
 * ------------------------------------------------------------------------- */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  euro: '€',
  pound: '£',
  yen: '¥',
  times: '×',
  divide: '÷'
}

/** Decodes the entities search snippets use, without double-decoding `&amp;lt;`. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match
  })
}

export function stripHtml(value: string): string {
  return decodeEntities(
    value
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim()
}

export function cleanQuery(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

/** A URL that is safe to put into an `<a href>` and to hand to the fetcher. */
export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    if (!url.hostname) return null
    return url.toString()
  } catch {
    return null
  }
}

export function domainOf(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

/** Deduplication key: ignores the fragment, tracking parameters and a trailing slash. */
export function urlKey(value: string): string {
  try {
    const url = new URL(value)
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|ref$|source$)/i.test(key)) url.searchParams.delete(key)
    }
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, '')}${
      url.search ? url.search : ''
    }`
  } catch {
    return value
  }
}

/* ------------------------------------------------------------------------- *
 * Local / private address detection (SSRF guard)
 * ------------------------------------------------------------------------- */

function parseIpv4(host: string): number[] | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  const numbers = parts.map((part) => Number(part))
  if (numbers.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return null
  return numbers
}

function isPrivateIpv4(host: string): boolean {
  const ip = parseIpv4(host)
  if (!ip) return false
  const [a, b] = ip
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && ip[2] === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

/** Expands an IPv6 literal to eight 16-bit groups, including mapped IPv4 tails. */
function parseIpv6(host: string): number[] | null {
  let value = host.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  let tail: number[] = []
  const dotted = value.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const ipv4 = parseIpv4(dotted[1])
    if (!ipv4) return null
    tail = [(ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]]
    value = value.slice(0, -dotted[1].length).replace(/:$/, '')
  }

  const parseGroups = (part: string): number[] | null => {
    if (part.length === 0) return []
    const groups = part.split(':')
    const numbers = groups.map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN))
    return numbers.some((number) => !Number.isFinite(number)) ? null : numbers
  }

  let groups: number[] | null
  if (value.includes('::')) {
    const [left, right] = value.split('::')
    if (value.split('::').length > 2) return null
    const head = parseGroups(left)
    const rest = parseGroups(right)
    if (!head || !rest) return null
    const missing = 8 - head.length - rest.length - tail.length
    if (missing < 0) return null
    groups = [...head, ...Array.from({ length: missing }, () => 0), ...rest]
  } else {
    groups = parseGroups(value)
  }
  if (!groups) return null
  groups = [...groups, ...tail]
  return groups.length === 8 ? groups : null
}

function isPrivateIpv6(host: string): boolean {
  const groups = parseIpv6(host)
  if (!groups) return false
  const first = groups[0]
  if ((first & 0xfe00) === 0xfc00) return true // unique local fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true // link local fe80::/10
  if ((first & 0xffc0) === 0xfec0) return true // deprecated site local fec0::/10
  if ((first & 0xff00) === 0xff00) return true // multicast ff00::/8

  // ::, ::1, IPv4-compatible (::a.b.c.d) and IPv4-mapped (::ffff:a.b.c.d).
  if (groups.slice(0, 5).every((group) => group === 0)) {
    if (groups[5] === 0 || groups[5] === 0xffff) {
      const ipv4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`
      return isPrivateIpv4(ipv4) || (groups[6] === 0 && groups[7] <= 1)
    }
  }
  return false
}

/** Rejects IP literals and special names that can never be public web pages. */
export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (host.length === 0) return true
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan') ||
    host.endsWith('.home') ||
    host.endsWith('.home.arpa') ||
    host.endsWith('.test') ||
    host.endsWith('.invalid') ||
    host.endsWith('.onion') ||
    host === 'metadata.google.internal'
  ) {
    return true
  }
  if (parseIpv4(host)) return isPrivateIpv4(host)
  if (host.includes(':')) return isPrivateIpv6(host)
  return false
}

/* ------------------------------------------------------------------------- *
 * Search-result parsing
 * ------------------------------------------------------------------------- */

function xmlValue(item: string, tag: string): string {
  const match = item.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  if (!match) return ''
  return match[1]
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/i, '$1')
    .trim()
}

function publishedIso(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

/**
 * Bing's RSS endpoint is one no-key fallback. It returns ordinary web results
 * (title, link, HTML description), unlike the Instant Answer API.
 */
export function parseBingRss(xml: string, limit = 10, requestedQuery = ''): ParsedSearchResult[] {
  const results: ParsedSearchResult[] = []
  // Bing may serve a cached feed unrelated to the requested query.
  const query = requestedQuery.trim()
  const tokenize = (value: string): string[] =>
    value.normalize('NFKD').toLowerCase().match(/[a-z0-9À-ɏЀ-ӿ]+/gi) ?? []
  const stopWords = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'is', 'it',
    'of', 'on', 'or', 'the', 'to', 'was', 'what', 'when', 'where', 'who', 'why', 'with',
    'и', 'в', 'во', 'на', 'о', 'об', 'про', 'что', 'как', 'где', 'когда', 'кто', 'это', 'для',
    'из', 'или', 'по', 'с', 'со', 'за'
  ])
  const queryTokens = [...new Set(tokenize(query).filter((token) => !stopWords.has(token)))]
  const minimumMatches = Math.max(2, Math.ceil(queryTokens.length * 0.5))
  const seen = new Set<string>()
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const item = match[1]
    const url = safeHttpUrl(decodeEntities(xmlValue(item, 'link')))
    if (!url) continue
    const key = urlKey(url)
    if (seen.has(key)) continue
    seen.add(key)
    const title = stripHtml(xmlValue(item, 'title')) || domainOf(url) || url
    const snippet = stripHtml(xmlValue(item, 'description')).slice(0, 600)
    const itemTokens = new Set(tokenize(`${title} ${snippet} ${url}`))
    if (
      requestedQuery.trim() &&
      queryTokens.length >= 2 &&
      queryTokens.filter((token) => itemTokens.has(token)).length < minimumMatches
    ) {
      continue
    }
    const published = publishedIso(xmlValue(item, 'pubDate'))
    results.push({ title, url, snippet, ...(published ? { published } : {}) })
    if (results.length >= limit) break
  }
  return results
}

function ddgTarget(href: string): string | null {
  const raw = decodeEntities(href).startsWith('//')
    ? `https:${decodeEntities(href)}`
    : decodeEntities(href)
  try {
    const url = new URL(raw, 'https://duckduckgo.com/')
    const target = url.searchParams.get('uddg')
    if (target) return safeHttpUrl(target)
    // Links that stay inside DuckDuckGo are ads or internal navigation.
    if (url.hostname === 'duckduckgo.com' || url.hostname.endsWith('.duckduckgo.com')) return null
    return safeHttpUrl(url.toString())
  } catch {
    return null
  }
}

/**
 * DuckDuckGo's HTML endpoint is the dependable no-key fallback: Bing's RSS
 * feed returns an empty channel for many ordinary questions, while the HTML
 * page still has the same ten results a browser would see.
 */
export function parseDuckDuckGoHtml(html: string, limit = 10): ParsedSearchResult[] {
  const results: ParsedSearchResult[] = []
  const seen = new Set<string>()
  const blocks = html.split(
    /<div\b[^>]*class=["'][^"']*\bresult\b[^"']*["'][^>]*>/i
  )
  for (const block of blocks.slice(1)) {
    if (/\bresult--ad\b|\bbadge--ad\b/i.test(block)) continue
    const anchor = block.match(
      /<a\b([^>]*\bclass=["'][^"']*\bresult__a\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/i
    )
    if (!anchor) continue
    const href = anchor[1].match(/\bhref=["']([^"']+)["']/i)?.[1]
    const url = href ? ddgTarget(href) : null
    if (!url) continue
    const key = urlKey(url)
    if (seen.has(key)) continue
    seen.add(key)
    const title = stripHtml(anchor[2]) || domainOf(url) || url
    const snippetMatch = block.match(
      /<a\b[^>]*\bclass=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i
    )
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]).slice(0, 600) : ''
    results.push({ title, url, snippet })
    if (results.length >= limit) break
  }
  return results
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Base64url decoder that also runs in the renderer, where Buffer does not exist. */
function decodeBase64(value: string): string {
  let output = ''
  let buffer = 0
  let bits = 0
  for (const char of value) {
    const index = BASE64_ALPHABET.indexOf(char)
    if (index === -1) continue
    buffer = (buffer << 6) | index
    bits += 6
    if (bits >= 8) {
      bits -= 8
      output += String.fromCharCode((buffer >> bits) & 0xff)
    }
  }
  return output
}

/**
 * Bing wraps most organic results in `bing.com/ck/a?...&u=a1<base64url>` so a
 * click can be attributed. The RSS feed needs no unwrapping, but the HTML page
 * does, and it is the fallback when the feed comes back empty or broken.
 */
function bingTarget(href: string): string | null {
  const raw = decodeEntities(href)
  const absolute = raw.startsWith('//') ? `https:${raw}` : raw
  try {
    const url = new URL(absolute, 'https://www.bing.com/')
    if (url.hostname === 'bing.com' || url.hostname.endsWith('.bing.com')) {
      const wrapped = url.searchParams.get('u')
      if (!wrapped || !wrapped.startsWith('a1')) return null
      const decoded = decodeBase64(wrapped.slice(2))
      return decoded ? safeHttpUrl(decoded) : null
    }
    return safeHttpUrl(url.toString())
  } catch {
    return null
  }
}

/**
 * Bing's ordinary HTML results. The RSS feed is cleaner, but it silently
 * returns an empty channel for a number of queries, and this page still shows
 * the same organic results a browser would see.
 */
export function parseBingHtml(html: string, limit = 10): ParsedSearchResult[] {
  const results: ParsedSearchResult[] = []
  const seen = new Set<string>()
  const blocks = html.split(/<li\b[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][^>]*>/i).slice(1)
  for (const block of blocks) {
    const anchor = block.match(
      /<h2\b[^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
    )
    if (!anchor) continue
    const url = bingTarget(anchor[1])
    if (!url) continue
    const key = urlKey(url)
    if (seen.has(key)) continue
    seen.add(key)
    const title = stripHtml(anchor[2]) || domainOf(url) || url
    const snippet = block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)
    results.push({
      title,
      url,
      snippet: snippet ? stripHtml(snippet[1]).slice(0, 600) : ''
    })
    if (results.length >= limit) break
  }
  return results
}

/* ------------------------------------------------------------------------- *
 * HTML → readable text
 * ------------------------------------------------------------------------- */

/**
 * Keeps the main article when a page marks one, else the body. The result is
 * plain text with paragraph breaks; scripts, navigation and chrome are gone.
 */
export function htmlToText(html: string): string {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|canvas|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ')

  const mainMatches = [
    ...withoutNoise.matchAll(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/gi)
  ].map((match) => match[2])
  const main = mainMatches.sort((a, b) => b.length - a.length)[0]
  const body = withoutNoise.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? withoutNoise
  const content = main && main.length > 400 ? main : body

  const withBreaks = content
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|section|article|main|h[1-6]|li|tr|blockquote|pre|table|ul|ol)\s*>/gi, '\n')
    // Inline tags split words in the markup without meaning a space in the text.
    .replace(
      /<\/?(?:a|abbr|b|strong|i|em|u|s|small|span|code|mark|sub|sup|kbd|var|cite|q|time|font)\b[^>]*>/gi,
      ''
    )
    .replace(/<[^>]*>/g, ' ')

  return decodeEntities(withBreaks)
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function extractHtmlTitle(html: string): string {
  const title =
    html.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i)?.[1] ??
    html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
    ''
  return stripHtml(title).slice(0, 300)
}
