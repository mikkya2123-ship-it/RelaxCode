import { existsSync, promises as fs } from 'node:fs'
import { app } from 'electron'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { shell } from 'electron'
import type { BackgroundProcessInfo, ChatMode, TodoItem, TodoStatus } from '@shared/ipc'
import type { ImageMeta, FigureMeta, PosterMeta, PosterFact } from '@shared/tool-meta'
import { normalizeFigureSpec, renderFigureSvg } from '@shared/figures'
import { safeHttpUrl } from '@shared/web-search'
import {
  fetchRemoteImage,
  formatBytes,
  imageSize,
  readImageFile,
  toDataUrl
} from './visuals'
import { getWorkspaceRoot, IGNORED_NAMES } from './workspace'
import { homeCwd } from '@shared/run-cwd'
import { mcpToolDefs } from './mcp'
import { blenderPaletteDefs } from './blender-palette'
import { backupFile, displayRelative } from './backup'
import { mirrorAgentCommand } from './term-sessions'
import { diffText } from '@shared/diff'
import type { DiffMeta } from '@shared/tool-meta'
import { GIT_TOOLS } from './tools-git'
import { CHECK_TOOLS } from './tools-check'
import { OBSERVE_TOOLS } from './tools-observe'
import { SCREEN_TOOLS } from './tools-screen'
import { DATA_TOOLS } from './tools-data'
import { PROJECT_TOOLS } from './tools-project'
import { UI_TOOLS } from './tools-ui'
import { SCHEDULE_TOOLS } from './tools-schedule'
import { WEB_TOOLS } from './tools-web'
import { getWebSearchApiKey } from './store'
import { runWebSearch, type WebSearchRecency } from './webSearch'
import {
  backgroundOutput,
  killTree,
  listBackground,
  startBackground,
  startBackgroundInTerminal,
  stopBackground,
  stopBackgroundByPid,
  stopBackgroundByPort
} from './proc'
import {
  dangerousCommand,
  resolveTerminalShell,
  windowsShellHint,
  type DangerousCommand,
  type ResolvedShell
} from '@shared/terminal'
import { decodeConsoleOutput, normaliseOutput, runInWindowsTerminal, shellSummary, spawnShell, WindowsTerminalUnavailableError } from './terminal'
import {
  argBool,
  argNumber,
  argString,
  cfg,
  execToolResult,
  NO_WORKSPACE,
  relPath,
  resolveInWorkspace,
  ToolError,
  truncate,
  type ToolContext,
  type ToolDef,
  type ToolResult
} from './tool-utils'

export type { ToolContext, ToolDef, ToolResult, ToolRisk } from './tool-utils'

const MAX_READ_BYTES = 256 * 1024
const MAX_GLOB_RESULTS = 200
const MAX_CONTENT_RESULTS_PER_FILE = 8
const MAX_LIST_LINES = 400
const MAX_SCAN_FILE_SIZE = 1024 * 1024

/** Workspace names the agent never looks at: the built-in list plus the user's. */
function ignoredNames(): Set<string> {
  return new Set([...IGNORED_NAMES, ...cfg().files.excludeGlobs])
}

async function isBinaryFile(absolute: string): Promise<boolean> {
  const handle = await fs.open(absolute, 'r')
  try {
    const buffer = Buffer.alloc(4096)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return bytesRead > 0 && buffer.subarray(0, bytesRead).includes(0)
  } finally {
    await handle.close()
  }
}

interface WalkOptions {
  maxFiles?: number
  maxDepth?: number
}

async function* walkFiles(
  startAbsolute: string,
  signal: AbortSignal,
  options: WalkOptions = {}
): AsyncGenerator<string> {
  const maxFiles = options.maxFiles ?? cfg().tools.maxScanFiles
  const maxDepth = options.maxDepth ?? 12
  const queue: Array<{ dir: string; depth: number }> = [{ dir: startAbsolute, depth: 0 }]
  let count = 0
  const ignored = ignoredNames()

  while (queue.length > 0) {
    if (signal.aborted) return
    const current = queue.shift()
    if (!current) return
    let entries
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (ignored.has(entry.name) || entry.name === '.DS_Store') continue
      const full = join(current.dir, entry.name)
      if (entry.isDirectory()) {
        if (current.depth < maxDepth) queue.push({ dir: full, depth: current.depth + 1 })
      } else if (entry.isFile()) {
        yield full
        count += 1
        if (count >= maxFiles) return
      }
    }
  }
}

function globToRegex(pattern: string): RegExp {
  let out = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        out += '.*'
        index += 1
        if (pattern[index + 1] === '/') index += 1
      } else {
        out += '[^/]*'
      }
    } else if (char === '?') {
      out += '[^/]'
    } else if ('.+^${}()|[]\\'.includes(char)) {
      out += `\\${char}`
    } else {
      out += char === '/' ? '/' : char
    }
  }
  return new RegExp(`^${out}$`, 'i')
}

const listDirTool: ToolDef = {
  name: 'list_dir',
  description:
    'List files and folders of a directory inside the workspace. Returns a tree with one level by default.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path relative to workspace root. Default: root' },
      depth: { type: 'number', description: 'How many levels deep to list (1-4). Default 1' }
    }
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const depth = Math.min(Math.max(argNumber(args, 'depth') ?? 1, 1), 4)
    const target = resolveInWorkspace(argString(args, 'path', false) || '.')
    const lines: string[] = []

    const visit = async (dir: string, currentDepth: number, prefix: string): Promise<void> => {
      if (lines.length >= MAX_LIST_LINES || ctx.signal.aborted) return
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      const filtered = entries
        .filter((entry) => !ignoredNames().has(entry.name) && entry.name !== '.DS_Store')
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      for (const entry of filtered) {
        if (lines.length >= MAX_LIST_LINES) {
          lines.push(`${prefix}… [truncated]`)
          return
        }
        lines.push(`${prefix}${entry.name}${entry.isDirectory() ? '/' : ''}`)
        if (entry.isDirectory() && currentDepth < depth) {
          await visit(join(dir, entry.name), currentDepth + 1, `${prefix}  `)
        }
      }
    }

    await visit(target, 1, '')
    return {
      ok: true,
      summary: `${relPath(target)}: ${lines.length} entries`,
      detail: lines.join('\n')
    }
  }
}

const readFileTool: ToolDef = {
  name: 'read_file',
  description:
    'Read a text file inside the workspace. Returns numbered lines. Use offset/limit for large files.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to workspace root' },
      offset: { type: 'number', description: '1-based first line to read' },
      limit: { type: 'number', description: 'Max lines to read (default 2000)' }
    },
    required: ['path']
  },
  risk: 'read',
  execute: async (args) => {
    const target = resolveInWorkspace(argString(args, 'path'))
    const stat = await fs.stat(target).catch(() => null)
    if (!stat || !stat.isFile()) throw new ToolError(`Not a file: ${relPath(target)}`)
    if (await isBinaryFile(target)) return { ok: false, summary: 'binary file', detail: 'Binary files are not supported yet.' }
    if (stat.size > MAX_READ_BYTES * 8) {
      return { ok: false, summary: 'file too large', detail: `File is ${stat.size} bytes; read a smaller range or use search_content.` }
    }

    const maxLines = cfg().tools.maxReadLines
    let content = await fs.readFile(target, 'utf8')
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1)
    const allLines = content.split(/\r?\n/)
    const offset = Math.max(argNumber(args, 'offset') ?? 1, 1)
    const limit = Math.min(Math.max(argNumber(args, 'limit') ?? maxLines, 1), maxLines)
    const slice = allLines.slice(offset - 1, offset - 1 + limit)
    const numbered = slice.map((line, index) => `${offset + index}| ${line}`).join('\n')
    const header =
      allLines.length > slice.length
        ? `File ${relPath(target)} (${allLines.length} lines total, showing ${offset}-${offset + slice.length - 1}):`
        : `File ${relPath(target)} (${allLines.length} lines):`
    return {
      ok: true,
      summary: `read ${relPath(target)} (${slice.length} lines)`,
      detail: `${header}\n${numbered}`
    }
  }
}

const writeFileTool: ToolDef = {
  name: 'write_file',
  description:
    'Create or overwrite a file inside the workspace with the given content. Creates parent directories.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to workspace root' },
      content: { type: 'string', description: 'Full file content' }
    },
    required: ['path', 'content']
  },
  risk: 'write',
  execute: async (args) => {
    const target = resolveInWorkspace(argString(args, 'path'))
    const content = argString(args, 'content', false)
    const before = await fs.readFile(target, 'utf8').catch(() => null)
    await fs.mkdir(dirname(target), { recursive: true })
    await fs.writeFile(target, content, 'utf8')
    const lines = content === '' ? 0 : content.split(/\r?\n/).length
    const diff = before !== null ? diffText(before, content, relPath(target)) : null
    const counts: { added: number; removed: number } =
      diff ?? { added: lines, removed: 0 }
    mirrorAgentCommand(
      `${before === null ? '✎ создать' : '✎ перезаписать'} ${relPath(target)} (+${counts.added} −${counts.removed})`,
      { ok: true, output: '' }
    )
    return {
      ok: true,
      summary: `wrote ${relPath(target)} (${lines} lines, +${counts.added} −${counts.removed})`,
      detail: `File written: ${relPath(target)}`,
      ...(diff && diff.patch !== '' ? { meta: { kind: 'diff', file: relPath(target), patch: diff.patch } as DiffMeta } : {})
    }
  }
}

const editFileTool: ToolDef = {
  name: 'edit_file',
  description:
    'Replace an exact string in a file. old_string must match exactly (including indentation). Fails if not found or ambiguous.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to workspace root' },
      old_string: { type: 'string', description: 'Exact text to replace' },
      new_string: { type: 'string', description: 'Replacement text' },
      replace_all: { type: 'boolean', description: 'Replace all occurrences instead of requiring uniqueness' }
    },
    required: ['path', 'old_string', 'new_string']
  },
  risk: 'write',
  execute: async (args) => {
    const target = resolveInWorkspace(argString(args, 'path'))
    const oldString = argString(args, 'old_string')
    const newString = argString(args, 'new_string', false)
    const replaceAll = argBool(args, 'replace_all')

    let content = await fs.readFile(target, 'utf8').catch(() => {
      throw new ToolError(`File not found: ${relPath(target)}`)
    })
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1)

    const occurrences = content.split(oldString).length - 1
    if (occurrences === 0) throw new ToolError('old_string not found in file')
    if (occurrences > 1 && !replaceAll) {
      throw new ToolError(`old_string matches ${occurrences} places; add more context or set replace_all`)
    }

    const updated = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString)
    await fs.writeFile(target, updated, 'utf8')
    const diff = diffText(content, updated, relPath(target))
    mirrorAgentCommand(`✎ ${relPath(target)} (+${diff.added} −${diff.removed})`, { ok: true, output: '' })
    return {
      ok: true,
      summary: `edited ${relPath(target)} (+${diff.added} −${diff.removed}, ${replaceAll ? occurrences : 1} replacement${occurrences > 1 ? 's' : ''})`,
      detail: `Updated ${relPath(target)}`,
      ...(diff.patch !== ''
        ? { meta: { kind: 'diff', file: relPath(target), patch: diff.patch } as DiffMeta }
        : {})
    }
  }
}

const deletePathTool: ToolDef = {
  name: 'delete_path',
  description: 'Delete a file or a directory (recursively) inside the workspace.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path relative to workspace root' },
      recursive: { type: 'boolean', description: 'Allow deleting a non-empty directory' }
    },
    required: ['path']
  },
  risk: 'delete',
  execute: async (args) => {
    const target = resolveInWorkspace(argString(args, 'path'))
    if (target === getWorkspaceRoot()) throw new ToolError('Refusing to delete the workspace root')
    const stat = await fs.stat(target).catch(() => null)
    if (!stat) throw new ToolError(`Path not found: ${relPath(target)}`)
    const toTrash = cfg().files.useTrash
    if (stat.isDirectory()) {
      const entries = await fs.readdir(target)
      if (entries.length > 0 && !argBool(args, 'recursive')) {
        throw new ToolError('Directory is not empty; set recursive=true to delete it')
      }
      if (toTrash) {
        await shell.trashItem(target)
      } else {
        await fs.rm(target, { recursive: true, force: true })
      }
      return {
        ok: true,
        summary: `deleted directory ${relPath(target)}${toTrash ? ' (moved to trash)' : ''}`,
        detail: toTrash ? 'Directory moved to the trash.' : 'Directory removed.'
      }
    }
    if (toTrash) {
      await shell.trashItem(target)
    } else {
      await fs.unlink(target)
    }
    mirrorAgentCommand(`🗑 удалить ${relPath(target)}`, { ok: true, output: '' })
    return {
      ok: true,
      summary: `deleted ${relPath(target)}${toTrash ? ' (moved to trash)' : ''}`,
      detail: toTrash ? 'File moved to the trash.' : 'File removed.'
    }
  }
}

const movePathTool: ToolDef = {
  name: 'move_path',
  description: 'Move or rename a file or directory inside the workspace.',
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'Source path relative to workspace root' },
      to: { type: 'string', description: 'Destination path relative to workspace root' }
    },
    required: ['from', 'to']
  },
  risk: 'write',
  execute: async (args) => {
    const from = resolveInWorkspace(argString(args, 'from'))
    const to = resolveInWorkspace(argString(args, 'to'))
    const stat = await fs.stat(from).catch(() => null)
    if (!stat) throw new ToolError(`Source not found: ${relPath(from)}`)
    await fs.mkdir(dirname(to), { recursive: true })
    await fs.rename(from, to)
    mirrorAgentCommand(`→ ${relPath(from)} → ${relPath(to)}`, { ok: true, output: '' })
    return { ok: true, summary: `moved ${relPath(from)} → ${relPath(to)}`, detail: 'Move complete.' }
  }
}

const searchFilesTool: ToolDef = {
  name: 'search_files',
  description: 'Find files by glob pattern (e.g. "*.ts", "src/**/test?.js"). Returns matching paths.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern, * and ** supported' },
      path: { type: 'string', description: 'Directory to search in. Default: workspace root' }
    },
    required: ['pattern']
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const pattern = argString(args, 'pattern')
    const base = resolveInWorkspace(argString(args, 'path', false) || '.')
    const matcher = globToRegex(pattern)
    const matches: string[] = []

    for await (const file of walkFiles(base, ctx.signal)) {
      const rel = relPath(file)
      const candidate = pattern.includes('/') ? rel : basename(file)
      if (matcher.test(candidate)) {
        matches.push(rel)
        if (matches.length >= MAX_GLOB_RESULTS) break
      }
    }

    return {
      ok: true,
      summary: matches.length === 0 ? 'no files matched' : `${matches.length} file(s) matched`,
      detail: matches.length === 0 ? `No files matched "${pattern}".` : matches.join('\n')
    }
  }
}

const searchContentTool: ToolDef = {
  name: 'search_content',
  description: 'Search file contents by plain text or regular expression. Returns "path:line: text".',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Text or regex to search for' },
      path: { type: 'string', description: 'Directory or file to search in. Default: workspace root' },
      regex: { type: 'boolean', description: 'Treat query as a regular expression' },
      ignore_case: { type: 'boolean', description: 'Case-insensitive search' }
    },
    required: ['query']
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const query = argString(args, 'query')
    const useRegex = argBool(args, 'regex')
    const flags = argBool(args, 'ignore_case') ? 'gi' : 'g'
    let pattern: RegExp
    try {
      pattern = useRegex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
    } catch {
      throw new ToolError('Invalid regular expression')
    }

    const base = resolveInWorkspace(argString(args, 'path', false) || '.')
    const stat = await fs.stat(base).catch(() => null)
    if (!stat) throw new ToolError(`Path not found: ${relPath(base)}`)

    const maxResults = cfg().tools.searchMaxResults
    const results: string[] = []
    const targets = stat.isFile() ? [base] : walkFiles(base, ctx.signal)

    for await (const file of targets) {
      if (results.length >= maxResults) break
      const fileStat = await fs.stat(file).catch(() => null)
      if (!fileStat || fileStat.size > MAX_SCAN_FILE_SIZE) continue
      let content: string
      try {
        content = await fs.readFile(file, 'utf8')
      } catch {
        continue
      }
      if (content.includes('\0')) continue
      const lines = content.split(/\r?\n/)
      let hits = 0
      for (let index = 0; index < lines.length; index += 1) {
        pattern.lastIndex = 0
        if (pattern.test(lines[index])) {
          results.push(`${relPath(file)}:${index + 1}: ${lines[index].trim().slice(0, 240)}`)
          hits += 1
          if (hits >= MAX_CONTENT_RESULTS_PER_FILE || results.length >= maxResults) break
        }
      }
    }

    return {
      ok: true,
      summary: results.length === 0 ? 'no matches' : `${results.length} match(es)`,
      detail: results.length === 0 ? `No matches for "${query}".` : results.join('\n')
    }
  }
}

/** A command the guard classifies as catastrophic is refused, whatever the mode. */
function catastrophicRefusal(guard: DangerousCommand): ToolResult {
  return {
    ok: false,
    summary: `refused: ${guard.reason}`,
    detail:
      'The terminal protection in Settings → Servers blocked this command because it could damage the computer itself. ' +
      'Do not retry it or work around the guard. If the user really needs it, explain what it does and ask them to run it (or to turn the protection off) themselves.'
  }
}

/**
 * Where a terminal command runs. With an open workspace it stays inside it (the
 * sandbox check lives in resolveInWorkspace); with no workspace it falls back to
 * the user's home folder, because the terminal is not a file tool and "run a
 * harmless command" must not fail in an empty IDE.
 */
function commandCwd(input: string): { cwd: string; usedHome: boolean } {
  const root = getWorkspaceRoot()
  if (root) return { cwd: resolveInWorkspace(input), usedHome: false }
  return { cwd: homeCwd(input, homedir()), usedHome: true }
}

/** Says where the command ran when no workspace bounded it. */
function withCwdNote(result: ToolResult, usedHome: boolean, cwd: string): ToolResult {
  if (!usedHome) return result
  const note = `No folder is open in the IDE, so the command ran in ${cwd}. Open a folder if it should run inside a project.`
  return { ...result, detail: result.detail.length > 0 ? `${result.detail}\n${note}` : note }
}

/**
 * A command cannot run in a folder that is gone. Spawning one there fails with
 * "spawn C:\\WINDOWS\\system32\\cmd.exe ENOENT", which sends the model hunting
 * for a missing shell instead of the real cause, so it is answered up front.
 */
function missingCwdResult(cwd: string): ToolResult | null {
  if (existsSync(cwd)) return null
  return {
    ok: false,
    summary: `working directory not found: ${cwd}`,
    detail:
      'The folder does not exist — it may have been deleted or renamed since the chat started. Create it (or pass the right cwd) and run the command again.'
  }
}

/**
 * A failed command that used a Linux program under cmd.exe gets the Windows
 * equivalent appended, because weak models otherwise retry `rm`, `ls` or `cat`
 * until the step budget runs out.
 */
function withShellHint(result: ToolResult, shell: ResolvedShell, command: string): ToolResult {
  if (result.ok) return result
  const hint = windowsShellHint(command, shell)
  if (!hint) return result
  return {
    ...result,
    detail: result.detail.length > 0 ? `${result.detail}\n${hint}` : hint
  }
}

/**
 * Capture a command's output for `run_command`. Used for cmd, sh and PowerShell;
 * Windows Terminal has its own runner because the tab cannot be piped.
 */
function runCapturedCommand(
  shell: 'powershell' | 'cmd' | 'sh',
  command: string,
  cwd: string,
  timeout: number,
  ctx: ToolContext
): Promise<ToolResult> {
  return new Promise<ToolResult>((resolveResult) => {
    let child: ReturnType<typeof spawnShell>
    try {
      child = spawnShell(shell, command, cwd)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      resolveResult({ ok: false, summary: message, detail: '' })
      return
    }

    // Bytes, not strings: a chunk can end in the middle of a UTF-8 character,
    // and the code page a Windows tool wrote in is only knowable per line. The
    // whole buffer is decoded once the process is done.
    const chunks: Buffer[] = []
    let size = 0
    let finished = false
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const output = (): string => {
      const text = normaliseOutput(decodeConsoleOutput(Buffer.concat(chunks)))
      return text.length > 0 ? truncate(text) : '(no output)'
    }

    const finish = (result: ToolResult): void => {
      if (finished) return
      finished = true
      if (timer) clearTimeout(timer)
      ctx.signal.removeEventListener('abort', onAbort)
      // The terminal panel mirrors what the AI runs.
      mirrorAgentCommand(command, { ok: result.ok, output: result.detail })
      resolveResult(result)
    }

    const onAbort = (): void => {
      killTree(child.pid)
      finish({ ok: false, summary: 'command aborted', detail: output() })
    }

    const collect = (data: Buffer): void => {
      // Four bytes per character is the most UTF-8 can take, so the cap is a
      // byte budget that still cannot exceed the character limit after decoding.
      const cap = cfg().tools.maxOutputChars * 4
      if (size >= cap) return
      const take = data.subarray(0, Math.max(0, cap - size))
      size += take.length
      chunks.push(take)
    }

    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error)
      finish({ ok: false, summary: message, detail: output() })
    })
    child.on('close', (code, signal) => {
      if (timedOut) {
        finish({
          ok: false,
          summary: `command timed out after ${timeout}ms (still-running processes were killed)`,
          detail: [
            output(),
            'Hint: the command was still running when the timeout ran out. If it is a server or watcher, start it with start_server (pass the port) instead. If it is an install, a build or a download that simply needs longer, run it again with a larger timeout_ms (up to 600000).'
          ]
            .filter((part) => part.length > 0)
            .join('\n')
        })
        return
      }
      const exitCode = code ?? 1
      finish({
        ok: exitCode === 0,
        summary: `exit code ${exitCode}${signal ? ` (${signal})` : ''}`,
        detail: output()
      })
    })

    if (ctx.signal.aborted) {
      onAbort()
      return
    }
    ctx.signal.addEventListener('abort', onAbort, { once: true })

    timer = setTimeout(() => {
      timedOut = true
      killTree(child.pid)
    }, timeout)
  })
}

const runCommandTool: ToolDef = {
  name: 'run_command',
  description:
    'Run a shell command on this computer and wait for it to finish. Returns stdout and stderr. It runs in the open workspace, or in the home folder when no folder is open. The shell follows Settings → Servers → "Where commands run" (Auto, PowerShell, cmd or Windows Terminal); with Windows Terminal the command opens in a visible tab and its output is still captured. Use this for installs, downloads, CLIs, builds and tests. The command and everything it starts are killed when it times out, so do NOT use this for long-running processes (dev servers, watchers, `npx serve`, `npm run dev`): they never exit and will be reported as a timeout. Use start_server for those.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command line to run' },
      cwd: {
        type: 'string',
        description:
          'Working directory relative to the workspace root, or to the home folder when no workspace is open. Default: that root/home folder'
      },
      timeout_ms: { type: 'number', description: 'Timeout in ms (default 60000, max 600000); raise it for installs and big downloads' }
    },
    required: ['command']
  },
  risk: 'exec',
  execute: async (args, ctx) => {
    const command = argString(args, 'command')
    const { cwd, usedHome } = commandCwd(argString(args, 'cwd', false) || '.')
    const settings = cfg()
    const defaultTimeout = settings.servers.commandTimeoutMs
    const timeout = Math.min(Math.max(argNumber(args, 'timeout_ms') ?? defaultTimeout, 1000), 600000)

    const guard = settings.servers.protectTerminal ? dangerousCommand(command) : null
    if (guard?.level === 'catastrophic') return catastrophicRefusal(guard)
    const missing = missingCwdResult(cwd)
    if (missing) return missing

    const shell = resolveTerminalShell(settings.servers.terminalShell, undefined)
    const finish = (result: ToolResult): ToolResult =>
      withCwdNote(withShellHint(result, shell, command), usedHome, cwd)
    if (shell !== 'windows-terminal') {
      return finish(await runCapturedCommand(shell, command, cwd, timeout, ctx))
    }

    let run
    try {
      run = await runInWindowsTerminal(command, cwd, timeout, ctx.signal)
    } catch (error) {
      if (error instanceof WindowsTerminalUnavailableError) {
        return finish(await runCapturedCommand('powershell', command, cwd, timeout, ctx))
      }
      throw error
    }
    if (run.unavailable) return finish(await runCapturedCommand('powershell', command, cwd, timeout, ctx))
    if (run.failedToStart) {
      // The tab never came up: run the command where it can at least finish,
      // and tell the model why the visible terminal was skipped.
      const fallback = await runCapturedCommand('powershell', command, cwd, timeout, ctx)
      return finish({
        ...fallback,
        detail: `Windows Terminal did not open a tab; the command ran in PowerShell instead.\n${fallback.detail}`
      })
    }
    const detail = run.output.length > 0 ? truncate(normaliseOutput(run.output)) : '(no output)'
    if (run.timedOut) {
      return finish({
        ok: false,
        summary: `command timed out after ${timeout}ms (the Windows Terminal tab was closed)`,
        detail: [
          detail,
          'Hint: the command was still running when the timeout ran out. If it is a server or watcher, start it with start_server (pass the port) instead. If it is an install, a build or a download that simply needs longer, run it again with a larger timeout_ms (up to 600000).'
        ].join('\n')
      })
    }
    if (run.aborted) return finish({ ok: false, summary: 'command aborted', detail })
    if (run.code === null) {
      return finish({
        ok: false,
        summary: 'the Windows Terminal tab closed before the command finished',
        detail
      })
    }
    return finish({ ok: run.code === 0, summary: `exit code ${run.code}`, detail })
  }
}

const describeProcess = (item: BackgroundProcessInfo): string =>
  `${item.running ? 'running' : 'stopped'} · id ${item.id} · pid ${item.pid}` +
  `${item.port !== null ? ` · port ${item.port}` : ''} · ${item.command}`

export const IPV6_HINT =
  'A server that will not answer: the usual cause is a listener bound to `localhost`, which can resolve to the IPv6 loopback (::1) and be reachable from nowhere. Fix it by binding IPv4/any (`listen(PORT, "0.0.0.0")` or `listen(PORT)`), never by guessing ports.'

const startServerTool: ToolDef = {
  name: 'start_server',
  description:
    'Start a long-running process (dev server, watcher) in the background and return as soon as it is up. Use this instead of run_command for anything that never exits. Pass the port the project really uses: the tool waits until it accepts connections on 127.0.0.1 or ::1, and also picks up a different port printed by the process. Then verify the page with fetch_url before telling the user it works.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command line, e.g. "npm start" or "node server.js"' },
      cwd: {
        type: 'string',
        description:
          'Working directory relative to the workspace root, or to the home folder when no workspace is open. Default: that root/home folder'
      },
      port: { type: 'number', description: 'Port the server listens on (from its code or config); the tool waits until it accepts connections' },
      wait_ms: { type: 'number', description: 'How long to wait for the port (default 15000, max 60000)' }
    },
    required: ['command']
  },
  risk: 'exec',
  execute: async (args, ctx) => {
    const command = argString(args, 'command')
    const { cwd, usedHome } = commandCwd(argString(args, 'cwd', false) || '.')
    const port = argNumber(args, 'port') ?? null
    const waitMs = Math.min(Math.max(argNumber(args, 'wait_ms') ?? 15000, 500), 60000)

    const settings = cfg()
    const guard = settings.servers.protectTerminal ? dangerousCommand(command) : null
    if (guard?.level === 'catastrophic') return catastrophicRefusal(guard)
    const missing = missingCwdResult(cwd)
    if (missing) return missing

    const running = listBackground().filter((item) => item.running).length
    if (running >= settings.servers.maxServers) {
      return {
        ok: false,
        summary: `limit reached: ${running} background processes are already running (max ${settings.servers.maxServers})`,
        detail: [
          'Stop one with stop_server before starting another, or raise the limit in Settings → Servers.',
          ...listBackground()
            .filter((item) => item.running)
            .map(describeProcess)
        ].join('\n')
      }
    }

    const shell = resolveTerminalShell(settings.servers.terminalShell, undefined)
    const finish = (result: ToolResult): ToolResult =>
      withCwdNote(withShellHint(result, shell, command), usedHome, cwd)
    let started
    if (shell === 'windows-terminal') {
      try {
        started = await startBackgroundInTerminal(command, cwd, port, waitMs)
      } catch (error) {
        if (!(error instanceof WindowsTerminalUnavailableError)) throw error
        started = await startBackground(command, cwd, port, waitMs, 'powershell')
      }
    } else {
      started = await startBackground(command, cwd, port, waitMs, shell)
    }
    ctx.emitProcesses()
    const detail = truncate(started.output || '(no output yet)')
    const where = `pid ${started.info.pid}, id ${started.info.id}, ${shellSummary(shell)}`

    if (started.startupError) {
      return finish({ ok: false, summary: started.startupError, detail })
    }
    if (started.exited) {
      return finish({
        ok: false,
        summary: `server exited with code ${started.exited.code ?? '?'} — it did not stay up`,
        detail
      })
    }
    if (started.listening && started.listeningPort !== null) {
      const switched =
        started.requestedPort !== null && started.listeningPort !== started.requestedPort
      return finish({
        ok: true,
        summary:
          `listening on http://localhost:${started.listeningPort} (${where})` +
          (switched
            ? ` — you asked for port ${started.requestedPort}, the server listens on ${started.listeningPort}`
            : ''),
        detail
      })
    }
    if (started.requestedPort !== null) {
      const lower = started.output.toLowerCase()
      const maybeIpv6 = lower.includes('localhost') && cfg().servers.bindHint
      return finish({
        ok: false,
        summary: `started (${where}) but nothing answers on port ${started.requestedPort} over 127.0.0.1. The process is still running — do NOT claim the server works.`,
        detail:
          truncate(started.output || '(no output yet)') +
          (maybeIpv6
            ? `\n\nHint: the output mentions "localhost". ${IPV6_HINT}`
            : '')
      })
    }
    return finish({
      ok: true,
      summary: `started in the background (${where}), but no port was given and none was found in its output, so it is NOT verified. Check list_servers or read the output.`,
      detail
    })
  }
}

const stopServerTool: ToolDef = {
  name: 'stop_server',
  description:
    'Stop a background process started with start_server. Give its id (from start_server or list_servers), or its pid, or its port.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Process id returned by start_server' },
      pid: { type: 'number', description: 'Operating system process id' },
      port: { type: 'number', description: 'Port the process listens on' }
    }
  },
  risk: 'exec',
  execute: async (args, ctx) => {
    const id = argString(args, 'id', false)
    const pid = argNumber(args, 'pid')
    const port = argNumber(args, 'port')
    const info = id
      ? stopBackground(id)
      : pid !== undefined
        ? stopBackgroundByPid(pid)
        : port !== undefined
          ? stopBackgroundByPort(port)
          : null
    ctx.emitProcesses()
    if (!info) {
      const running = listBackground().filter((item) => item.running)
      return {
        ok: false,
        summary: 'nothing was stopped: no background process matched',
        detail:
          running.length === 0
            ? 'Nothing is running right now.'
            : `Pass one of these ids to stop_server:\n${running.map(describeProcess).join('\n')}`
      }
    }
    return { ok: true, summary: `stopped "${info.command}" (pid ${info.pid})`, detail: '' }
  }
}

const listServersTool: ToolDef = {
  name: 'list_servers',
  description:
    'List background processes started with start_server, or pass an id to read one process output.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Show the recent output of this process' }
    }
  },
  risk: 'read',
  execute: async (args) => {
    const id = argString(args, 'id', false)
    if (id) {
      return { ok: true, summary: `output of ${id}`, detail: truncate(backgroundOutput(id) || '(no output)') }
    }
    const list = listBackground()
    if (list.length === 0) {
      return { ok: true, summary: 'no background processes', detail: '' }
    }
    return {
      ok: true,
      summary: `${list.length} background process(es)`,
      detail: list.map(describeProcess).join('\n')
    }
  }
}

const gitStatusTool: ToolDef = {
  name: 'git_status',
  description: 'Show git status (short format) of the workspace.',
  parameters: { type: 'object', properties: {} },
  risk: 'read',
  execute: async (_args, ctx) => {
    const root = getWorkspaceRoot()
    if (!root) throw new ToolError(NO_WORKSPACE)
    const result = await execToolResult('git status --short --branch', root, ctx.signal)
    return { ...result, summary: result.ok ? 'git status' : result.summary }
  }
}

const gitDiffTool: ToolDef = {
  name: 'git_diff',
  description: 'Show git diff of the workspace (unstaged by default).',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Limit diff to a path' },
      staged: { type: 'boolean', description: 'Show staged changes instead' }
    }
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const root = getWorkspaceRoot()
    if (!root) throw new ToolError(NO_WORKSPACE)
    let command = 'git diff'
    if (argBool(args, 'staged')) command += ' --staged'
    const scope = argString(args, 'path', false)
    if (scope) command += ` -- "${relPath(resolveInWorkspace(scope))}"`
    const result = await execToolResult(command, root, ctx.signal)
    return { ...result, summary: result.ok ? 'git diff' : result.summary }
  }
}

const todoWriteTool: ToolDef = {
  name: 'todo_write',
  description:
    'Create or update the task list for the current job. Use it to plan multi-step work and keep exactly one task in_progress.',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'Full task list',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Task description' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] }
          },
          required: ['content', 'status']
        }
      }
    },
    required: ['todos']
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const raw = Array.isArray(args.todos) ? args.todos : []
    const todos: TodoItem[] = raw.slice(0, 40).map((item, index) => {
      const record = (item ?? {}) as Record<string, unknown>
      const status = record.status
      return {
        id: `t${index + 1}`,
        content: typeof record.content === 'string' ? record.content.slice(0, 300) : `Task ${index + 1}`,
        status: status === 'in_progress' || status === 'completed' ? (status as TodoStatus) : 'pending'
      }
    })
    ctx.setTodos(todos)
    const done = todos.filter((todo) => todo.status === 'completed').length
    return { ok: true, summary: `todos updated (${done}/${todos.length} done)`, detail: 'Task list updated.' }
  }
}

const askUserTool: ToolDef = {
  name: 'ask_user',
  description:
    'Ask the user a question and wait for the answer. Use when you need clarification or a decision.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'Question text' },
      options: {
        type: 'array',
        description: 'Optional suggested answers',
        items: { type: 'string' }
      }
    },
    required: ['question']
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const question = argString(args, 'question')
    const options = Array.isArray(args.options)
      ? args.options.filter((option): option is string => typeof option === 'string').slice(0, 6)
      : []
    const answer = await ctx.askUser(question, options)
    if (ctx.signal.aborted) throw new ToolError('aborted')
    return { ok: true, summary: 'user answered', detail: answer }
  }
}

/** Other spellings of the loopback address, so a URL to localhost can fall back. */
function loopbackAlternatives(hostname: string): string[] {
  const clean = hostname.replace(/^\[|\]$/g, '')
  if (clean === 'localhost') return ['127.0.0.1', '[::1]']
  if (clean === '127.0.0.1') return ['[::1]', 'localhost']
  if (clean === '::1') return ['127.0.0.1', 'localhost']
  return []
}

const fetchUrlTool: ToolDef = {
  name: 'fetch_url',
  description: 'Fetch a URL and return the response as text (HTML is returned as-is, capped).',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Absolute http(s) URL' }
    },
    required: ['url']
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const url = argString(args, 'url')
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new ToolError('Invalid URL')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ToolError('Only http(s) URLs are supported')
    }

    // A dev server started with `listen(port, 'localhost')` may be reachable on
    // `::1` only, while Node prefers `127.0.0.1` (and vice versa). Try the
    // loopback spellings in turn instead of reporting a false "fetch failed".
    const candidates: URL[] = [parsed]
    for (const host of loopbackAlternatives(parsed.hostname)) {
      const alternative = new URL(parsed.toString())
      alternative.host = parsed.port.length > 0 ? `${host}:${parsed.port}` : host
      candidates.push(alternative)
    }

    let lastError = ''
    for (const candidate of candidates) {
      const timeout = AbortSignal.timeout(15000)
      const combined = AbortSignal.any([ctx.signal, timeout])
      let response: Response
      try {
        response = await fetch(candidate, { signal: combined, redirect: 'follow' })
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        continue
      }
      const raw = await response.text()
      const text = raw.slice(0, cfg().tools.fetchMaxKb * 1024)
      if (!response.ok) {
        return { ok: false, summary: `HTTP ${response.status}`, detail: truncate(text) }
      }
      const via = candidates.length > 1 && candidate !== parsed ? ` (via ${candidate.origin})` : ''
      return {
        ok: true,
        summary: `fetched ${parsed.host} (${raw.length} bytes)${via}`,
        detail: truncate(text)
      }
    }

    return {
      ok: false,
      summary: `fetch failed: ${lastError || 'no response'}`,
      detail: `Tried: ${candidates.map((item) => item.origin).join(', ')}. If this is a server you started, call list_servers to read its output and check the port it printed.`
    }
  }
}

const WEB_RECENCIES = new Set<WebSearchRecency>(['day', 'week', 'month', 'year'])

const webSearchTool: ToolDef = {
  name: 'web_search',
  description:
    'Search the live web and read the top pages. Use it when the answer depends on current facts (news, prices, releases, documentation, people, companies), when the user asks to search or look something up online, or when you are unsure and the web can verify it. Do not use it for stable general knowledge or for anything answerable from the workspace. Use 2–8 keyword queries, not full sentences; call it again with different words if the results are weak. Results contain numbered sources and extracted page text: cite them as [n] and never invent sources.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Short search query (2–8 keywords), e.g. "OpenAI Responses API web search".'
      },
      recency: {
        type: 'string',
        enum: ['day', 'week', 'month', 'year'],
        description: 'Limit results to recent pages when freshness matters. Omit for no limit.'
      }
    },
    required: ['query']
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const query = argString(args, 'query').trim()
    if (query.length < 2) throw new ToolError('The search query is too short')
    if (!cfg().webSearch.enabled) {
      throw new ToolError('Web search is switched off in settings')
    }

    if (ctx.webSearch && !ctx.webSearch.take()) {
      const limit = cfg().webSearch.maxUses
      return {
        ok: false,
        summary: 'web search limit reached',
        detail: `This run already used its ${limit} searches. Answer from the sources already collected and say what could not be verified. Do not call web_search again.`
      }
    }

    const recencyRaw = typeof args.recency === 'string' ? args.recency : ''
    const recency = WEB_RECENCIES.has(recencyRaw as WebSearchRecency)
      ? (recencyRaw as WebSearchRecency)
      : undefined
    const searchSettings = cfg().webSearch
    const config = {
      provider: searchSettings.provider,
      apiKey: getWebSearchApiKey(),
      maxResults: searchSettings.maxResults,
      readPages: searchSettings.readPages,
      safeSearch: searchSettings.safeSearch
    }
    const run = await runWebSearch(
      {
        query,
        maxResults: config.maxResults,
        readPages: config.readPages,
        recency,
        provider: config.provider,
        apiKey: config.apiKey,
        safeSearch: config.safeSearch,
        reserveCitations:
          ctx.webSearch?.reserve ??
          ((count) => Array.from({ length: count }, (_, index) => index + 1)),
        onProgress: (meta) => ctx.report?.(meta)
      },
      ctx.signal
    )

    const language = cfg().agent.responseLanguage
    const languageLine =
      language === 'ru'
        ? 'Write your answer to the user in Russian, whatever language the pages above are in — unless the user explicitly asked for another language.'
        : language === 'en'
          ? 'Write your answer to the user in English, whatever language the pages above are in — unless the user explicitly asked for another language.'
          : "Write your answer to the user in the same language as their request, whatever language the pages above are in."

    return {
      ok: run.ok,
      summary: run.summary,
      detail: `${truncate(run.detail)}\n${languageLine}`,
      meta: run.meta
    }
  }
}

/** Hard ceiling whatever the settings say: a picture is data, not a download manager. */
const MAX_IMAGE_MB = 8

const showImageTool: ToolDef = {
  name: 'show_image',
  description:
    'Put a real picture into the chat next to your answer. Use it when the picture itself is the clearest explanation (a diagram, chart, photo of a thing, UI, error screenshot, a page image found by web_search, or a file in the workspace) and the user would benefit from seeing it — not for decoration. Pass a public image `url` (the "Page image" line of a web_search source, or any direct image link) or a workspace `path`. Only raster formats are supported (PNG, JPEG, GIF, WebP, AVIF, BMP). The tool downloads the picture and shows it to the user; never paste image URLs or markdown images into your reply instead. It displays pictures for the user — it is not a way for you to see or analyze a picture; attachments the user sends already reach you in the message itself.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Direct http(s) link to an image file' },
      path: { type: 'string', description: 'Image file inside the workspace (instead of url)' },
      alt: { type: 'string', description: 'Short description of what the picture shows; also used as accessible text' },
      caption: { type: 'string', description: 'Caption shown under the picture' },
      source: { type: 'string', description: 'Page the picture came from, so the user can open it' },
      source_title: { type: 'string', description: 'Title of that page' }
    }
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const settings = cfg().visuals
    if (!settings.imagesEnabled) {
      throw new ToolError('show_image is switched off in Settings → Images and drawings')
    }
    const url = argString(args, 'url', false).trim()
    const path = argString(args, 'path', false).trim()
    if (url.length === 0 && path.length === 0) {
      throw new ToolError('Pass either url (a public image link) or path (an image inside the workspace)')
    }
    if (url.length > 0 && path.length > 0) throw new ToolError('Pass only one of url or path')

    const caption = argString(args, 'caption', false).slice(0, 300)
    const maxBytes = Math.min(settings.maxImageMb, MAX_IMAGE_MB) * 1024 * 1024
    const loaded = path
      ? await readImageFile(resolveInWorkspace(path), maxBytes)
      : await (async () => {
          if (!settings.remoteImages) {
            throw new ToolError(
              'Pictures from the internet are switched off in Settings → Images and drawings. Use a workspace file, or tell the user which setting to turn on.'
            )
          }
          const safe = safeHttpUrl(url)
          if (!safe) throw new ToolError('Only http(s) links to pictures are supported')
          return fetchRemoteImage(safe, ctx.signal, maxBytes)
        })()

    const size = imageSize(loaded.buffer, loaded.mime)
    const sourceUrl = settings.imageSource
      ? (safeHttpUrl(argString(args, 'source', false)) ?? loaded.url)
      : undefined
    const sourceTitle = argString(args, 'source_title', false).slice(0, 160)
    const alt =
      argString(args, 'alt', false).slice(0, 200) ||
      caption ||
      (path ? basename(path) : `Picture from ${sourceUrl ? new URL(sourceUrl).hostname : 'the web'}`)

    const meta: ImageMeta = {
      kind: 'image',
      src: toDataUrl(loaded.mime, loaded.buffer),
      alt,
      mime: loaded.mime,
      bytes: loaded.buffer.length,
      ...(caption ? { caption } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(sourceTitle ? { sourceTitle } : {}),
      ...(size && size.width > 0 && size.height > 0
        ? { width: size.width, height: size.height }
        : {})
    }

    const shape = meta.width && meta.height ? `${meta.width}×${meta.height}, ` : ''
    return {
      ok: true,
      summary: `showed a picture (${shape}${formatBytes(meta.bytes)})`,
      detail:
        'The picture is now visible to the user in the chat. Refer to it in your answer in a few words; ' +
        'do not paste its link, base64 or a markdown image. If the user asked for a specific picture and this is not it, say what you showed and show another with show_image.',
      meta
    }
  }
}

/** A poster carries a handful of labelled rows, not the whole Wikipedia article. */
const MAX_POSTER_FACTS = 12

const showPosterTool: ToolDef = {
  name: 'show_poster',
  description:
    'Show a subject of the arts as a poster card: a real picture on top and its passport underneath (title, author, a few labelled facts and a closing line) — like a theatre afisha. Use it by default whenever the subject of your answer is one specific work (a film, series, ballet, opera, play, painting, album, book, game), a person of the arts (actor, director, composer, artist) or a fictional character (Spider-Man, Peter Parker, Sherlock Holmes) — including plain "расскажи о…" / "кто такой…" questions, not only when the user asks for an afisha or a poster. Take the passport facts from your own knowledge; go to the web only to find the picture: web_search the subject and pass its direct link (the "Page image" line of a source works well), one search is usually enough — extra searches only when you do not know the facts or the user asked you to search. The tool downloads and embeds the picture. Keep your own reply to a couple of sentences around the card — never repeat the facts in text or paste the image as markdown. Do not use it when the subject is not one specific work or person (comparisons, genre history, code or workspace questions).',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Heading of the card, e.g. "Афиша балета «Лебединое озеро»" or the work title' },
      image_url: { type: 'string', description: 'Direct http(s) link to a picture of the work (poster, still, artwork)' },
      path: { type: 'string', description: 'Picture file inside the workspace (instead of image_url)' },
      alt: { type: 'string', description: 'Short description of the picture, also used as accessible text' },
      author: { type: 'string', description: 'Line under the heading: author, composer, director or artist' },
      author_url: { type: 'string', description: 'Link to a page about that author, if found' },
      facts: {
        type: 'array',
        description: 'Labelled rows of the passport, e.g. {"label":"Композитор","value":"Пётр Чайковский"}. 3–8 rows.',
        items: {
          type: 'object',
          properties: { label: { type: 'string' }, value: { type: 'string' } },
          required: ['label', 'value']
        }
      },
      note: { type: 'string', description: 'Short closing line under the facts — a teaser or a takeaway' },
      source: { type: 'string', description: 'Page the picture came from, shown as a badge on the image' },
      source_title: { type: 'string', description: 'Title of that page' }
    },
    required: ['title', 'facts']
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const settings = cfg().visuals
    if (!settings.imagesEnabled) {
      throw new ToolError('show_poster is switched off in Settings → Images and drawings')
    }
    if (!settings.posterEnabled) {
      throw new ToolError('show_poster is switched off in Settings → Images and drawings')
    }
    const title = argString(args, 'title', false)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200)
    if (title.length === 0) throw new ToolError('Pass a title for the work')
    const url = argString(args, 'image_url', false).trim()
    const path = argString(args, 'path', false).trim()
    if (url.length === 0 && path.length === 0) {
      throw new ToolError(
        'Pass image_url — a direct picture link (run web_search first and use a "Page image" line or any direct image link)'
      )
    }
    if (url.length > 0 && path.length > 0) throw new ToolError('Pass only one of image_url or path')

    const factText = (value: unknown, max: number): string =>
      typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
    const rawFacts: unknown[] = Array.isArray(args.facts)
      ? args.facts
      : args.facts && typeof args.facts === 'object'
        ? Object.entries(args.facts as Record<string, unknown>).map(([label, value]) => ({ label, value }))
        : []
    const facts: PosterFact[] = rawFacts
      .map((entry): PosterFact | null => {
        if (!entry || typeof entry !== 'object') return null
        const item = entry as Record<string, unknown>
        const label = factText(item.label ?? item.name ?? item.title, 60)
        const value = factText(item.value ?? item.text ?? item.content, 240)
        return label.length > 0 && value.length > 0 ? { label, value } : null
      })
      .filter((fact): fact is PosterFact => fact !== null)
      .slice(0, MAX_POSTER_FACTS)
    if (facts.length === 0) {
      throw new ToolError('Pass at least one fact row, e.g. facts: [{"label":"Год","value":"1877"}]')
    }

    const maxBytes = Math.min(settings.maxImageMb, MAX_IMAGE_MB) * 1024 * 1024
    const loaded = path
      ? await readImageFile(resolveInWorkspace(path), maxBytes)
      : await (async () => {
          if (!settings.remoteImages) {
            throw new ToolError(
              'Pictures from the internet are switched off in Settings → Images and drawings. Tell the user which setting to turn on.'
            )
          }
          const safe = safeHttpUrl(url)
          if (!safe) throw new ToolError('Only http(s) links to pictures are supported')
          return fetchRemoteImage(safe, ctx.signal, maxBytes)
        })()

    const size = imageSize(loaded.buffer, loaded.mime)
    const author = factText(args.author, 160) || undefined
    const authorUrl =
      author && settings.imageSource ? (safeHttpUrl(argString(args, 'author_url', false)) ?? undefined) : undefined
    const sourceUrl = settings.imageSource
      ? (safeHttpUrl(argString(args, 'source', false)) ?? loaded.url)
      : undefined
    const sourceTitle = factText(args.source_title, 160) || undefined
    const imageAlt =
      factText(args.alt, 200) || `Picture: ${title}`

    const meta: PosterMeta = {
      kind: 'poster',
      title,
      imageSrc: toDataUrl(loaded.mime, loaded.buffer),
      imageAlt,
      facts,
      ...(author ? { author } : {}),
      ...(authorUrl ? { authorUrl } : {}),
      ...(factText(args.note, 300) ? { note: factText(args.note, 300) } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(sourceTitle ? { sourceTitle } : {}),
      mime: loaded.mime,
      bytes: loaded.buffer.length,
      ...(size && size.width > 0 && size.height > 0 ? { width: size.width, height: size.height } : {})
    }
    return {
      ok: true,
      summary: `showed a poster — ${title}`,
      detail:
        'The poster card is now visible to the user: the picture on top, the passport of the work underneath. Refer to it in a couple of sentences; do not repeat the facts, the picture link or base64 in your reply. If the picture does not match the work, call show_poster again with a better link.',
      meta
    }
  }
}

/** Says what the model's call actually contained, so its retry can fix the shape. */
function describeFigureArgs(value: unknown): string {
  if (Array.isArray(value)) return `an array of ${value.length} items, used directly as the elements`
  if (!value || typeof value !== 'object') return `a ${typeof value}, not an object`
  const raw = value as Record<string, unknown>
  const keys = Object.keys(raw)
  const elements = raw.elements
  const shape =
    elements === undefined
      ? 'no "elements" key at all'
      : Array.isArray(elements)
        ? `an "elements" array of ${elements.length} items`
        : `"elements" of type ${typeof elements}`
  const keyList = keys.length > 0 ? keys.slice(0, 8).map((key) => `"${key}"`).join(', ') : 'no keys'
  return `an object with keys ${keyList} and ${shape}`
}

const drawFigureTool: ToolDef = {
  name: 'draw_figure',
  description:
    'Draw a clean, labelled technical figure in the chat: geometry (adjacent/vertical angles, triangles, circles, bisectors, equal segments), coordinate axes with function graphs, vectors, dimensions and annotations. Describe the figure as geometry — named points, segments, angles with an exact `degrees` value, dimensions, an `expr` graph — and the tool renders it with a grid, letter labels and measured values. Use it whenever the user asks to draw, sketch, plot or solve something visually instead of writing ASCII art or SVG. Coordinates are ordinary maths coordinates with y pointing up; 1 unit is whatever scale you choose. The renderer is forgiving: points can be defined once and referenced by label, an angle may be given as `degrees`, and a bare angle gets its arms drawn automatically.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Heading drawn above the figure' },
      caption: { type: 'string', description: 'One line shown under the drawing' },
      elements: {
        type: 'array',
        description:
          'Elements in drawing order; points are [x, y], y up. Types: point {at,label}; segment {from,to,label,ticks,dashed} or {from,label:"AB",length,direction}; line {from,to}; ray {from,through}; vector {from,to,label}; polygon {points,label:"ABC",filled}; circle {center,radius} or {center,diameter}; angle {vertex,from,to,label,degrees,right,reflex}; dimension {from,to,offset,label}; text {at,text}; axes {from,to,step,xLabel,yLabel}; graph {expr,from,to,label}. Define {type:"point",at:[0,0],label:"A"} once and pass "A" instead of [x,y] anywhere. For an exact angle pass `degrees`; the arm is rotated to it. Letters in labels become point names: label:"∠AOB = 60°" draws A, O, B. Examples: {"elements":[{"type":"segment","from":[-4,0],"to":[4,0]},{"type":"angle","vertex":[0,0],"from":[3,0],"degrees":60,"label":"∠AOB = 60°"}]} and {"elements":[{"type":"axes","from":[-5,-3],"to":[5,7]},{"type":"graph","expr":"x^2 - 4"}]}. For two adjacent (смежные) angles through one vertex: {"elements":[{"type":"point","at":[0,0],"label":"O"},{"type":"segment","from":[-5,0],"to":[5,0]},{"type":"angle","vertex":[0,0],"from":[5,0],"degrees":60,"label":"∠AOB = 60°"},{"type":"angle","vertex":[0,0],"from":[2.5,4.33],"degrees":120,"label":"∠BOC = 120°"}]} — the two measures must add up to 180. Point elements alone draw dots, so always add the segments or angles that make the shape.',
        items: { type: 'object' }
      },
      results: {
        type: 'array',
        description: 'Computed values printed under the drawing, e.g. {label:"∠AOB", value:"120°", formula:"180° − 60°"}.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            value: { type: 'string' },
            formula: { type: 'string' }
          },
          required: ['label', 'value']
        }
      },
      notes: { type: 'array', description: 'Short solution lines shown after the values.', items: { type: 'string' } }
    },
    required: ['elements']
  },
  risk: 'read',
  execute: async (args) => {
    const settings = cfg().visuals
    if (!settings.figuresEnabled) {
      throw new ToolError('draw_figure is switched off in Settings → Images and drawings')
    }
    const parseSpec = (value: unknown): unknown => {
      if (typeof value !== 'string') return value
      try {
        return JSON.parse(value)
      } catch {
        return value
      }
    }
    const source = parseSpec(
      typeof args.figure === 'object' || typeof args.figure === 'string'
        ? args.figure
        : typeof args.spec === 'object' || typeof args.spec === 'string'
          ? args.spec
          : args
    )
    const { spec, warnings } = normalizeFigureSpec(source)
    if (!spec) {
      return {
        ok: false,
        summary: 'the figure could not be built',
        detail: [
          ...warnings,
          `What your call actually contained: ${describeFigureArgs(source)}.`,
          'Call draw_figure again with a real `elements` JSON array (not a string, not a single object). Each element needs a type and points as [x, y]:',
          'point, segment, line, ray, polygon, circle, angle, vector, dimension, text, axes, graph.',
          'Example: {"elements":[{"type":"point","at":[0,0],"label":"O"},{"type":"segment","from":[-4,0],"to":[4,0]},{"type":"angle","vertex":[0,0],"from":[3,0],"degrees":60,"label":"∠AOB = 60°"}]}'
        ].join('\n')
      }
    }

    const style = {
      grid: settings.figureGrid,
      theme: settings.figureTheme,
      results: settings.figureResults
    }
    const render = renderFigureSvg(spec, style)
    const allWarnings = [...warnings, ...render.warnings]
    const meta: FigureMeta = {
      kind: 'figure',
      svg: render.svg,
      notes: spec.notes ?? [],
      results: render.results,
      warnings: allWarnings,
      spec,
      style,
      ...(spec.title ? { title: spec.title } : {}),
      ...(spec.caption ? { caption: spec.caption } : {})
    }
    const lines = [
      'The drawing is rendered in the chat and the user can see it. Do not redraw it as ASCII art, SVG or a code block; describe the result in a couple of sentences.',
      ...(render.results.length > 0
        ? [
            'Values printed under the drawing: ' +
              render.results.map((item) => `${item.label} = ${item.value}`).join(', ')
          ]
        : []),
      ...(allWarnings.length > 0
        ? ['Some parts of your description were dropped or approximated:', ...allWarnings]
        : [])
    ]
    return {
      ok: true,
      summary: `drew a figure with ${spec.elements.length} element${spec.elements.length === 1 ? '' : 's'}${spec.title ? ` — ${spec.title}` : ''}`,
      detail: lines.join('\n'),
      meta
    }
  }
}

const backupFileTool: ToolDef = {
  name: 'backup_file',
  description:
    'Copy a workspace file into the internal backup store before a risky or wide-ranging change — a .blend scene, an .aep project, a config you are about to rewrite. The copy lives in userData/backups, the last 20 versions of a file are kept. Back up first, then change; mention the backup to the user when you make one.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File to back up, relative to the workspace root' }
    },
    required: ['path']
  },
  risk: 'write',
  execute: async (args) => {
    const input = argString(args, 'path')
    const absolute = resolveInWorkspace(input)
    const root = getWorkspaceRoot()
    const result = backupFile(app.getPath('userData'), root, absolute)
    if (!result.ok) {
      const reasons: Record<string, string> = {
        'not-found': `No file at ${input}.`,
        'not-file': `${input} is not a file.`,
        'outside-workspace': 'Only files inside the open workspace can be backed up.',
        io: 'The backup could not be written.'
      }
      return { ok: false, summary: reasons[result.reason] ?? 'backup failed', detail: '' }
    }
    return {
      ok: true,
      summary: `backed up ${displayRelative(root, absolute)} (${formatBytes(result.bytes)})`,
      detail: [
        `Backup of ${displayRelative(root, absolute)} written to ${result.backupPath}.`,
        `Keeping ${result.kept} newest backup(s) of this file.`,
        'You can now make the change; if it goes wrong, the backup holds the original.'
      ].join('\n')
    }
  }
}

export const TOOLS: ToolDef[] = [
  listDirTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  deletePathTool,
  movePathTool,
  searchFilesTool,
  searchContentTool,
  backupFileTool,
  runCommandTool,
  startServerTool,
  stopServerTool,
  listServersTool,
  gitStatusTool,
  gitDiffTool,
  todoWriteTool,
  askUserTool,
  fetchUrlTool,
  webSearchTool,
  showImageTool,
  showPosterTool,
  drawFigureTool,
  ...GIT_TOOLS,
  ...CHECK_TOOLS,
  ...OBSERVE_TOOLS,
  ...SCREEN_TOOLS,
  ...DATA_TOOLS,
  ...PROJECT_TOOLS,
  ...UI_TOOLS,
  ...SCHEDULE_TOOLS,
  ...WEB_TOOLS
]

export function toolsForMode(mode: ChatMode): ToolDef[] {
  const settings = cfg()
  const disabled = new Set(settings.tools.disabled)
  if (!settings.servers.allowRunCommand) disabled.add('run_command')
  if (!settings.servers.allowBackground) {
    disabled.add('start_server')
    disabled.add('stop_server')
    disabled.add('list_servers')
  }
  if (!settings.webSearch.enabled) disabled.add('web_search')
  if (!settings.visuals.imagesEnabled) {
    disabled.add('show_image')
    disabled.add('show_poster')
  }
  if (!settings.visuals.posterEnabled) disabled.add('show_poster')
  if (!settings.visuals.figuresEnabled) disabled.add('draw_figure')
  const base = mode === 'agent' ? TOOLS : TOOLS.filter((tool) => tool.risk === 'read')
  // Tools of connected MCP servers join the registry dynamically: only trusted,
  // enabled and currently ready servers contribute, so the model never sees
  // names it cannot call. Chat and plan keep their read-only rule.
  const mcp = mcpToolDefs().filter(
    (tool) => !disabled.has(tool.name) && (mode === 'agent' || tool.risk === 'read')
  )
  // The Blender recipe palette joins only when its server is connected.
  const palette =
    mode === 'agent' && !disabled.has('blender_recipe') ? blenderPaletteDefs() : []
  return [...base.filter((tool) => !disabled.has(tool.name)), ...(mcp as ToolDef[]), ...palette]
}

/**
 * Models that were trained on other harnesses keep calling tools by their old
 * names (`write_content`, `bash`, `str_replace`…). Normalise those back to the
 * canonical names instead of failing with "unknown tool".
 */
const TOOL_ALIASES: Record<string, string> = {
  // writing
  writecontent: 'write_file',
  write: 'write_file',
  writefile: 'write_file',
  writetofile: 'write_file',
  createfile: 'write_file',
  create: 'write_file',
  addfile: 'write_file',
  newfile: 'write_file',
  savefile: 'write_file',
  filewrite: 'write_file',
  createdoc: 'write_file',
  createreadme: 'write_file',
  // editing
  edit: 'edit_file',
  editfile: 'edit_file',
  replace: 'edit_file',
  replaceinfile: 'edit_file',
  strreplace: 'edit_file',
  strreplacebasededittool: 'edit_file',
  applypatch: 'edit_file',
  patch: 'edit_file',
  insertcode: 'edit_file',
  // reading
  read: 'read_file',
  readfile: 'read_file',
  openfile: 'read_file',
  cat: 'read_file',
  view: 'read_file',
  viewfile: 'read_file',
  getfile: 'read_file',
  // directory listing
  list: 'list_dir',
  ls: 'list_dir',
  listdir: 'list_dir',
  listdirectory: 'list_dir',
  lsdir: 'list_dir',
  dir: 'list_dir',
  tree: 'list_dir',
  // delete / move
  delete: 'delete_path',
  deletefile: 'delete_path',
  removed: 'delete_path',
  removefile: 'delete_path',
  rm: 'delete_path',
  rmfile: 'delete_path',
  move: 'move_path',
  movefile: 'move_path',
  rename: 'move_path',
  renamefile: 'move_path',
  mv: 'move_path',
  // search
  grep: 'search_content',
  grepsearch: 'search_content',
  search: 'search_content',
  searchinfiles: 'search_content',
  searchcontent: 'search_content',
  glob: 'search_files',
  find: 'search_files',
  findfiles: 'search_files',
  listfiles: 'search_files',
  // shell
  bash: 'run_command',
  shell: 'run_command',
  run: 'run_command',
  runcommand: 'run_command',
  execute: 'run_command',
  executecommand: 'run_command',
  exec: 'run_command',
  terminal: 'run_command',
  runterminalcmd: 'run_command',
  command: 'run_command',
  // todo list
  todo: 'todo_write',
  todos: 'todo_write',
  todowrite: 'todo_write',
  updatetodos: 'todo_write',
  taskwrite: 'todo_write',
  // misc
  ask: 'ask_user',
  askuser: 'ask_user',
  question: 'ask_user',
  startserver: 'start_server',
  runserver: 'start_server',
  serve: 'start_server',
  startdevserver: 'start_server',
  server: 'start_server',
  stopserver: 'stop_server',
  killserver: 'stop_server',
  listservers: 'list_servers',
  processes: 'list_servers',
  listprocesses: 'list_servers',
  fetch: 'fetch_url',
  fetchurl: 'fetch_url',
  webfetch: 'fetch_url',
  httpget: 'fetch_url',
  // pictures and drawings
  showimage: 'show_image',
  image: 'show_image',
  attachimage: 'show_image',
  embedimage: 'show_image',
  previewimage: 'show_image',
  sendimage: 'show_image',
  picture: 'show_image',
  drawfigure: 'draw_figure',
  drawdiagram: 'draw_figure',
  diagram: 'draw_figure',
  draw: 'draw_figure',
  sketch: 'draw_figure',
  renderfigure: 'draw_figure',
  figure: 'draw_figure',
  plot: 'draw_figure',
  chart: 'draw_figure',
  geturl: 'fetch_url',
  fetchwebpage: 'fetch_url',
  // web search
  websearch: 'web_search',
  searchweb: 'web_search',
  searchtheweb: 'web_search',
  searchinternet: 'web_search',
  internetsearch: 'web_search',
  googlesearch: 'web_search',
  google: 'web_search',
  browsersearch: 'web_search',
  websearchtool: 'web_search',
  lookonline: 'web_search',
  gitstatus: 'git_status',
  gitdiff: 'git_diff',
  // git extras
  commit: 'git_commit',
  gitcommit: 'git_commit',
  save: 'git_commit',
  gitlog: 'git_log',
  history: 'git_log',
  gitrestore: 'git_restore',
  revert: 'git_restore',
  undo: 'git_restore',
  gitblame: 'git_blame',
  blame: 'git_blame',
  // checks
  runtests: 'run_tests',
  test: 'run_tests',
  tests: 'run_tests',
  runtest: 'run_tests',
  typecheck: 'type_check',
  tsc: 'type_check',
  lint: 'lint_check',
  eslint: 'lint_check',
  format: 'format_code',
  prettier: 'format_code',
  deps: 'deps_check',
  outdated: 'deps_check',
  audit: 'deps_check',
  install: 'install_package',
  addpackage: 'install_package',
  npminstall: 'install_package',
  versions: 'check_versions',
  checkversion: 'check_versions',
  // observation
  logs: 'terminal_feed',
  readlogs: 'terminal_feed',
  terminalfeed: 'terminal_feed',
  port: 'port_check',
  ports: 'port_check',
  killprocess: 'process_kill',
  ping: 'health_check',
  healthcheck: 'health_check',
  // screen and browser
  screenshot: 'screenshot_app',
  takescreenshot: 'screenshot_app',
  capture: 'screenshot_app',
  mobilecheck: 'check_mobile',
  pilot: 'browser_pilot',
  browsepage: 'browser_pilot',
  fillform: 'fill_form',
  submitform: 'fill_form',
  chaos: 'chaos_check',
  stresstest: 'chaos_check',
  // data and documents
  parsejson: 'parse_structured',
  parsecsv: 'parse_structured',
  readdocx: 'read_docx',
  docx: 'read_docx',
  readxlsx: 'read_xlsx',
  xlsx: 'read_xlsx',
  readpdf: 'read_pdf',
  pdf: 'read_pdf',
  download: 'download_file',
  wget: 'download_file',
  db: 'db_query',
  sql: 'db_query',
  // project understanding
  projectmap: 'project_map',
  map: 'project_map',
  notes: 'project_notes',
  remember: 'project_notes',
  memory: 'project_notes',
  finddefinition: 'symbol_search',
  definition: 'symbol_search',
  usages: 'find_references',
  findusages: 'find_references',
  findsimilar: 'similar_code',
  explaincode: 'explain_code',
  explain: 'explain_code',
  recent: 'recent_files',
  recentchanges: 'recent_files',
  snapshot: 'snapshot_project',
  recyclebin: 'recycle_bin',
  trash: 'recycle_bin',
  // interaction
  openeditor: 'open_in_editor',
  showfile: 'open_in_editor',
  showtable: 'show_table',
  table: 'show_table',
  drawscheme: 'make_diagram',
  openlink: 'open_url',
  exportchat: 'export_chat',
  savechat: 'export_chat',
  speak: 'voice_read',
  voice: 'voice_read',
  notification: 'notify_me',
  alert: 'notify_me',
  // background
  schedule: 'schedule_task',
  timer: 'schedule_task',
  watcher: 'watch_folder',
  watch: 'watch_folder',
  dayplan: 'task_queue',
  persistenttodos: 'task_queue',
  // web
  docs: 'docs_lookup',
  searchdocs: 'docs_lookup',
  documentation: 'docs_lookup',
  api: 'api_call',
  curl: 'api_call',
  apirequest: 'api_call'
}

function normalizeToolKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  let previous = Array.from({ length: cols }, (_, index) => index)
  for (let i = 1; i < rows; i += 1) {
    const current = [i]
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      )
    }
    previous = current
  }
  return previous[cols - 1]
}

/** Map a model-supplied tool name to a canonical RelaxCode tool, or null. */
export function resolveToolName(raw: string): string | null {
  if (typeof raw !== 'string') return null
  const key = normalizeToolKey(raw)
  if (key.length === 0) return null

  const canonical = TOOLS.map((tool) => tool.name)
  const direct = canonical.find((name) => normalizeToolKey(name) === key)
  if (direct) return direct

  // MCP tool names join the canonical set only as exact matches: fuzzy
  // distance across hundreds of external tools would invent calls.
  const mcpDirect = mcpToolDefs().find((tool) => normalizeToolKey(tool.name) === key)
  if (mcpDirect) return mcpDirect.name

  const alias = TOOL_ALIASES[key]
  if (alias) return alias

  // Last resort: nearest canonical name (typos like "write_fil").
  let best: string | null = null
  let bestDistance = 3
  for (const name of canonical) {
    const distance = levenshtein(key, normalizeToolKey(name))
    if (distance < bestDistance) {
      bestDistance = distance
      best = name
    }
  }
  return bestDistance <= 2 ? best : null
}

export function findTool(name: string, mode: ChatMode): ToolDef | null {
  const available = toolsForMode(mode)
  const exact = available.find((tool) => tool.name === name)
  if (exact) return exact
  const resolved = resolveToolName(name)
  if (!resolved) return null
  return available.find((tool) => tool.name === resolved) ?? null
}

export function openAiToolSchema(toolDef: ToolDef): {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
} {
  return {
    type: 'function',
    function: { name: toolDef.name, description: toolDef.description, parameters: toolDef.parameters }
  }
}
