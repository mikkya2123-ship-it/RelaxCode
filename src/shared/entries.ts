/**
 * File entry names, paths and name conflicts — everything the explorer (and the
 * main process behind it) has to decide *without* touching the disk.
 *
 * It lives in `shared` because both sides use it: the renderer validates a name
 * as the user types and the main process validates it again before writing, so a
 * name that reaches the filesystem is always one the explorer would accept too.
 * Keeping it free of `electron` also makes it unit-testable under plain node.
 */

export type EntryKind = 'file' | 'dir'

/** Why a name cannot be used. Codes, so the caller can word the problem. */
export type EntryNameIssue =
  | 'empty'
  | 'dots'
  | 'separator'
  | 'illegal'
  | 'trailing'
  | 'reserved'
  | 'too-long'

const ILLEGAL_CHARS = /[<>:"|?*\u0000-\u001f]/

/** Device names Windows refuses whatever the extension is (`con.txt` too). */
const RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9'
])

export const ENTRY_NAME_MAX = 255

/** The first reason `name` cannot be used as a single file/folder name, if any. */
export function entryNameIssue(name: string): EntryNameIssue | null {
  if (name.length === 0) return 'empty'
  if (name === '.' || name === '..') return 'dots'
  if (/[\\/]/.test(name)) return 'separator'
  if (ILLEGAL_CHARS.test(name)) return 'illegal'
  if (name.length > ENTRY_NAME_MAX) return 'too-long'
  // Windows silently drops a trailing dot or space, so refuse it instead of
  // creating "report" when the user asked for "report.".
  if (/[ .]$/.test(name)) return 'trailing'
  const stem = (name.split('.')[0] ?? '').toLowerCase()
  if (RESERVED_NAMES.has(stem)) return 'reserved'
  return null
}

export function isValidEntryName(name: string): boolean {
  return entryNameIssue(name) === null
}

export type CreatePathResult =
  | { ok: true; segments: string[] }
  | { ok: false; issue: EntryNameIssue }

/**
 * A name typed into "New File" may be a path (`src/utils/date.ts`) — VS Code
 * creates the missing folders. Every segment is validated on its own, so an
 * illegal character is reported instead of being handed to the filesystem.
 */
export function createPathSegments(value: string): CreatePathResult {
  const segments = value.split(/[\\/]+/).filter((part) => part.length > 0 && part !== '.')
  if (segments.length === 0) return { ok: false, issue: 'empty' }
  for (const segment of segments) {
    const issue = entryNameIssue(segment)
    if (issue) return { ok: false, issue }
  }
  return { ok: true, segments }
}

/** Splits `file.tar.gz` into `{ base: 'file.tar', ext: '.gz' }`; dotfiles have no extension. */
export function splitExtension(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return { base: name, ext: '' }
  return { base: name.slice(0, dot), ext: name.slice(dot) }
}

/**
 * A free name for a copy: `notes.txt` → `notes copy.txt` → `notes copy 2.txt`.
 * Child folders are not consulted; callers pass the names already taken in the
 * destination folder.
 */
export function conflictName(name: string, taken: Iterable<string>, word = 'copy'): string {
  const used = new Set<string>()
  for (const item of taken) used.add(item.toLowerCase())
  const { base, ext } = splitExtension(name)
  for (let index = 1; index < 1000; index += 1) {
    const suffix = index === 1 ? word : `${word} ${index}`
    const candidate = `${base} ${suffix}${ext}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
  return `${base} ${word} ${Date.now()}${ext}`
}

/* --------------------------------- paths --------------------------------- */
/*
 * Comparisons are case-insensitive and treat both separators as equal: the IDE
 * runs on Windows, where `D:\App` and `d:/app` are the same folder, and mixing
 * the two would produce "the path is already inside itself" style nonsense.
 */

function comparable(path: string): string {
  const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return (slashed.length === 0 ? '/' : slashed).toLowerCase()
}

export function isSamePath(a: string, b: string): boolean {
  return comparable(a) === comparable(b)
}

/** True when `child` sits *inside* `parent` (equal paths are not "inside"). */
export function isPathInside(parent: string, child: string): boolean {
  const outer = comparable(parent)
  const inner = comparable(child)
  if (outer === inner) return false
  return inner.startsWith(outer.endsWith('/') ? outer : `${outer}/`)
}

/** Trailing separators removed, except for the bare root (`D:\`, `/`). */
export function stripTrailingSeparators(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.length === 0 ? path : trimmed
}

export function nameOf(path: string): string {
  const trimmed = stripTrailingSeparators(path)
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return index < 0 ? trimmed : trimmed.slice(index + 1)
}

export function parentDirOf(path: string): string {
  const trimmed = stripTrailingSeparators(path)
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (index < 0) return trimmed
  if (index === 0) return trimmed.slice(0, 1)
  const parent = trimmed.slice(0, index)
  // `D:` on its own is not a usable path; `D:\` is.
  return /^[a-z]:$/i.test(parent) ? `${parent}\\` : parent
}

export function joinPath(dir: string, name: string): string {
  const base = stripTrailingSeparators(dir)
  const separator = base.includes('\\') || !base.includes('/') ? '\\' : '/'
  return `${base}${separator}${name}`
}

/** `C:\app\src\a.ts` → `src\a.ts`; returns `path` untouched when it is not inside `root`. */
export function relativeTo(root: string, path: string): string {
  if (isSamePath(root, path)) return ''
  if (!isPathInside(root, path)) return path
  const trimmed = stripTrailingSeparators(path)
  return trimmed.slice(stripTrailingSeparators(root).length + 1)
}
