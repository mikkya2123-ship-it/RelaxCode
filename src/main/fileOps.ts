import { promises as fs } from 'node:fs'
import { constants as fsConstants } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type {
  EntryCreateRequest,
  EntryDeleteResult,
  EntryOpFailure,
  EntryOpReason,
  EntryOpResult
} from '../shared/ipc'
import type { EntryKind, EntryNameIssue } from '../shared/entries'
import {
  conflictName,
  createPathSegments,
  entryNameIssue,
  isPathInside,
  isSamePath,
  joinPath,
  nameOf,
  parentDirOf
} from '../shared/entries.ts'

/**
 * File and folder operations behind the explorer.
 *
 * The renderer decides *what* to do (and validates names while typing), this
 * module decides whether it is allowed: every path is resolved against the open
 * workspace, a name is checked again, and nothing is ever overwritten. The
 * filesystem and the recycle bin are injected, so the rules can be unit-tested
 * under plain node without Electron.
 */

export interface FileOpsDeps {
  /** Absolute workspace root, or null when no folder is open. */
  workspaceRoot: () => string | null
  /** `files.useTrash`: delete means "move to the recycle bin". */
  useTrash: () => boolean
  trash: (path: string) => Promise<void>
  reveal: (path: string) => void
}

export interface FileOps {
  create: (request: EntryCreateRequest) => Promise<EntryOpResult>
  rename: (path: string, name: string) => Promise<EntryOpResult>
  move: (path: string, parentPath: string) => Promise<EntryOpResult>
  duplicate: (path: string) => Promise<EntryOpResult>
  remove: (path: string) => Promise<EntryDeleteResult>
  reveal: (path: string) => EntryOpResult
}

function fail(reason: EntryOpReason, issue?: EntryNameIssue): EntryOpFailure {
  return issue ? { ok: false, reason, issue } : { ok: false, reason }
}

function failureFromError(error: unknown): EntryOpFailure {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'EEXIST') return fail('exists')
  if (code === 'ENOENT') return fail('not-found')
  if (code === 'ENOTDIR') return fail('not-directory')
  return fail('unknown')
}

/** The absolute path, when it stays inside `root`; null otherwise. */
function resolveInside(root: string, input: string): string | null {
  const resolved = resolve(root, input)
  if (isSamePath(resolved, root) || isPathInside(root, resolved)) return resolved
  return null
}

async function entryExists(path: string): Promise<boolean> {
  try {
    await fs.lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function requireDirectory(path: string): Promise<'ok' | 'not-found' | 'not-directory'> {
  try {
    const stat = await fs.stat(path)
    return stat.isDirectory() ? 'ok' : 'not-directory'
  } catch {
    return 'not-found'
  }
}

export function createFileOps(deps: FileOpsDeps): FileOps {
  const rootOrNull = (): string | null => deps.workspaceRoot()

  return {
    async create(request: EntryCreateRequest): Promise<EntryOpResult> {
      const kind: EntryKind = request.kind === 'dir' ? 'dir' : 'file'
      const root = rootOrNull()
      if (!root) return fail('outside-workspace')

      const parent = resolveInside(root, request.parentPath)
      if (!parent) return fail('outside-workspace')

      const parentState = await requireDirectory(parent)
      if (parentState === 'not-found') return fail('not-found')
      if (parentState === 'not-directory') return fail('not-directory')

      // `src/utils/date.ts` is allowed: the missing folders are created.
      const parsed = createPathSegments(request.name)
      if (!parsed.ok) return fail('invalid-name', parsed.issue)

      const target = resolve(parent, ...parsed.segments)
      if (!resolveInside(root, target)) return fail('outside-workspace')

      try {
        if (await entryExists(target)) return fail('exists')

        if (kind === 'dir') {
          await fs.mkdir(target, { recursive: true })
        } else {
          const folder = dirname(target)
          if (!isSamePath(folder, parent)) await fs.mkdir(folder, { recursive: true })
          // `wx` makes the "does not overwrite" promise hold even in a race.
          const handle = await fs.open(target, 'wx')
          await handle.close()
        }
        return { ok: true, path: target }
      } catch (error) {
        return failureFromError(error)
      }
    },

    async rename(path: string, name: string): Promise<EntryOpResult> {
      const root = rootOrNull()
      if (!root) return fail('outside-workspace')

      const source = resolveInside(root, path)
      if (!source) return fail('outside-workspace')
      if (isSamePath(source, root)) return fail('root')

      const issue = entryNameIssue(name)
      if (issue) return fail('invalid-name', issue)

      const target = joinPath(parentDirOf(source), name)
      if (!resolveInside(root, target)) return fail('outside-workspace')

      try {
        if (!(await entryExists(source))) return fail('not-found')
        if (source === target) return { ok: true, path: source }

        // Windows ignores case, so `foo.ts` → `Foo.ts` finds itself. A real
        // second entry keeps the rename from silently replacing it.
        const sameFile = isSamePath(source, target)
        if ((!sameFile || process.platform !== 'win32') && (await entryExists(target))) {
          return fail('exists')
        }

        await fs.rename(source, target)
        return { ok: true, path: target }
      } catch (error) {
        return failureFromError(error)
      }
    },

    async move(path: string, parentPath: string): Promise<EntryOpResult> {
      const root = rootOrNull()
      if (!root) return fail('outside-workspace')

      const source = resolveInside(root, path)
      if (!source) return fail('outside-workspace')
      if (isSamePath(source, root)) return fail('root')

      const destination = resolveInside(root, parentPath)
      if (!destination) return fail('outside-workspace')

      const parentState = await requireDirectory(destination)
      if (parentState === 'not-found') return fail('not-found')
      if (parentState === 'not-directory') return fail('not-directory')

      // Dropping a folder into itself (or into one of its own children) would
      // detach the subtree from the workspace; the UI also refuses the drop.
      if (isSamePath(source, destination) || isPathInside(source, destination)) {
        return fail('inside-itself')
      }
      if (isSamePath(parentDirOf(source), destination)) return { ok: true, path: source }

      const target = joinPath(destination, nameOf(source))
      if (!resolveInside(root, target)) return fail('outside-workspace')

      try {
        if (await entryExists(target)) return fail('exists')
        await fs.rename(source, target)
        return { ok: true, path: target }
      } catch (error) {
        return failureFromError(error)
      }
    },

    async duplicate(path: string): Promise<EntryOpResult> {
      const root = rootOrNull()
      if (!root) return fail('outside-workspace')

      const source = resolveInside(root, path)
      if (!source) return fail('outside-workspace')
      if (isSamePath(source, root)) return fail('root')

      try {
        const parent = parentDirOf(source)
        const taken = await fs.readdir(parent)
        const target = joinPath(parent, conflictName(nameOf(source), taken))

        const stat = await fs.lstat(source)
        if (stat.isDirectory()) {
          await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false })
        } else if (stat.isSymbolicLink()) {
          await fs.symlink(await fs.readlink(source), target)
        } else {
          await fs.copyFile(source, target, fsConstants.COPYFILE_EXCL)
        }
        return { ok: true, path: target }
      } catch (error) {
        return failureFromError(error)
      }
    },

    async remove(path: string): Promise<EntryDeleteResult> {
      const root = rootOrNull()
      if (!root) return fail('outside-workspace')

      const source = resolveInside(root, path)
      if (!source) return fail('outside-workspace')
      if (isSamePath(source, root)) return fail('root')

      try {
        if (!(await entryExists(source))) return fail('not-found')
        if (deps.useTrash()) {
          try {
            await Promise.race([
              deps.trash(source),
              new Promise((_, reject) => setTimeout(() => reject(new Error('trash-timeout')), 30000))
            ])
            return { ok: true }
          } catch {
            // The recycle bin refused (busy file, long path, odd drive):
            // a hard delete takes over so the action still succeeds.
          }
        }
        await fs.rm(source, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
        return { ok: true }
      } catch (error) {
        return failureFromError(error)
      }
    },

    reveal(path: string): EntryOpResult {
      const root = rootOrNull()
      if (!root) return fail('outside-workspace')

      const source = resolveInside(root, path)
      if (!source) return fail('outside-workspace')

      deps.reveal(source)
      return { ok: true, path: source }
    }
  }
}
