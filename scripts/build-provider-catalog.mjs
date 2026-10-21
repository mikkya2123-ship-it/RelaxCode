/**
 * Regenerates src/shared/provider-catalog.ts from the models.dev registry.
 *
 * The registry is a community catalogue of providers, their OpenAI-compatible
 * endpoints and the models behind them. RelaxCode speaks the OpenAI protocol, so
 * only providers with a compatible endpoint are kept; the rest are dropped
 * instead of being offered as something that would not work.
 *
 *   node scripts/build-provider-catalog.mjs                 # fetch models.dev
 *   node scripts/build-provider-catalog.mjs --from file.json # use a snapshot
 *
 * Hand-written entries (Russian gateways, local runtimes) live in this script,
 * because the registry either does not list them or lists them without an
 * endpoint we can talk to.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const SOURCE = 'https://models.dev/api.json'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'src/shared/provider-catalog.ts')

/** SDK packages that talk to an OpenAI-compatible endpoint. */
const COMPATIBLE_SDK = new Set([
  '@ai-sdk/openai-compatible',
  '@ai-sdk/openai',
  '@ai-sdk/deepinfra',
  '@ai-sdk/cerebras',
  '@ai-sdk/groq',
  '@ai-sdk/xai',
  '@ai-sdk/togetherai',
  '@ai-sdk/mistral',
  '@ai-sdk/perplexity',
  '@openrouter/ai-sdk-provider',
  '@aihubmix/ai-sdk-provider',
  'ai-gateway-provider',
  'merge-gateway-ai-sdk-provider',
  'venice-ai-sdk-provider',
  '@qvac/ai-sdk-provider',
  '@saladtechnologies-oss/ai-sdk-provider'
])

/**
 * SDKs whose package hard-codes its endpoint, so the registry leaves `api`
 * empty. The value is the OpenAI-compatible base URL the SDK uses.
 */
const API_OVERRIDES = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  cohere: 'https://api.cohere.ai/compatibility/v1',
  deepinfra: 'https://api.deepinfra.com/v1/openai',
  cerebras: 'https://api.cerebras.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  perplexity: 'https://api.perplexity.ai',
  venice: 'https://api.venice.ai/api/v1',
  xai: 'https://api.x.ai/v1',
  mistral: 'https://api.mistral.ai/v1',
  togetherai: 'https://api.together.xyz/v1'
}

/** Shown at the top of the picker, in this order. */
const POPULAR = [
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'deepseek',
  'xai',
  'groq',
  'mistral',
  'cerebras',
  'togetherai',
  'deepinfra',
  'fireworks-ai',
  'nvidia',
  'zai',
  'moonshotai',
  'minimax',
  'qwen',
  'opencode'
]

/**
 * Providers missing from the registry or unusable as listed there. Russian
 * gateways matter to the people who use them for billing and access.
 */
const MANUAL = [
  {
    id: 'genapi',
    name: 'GenAPI',
    baseUrl: 'https://proxy.gen-api.ru/v1',
    docs: 'https://gen-api.ru',
    env: 'GENAPI_API_KEY',
    models: 0,
    top: [],
    region: 'ru'
  },
  {
    id: 'proxyapi',
    name: 'ProxyAPI',
    baseUrl: 'https://api.proxyapi.ru/openai/v1',
    docs: 'https://proxyapi.ru',
    env: 'PROXYAPI_KEY',
    models: 0,
    top: [],
    region: 'ru'
  },
  {
    id: 'vsegpt',
    name: 'VseGPT',
    baseUrl: 'https://api.vsegpt.ru/v1',
    docs: 'https://vsegpt.ru',
    env: 'VSEGPT_API_KEY',
    models: 0,
    top: [],
    region: 'ru'
  },
  {
    id: 'gptunnel',
    name: 'GPTunnel',
    baseUrl: 'https://gptunnel.ru/v1',
    docs: 'https://gptunnel.ru',
    env: 'GPTUNNEL_API_KEY',
    models: 0,
    top: [],
    region: 'ru'
  },
  {
    id: 'yandex-ai-studio',
    name: 'Yandex AI Studio',
    baseUrl: 'https://llm.api.cloud.yandex.net/v1',
    docs: 'https://yandex.cloud/docs/ai-studio',
    env: 'YANDEX_API_KEY',
    models: 0,
    top: [],
    region: 'ru'
  },
  {
    id: 'gigachat',
    name: 'GigaChat',
    baseUrl: 'https://gigachat.devices.sberbank.ru/api/v1',
    docs: 'https://developers.sber.ru/docs/ru/gigachat',
    env: 'GIGACHAT_CREDENTIALS',
    models: 0,
    top: [],
    region: 'ru'
  },
  {
    id: 'cloudru',
    name: 'Cloud.ru Foundation Models',
    baseUrl: 'https://foundation-models.api.cloud.ru/v1',
    docs: 'https://cloud.ru/docs/foundation-models',
    env: 'CLOUDRU_API_KEY',
    models: 0,
    top: [],
    region: 'ru'
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    baseUrl: 'http://127.0.0.1:11434/v1',
    docs: 'https://ollama.com',
    env: '',
    models: 0,
    top: [],
    local: true
  },
  {
    id: 'llamacpp',
    name: 'llama.cpp (local)',
    baseUrl: 'http://127.0.0.1:8080/v1',
    docs: 'https://github.com/ggml-org/llama.cpp',
    env: '',
    models: 0,
    top: [],
    local: true
  }
]

/** Newest tool-capable models make the best default for an agent. */
function topModels(provider) {
  const all = Object.values(provider.models ?? {})
  const byDate = (a, b) => String(b.release_date ?? '').localeCompare(String(a.release_date ?? ''))
  const ordered = [
    ...all.filter((model) => model.tool_call).sort(byDate),
    ...all.filter((model) => !model.tool_call).sort(byDate)
  ]
  const picked = []
  for (const model of ordered) {
    if (picked.length === 3) break
    if (typeof model.id === 'string' && model.id.length > 0) picked.push(model.id)
  }
  return picked
}

function quote(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function fallbackName(baseUrl) {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

async function loadRegistry() {
  const fromIndex = process.argv.indexOf('--from')
  if (fromIndex !== -1) {
    const file = process.argv[fromIndex + 1]
    if (!file) throw new Error('--from needs a path')
    return JSON.parse(await readFile(path.resolve(file), 'utf8'))
  }
  const response = await fetch(SOURCE)
  if (!response.ok) throw new Error(`${SOURCE}: HTTP ${response.status}`)
  return await response.json()
}

const registry = await loadRegistry()
const entries = []

for (const [id, provider] of Object.entries(registry)) {
  const baseUrl = (provider.api ?? API_OVERRIDES[id] ?? '').trim().replace(/\/+$/, '')
  if (!baseUrl) continue
  // A few registry entries are templates (`${VAR}/v1`) or internal names; they
  // cannot be a working endpoint, so they are not offered.
  if (!/^https?:\/\/[^/]+/.test(baseUrl)) continue
  if (!COMPATIBLE_SDK.has(provider.npm) && !API_OVERRIDES[id]) continue

  entries.push({
    id,
    name: provider.name?.trim() || fallbackName(baseUrl),
    baseUrl,
    docs: provider.doc?.trim() || '',
    env: Array.isArray(provider.env) ? (provider.env[0] ?? '') : '',
    models: Object.keys(provider.models ?? {}).length,
    top: topModels(provider),
    region: '',
    local: false,
    popular: POPULAR.includes(id)
  })
}

for (const manual of MANUAL) {
  if (entries.some((entry) => entry.id === manual.id)) continue
  entries.push({ ...manual, region: manual.region ?? '', local: manual.local ?? false, popular: false })
}

const seen = new Set()
const unique = entries.filter((entry) => {
  if (seen.has(entry.id)) return false
  seen.add(entry.id)
  return true
})

// Two registry entries sometimes share one endpoint (a plan and a gateway).
// Keep the plain one, or the popular one when only it is hand-picked.
function urlScore(entry) {
  let score = entry.popular ? 0 : 10
  if (/-coding-plan|token-plan/.test(entry.id)) score += 1
  if (entry.name.includes('(')) score += 1
  return score
}

const byUrl = new Map()
for (const entry of unique) {
  const previous = byUrl.get(entry.baseUrl)
  if (!previous || urlScore(entry) < urlScore(previous)) byUrl.set(entry.baseUrl, entry)
}
const final = [...byUrl.values()]

const rank = (entry) => {
  const index = POPULAR.indexOf(entry.id)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}
final.sort((a, b) => {
  const diff = rank(a) - rank(b)
  if (diff !== 0) return diff
  return a.name.localeCompare(b.name, 'en')
})

const models = final.reduce((sum, entry) => sum + entry.models, 0)

function renderEntry(entry) {
  const fields = [
    `id: ${quote(entry.id)}`,
    `name: ${quote(entry.name)}`,
    `baseUrl: ${quote(entry.baseUrl)}`
  ]
  if (entry.docs) fields.push(`docs: ${quote(entry.docs)}`)
  if (entry.env) fields.push(`env: ${quote(entry.env)}`)
  fields.push(`models: ${entry.models}`)
  fields.push(`top: [${entry.top.map(quote).join(', ')}]`)
  if (entry.region) fields.push(`region: ${quote(entry.region)}`)
  if (entry.local) fields.push('local: true')
  if (entry.popular) fields.push('popular: true')
  return `  { ${fields.join(', ')} },`
}

const file = `/**
 * The provider catalogue bundled with the app.
 *
 * Generated by scripts/build-provider-catalog.mjs from models.dev — do not edit
 * by hand. Every entry points at an OpenAI-compatible endpoint, so it can be
 * used by the chat and the agent right away; \`baseUrl\` is always editable and
 * anything missing can be added as a custom provider.
 *
 * ${final.length} providers, ${models} models known to the registry.
 */
export type ProviderRegion = 'ru'

export interface CatalogProvider {
  /** Stable id, also used to recognise a bundled provider later. */
  id: string
  name: string
  /** OpenAI-compatible base URL, no trailing slash. */
  baseUrl: string
  /** Where to create a key / read the docs. */
  docs?: string
  /** Environment variable the key is usually kept in. */
  env?: string
  /** How many models the registry knows for this provider (0 = unknown). */
  models: number
  /** Suggested model ids, best first. Empty when the provider is unknown. */
  top: string[]
  /** Region worth grouping separately in the picker. */
  region?: ProviderRegion
  /** Runs on this machine instead of the network. */
  local?: boolean
  /** Hand-picked provider, shown above the rest. */
  popular?: boolean
}

export const PROVIDER_CATALOG: CatalogProvider[] = [
${final.map(renderEntry).join('\n')}
]

/** Base URL the "custom provider" form starts from. */
export const CUSTOM_PROVIDER_BASE_URL = 'https://api.openai.com/v1'

/** What the bundled catalogue is worth telling the user. */
export const PROVIDER_CATALOG_STATS = { providers: ${final.length}, models: ${models} }
`

await writeFile(OUT, file, 'utf8')
console.log(`wrote ${path.relative(ROOT, OUT)}: ${final.length} providers, ${models} models`)
