import { platform } from 'node:os'
import { safeHttpUrl } from '@shared/web-search'
import { backgroundOutput, listBackground } from './proc'
import {
  argNumber,
  argString,
  execCapture,
  ToolError,
  truncate,
  type ToolDef
} from './tool-utils'

/**
 * Eyes on the running system: what a background process has been printing,
 * who occupies a port, how to kill a stuck process, and whether a URL
 * answers. Without these the agent starts things and then goes blind.
 */

const terminalFeedTool: ToolDef = {
  name: 'terminal_feed',
  description:
    'Read the recent output of a background process started by start_server or run in the terminal panel. Use it to see logs, errors and startup messages of a running dev server. Call list_servers first when you do not know the process id.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Process id from list_servers' },
      lines: { type: 'number', description: 'How many last lines to return (default 60)' }
    },
    required: ['id']
  },
  risk: 'read',
  execute: async (args) => {
    const id = argString(args, 'id')
    const entry = listBackground().find((item) => item.id === id)
    if (!entry) {
      const known = listBackground().map((item) => `${item.id} — ${item.command}`).join('\n')
      return { ok: false, summary: 'unknown process id', detail: known || 'No background processes are running.' }
    }
    const limit = Math.min(Math.max(argNumber(args, 'lines') ?? 60, 5), 400)
    const full = backgroundOutput(id)
    const all = full.split('\n')
    const feed = all.length > limit ? `[… ${all.length - limit} earlier lines omitted]\n${all.slice(-limit).join('\n')}` : full
    return {
      ok: true,
      summary: `${entry.command.slice(0, 60)} — last ${Math.min(all.length, limit)} lines`,
      detail: truncate(feed || '(no output yet)')
    }
  }
}

interface PortRow {
  port: number
  pid: number
  name: string
}

async function windowsPortRows(port: number, signal: AbortSignal): Promise<PortRow[]> {
  const netstat = await execCapture(`netstat -ano -p tcp`, '.', signal, 30000)
  const rows: PortRow[] = []
  const pids = new Set<number>()
  for (const line of netstat.output.split('\n')) {
    // TCP    127.0.0.1:3000    0.0.0.0:0    LISTENING    4212
    const match = new RegExp(`[:.]${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, 'i').exec(line)
    if (match) pids.add(Number(match[1]))
  }
  for (const pid of pids) {
    const task = await execCapture(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, '.', signal, 20000)
    const name = task.output.split('\n')[0]?.split(',')[0]?.replace(/"/g, '') ?? `PID ${pid}`
    rows.push({ port, pid, name })
  }
  return rows
}

async function posixPortRows(port: number, signal: AbortSignal): Promise<PortRow[]> {
  const lsof = await execCapture(`lsof -i :${port} -P -n -sTCP:LISTEN 2>/dev/null || true`, '.', signal, 20000)
  const rows: PortRow[] = []
  for (const line of lsof.output.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/)
    const pid = Number(cols[1])
    if (Number.isFinite(pid) && pid > 0 && cols.length > 1) {
      rows.push({ port, pid, name: cols[0] })
    }
  }
  return rows
}

const portCheckTool: ToolDef = {
  name: 'port_check',
  description:
    'Show which process is listening on a network port and its PID/name. Use it when a server "cannot bind" because the port is taken, or to confirm something IS listening after start_server.',
  parameters: {
    type: 'object',
    properties: { port: { type: 'number', description: 'Port number (1-65535)' } },
    required: ['port']
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const port = argNumber(args, 'port')
    if (!port || port < 1 || port > 65535) throw new ToolError('Invalid port number')
    const rows = platform() === 'win32' ? await windowsPortRows(port, ctx.signal) : await posixPortRows(port, ctx.signal)
    if (rows.length === 0) {
      return { ok: true, summary: `port ${port}: nothing is listening`, detail: `No process listens on port ${port}.` }
    }
    return {
      ok: true,
      summary: `port ${port}: ${rows.length} listener(s)`,
      detail: rows.map((row) => `port ${row.port} → ${row.name} (PID ${row.pid})`).join('\n')
    }
  }
}

const processKillTool: ToolDef = {
  name: 'process_kill',
  description:
    'Force-kill a process by PID (with everything it started). Use it for stuck processes that did not stop via stop_server or the terminal. Run port_check or list_servers first to get the PID — never guess one.',
  parameters: {
    type: 'object',
    properties: { pid: { type: 'number', description: 'PID of the process to kill' } },
    required: ['pid']
  },
  risk: 'delete',
  execute: async (args, ctx) => {
    const pid = argNumber(args, 'pid')
    if (!pid || pid < 1) throw new ToolError('Invalid PID')
    const command = platform() === 'win32' ? `taskkill /F /T /PID ${pid}` : `kill -9 ${pid}`
    const outcome = await execCapture(command, '.', ctx.signal, 30000)
    return {
      ok: outcome.ok,
      summary: outcome.ok ? `killed PID ${pid}` : `could not kill PID ${pid}`,
      detail: truncate(outcome.output || '(no output)')
    }
  }
}

const healthCheckTool: ToolDef = {
  name: 'health_check',
  description:
    'Check that a URL answers and how fast: performs one GET request, reports the HTTP status and the response time. Use it after start_server to confirm the app is really up before screenshotting or testing it.',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string', description: 'http(s) URL to check' } },
    required: ['url']
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const raw = argString(args, 'url')
    const url = safeHttpUrl(raw)
    if (!url) throw new ToolError('Only public http(s) URLs are allowed')
    const started = Date.now()
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(15000)]),
        redirect: 'follow'
      })
      const ms = Date.now() - started
      return {
        ok: response.ok,
        summary: `${response.status} ${response.statusText || ''}`.trim() + ` in ${ms}ms`,
        detail: `GET ${url} → HTTP ${response.status} in ${ms} ms${response.redirected ? ` (redirected to ${response.url})` : ''}`
      }
    } catch (error) {
      const ms = Date.now() - started
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, summary: `no answer (${ms}ms)`, detail: `GET ${url} failed after ${ms} ms: ${message}` }
    }
  }
}

export const OBSERVE_TOOLS: ToolDef[] = [terminalFeedTool, portCheckTool, processKillTool, healthCheckTool]
