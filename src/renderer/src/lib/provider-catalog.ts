import { PROVIDER_CATALOG, type CatalogProvider } from '@shared/provider-catalog'

function normalize(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').toLowerCase()
}

function hostOf(value: string | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

const BY_URL = new Map<string, CatalogProvider>(
  PROVIDER_CATALOG.map((provider) => [normalize(provider.baseUrl), provider])
)

/** Hosts that are somebody's API root — never mistaken for a website. */
const API_HOSTS = new Set(
  PROVIDER_CATALOG.map((provider) => hostOf(provider.baseUrl)).filter(
    (host): host is string => host !== null
  )
)

/**
 * Hosts that are a provider's site or docs, as long as exactly one provider
 * claims them: `gen-api.ru` → GenAPI, whose API lives on proxy.gen-api.ru.
 */
const SITE_HOSTS = new Map<string, CatalogProvider>()
const AMBIGUOUS_HOSTS = new Set<string>()
for (const provider of PROVIDER_CATALOG) {
  const host = hostOf(provider.docs)
  if (!host) continue
  const existing = SITE_HOSTS.get(host)
  if (existing && existing.id !== provider.id) {
    AMBIGUOUS_HOSTS.add(host)
    continue
  }
  SITE_HOSTS.set(host, provider)
}
for (const host of AMBIGUOUS_HOSTS) SITE_HOSTS.delete(host)

/**
 * Which catalogue entry a connection belongs to. Profiles are stored as plain
 * endpoints, so recognising the provider is what lets the UI show its logo.
 */
export function catalogForBaseUrl(baseUrl: string | null | undefined): CatalogProvider | null {
  if (!baseUrl) return null
  return BY_URL.get(normalize(baseUrl)) ?? null
}

/**
 * Pasting the provider's website where its API address belongs is the most
 * common way to end up with a Base URL that answers with HTML. When the address
 * points at a known provider page, name the endpoint that was meant.
 */
export function suggestApiBaseUrl(baseUrl: string | null | undefined): CatalogProvider | null {
  const host = hostOf(baseUrl ?? undefined)
  if (!host || API_HOSTS.has(host)) return null
  const provider = SITE_HOSTS.get(host)
  if (!provider) return null
  return hostOf(provider.baseUrl) === host ? null : provider
}
