import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ReadableStream as NodeWebReadable } from 'node:stream/web'
import { app } from 'electron'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  applyMcpSchemaBudget,
  clampMcpDescription,
  MCP_SCHEMA_BUDGET,
  mcpResultToText,
  mcpToolEnabled,
  mcpToolFullName,
  normalizeMcpServer,
  parseMcpImport,
  parseMcpToolName,
  serializeMcpExport,
  toolRiskFor,
  type McpEvent,
  type McpServerConfig,
  type McpServerState,
  type McpServerStatus,
  type McpToolInfo,
  type McpToolRisk
} from '@shared/mcp'
import type { ImageMeta } from '@shared/tool-meta'
import { logEvent } from './logger'
import type { ToolResult } from './tools'

/**
 * MCP server manager: owns the `userData/mcp.json` file, spawns servers
 * through the official SDK, keeps their status and tools, and turns every
 * ready tool into an agent-callable function. A server that dies (Unity
 * domain reload, Blender restart) is reconnected automatically a few times
 * before the UI reports the failure.
 */

const MAX_STDERR_LINES = 200
const CONNECT_TIMEOUT_MS = 15000
const RECONNECT_LIMIT = 5

interface ManagedServer {
  config: McpServerConfig
  status: McpServerStatus
  error: string | null
  client: Client | null
  pid: number | null
  tools: McpToolInfo[]
  schemas: Map<string, unknown>
  startedAt: number | null
  restarts: number
  stderr: string[]
  /** Set while an intentional stop is in flight, so onclose stays quiet. */
  stopping: boolean
  reconnectTimer: NodeJS.Timeout | null
  reconnectAttempts: number
  /** Bumped on every start/stop; stale async completions are ignored. */
  generation: number
}

const servers = new Map<string, ManagedServer>()
let notify: ((event: McpEvent) => void) | null = null
let loaded = false

function mcpFilePath(): string {
  return join(app.getPath('userData'), 'mcp.json')
}

function loadFile(): void {
  if (loaded) return
  loaded = true
  let raw: unknown = null
  try {
    if (existsSync(mcpFilePath())) {
      raw = JSON.parse(readFileSync(mcpFilePath(), 'utf8'))
    }
  } catch (error) {
    logEvent('warn', `mcp.json is unreadable: ${errorMessage(error)}`)
  }
  const map = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>).mcpServers : null) ?? null
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    for (const [name, value] of Object.entries(map as Record<string, unknown>)) {
      const config = normalizeMcpServer(value, name)
      if (config) servers.set(name, freshServer(config))
    }
  }
}

function saveFile(): void {
  const mcpServers: Record<string, McpServerConfig> = {}
  for (const [name, managed] of servers) mcpServers[name] = managed.config
  const file = mcpFilePath()
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify({ mcpServers }, null, 2), 'utf8')
  renameSync(tmp, file)
}

function freshServer(config: McpServerConfig): ManagedServer {
  return {
    config,
    status: 'stopped',
    error: null,
    client: null,
    pid: null,
    tools: [],
    schemas: new Map(),
    startedAt: null,
    restarts: 0,
    stderr: [],
    stopping: false,
    reconnectTimer: null,
    reconnectAttempts: 0,
    generation: 0
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function setNotify(listener: ((event: McpEvent) => void) | null): void {
  notify = listener
}

function emit(event: McpEvent): void {
  try {
    notify?.(event)
  } catch {
    // The renderer window may be gone mid-emit; the state itself is safe.
  }
}

/** Connector setup code (apps.ts) reports progress through the same channel. */
export function emitMcpEvent(event: McpEvent): void {
  emit(event)
}

function emitState(): void {
  emit({ type: 'state', states: listStates() })
}

function pushStderr(managed: ManagedServer, line: string): void {
  managed.stderr.push(line)
  if (managed.stderr.length > MAX_STDERR_LINES) managed.stderr.splice(0, managed.stderr.length - MAX_STDERR_LINES)
  emit({ type: 'stderr', name: managed.config.name, line })
}

export function listStates(): McpServerState[] {
  loadFile()
  return [...servers.values()].map((managed) => ({
    name: managed.config.name,
    config: managed.config,
    status: managed.status,
    error: managed.error,
    pid: managed.pid,
    tools: managed.tools,
    startedAt: managed.startedAt,
    restarts: managed.reconnectAttempts,
    stderr: [...managed.stderr.slice(-40)]
  }))
}

function setStatus(managed: ManagedServer, status: McpServerStatus, error: string | null = null): void {
  managed.status = status
  managed.error = error
  emitState()
}

/* ------------------------------------------------------------------ start/stop */

/**
 * Spawns/connects one server and caches its tool list. The promise settles
 * once the attempt is over (ready or error), so the IPC caller can show the
 * outcome; reconnects later on are fire-and-forget.
 */
export async function startServer(
  name: string,
  isReconnect = false
): Promise<{ ok: boolean; error: string | null }> {
  loadFile()
  const managed = servers.get(name)
  if (!managed) return { ok: false, error: 'unknown-server' }
  const { config } = managed

  if (config.transport === 'stdio' && !config.trusted) {
    return { ok: false, error: 'untrusted' }
  }
  if (!config.enabled) return { ok: false, error: 'disabled' }

  await stopServer(name, { silent: true })
  const generation = managed.generation + 1
  managed.generation = generation
  managed.stopping = false
  if (!isReconnect) managed.reconnectAttempts = 0
  setStatus(managed, 'starting')

  const client = new Client({ name: 'RelaxCode', version: app.getVersion() })
  managed.client = client

  let transport: StdioClientTransport | StreamableHTTPClientTransport
  try {
    transport =
      config.transport === 'http'
        ? new StreamableHTTPClientTransport(new URL(config.url))
        : new StdioClientTransport({
            command: config.command,
            args: config.args,
            // An exact empty env would strip PATH/SystemRoot from the child;
            // inherit ours and let the config override single keys.
            env: { ...process.env, ...config.env } as Record<string, string>,
            ...(config.cwd ? { cwd: config.cwd } : {})
          })
  } catch (error) {
    managed.client = null
    setStatus(managed, 'error', errorMessage(error))
    return { ok: false, error: managed.error }
  }

  // Stdio stderr is where MCP servers log their own diagnostics; keep a tail
  // for the UI instead of letting it vanish into the void.
  if (transport instanceof StdioClientTransport) {
    void readStderrStream(transport, managed, generation)
  }

  const connectTimeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`connection timed out after ${CONNECT_TIMEOUT_MS} ms`)), CONNECT_TIMEOUT_MS)
  })

  try {
    await Promise.race([client.connect(transport), connectTimeout])
    if (generation !== managed.generation) {
      // A stop/restart happened while connecting; drop this attempt.
      await closeClient(client)
      return { ok: false, error: 'superseded' }
    }
    if (transport instanceof StdioClientTransport) managed.pid = transport.pid ?? null

    const listed = await Promise.race([client.listTools(), connectTimeout])
    if (generation !== managed.generation) {
      await closeClient(client)
      return { ok: false, error: 'superseded' }
    }

    managed.tools = []
    managed.schemas = new Map()
    for (const tool of listed.tools) {
      if (!tool || typeof tool.name !== 'string' || tool.name.length === 0) continue
      managed.tools.push({
        name: mcpToolFullName(config.name, tool.name),
        server: config.name,
        tool: tool.name,
        description: clampMcpDescription(tool.description),
        risk: toolRiskFor(config, tool.name)
      })
      managed.schemas.set(
        tool.name,
        (tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : { type: 'object' }) as object
      )
    }

    managed.startedAt = Date.now()
    managed.error = null
    setStatus(managed, 'ready')
    logEvent('info', `mcp ${config.name} ready (${managed.tools.length} tools)`)
    emit({ type: 'tool-list-changed', name: config.name })
    return { ok: true, error: null }
  } catch (error) {
    if (generation !== managed.generation) return { ok: false, error: 'superseded' }
    await closeClient(client)
    managed.client = null
    managed.pid = null
    const message = errorMessage(error)
    setStatus(managed, 'error', message)
    logEvent('warn', `mcp ${config.name} failed: ${message}`)
    scheduleReconnect(managed)
    return { ok: false, error: message }
  }
}

async function readStderrStream(
  transport: StdioClientTransport,
  managed: ManagedServer,
  generation: number
): Promise<void> {
  const stream = transport.stderr as unknown as NodeWebReadable<Uint8Array> | null
  if (!stream) return
  const decoder = new TextDecoder()
  let pending = ''
  try {
    const reader = stream.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (generation !== managed.generation) break
      pending += decoder.decode(value, { stream: true })
      for (;;) {
        const newline = pending.indexOf('\n')
        if (newline < 0) break
        const line = pending.slice(0, newline).trimEnd()
        pending = pending.slice(newline + 1)
        if (line.length > 0) pushStderr(managed, line.slice(0, 500))
      }
    }
  } catch {
    // The stream dies with the process; onclose handles the reconnect.
  }
}

/** A dead server (Unity domain reload, Blender restart) gets a few tries back. */
function scheduleReconnect(managed: ManagedServer): void {
  const { config } = managed
  if (!config.enabled || !config.trusted) return
  if (managed.reconnectTimer) return
  if (managed.reconnectAttempts >= RECONNECT_LIMIT) return

  managed.reconnectAttempts += 1
  const delay = Math.min(30000, 1500 * 2 ** (managed.reconnectAttempts - 1))
  logEvent('info', `mcp ${config.name} reconnect in ${Math.round(delay / 1000)}s (attempt ${managed.reconnectAttempts})`)
  managed.reconnectTimer = setTimeout(() => {
    managed.reconnectTimer = null
    if (managed.status === 'stopped') return
    void startServer(config.name, true).then((result) => {
      if (!result.ok && managed.status === 'error' && managed.reconnectAttempts >= RECONNECT_LIMIT) {
        // The last attempt failed: the UI already shows the error.
      }
    })
  }, delay)
}

async function closeClient(client: Client | null): Promise<void> {
  if (!client) return
  try {
    await client.close()
  } catch {
    // Closing a half-open connection may throw; nothing left to save.
  }
}

export async function stopServer(
  name: string,
  options: { silent?: boolean } = {}
): Promise<{ ok: boolean }> {
  loadFile()
  const managed = servers.get(name)
  if (!managed) return { ok: false }
  if (managed.reconnectTimer) {
    clearTimeout(managed.reconnectTimer)
    managed.reconnectTimer = null
  }
  managed.stopping = true
  managed.generation += 1
  const client = managed.client
  managed.client = null
  managed.pid = null
  managed.tools = []
  managed.schemas = new Map()
  managed.startedAt = null
  await closeClient(client)
  managed.stopping = false
  setStatus(managed, 'stopped')
  if (!options.silent) logEvent('info', `mcp ${name} stopped`)
  return { ok: true }
}

/* ----------------------------------------------------------------- tool defs */

export interface McpToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  risk: McpToolRisk
  execute: (args: Record<string, unknown>, ctx: { signal: AbortSignal }) => Promise<ToolResult>
}

/** Every call the agent can make right now, ready to be merged into the registry. */
export function mcpToolDefs(): McpToolDef[] {
  loadFile()
  const defs: McpToolDef[] = []
  for (const managed of servers.values()) {
    const { config } = managed
    if (!config.enabled || !config.trusted || managed.status !== 'ready') continue
    for (const tool of managed.tools) {
      if (!mcpToolEnabled(config, tool.tool)) continue
      const schema = managed.schemas.get(tool.tool)
      defs.push({
        name: tool.name,
        description: tool.description.length > 0 ? `[MCP ${config.name}] ${tool.description}` : `[MCP ${config.name}]`,
        parameters: (schema && typeof schema === 'object' ? schema : { type: 'object' }) as Record<string, unknown>,
        risk: tool.risk,
        execute: async (args, ctx) => callToolAsResult(config.name, tool.tool, args, ctx.signal)
      })
    }
  }
  // Many connected servers must not eat the context window: over the budget
  // the schemas degrade (descriptions first, then parameters).
  return applyMcpSchemaBudget(defs, MCP_SCHEMA_BUDGET)
}

async function callToolAsResult(
  server: string,
  tool: string,
  args: Record<string, unknown>,
  signal: AbortSignal
): Promise<ToolResult> {
  loadFile()
  const managed = servers.get(server)
  if (!managed) return { ok: false, summary: `unknown MCP server: ${server}`, detail: '' }
  if (managed.status !== 'ready' || !managed.client) {
    return {
      ok: false,
      summary: `MCP server "${server}" is not ready (${managed.status})`,
      detail:
        managed.error
          ? `Last error: ${managed.error}. The server may be restarting — wait a moment and retry once, or tell the user to check Settings → Applications & MCP.`
          : 'The server may be restarting — wait a moment and retry once, or tell the user to check Settings → Applications & MCP.'
    }
  }
  const timeoutMs = managed.config.timeoutMs
  try {
    const result = await managed.client.callTool(
      { name: tool, arguments: args },
      undefined,
      { signal, timeout: timeoutMs }
    )
    const { ok, text, images } = mcpResultToText(result, 30000)
    // Screenshots and renders travel as base64 image parts; surface the first
    // one as a chat picture card, exactly like show_image does.
    let meta: ImageMeta | undefined
    const firstImage = images[0]
    if (firstImage) {
      meta = {
        kind: 'image',
        src: firstImage.dataUrl,
        alt: `${server} ${tool}`,
        caption: `${server}:${tool}`,
        mime: firstImage.mime,
        bytes: firstImage.bytes
      }
    }
    return {
      ok,
      summary: `${server}:${tool} ${ok ? 'ok' : 'error'}`,
      detail: text,
      ...(meta ? { meta } : {})
    }
  } catch (error) {
    const message = errorMessage(error)
    // Watchdog: a closed transport (the app crashed, recompiled, restarted)
    // must not leave the manager thinking the server is still ready. Mark it
    // and let the reconnect loop bring it back.
    if (/connection closed|not connected|transport closed|fetch failed/i.test(message)) {
      managed.client = null
      managed.pid = null
      setStatus(managed, 'error', message)
      scheduleReconnect(managed)
    }
    return {
      ok: false,
      summary: `MCP call failed: ${server}:${tool}`,
      detail:
        /timed?\s?out/i.test(message)
          ? `The call timed out after ${Math.round(timeoutMs / 1000)}s. The tool may still be running inside the app; check the app's own window before retrying.`
          : message
    }
  }
}

/* ------------------------------------------------------------- config editing */

/** The fields that make a server "the same program": changing one resets trust. */
function identity(config: McpServerConfig): string {
  return JSON.stringify([
    config.transport,
    config.command,
    config.args,
    config.env,
    config.cwd,
    config.url
  ])
}

export function saveServer(raw: unknown): { ok: boolean; error: string | null } {
  loadFile()
  const config = normalizeMcpServer(raw, '')
  if (!config) return { ok: false, error: 'invalid-config' }
  const existing = servers.get(config.name)
  if (existing) {
    // Same program → keep the trust decision; anything else starts over.
    config.trusted = existing.config.trusted && identity(existing.config) === identity(config)
  }
  servers.set(config.name, { ...freshServer(config), status: existing?.status ?? 'stopped' })
  const managed = servers.get(config.name)
  if (managed) {
    managed.tools = []
    managed.schemas = new Map()
  }
  if (existing && (identity(existing.config) !== identity(config) || !config.enabled)) {
    void stopServer(config.name)
  }
  saveFile()
  emitState()
  return { ok: true, error: null }
}

export function removeServer(name: string): void {
  loadFile()
  if (!servers.has(name)) return
  void stopServer(name)
  servers.delete(name)
  saveFile()
  emitState()
}

export function trustServer(name: string): { ok: boolean } {
  loadFile()
  const managed = servers.get(name)
  if (!managed) return { ok: false }
  managed.config = { ...managed.config, trusted: true }
  saveFile()
  emitState()
  return { ok: true }
}

export function importServers(json: string): { ok: boolean; added: number; error: string | null } {
  loadFile()
  const { servers: parsed, error } = parseMcpImport(json)
  if (error !== null) return { ok: false, added: 0, error }
  let added = 0
  for (const config of parsed) {
    // Imported servers always arrive untrusted, even when the name existed.
    servers.set(config.name, freshServer({ ...config, trusted: false }))
    added += 1
  }
  saveFile()
  emitState()
  return { ok: true, added, error: null }
}

export function exportServersJson(): string {
  loadFile()
  return serializeMcpExport([...servers.values()].map((managed) => managed.config))
}

/* ------------------------------------------------------------------- lifecycle */

export async function stopAllMcp(): Promise<void> {
  for (const name of [...servers.keys()]) await stopServer(name, { silent: true })
}

/** Manual test call from the settings screen (the trust check happens there). */
export async function invokeTool(
  server: string,
  tool: string,
  argsJson: string
): Promise<{ ok: boolean; text: string; error: string | null }> {
  let args: Record<string, unknown> = {}
  if (argsJson.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(argsJson)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>
      } else {
        return { ok: false, text: '', error: 'invalid-json' }
      }
    } catch {
      return { ok: false, text: '', error: 'invalid-json' }
    }
  }
  const result = await callToolAsResult(server, tool, args, new AbortController().signal)
  return { ok: result.ok, text: result.detail, error: null }
}

/** True when `name` is an MCP tool name (`mcp__server__tool`) that exists now. */
export function isMcpToolName(name: string): boolean {
  const parsed = parseMcpToolName(name)
  if (!parsed) return false
  return mcpToolDefs().some((def) => def.name === name)
}

export { setNotify }
