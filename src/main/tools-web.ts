import { getWebSearchApiKey } from './store'
import { runWebSearch } from './webSearch'
import { cfg, argString, ToolError, truncate, type ToolDef } from './tool-utils'

/**
 * Outbound HTTP: documentation search that stays close to official sources,
 * and a general api_call for everything else a task may need to reach.
 */

const DOCS_DOMAINS = [
  'developer.mozilla.org',
  'docs.python.org',
  'nodejs.org',
  'react.dev',
  'vuejs.org',
  'angular.dev',
  'go.dev',
  'doc.rust-lang.org',
  'docs.oracle.com',
  'learn.microsoft.com',
  'typescriptlang.org',
  'tailwindcss.com',
  'postgresql.org',
  'mongodb.com',
  'redis.io',
  'docker.com',
  'kubernetes.io'
]

const docsLookupTool: ToolDef = {
  name: 'docs_lookup',
  description:
    'Search the OFFICIAL documentation of web, language and infra technologies (MDN, Python, Node, React, Rust, Postgres, Kubernetes…) instead of the whole web. Returns curated sources and opens the best pages. Use it for API details, config options and version-specific behaviour.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to find, e.g. "array at() negative index"' },
      technology: { type: 'string', description: 'Optional tech to bias towards, e.g. "react"' }
    },
    required: ['query']
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const query = argString(args, 'query').slice(0, 300)
    const technology = argString(args, 'technology', false)
    const searchSettings = cfg().webSearch
    const domainHint = DOCS_DOMAINS.find((domain) => technology && domain.includes(technology.toLowerCase().replace(/[^a-z]/g, '')))
    const fullQuery = domainHint
      ? `${query} site:${domainHint}`
      : `${query} documentation ${DOCS_DOMAINS.slice(0, 6).map((domain) => `site:${domain}`).join(' OR ')}`

    const run = await runWebSearch(
      {
        query: fullQuery,
        maxResults: searchSettings.maxResults,
        readPages: searchSettings.readPages,
        provider: searchSettings.provider,
        apiKey: getWebSearchApiKey(),
        safeSearch: searchSettings.safeSearch,
        reserveCitations: ctx.webSearch?.reserve ?? ((count) => Array.from({ length: count }, (_, index) => index + 1)),
        onProgress: (meta) => ctx.report?.(meta)
      },
      ctx.signal
    )
    return { ok: run.ok, summary: `docs: ${query}`, detail: truncate(run.detail), meta: run.meta }
  }
}

const MAX_BODY_CHARS = 50_000

const apiCallTool: ToolDef = {
  name: 'api_call',
  description:
    'Call any http(s) API like a programmer would from code: choose the method, headers and a JSON/text body, and get the status plus the response body. Use it to test endpoints, check API keys, talk to internal services on localhost, or query public APIs. The response is capped at 50k characters.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'http(s) endpoint, localhost allowed' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], description: 'HTTP method (default GET)' },
      headers: { type: 'object', description: 'Request headers, e.g. {"Authorization": "Bearer …"}' },
      body: { type: 'string', description: 'Request body (raw JSON or text)' },
      timeout_ms: { type: 'number', description: 'Timeout in ms (default 30000)' }
    },
    required: ['url']
  },
  risk: 'exec',
  execute: async (args, ctx) => {
    const rawUrl = argString(args, 'url')
    // localhost endpoints are the point here, so the public-only guard does
    // not apply — but file:// and other schemes still are.
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      throw new ToolError(`Invalid URL: ${rawUrl}`)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ToolError('Only http(s) URLs are allowed')

    const method = (argString(args, 'method', false) || 'GET').toUpperCase()
    const headers: Record<string, string> = {}
    if (args.headers && typeof args.headers === 'object' && !Array.isArray(args.headers)) {
      for (const [key, value] of Object.entries(args.headers as Record<string, unknown>)) {
        if (typeof value === 'string' || typeof value === 'number') headers[key] = String(value)
      }
    }
    const body = argString(args, 'body', false)
    const timeout = Math.min(Math.max(args.timeout_ms && typeof args.timeout_ms === 'number' ? args.timeout_ms : 30000, 1000), 120000)

    const started = Date.now()
    try {
      const response = await fetch(url, {
        method,
        headers: body !== '' && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')
          ? { ...headers, 'content-type': 'application/json' }
          : headers,
        body: body !== '' && method !== 'GET' && method !== 'HEAD' ? body : undefined,
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(timeout)])
      })
      const text = method === 'HEAD' ? '' : await response.text()
      const ms = Date.now() - started
      return {
        ok: response.ok,
        summary: `${method} ${url.pathname} → ${response.status} in ${ms}ms`,
        detail: truncate(`${response.status} ${response.statusText}\n${text}`, MAX_BODY_CHARS)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, summary: `${method} failed`, detail: truncate(message) }
    }
  }
}

export const WEB_TOOLS: ToolDef[] = [docsLookupTool, apiCallTool]
