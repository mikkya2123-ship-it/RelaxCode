import { promises as fs } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import type { DirEntry } from '@shared/ipc'
import { getSettings } from './store'

export const IGNORED_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.cache',
  '.turbo',
  '.parcel-cache',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.DS_Store'
])

const MAX_WATCH_DEPTH = 16

let root: string | null = null
let watcher: FSWatcher | null = null
let changeListener: ((dirs: string[]) => void) | null = null

export function setChangeListener(listener: ((dirs: string[]) => void) | null): void {
  changeListener = listener
}

export function getWorkspaceRoot(): string | null {
  return root
}

export async function disposeWorkspace(): Promise<void> {
  await watcher?.close()
  watcher = null
  root = null
}

export async function setWorkspaceRoot(path: string): Promise<string> {
  const resolved = resolve(path)
  const stat = await fs.stat(resolved)
  if (!stat.isDirectory()) {
    throw new Error('Path is not a directory')
  }

  await watcher?.close()
  watcher = null
  root = resolved

  const ignoredNames = new Set([...IGNORED_NAMES, ...getSettings().files.excludeGlobs])
  watcher = watch(resolved, {
    ignoreInitial: true,
    depth: MAX_WATCH_DEPTH,
    ignored: (p: string) => ignoredNames.has(basename(p)),
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 80 }
  })

  const pending = new Set<string>()
  let flushTimer: NodeJS.Timeout | null = null

  const markDirty = (filePath: string): void => {
    pending.add(dirname(filePath))
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      const dirs = [...pending]
      pending.clear()
      changeListener?.(dirs)
    }, 250)
  }

  watcher
    .on('add', markDirty)
    .on('unlink', markDirty)
    .on('addDir', markDirty)
    .on('unlinkDir', markDirty)

  return resolved
}

export function assertInsideWorkspace(inputPath: string): string {
  if (!root) throw new Error('No workspace is open')
  const resolved = resolve(root, inputPath)
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new Error(
      `Path is outside of the workspace: "${inputPath}". The workspace root is "${root}" — use a path relative to it (for example "index.html" or "src/app.ts").`
    )
  }
  return resolved
}

export async function readDir(dirPath: string): Promise<DirEntry[]> {
  const target = assertInsideWorkspace(dirPath)
  const entries = await fs.readdir(target, { withFileTypes: true })
  const result: DirEntry[] = []
  const settings = getSettings()
  const ignored = new Set([...IGNORED_NAMES, ...settings.files.excludeGlobs])

  for (const entry of entries) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue
    if (entry.name === '.DS_Store') continue
    if (!settings.files.showHidden && entry.name.startsWith('.')) continue
    result.push({
      name: entry.name,
      path: join(target, entry.name),
      isDirectory: entry.isDirectory()
    })
  }

  result.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })

  return result
}
