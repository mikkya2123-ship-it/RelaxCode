import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'

/**
 * State snapshots before risky work: the agent (or the user) can back up any
 * workspace file — a .blend, an .aep, a config — into `userData/backups`
 * before a bulk change, and every target keeps a bounded history.
 * Kept free of Electron so the test harness can exercise the logic directly.
 */

export const BACKUP_LIMIT = 20

export type BackupReason = 'not-found' | 'not-file' | 'outside-workspace' | 'io'

export type BackupResult =
  | { ok: true; backupPath: string; bytes: number; kept: number }
  | { ok: false; reason: BackupReason }

export function backupRoot(userDataDir: string): string {
  return join(userDataDir, 'backups')
}

/** Workspace-relative display path, forward slashes, '.' for the root. */
export function displayRelative(root: string | null, absolute: string): string {
  if (!root) return absolute
  const rel = relative(root, absolute)
  return rel === '' ? '.' : rel.split(sep).join('/')
}

export function backupFile(
  userDataDir: string,
  workspaceRoot: string | null,
  inputPath: string,
  now = Date.now()
): BackupResult {
  try {
    if (!workspaceRoot) return { ok: false, reason: 'outside-workspace' }
    // Files inside the workspace only: the backup must never become a way to
    // read a file the agent could not read anyway.
    const absolute = resolve(workspaceRoot, inputPath)
    const rel = relative(workspaceRoot, absolute)
    if (rel.startsWith('..') || resolve(rel) === rel) return { ok: false, reason: 'outside-workspace' }
    if (!existsSync(absolute)) return { ok: false, reason: 'not-found' }
    if (!statSync(absolute).isFile()) return { ok: false, reason: 'not-file' }

    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
    const targetDir = join(backupRoot(userDataDir), basename(workspaceRoot), rel.split(sep).slice(0, -1).join(sep))
    const name = basename(absolute)
    mkdirSync(targetDir, { recursive: true })
    const backupPath = join(targetDir, `${name}.${stamp}.bak`)
    copyFileSync(absolute, backupPath)

    // Bounded history per file name: the oldest copies go away first.
    const siblings = readdirSync(targetDir)
      .filter((entry) => entry.startsWith(`${name}.`) && entry.endsWith('.bak'))
      .map((entry) => join(targetDir, entry))
      .map((entry) => ({ entry, mtime: statSync(entry).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    for (const stale of siblings.slice(BACKUP_LIMIT)) {
      rmSync(stale.entry, { force: true })
    }

    return {
      ok: true,
      backupPath,
      bytes: statSync(absolute).size,
      kept: Math.min(siblings.length, BACKUP_LIMIT)
    }
  } catch {
    return { ok: false, reason: 'io' }
  }
}
