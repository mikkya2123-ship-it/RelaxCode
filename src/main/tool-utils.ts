import { exec } from 'node:child_process'
import { relative, sep } from 'node:path'
import type { TodoItem } from '@shared/ipc'
import type { McpToolRisk } from '@shared/mcp'
import type { ToolMeta } from '@shared/tool-meta'
import { assertInsideWorkspace, getWorkspaceRoot } from './workspace'
import { getSettings, type AppSettings } from './store'
import { decodeConsoleOutput } from './terminal'
import { mirrorAgentCommand } from './term-sessions'

/* ------------------------------------------------------------------------- *
 * Shared plumbing of every tool module: the shapes, the argument readers and
 * the two runners (captured exec, git). tools.ts re-exports the types so the
 * rest of the main process keeps importing them from one place.
 * ------------------------------------------------------------------------- */

export type ToolRisk = McpToolRisk

export interface ToolContext {
  signal: AbortSignal
  setTodos: (todos: TodoItem[]) => void
  askUser: (question: string, options: string[]) => Promise<string>
  /** Notify the UI that the set of background processes changed. */
  emitProcesses: () => void
  /** Streams structured progress for a rich tool card. */
  report?: (meta: ToolMeta) => void
  /** Per-run web-search budget and stable citation numbering. */
  webSearch?: {
    take: () => boolean
    reserve: (count: number) => number[]
  }
  /** Hands a picture to the MODEL itself (screenshots it should look at). */
  showModelImage?: (dataUrl: string, caption: string) => void
  /** Desktop notification; false when the window cannot show it. */
  notify?: (title: string, body?: string) => boolean
  /** Opens a workspace file in the editor at a line; false when unavailable. */
  openInEditor?: (path: string, line?: number) => boolean
  /** Speaks text aloud in the renderer. */
  speak?: (text: string) => boolean
  /** Asks the renderer to write the current chat out; null on no answer. */
  exportChat?: (fileName: string) => Promise<string | null>
}

export interface ToolResult {
  ok: boolean
  summary: string
  detail: string
  /** Optional typed payload; the chat renders `web-search` results specially. */
  meta?: ToolMeta
}

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  risk: ToolRisk
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
}

/** Live values: every one of these can be changed from the settings screen. */
export const cfg = (): AppSettings => getSettings()

export class ToolError extends Error {}

export function argString(args: Record<string, unknown>, key: string, required = true): string {
  const value = args[key]
  if (typeof value === 'string' && value.length > 0) return value
  if (!required) return ''
  throw new ToolError(`Missing required argument: ${key}`)
}

export function argNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return undefined
}

export function argBool(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true
}

/** Said once, so every file tool gives the model the same actionable answer. */
export const NO_WORKSPACE =
  'No folder is open in the IDE, so there is no project to read or change. Ask the user to open one — the terminal tools work without a folder.'

export function resolveInWorkspace(input: string): string {
  if (!getWorkspaceRoot()) throw new ToolError(NO_WORKSPACE)
  return assertInsideWorkspace(input)
}

export function relPath(absolute: string): string {
  const root = getWorkspaceRoot()
  if (!root) return absolute
  const rel = relative(root, absolute)
  return rel === '' ? '.' : rel.split(sep).join('/')
}

export function truncate(text: string, limit = cfg().tools.maxOutputChars): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n… [truncated, ${text.length - limit} chars omitted]`
}

export interface ExecOutcome {
  ok: boolean
  code: number | null
  output: string
}

/**
 * Runs a command, captures stdout+stderr (decoded from the console code page)
 * and returns a plain outcome. This is the building block for git and for the
 * check tools; interactive/long-running commands go through proc.ts instead.
 */
export function execCapture(
  command: string,
  cwd: string,
  signal: AbortSignal,
  timeoutMs = 30000
): Promise<ExecOutcome> {
  return new Promise<ExecOutcome>((resolve) => {
    exec(
      command,
      { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true, signal, encoding: 'buffer' },
      (error, stdout, stderr) => {
        const output = [stdout, stderr]
          .map((part) => decodeConsoleOutput(part))
          .filter((part) => part.length > 0)
          .join('\n')
        const outcome = { ok: !error, code: error ? ((error as { code?: number }).code ?? 1) : 0, output }
        // The terminal panel shows what the AI runs as it runs it.
        mirrorAgentCommand(command, outcome)
        resolve(outcome)
      }
    )
  })
}

/** execCapture as a ToolResult — how the git tools report. */
export function execToolResult(command: string, cwd: string, signal: AbortSignal, timeoutMs?: number): Promise<ToolResult> {
  return execCapture(command, cwd, signal, timeoutMs).then((outcome) => ({
    ok: outcome.ok,
    summary: outcome.ok ? 'ok' : `exit code ${outcome.code ?? 1}`,
    detail: truncate(outcome.output || '(no output)')
  }))
}

/** Quotes one shell argument for cmd/PowerShell/POSIX double-quoted style. */
export function shellQuote(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ').replace(/\\/g, '/').replace(/"/g, '\\"')
  return `"${clean}"`
}
