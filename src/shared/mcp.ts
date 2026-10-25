import { asBoolean, asNumber, asString, asStringList, asChoice } from './settings.ts'

/**
 * Model Context Protocol: external servers the agent can call as tools.
 *
 * The on-disk config (`userData/mcp.json`) is a superset of the Claude Desktop
 * format, so a user can paste an existing `{ "mcpServers": … }` file and only
 * add the trust confirmation on top. The pure helpers here are shared by the
 * main process and the renderer and are covered by `npm run test:mcp`.
 */

export type McpToolRisk = 'read' | 'write' | 'exec' | 'delete'

export const MCP_RISKS = ['read', 'write', 'exec', 'delete'] as const

export type McpTransport = 'stdio' | 'http'

export const MCP_TRANSPORTS = ['stdio', 'http'] as const

export interface McpServerConfig {
  /** Unique, filesystem- and prompt-friendly: letters, digits, `_` and `-`. */
  name: string
  transport: McpTransport
  /** stdio: executable to spawn. */
  command: string
  args: string[]
  env: Record<string, string>
  /** stdio: working directory for the spawned process. */
  cwd: string
  /** http: streamable-HTTP endpoint. */
  url: string
  enabled: boolean
  /**
   * The user saw the exact command/env this server runs and accepted it. An
   * untrusted server is listed in the UI but is never spawned and its tools
   * never reach the agent.
   */
  trusted: boolean
  /** Risk of every tool that has no specific override. */
  defaultRisk: McpToolRisk
  toolRisk: Record<string, McpToolRisk>
  disabledTools: string[]
  /** Per-call timeout in ms; a hung tool must not hang the agent loop. */
  timeoutMs: number
}

export type McpServerStatus = 'stopped' | 'starting' | 'ready' | 'error'

export interface McpToolInfo {
  /** Full name the agent sees: `mcp__<server>__<tool>`. */
  name: string
  server: string
  tool: string
  description: string
  risk: McpToolRisk
}

export interface McpServerState {
  name: string
  config: McpServerConfig
  status: McpServerStatus
  error: string | null
  pid: number | null
  tools: McpToolInfo[]
  startedAt: number | null
  /** Automatic reconnect attempts since the last successful start. */
  restarts: number
  /** Last stderr lines, oldest first — the UI shows this when a server fails. */
  stderr: string[]
}

export const MCP_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

/** Longest tool description that goes into the model-visible schema. */
export const MCP_MAX_DESCRIPTION = 400

/**
 * Env keys whose values look like secrets. They are shown in the trust dialog
 * (the user must see what they run) but stripped from the JSON export.
 */
export function isSecretishEnvKey(key: string): boolean {
  return /api[-_]?key|token|secret|password|credential/i.test(key)
}

export function mcpToolFullName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`
}

export function parseMcpToolName(fullName: string): { server: string; tool: string } | null {
  if (!fullName.startsWith('mcp__')) return null
  const rest = fullName.slice('mcp__'.length)
  const sep = rest.indexOf('__')
  if (sep <= 0 || sep === rest.length - 2) return null
  return { server: rest.slice(0, sep), tool: rest.slice(sep + 2) }
}

export function toolRiskFor(config: McpServerConfig, tool: string): McpToolRisk {
  return config.toolRisk[tool] ?? config.defaultRisk
}

export function mcpToolEnabled(config: McpServerConfig, tool: string): boolean {
  return !config.disabledTools.includes(tool)
}

/**
 * Accepts anything a hand-edited file or a Claude Desktop import may carry and
 * returns a complete config, or null when the entry cannot be used at all
 * (no name, a bad name, or nothing to connect to).
 */
export function normalizeMcpServer(raw: unknown, fallbackName: string): McpServerConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>
  const nameInput = typeof input.name === 'string' && input.name.trim().length > 0 ? input.name.trim() : fallbackName
  if (!MCP_NAME_RE.test(nameInput)) return null

  const transport = asChoice<McpTransport>(
    input.transport,
    MCP_TRANSPORTS,
    input.url !== undefined && typeof input.url === 'string' && input.url.trim().length > 0
      ? 'http'
      : 'stdio'
  )

  const command = asString(input.command, '', 1000).trim()
  const url = asString(input.url, '', 1000).trim()
  if (transport === 'stdio' && command.length === 0) return null
  if (transport === 'http' && !/^https?:\/\//i.test(url)) return null

  const env: Record<string, string> = {}
  if (input.env && typeof input.env === 'object' && !Array.isArray(input.env)) {
    for (const [key, value] of Object.entries(input.env as Record<string, unknown>)) {
      if (!MCP_NAME_RE.test(key)) continue
      if (typeof value !== 'string' && typeof value !== 'number') continue
      env[key] = String(value)
    }
  }

  const args = asStringList(input.args, [], 40)

  const toolRisk: Record<string, McpToolRisk> = {}
  if (input.toolRisk && typeof input.toolRisk === 'object' && !Array.isArray(input.toolRisk)) {
    for (const [tool, risk] of Object.entries(input.toolRisk as Record<string, unknown>)) {
      if (MCP_NAME_RE.test(tool)) toolRisk[tool] = asChoice(risk, MCP_RISKS, 'exec')
    }
  }

  return {
    name: nameInput,
    transport,
    command,
    args,
    env,
    cwd: asString(input.cwd, '', 1000).trim(),
    url,
    enabled: asBoolean(input.enabled, true),
    // A server that arrives from a file is never trusted automatically.
    trusted: asBoolean(input.trusted, false),
    defaultRisk: asChoice(input.defaultRisk, MCP_RISKS, 'exec'),
    toolRisk,
    disabledTools: asStringList(input.disabledTools, [], 200),
    timeoutMs: Math.round(asNumber(input.timeoutMs, 1000, 600000, 60000))
  }
}

/** The `{ mcpServers: … }` file: Claude Desktop's shape, our fields on top. */
export interface McpServersFile {
  mcpServers: Record<string, McpServerConfig>
}

export function normalizeMcpFile(raw: unknown): McpServersFile {
  const out: McpServersFile = { mcpServers: {} }
  if (!raw || typeof raw !== 'object') return out
  const servers = (raw as Record<string, unknown>).mcpServers
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return out
  for (const [name, value] of Object.entries(servers as Record<string, unknown>)) {
    const config = normalizeMcpServer(value, name)
    // Hand-edited files can duplicate names after a rename; last one wins.
    if (config) out.mcpServers[name] = config
  }
  return out
}

/**
 * Parses a pasted/imported JSON document. Accepts both the full
 * `{ "mcpServers": … }` file and a bare `{ "name": { "command": … } }` map, so
 * a Claude Desktop snippet without the wrapper also imports.
 */
export function parseMcpImport(json: string): { servers: McpServerConfig[]; error: string | null } {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { servers: [], error: 'invalid-json' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { servers: [], error: 'invalid-json' }
  }
  const map = (parsed as Record<string, unknown>).mcpServers ?? parsed
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return { servers: [], error: 'invalid-json' }
  }
  const servers: McpServerConfig[] = []
  for (const [name, value] of Object.entries(map as Record<string, unknown>)) {
    const config = normalizeMcpServer(value, name)
    if (config) servers.push(config)
  }
  if (servers.length === 0) return { servers: [], error: 'no-servers' }
  return { servers, error: null }
}

/**
 * The export writes the portable Claude Desktop shape. Env values that look
 * like secrets are dropped rather than copied onto the clipboard / disk.
 */
export function serializeMcpExport(configs: McpServerConfig[]): string {
  const mcpServers: Record<string, unknown> = {}
  for (const config of configs) {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(config.env)) {
      if (!isSecretishEnvKey(key)) env[key] = value
    }
    mcpServers[config.name] =
      config.transport === 'http'
        ? { url: config.url, env }
        : { command: config.command, args: config.args, env, ...(config.cwd ? { cwd: config.cwd } : {}) }
  }
  return JSON.stringify({ mcpServers }, null, 2)
}

export interface McpContentPart {
  type?: string
  text?: string
  data?: string
  mimeType?: string
}

/** An image inside an MCP tool result (e.g. a Blender viewport screenshot). */
export interface McpResultImage {
  /** `data:<mime>;base64,<payload>` — ready for an <img> and for ImageMeta. */
  dataUrl: string
  mime: string
  bytes: number
}

/**
 * MCP tool results arrive as `{ content: [{type:'text',text}, …], isError? }`.
 * Flatten that to the plain string a RelaxCode tool result carries; image
 * parts (base64) come back separately so the chat can render them as cards.
 */
export function mcpResultToText(
  result: unknown,
  maxChars: number
): { ok: boolean; text: string; images: McpResultImage[] } {
  if (!result || typeof result !== 'object') {
    return { ok: false, text: 'Empty tool result.', images: [] }
  }
  const raw = result as { isError?: unknown; content?: unknown; structuredContent?: unknown }
  const parts = Array.isArray(raw.content) ? (raw.content as McpContentPart[]) : []
  const images: McpResultImage[] = []
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue
    if (part.type === 'image' && typeof part.data === 'string' && typeof part.mimeType === 'string') {
      images.push({
        dataUrl: `data:${part.mimeType};base64,${part.data}`,
        mime: part.mimeType,
        bytes: Math.round((part.data.length * 3) / 4)
      })
    }
  }
  let text = parts
    .filter((part) => part && typeof part === 'object')
    .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .filter((line) => line.length > 0)
    .join('\n')
  if (text.length === 0 && raw.structuredContent && typeof raw.structuredContent === 'object') {
    try {
      text = JSON.stringify(raw.structuredContent, null, 2)
    } catch {
      text = ''
    }
  }
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n… [truncated, ${text.length - maxChars} chars omitted]`
  }
  const ok = raw.isError !== true
  return { ok, text: text.length > 0 ? text : ok ? 'The tool returned no content.' : 'The tool reported an error.', images }
}

/**
 * Filesystem- and prompt-safe part of a per-server playbook file name. Server
 * names are already validated, but playbooks must survive renames of the app
 * config folder, so the mapping is deliberately its own function.
 */
export function playbookFileName(server: string): string {
  const safe = server.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
  return `${safe}.md`
}

/** Clamp a description for the model: MCP servers can send huge prompts. */
export function clampMcpDescription(description: unknown): string {
  const text = typeof description === 'string' ? description.trim() : ''
  if (text.length <= MCP_MAX_DESCRIPTION) return text
  return `${text.slice(0, MCP_MAX_DESCRIPTION)}…`
}

/**
 * A request can only carry so much tool schema. Dozens of connected servers
 * would eat the context window with JSON, so when the budget is exceeded the
 * schemas degrade step by step instead of silently dropping tools: first the
 * descriptions shorten, then the parameters collapse to an empty object.
 * Tool names always survive — a name the model cannot see is a call it
 * cannot make.
 */
export function applyMcpSchemaBudget<T extends { name: string; description: string; parameters: unknown }>(
  defs: T[],
  budgetChars: number
): T[] {
  const sizeOf = (def: T): number =>
    def.description.length + JSON.stringify(def.parameters ?? {}).length
  let total = defs.reduce((sum, def) => sum + sizeOf(def), 0)
  if (total <= budgetChars) return defs

  const out = defs.map((def) => ({ ...def }))
  // Step 1: trim descriptions to a hint. Names and schemas stay intact.
  for (const def of out) {
    if (total <= budgetChars) break
    if (def.description.length > 80) {
      total -= def.description.length - 80
      def.description = def.description.slice(0, 80)
    }
  }
  // Step 2: drop the parameter schemas entirely.
  for (const def of out) {
    if (total <= budgetChars) break
    total -= JSON.stringify(def.parameters ?? {}).length
    def.parameters = { type: 'object' }
  }
  return out
}

/** Total characters the MCP tool schemas may take in one request. */
export const MCP_SCHEMA_BUDGET = 48000

/** Main → renderer push: full server states on every change, stderr lines live. */
export type McpEvent =
  | { type: 'state'; states: McpServerState[] }
  | { type: 'stderr'; name: string; line: string }
  | { type: 'tool-list-changed'; name: string }
  /** Progress of a connector setup (venv creation, pip install, addon copy). */
  | { type: 'setup'; line: string; level: 'info' | 'error' }
  /**
   * A capture of the application window taken right after one of its tools
   * ran — a frame of the Screen panel's history, captioned with the step.
   */
  | { type: 'frame'; server: string; dataUrl: string; caption: string; at: number }

/** An application on this computer a connector can attach to. */
export interface McpDetectedApp {
  app: string
  label: string
  exePath: string
  version: string | null
  /** Per-user config folder of this install (null when never launched). */
  configDir: string | null
  /** The connector's addon/plugin is already in the config folder. */
  addonInstalled: boolean
}
