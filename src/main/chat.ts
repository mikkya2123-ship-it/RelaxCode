import OpenAI from 'openai'
import type { ModelInfo, ModelsListOptions, ModelsResult } from '@shared/ipc'
import { normalizeBaseUrl } from '@shared/base-url'
import { activeProvider, getApiKey, providerById } from './store'

const REQUEST_TIMEOUT_MS = 15000

function errorMessage(error: unknown): string {
  if (error instanceof OpenAI.APIError) {
    const body = error.error as
      | { metadata?: { raw?: string; provider_name?: string }; code?: number | string }
      | undefined
    const provider = body?.metadata?.provider_name
    const raw = body?.metadata?.raw
    const base = error.status ? `HTTP ${error.status}: ${error.message}` : error.message
    const details = [provider ? `provider ${provider}` : '', raw ?? ''].filter(Boolean).join(' — ')
    return details ? `${base} — ${details.slice(0, 300)}` : base
  }
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * A network failure is never "fetch failed" to the person reading it. The
 * renderer turns `net:<kind>:<detail>` into a sentence; the detail stays so the
 * cause is still visible to whoever knows what ENOTFOUND means.
 */
function networkError(error: unknown, url: string): string | null {
  const cause = (error as { cause?: unknown }).cause as
    | { code?: unknown; hostname?: unknown; errors?: unknown }
    | undefined
  // A refused connection arrives as an AggregateError over the resolved
  // addresses, so the code lives one level deeper.
  const nested = Array.isArray(cause?.errors) ? cause.errors : []
  const parts = [cause, ...(nested as Array<{ code?: unknown; hostname?: unknown }>)].filter(
    (part): part is { code?: unknown; hostname?: unknown } => typeof part === 'object' && part !== null
  )
  const codes = parts
    .map((part) => (typeof part.code === 'string' ? part.code.toUpperCase() : ''))
    .filter((code) => code.length > 0)
  const host =
    (parts
      .map((part) => (typeof part.hostname === 'string' ? part.hostname : ''))
      .find((value) => value.length > 0) ?? '') || new URL(url).hostname || url
  const has = (...wanted: string[]): boolean => wanted.some((code) => codes.includes(code))
  const message =
    parts
      .map((part) =>
        typeof (part as { message?: unknown }).message === 'string'
          ? (part as { message: string }).message
          : ''
      )
      .find((value) => value.length > 0) ?? ''
  const label = codes.join('/') || message || 'fetch failed'

  if (error instanceof Error && error.name === 'TimeoutError') {
    return `net:timeout:no answer in ${REQUEST_TIMEOUT_MS / 1000}s`
  }
  // Node refuses to talk to a handful of ports (discard, SMTP, …) outright.
  if (/bad port/i.test(message)) return `net:port:${message}`
  if (has('ENOTFOUND', 'EAI_AGAIN', 'EAI_NODATA')) return `net:dns:${label} ${host}`
  if (has('ECONNREFUSED')) return `net:refused:${label} ${host}`
  if (
    has('ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT')
  ) {
    return `net:timeout:${label} ${host}`
  }
  if (has('ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_ABORTED')) {
    return `net:connect:${label} ${host}`
  }
  if (codes.some((code) => code.startsWith('CERT') || code.includes('SELF_SIGNED') || code.includes('TLS'))) {
    return `net:tls:${label} ${host}`
  }
  if (error instanceof Error && error.message === 'fetch failed') {
    return `net:connect:${label || 'fetch failed'} ${host}`
  }
  return null
}

export async function listModels(options?: ModelsListOptions): Promise<ModelsResult> {
  // A provider id (the settings screen checking a profile) wins over the active
  // connection; an explicit baseUrl/key overrides both.
  const provider = options?.providerId ? providerById(options.providerId) : null
  const active = activeProvider()
  const fallbackBaseUrl = provider?.baseUrl ?? active.baseUrl
  const effectiveBaseUrl = options?.baseUrl?.trim()
    ? options.baseUrl.trim().replace(/\/+$/, '')
    : fallbackBaseUrl
  const effectiveApiKey = options?.apiKey?.trim()
    ? options.apiKey.trim()
    : getApiKey(provider?.id)
  // Testing a saved profile whose key cannot be decrypted would quietly become an
  // anonymous request and look like a healthy connection. Name the real problem.
  if (provider && provider.apiKeyEnc && !effectiveApiKey) {
    return { ok: false, error: 'key-unreadable' }
  }
  if (!effectiveBaseUrl) return { ok: false, error: 'no-base-url' }
  // Repairing is the settings screen's job; here anything unusable is refused
  // before a request is attempted, so the answer is instant and specific.
  const baseUrl = normalizeBaseUrl(effectiveBaseUrl)
  if (!baseUrl.ok) return { ok: false, error: 'invalid-base-url' }

  // OpenRouter exposes a key-aware list that already excludes models blocked by
  // the account's privacy settings, guardrails or region. Prefer it so the user
  // only sees models that actually work with their key.
  if (isOpenRouter(baseUrl.value) && effectiveApiKey) {
    const userResult = await fetchModels(`${baseUrl.value}/models/user`, effectiveApiKey)
    if (userResult.ok) return { ok: true, models: userResult.models }
    // Older/regional hosts may not implement /models/user — fall back to the public list.
    if (userResult.status !== 404 && userResult.status !== 400) {
      return { ok: false, error: userResult.error }
    }
  }

  const result = await fetchModels(`${baseUrl.value}/models`, effectiveApiKey)
  return result.ok ? { ok: true, models: result.models } : { ok: false, error: result.error }
}

function isOpenRouter(baseUrl: string): boolean {
  try {
    return /(^|\.)openrouter\.ai$/i.test(new URL(baseUrl).hostname)
  } catch {
    return false
  }
}

interface RawModel {
  id?: unknown
  pricing?: { prompt?: unknown; completion?: unknown }
  supported_parameters?: unknown
  /** OpenRouter describes the reasoning a model supports. */
  reasoning?: { supported_efforts?: unknown; mandatory?: unknown }
  /** Context window, spelled differently by different gateways. */
  context_length?: unknown
  context_window?: unknown
  max_context_length?: unknown
  top_provider?: { context_length?: unknown }
}

function positiveNumber(value: unknown): number | undefined {
  const num = typeof value === 'number' ? value : Number.parseFloat(String(value))
  return Number.isFinite(num) && num > 0 ? Math.round(num) : undefined
}

function contextLengthOf(raw: RawModel): number | undefined {
  return (
    positiveNumber(raw.context_length) ??
    positiveNumber(raw.top_provider?.context_length) ??
    positiveNumber(raw.context_window) ??
    positiveNumber(raw.max_context_length)
  )
}

function isZeroPrice(value: unknown): boolean {
  if (value === undefined || value === null) return false
  const num = typeof value === 'number' ? value : Number.parseFloat(String(value))
  return Number.isFinite(num) && num === 0
}

function toModelInfo(raw: RawModel): ModelInfo | null {
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null
  const free =
    raw.id.endsWith(':free') ||
    (isZeroPrice(raw.pricing?.prompt) && isZeroPrice(raw.pricing?.completion))
  const tools =
    Array.isArray(raw.supported_parameters) && raw.supported_parameters.includes('tools')
  const efforts = Array.isArray(raw.reasoning?.supported_efforts)
    ? raw.reasoning.supported_efforts.filter((value): value is string => typeof value === 'string')
    : []
  const contextLength = contextLengthOf(raw)
  return {
    id: raw.id,
    free,
    tools,
    ...(efforts.length > 0 ? { reasoningEfforts: efforts } : {}),
    ...(raw.reasoning?.mandatory === true ? { reasoningAlways: true } : {}),
    ...(contextLength !== undefined ? { contextLength } : {})
  }
}

/** Free + tool-capable first, then free, then paid tool-capable, then the rest. */
function modelRank(model: ModelInfo): number {
  if (model.free && model.tools) return 0
  if (model.free) return 1
  if (model.tools) return 2
  return 3
}

function sortModels(models: ModelInfo[]): ModelInfo[] {
  return models
    .slice()
    .sort(
      (a, b) =>
        modelRank(a) - modelRank(b) ||
        a.id.localeCompare(b.id, undefined, { sensitivity: 'base' })
    )
}

type FetchModelsResult =
  | { ok: true; models: ModelInfo[] }
  | { ok: false; status: number; error: string }

async function fetchModels(url: string, apiKey: string | null): Promise<FetchModelsResult> {
  try {
    const response = await fetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      return {
        ok: false,
        status: response.status,
        error: `HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`
      }
    }
    const text = await response.text()
    let json: { data?: unknown }
    try {
      json = JSON.parse(text) as { data?: unknown }
    } catch {
      // A provider site answers with HTML where its API answers with JSON.
      return {
        ok: false,
        status: response.status,
        error: text.trimStart().startsWith('<') ? 'html-response' : 'invalid-json'
      }
    }
    const list = Array.isArray(json.data) ? json.data : []
    const models = list
      .map((entry) => toModelInfo(entry as RawModel))
      .filter((model): model is ModelInfo => model !== null)
    return { ok: true, models: sortModels(models) }
  } catch (error) {
    return { ok: false, status: 0, error: networkError(error, url) ?? errorMessage(error) }
  }
}
