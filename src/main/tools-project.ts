import { copyFileSync, existsSync, mkdirSync, promises as fsp, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { app } from 'electron'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { getWorkspaceRoot, IGNORED_NAMES } from './workspace'
import { backupRoot, BACKUP_LIMIT } from './backup'
import { formatBytes } from './visuals'
import {
  argNumber,
  argString,
  execCapture,
  NO_WORKSPACE,
  relPath,
  resolveInWorkspace,
  ToolError,
  truncate,
  type ToolDef
} from './tool-utils'

/**
 * Understanding and memory: the shape of a project, where symbols live, what
 * changed recently, durable notes that survive between chats, whole-project
 * snapshots and the recycle bin of backed-up files.
 */

const MAX_SCAN = 1024 * 1024

async function* walkWorkspace(signal: AbortSignal, maxFiles = 8000): AsyncGenerator<string> {
  const root = getWorkspaceRoot()
  if (!root) return
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  const ignored = new Set([...IGNORED_NAMES, ...'.git'.split(' ')])
  let count = 0
  while (queue.length > 0 && count < maxFiles) {
    if (signal.aborted) return
    const current = queue.shift()
    if (!current) return
    let entries
    try {
      entries = await fsp.readdir(current.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (ignored.has(entry.name) || entry.name === '.DS_Store') continue
      const full = join(current.dir, entry.name)
      if (entry.isDirectory()) {
        if (current.depth < 14) queue.push({ dir: full, depth: current.depth + 1 })
      } else if (entry.isFile()) {
        yield full
        count += 1
      }
    }
  }
}

// --- project map ---------------------------------------------------------------

const projectMapTool: ToolDef = {
  name: 'project_map',
  description:
    'Build a one-screen digest of the project: top-level folders with file counts, the stack (package.json / pyproject / go.mod / Cargo.toml), entry points and test folders. Run it first when you arrive in an unfamiliar project — cheaper than listing every file.',
  parameters: { type: 'object', properties: {} },
  risk: 'read',
  execute: async () => {
    const root = getWorkspaceRoot()
    if (!root) throw new ToolError(NO_WORKSPACE)
    const lines: string[] = []

    const top = await fsp.readdir(root, { withFileTypes: true })
    const ignoredTop = new Set(IGNORED_NAMES)
    const folders = top.filter((entry) => entry.isDirectory() && !ignoredTop.has(entry.name))
    for (const folder of folders.slice(0, 15)) {
      let count = 0
      try {
        count = readdirSync(join(root, folder.name), { recursive: true }).length
      } catch {
        count = 0
      }
      lines.push(`${folder.name}/ — ${count} entries`)
    }

    try {
      const pkg = JSON.parse(await fsp.readFile(join(root, 'package.json'), 'utf8'))
      lines.push(
        `npm: ${(pkg as { name?: string }).name ?? 'unnamed'} v${(pkg as { version?: string }).version ?? '?'}`,
        `deps: ${Object.keys((pkg as { dependencies?: object }).dependencies ?? {}).join(', ') || 'none'}`,
        `scripts: ${Object.entries((pkg as { scripts?: Record<string, string> }).scripts ?? {}).map(([k, v]) => `${k}="${v.slice(0, 50)}"`).join(' · ') || 'none'}`
      )
    } catch {
      for (const marker of ['pyproject.toml', 'go.mod', 'Cargo.toml', 'composer.json', 'pom.xml']) {
        if (existsSync(join(root, marker))) lines.push(`project type: ${marker}`)
      }
    }
    for (const entry of top.filter((e) => e.isFile()).map((e) => e.name)) {
      if (/^(readme|license|dockerfile|makefile)/i.test(entry)) lines.push(entry)
    }
    const tests = folders.filter((f) => /test|spec/i.test(f.name)).map((f) => f.name)
    if (tests.length > 0) lines.push(`test folders: ${tests.join(', ')}`)

    return { ok: true, summary: `map of ${basename(root)}`, detail: truncate(lines.join('\n')) }
  }
}

// --- project notes (memory between chats) --------------------------------------

interface ProjectNotes {
  [workspace: string]: Array<{ at: number; topic: string; text: string }>
}

function notesPath(): string {
  return join(app.getPath('userData'), 'project-notes.json')
}

function readNotes(): ProjectNotes {
  try {
    return JSON.parse(readFileSync(notesPath(), 'utf8')) as ProjectNotes
  } catch {
    return {}
  }
}

function writeNotes(notes: ProjectNotes): void {
  writeFileSync(notesPath(), JSON.stringify(notes))
}

export function projectNotesDigest(): string {
  const root = getWorkspaceRoot()
  if (!root) return ''
  const entries = readNotes()[root] ?? []
  if (entries.length === 0) return ''
  const lines = entries.slice(-12).map((entry) => `[${entry.topic}] ${entry.text}`)
  return `Project notes you (or an earlier chat) wrote about this workspace:\n${lines.join('\n')}`
}

const projectNotesTool: ToolDef = {
  name: 'project_notes',
  description:
    'Durable memory for this project: facts worth remembering across chats ("uses pnpm, never npm", "the auth flow lives in src/auth", "user prefers Russian"). Write what you learn once; every future chat reads it automatically at startup. Read lists current notes; clear removes one topic.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['read', 'write', 'clear'], description: 'What to do (default read)' },
      topic: { type: 'string', description: 'Short tag, e.g. "build" or "auth" (write/clear)' },
      text: { type: 'string', description: 'The fact to remember (write)' }
    },
    required: ['action']
  },
  risk: 'write',
  execute: async (args) => {
    const root = getWorkspaceRoot()
    if (!root) throw new ToolError(NO_WORKSPACE)
    const action = argString(args, 'action', false) || 'read'
    const notes = readNotes()
    const entries = notes[root] ?? []

    if (action === 'write') {
      const topic = argString(args, 'topic', false) || 'general'
      const text = argString(args, 'text').slice(0, 1000)
      notes[root] = [...entries.filter((entry) => entry.topic !== topic), { at: Date.now(), topic, text }].slice(-50)
      writeNotes(notes)
      return { ok: true, summary: `noted [${topic}]`, detail: `Saved for every future chat in this workspace: ${text}` }
    }
    if (action === 'clear') {
      const topic = argString(args, 'topic', false)
      notes[root] = topic ? entries.filter((entry) => entry.topic !== topic) : []
      writeNotes(notes)
      return { ok: true, summary: topic ? `cleared [${topic}]` : 'cleared all notes', detail: 'Forgotten.' }
    }
    return {
      ok: true,
      summary: `${entries.length} note(s)`,
      detail: entries.length === 0 ? 'No notes yet — write what is worth remembering.' : entries.map((entry) => `[${entry.topic}] ${entry.text}`).join('\n')
    }
  }
}

// --- symbols and references ------------------------------------------------------

function identifierRegex(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`, 'g')
}

/** Definition-ish patterns across common languages. */
function definitionPatterns(name: string): RegExp[] {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [
    new RegExp(`\\b(?:function|class|interface|type|enum|struct|trait|impl)\\s+${n}\\b`),
    new RegExp(`\\b(?:const|let|var|val|fn|func|def)\\s+${n}\\s*[(:=]`)
  ]
}

const symbolSearchTool: ToolDef = {
  name: 'symbol_search',
  description:
    'Find where a function, class or type is DEFINED in the project: returns file:line for each definition (works for JS/TS, Python, Go, Rust and friends via keyword patterns). Use it before editing a symbol you have not seen.',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Symbol name, e.g. "parseConfig"' } },
    required: ['name']
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const name = argString(args, 'name')
    const patterns = definitionPatterns(name)
    const hits: string[] = []
    for await (const file of walkWorkspace(ctx.signal)) {
      if (hits.length >= 40) break
      try {
        const stat = await fsp.stat(file)
        if (stat.size > MAX_SCAN) continue
        const text = await fsp.readFile(file, 'utf8')
        const lines = text.split('\n')
        for (let index = 0; index < lines.length; index += 1) {
          if (patterns.some((pattern) => pattern.test(lines[index]))) {
            hits.push(`${relPath(file)}:${index + 1}  ${lines[index].trim().slice(0, 100)}`)
            if (hits.length >= 40) break
          }
        }
      } catch {
        continue
      }
    }
    if (hits.length === 0) return { ok: false, summary: `"${name}" not defined anywhere`, detail: 'No definition pattern matched. Try find_references to catch every mention.' }
    return { ok: true, summary: `${hits.length} definition(s) of ${name}`, detail: hits.join('\n') }
  }
}

const findReferencesTool: ToolDef = {
  name: 'find_references',
  description:
    'Find every place a name is USED in the project (imports, calls, tests): returns file:line with the code snippet. Run it before renaming or changing a symbol so nothing is missed.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Identifier to search for' },
      limit: { type: 'number', description: 'Max matches (default 50)' }
    },
    required: ['name']
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const name = argString(args, 'name')
    const limit = Math.min(Math.max(argNumber(args, 'limit') ?? 50, 5), 200)
    const pattern = identifierRegex(name)
    const hits: string[] = []
    for await (const file of walkWorkspace(ctx.signal)) {
      if (hits.length >= limit) break
      try {
        const stat = await fsp.stat(file)
        if (stat.size > MAX_SCAN) continue
        const lines = (await fsp.readFile(file, 'utf8')).split('\n')
        for (let index = 0; index < lines.length; index += 1) {
          pattern.lastIndex = 0
          if (pattern.test(lines[index])) {
            hits.push(`${relPath(file)}:${index + 1}  ${lines[index].trim().slice(0, 100)}`)
            if (hits.length >= limit) break
          }
        }
      } catch {
        continue
      }
    }
    if (hits.length === 0) return { ok: false, summary: `"${name}" is not used anywhere`, detail: 'No mentions found.' }
    return { ok: true, summary: `${hits.length} mention(s) of ${name}`, detail: hits.join('\n') }
  }
}

// --- similar code -----------------------------------------------------------------

function identifiersOf(text: string): Set<string> {
  return new Set(text.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) ?? [])
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const token of a) if (b.has(token)) shared += 1
  return shared / (a.size + b.size - shared)
}

const similarCodeTool: ToolDef = {
  name: 'similar_code',
  description:
    "Find places in the project that already solve a similar problem: pass a code snippet, get the files whose chunks share the most identifiers with it. Use it to follow the project's own patterns instead of inventing new ones.",
  parameters: {
    type: 'object',
    properties: { snippet: { type: 'string', description: 'Code snippet (a function, a block) to match against' } },
    required: ['snippet']
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const snippet = argString(args, 'snippet').slice(0, 8000)
    const want = identifiersOf(snippet)
    if (want.size === 0) return { ok: false, summary: 'nothing to match', detail: 'The snippet has no identifiers.' }
    const CHUNK = 24
    type Hit = { score: number; where: string }
    const hits: Hit[] = []
    for await (const file of walkWorkspace(ctx.signal, 4000)) {
      try {
        const stat = await fsp.stat(file)
        if (stat.size > MAX_SCAN) continue
        const lines = (await fsp.readFile(file, 'utf8')).split('\n')
        for (let start = 0; start < lines.length; start += CHUNK) {
          const chunk = lines.slice(start, start + CHUNK)
          const score = jaccard(want, identifiersOf(chunk.join('\n')))
          if (score >= 0.2) hits.push({ score, where: `${relPath(file)}:${start + 1}` })
        }
      } catch {
        continue
      }
    }
    hits.sort((a, b) => b.score - a.score)
    const top = hits.slice(0, 8)
    if (top.length === 0) return { ok: true, summary: 'no similar code found', detail: 'Nothing in the project resembles the snippet closely.' }
    return {
      ok: true,
      summary: `${top.length} similar place(s)`,
      detail: top.map((hit) => `${hit.where} — ${Math.round(hit.score * 100)}% identifier overlap`).join('\n')
    }
  }
}

// --- explain code (focused read) -----------------------------------------------------

const explainCodeTool: ToolDef = {
  name: 'explain_code',
  description:
    'Load a focused, numbered slice of a file (a range around a line, or the file head) so you can explain it to the user precisely. A cheaper, sharper read than the whole file.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace file to explain' },
      line: { type: 'number', description: 'Line to center on (default: file head)' },
      span: { type: 'number', description: 'How many lines of context (default 60)' }
    },
    required: ['path']
  },
  risk: 'read',
  execute: async (args) => {
    const absolute = resolveInWorkspace(argString(args, 'path'))
    const lines = (await fsp.readFile(absolute, 'utf8')).split('\n')
    const span = Math.min(Math.max(argNumber(args, 'span') ?? 60, 10), 200)
    const center = argNumber(args, 'line') ?? Math.min(span, lines.length)
    const from = Math.max(1, Math.min(center - Math.floor(span / 2), Math.max(1, lines.length - span + 1)))
    const to = Math.min(lines.length, from + span - 1)
    const slice = lines
      .slice(from - 1, to)
      .map((line, index) => `${from + index}  ${line}`)
      .join('\n')
    return { ok: true, summary: `${relPath(absolute)} lines ${from}-${to} of ${lines.length}`, detail: truncate(slice) }
  }
}

// --- recent files -----------------------------------------------------------------

const recentFilesTool: ToolDef = {
  name: 'recent_files',
  description:
    'What was touched recently in this project: files from the last git commits, plus the newest files by modification time. Use it to find the "live" part of a codebase fast.',
  parameters: { type: 'object', properties: {} },
  risk: 'read',
  execute: async (_args, ctx) => {
    const root = getWorkspaceRoot()
    if (!root) throw new ToolError(NO_WORKSPACE)
    const lines: string[] = []

    const git = await execCapture('git log -n 5 --name-only --pretty=format:"" --diff-filter=ACMR', root, ctx.signal, 20000)
    if (git.ok) {
      const files = [...new Set(git.output.split('\n').map((l) => l.trim()).filter((l) => l.length > 0))].slice(0, 15)
      if (files.length > 0) lines.push(`From the last commits:\n${files.join('\n')}`)
    }
    const newest: Array<{ file: string; mtime: number }> = []
    for await (const file of walkWorkspace(ctx.signal, 3000)) {
      try {
        newest.push({ file, mtime: statSync(file).mtimeMs })
      } catch {
        continue
      }
    }
    newest.sort((a, b) => b.mtime - a.mtime)
    lines.push(
      `Newest on disk:\n${newest.slice(0, 10).map((entry) => `${relPath(entry.file)} (${new Date(entry.mtime).toLocaleString()})`).join('\n')}`
    )
    return { ok: true, summary: `${newest.length} files scanned`, detail: truncate(lines.join('\n\n')) }
  }
}

// --- snapshots (whole project) -----------------------------------------------------

const SNAPSHOT_LIMIT = 20
const SNAPSHOT_FILE_CAP = 20000

function snapshotRoot(): string {
  return join(app.getPath('userData'), 'snapshots')
}

export type SnapshotOutcome =
  | { ok: true; name: string; files: number; bytes: number }
  | { ok: false; error: string }

/**
 * Copies the workspace (code only) into app storage under a fresh timestamp
 * name. Shared by the snapshot_project tool and the chat's time travel —
 * the latter photographs the project before a run's first change.
 */
export async function createProjectSnapshot(
  root: string,
  signal: AbortSignal
): Promise<SnapshotOutcome> {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const mine = join(snapshotRoot(), basename(root))
    const target = join(mine, stamp)
    mkdirSync(target, { recursive: true })
    let copied = 0
    let bytes = 0
    for await (const file of walkWorkspace(signal, SNAPSHOT_FILE_CAP)) {
      const rel = relative(root, file)
      const dest = join(target, rel)
      mkdirSync(dirname(dest), { recursive: true })
      copyFileSync(file, dest)
      copied += 1
      bytes += statSync(file).size
    }
    const siblings = readdirSync(mine).sort().reverse()
    for (const stale of siblings.slice(SNAPSHOT_LIMIT)) rmSync(join(mine, stale), { recursive: true, force: true })
    return { ok: true, name: stamp, files: copied, bytes }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Copies a snapshot back over the workspace; -1 when it does not exist. */
export function restoreProjectSnapshot(root: string, name: string): number {
  const source = join(snapshotRoot(), basename(root), basename(name))
  if (!existsSync(source) || !statSync(source).isDirectory()) return -1
  let restored = 0
  const files = readdirSync(source, { recursive: true }).filter((entry) => statSync(join(source, String(entry))).isFile())
  for (const entry of files.slice(0, SNAPSHOT_FILE_CAP)) {
    const target = join(root, String(entry))
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(source, String(entry)), target)
    restored += 1
  }
  return restored
}

const snapshotProjectTool: ToolDef = {
  name: 'snapshot_project',
  description:
    'Photograph the whole project (code only — node_modules, .git and other heavy folders are skipped) into app storage, or restore an earlier snapshot. Create one before risky bulk changes; restoring overwrites the current files. action: create | list | restore.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'list', 'restore'], description: 'What to do (default create)' },
      name: { type: 'string', description: 'restore: snapshot name from list' }
    }
  },
  risk: 'delete',
  execute: async (args, ctx) => {
    const root = getWorkspaceRoot()
    if (!root) throw new ToolError(NO_WORKSPACE)
    const action = argString(args, 'action', false) || 'create'
    const mine = join(snapshotRoot(), basename(root))

    if (action === 'list') {
      const names = existsSync(mine) ? readdirSync(mine).sort().reverse() : []
      return {
        ok: true,
        summary: `${names.length} snapshot(s)`,
        detail: names.length === 0 ? 'No snapshots yet.' : names.map((name) => `${name} (${formatBytes(statSync(join(mine, name)).size)} of metadata)`).join('\n')
      }
    }

    if (action === 'restore') {
      const name = argString(args, 'name')
      const restored = restoreProjectSnapshot(root, name)
      if (restored < 0) {
        return { ok: false, summary: 'snapshot not found', detail: 'Call snapshot_project with action "list" first.' }
      }
      return { ok: true, summary: `restored ${restored} file(s) from ${basename(name)}`, detail: 'The workspace now matches the snapshot.' }
    }

    const snap = await createProjectSnapshot(root, ctx.signal)
    if (!snap.ok) return { ok: false, summary: 'snapshot failed', detail: snap.error }
    return {
      ok: true,
      summary: `snapshot "${snap.name}": ${snap.files} files, ${formatBytes(snap.bytes)}`,
      detail: `Restore with action "restore", name "${snap.name}".`
    }
  }
}

// --- recycle bin ----------------------------------------------------------------

const recycleBinTool: ToolDef = {
  name: 'recycle_bin',
  description:
    'The safety net of delete_path and backup_file: lists the backed-up copies of workspace files kept in app storage, and restores one. action: list (default) | restore with the backup path from the list.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'restore'], description: 'What to do (default list)' },
      backup: { type: 'string', description: 'restore: the .bak path from the list' }
    }
  },
  risk: 'write',
  execute: async (args) => {
    const root = getWorkspaceRoot()
    if (!root) throw new ToolError(NO_WORKSPACE)
    const action = argString(args, 'action', false) || 'list'
    const mine = join(backupRoot(app.getPath('userData')), basename(root))

    if (action === 'restore') {
      const backup = argString(args, 'backup')
      const absolute = resolve(mine, basename(backup))
      if (!existsSync(absolute)) return { ok: false, summary: 'backup not found', detail: 'Call recycle_bin with action "list" first.' }
      // The .bak name carries the original file name; the folder structure mirrors the workspace.
      const original = join(root, relative(mine, dirname(absolute)), basename(absolute).replace(/\.\d{4}-\d{2}-\d{2}T.*\.bak$/, ''))
      copyFileSync(absolute, original)
      return { ok: true, summary: `restored ${relPath(original)}`, detail: `${absolute} → ${relPath(original)}` }
    }

    const found: string[] = []
    const visit = (dir: string): void => {
      if (found.length > 100) return
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) visit(full)
        else if (entry.name.endsWith('.bak')) found.push(`${relative(mine, full)} (${formatBytes(statSync(full).size)})`)
      }
    }
    if (existsSync(mine)) visit(mine)
    return {
      ok: true,
      summary: `${found.length} backup(s)`,
      detail: found.length === 0 ? 'The bin is empty.' : `Up to ${BACKUP_LIMIT} copies per file are kept:\n${found.join('\n')}`
    }
  }
}

export const PROJECT_TOOLS: ToolDef[] = [
  projectMapTool,
  projectNotesTool,
  symbolSearchTool,
  findReferencesTool,
  similarCodeTool,
  explainCodeTool,
  recentFilesTool,
  snapshotProjectTool,
  recycleBinTool
]
