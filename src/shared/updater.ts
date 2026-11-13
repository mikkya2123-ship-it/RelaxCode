/**
 * Update plumbing shared by the main process, the preload bridge and the
 * renderer.
 *
 * The app checks the GitHub releases of the repository on startup and every
 * few hours. Only when a newer stable release exists does the title bar show
 * the "Обновить" button; the dialog shows a short plain-text digest of the
 * release notes and offers to download and install the build.
 */

/** Where a release check currently stands. */
export type UpdatePhase =
  | 'idle'
  /** A check is in flight. */
  | 'checking'
  /** A newer release exists; the button appears. */
  | 'available'
  | 'downloading'
  /** The installer is on disk and only needs a restart. */
  | 'ready'
  /** The installed version is the latest one. */
  | 'up-to-date'
  | 'error'

export interface UpdateProgress {
  /** 0–100, rounded for display. */
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export interface UpdateState {
  phase: UpdatePhase
  /** The version that is installed right now. */
  current: string
  /** The version of the available release. */
  version: string | null
  /** A short plain-text digest of the release notes. */
  notes: string[]
  releaseDate: string | null
  /** GitHub page of the release, for the full notes. */
  releaseUrl: string | null
  progress: UpdateProgress | null
  error: string | null
  /**
   * A development build cannot replace itself: "install" opens the release
   * page instead. Packaged installations always install directly.
   */
  manual: boolean
}

/** electron-updater reports notes either as one string or per version. */
export type ReleaseNotes =
  | string
  | Array<{ version?: string; note?: string | null }>
  | null
  | undefined

/** Splits a version into numeric core parts and a prerelease tail. */
function parseVersion(value: string): { parts: number[]; prerelease: string } {
  const clean = value.trim().replace(/^v/i, '').split('+')[0]
  const dash = clean.indexOf('-')
  const core = dash >= 0 ? clean.slice(0, dash) : clean
  const prerelease = dash >= 0 ? clean.slice(dash + 1) : ''
  const parts = core
    .split('.')
    .map((piece) => {
      const parsed = Number.parseInt(piece, 10)
      return Number.isFinite(parsed) ? parsed : 0
    })
  while (parts.length < 3) parts.push(0)
  return { parts, prerelease }
}

/**
 * Compares two versions (with or without a leading `v`). Returns 1 when `a`
 * is newer, -1 when `b` is newer and 0 when they are the same. A release is
 * newer than its own prerelease (`1.0.0` > `1.0.0-beta.1`).
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  const length = Math.max(left.parts.length, right.parts.length)
  for (let index = 0; index < length; index += 1) {
    const l = left.parts[index] ?? 0
    const r = right.parts[index] ?? 0
    if (l !== r) return l > r ? 1 : -1
  }
  if (left.prerelease === right.prerelease) return 0
  if (left.prerelease === '') return 1
  if (right.prerelease === '') return -1
  return left.prerelease > right.prerelease ? 1 : -1
}

/** True when `candidate` is strictly newer than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16) || 0)
    }
    if (entity.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10) || 0)
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? match
  })
}

/** Headings that carry structure rather than useful news. */
const NOISE_LINE =
  /^(what'?s changed|full changelog|changelog|changes|new in this release|что нового|изменения|список изменений)[:：]?$/i

/**
 * Turns GitHub markdown (or the HTML the Atom feed sometimes returns) into a
 * handful of short plain-text lines for the update dialog. Links, code and
 * headings are dropped: the dialog shows what changed, not the formatting.
 */
export function releaseNotesLines(input: ReleaseNotes, maxLines = 6): string[] {
  const raw = Array.isArray(input)
    ? input
        .map((item) => (typeof item?.note === 'string' ? item.note : ''))
        .filter((note) => note.trim() !== '')
        .join('\n')
    : typeof input === 'string'
      ? input
      : ''
  if (raw.trim() === '') return []

  let text = raw
    .replace(/\r\n?/g, '\n')
    // Fenced code blocks carry no news; inline code keeps its text.
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/\*\*|__/g, '')
    .replace(/^\s*[-*+•]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')

  text = decodeEntities(text)

  const seen = new Set<string>()
  const lines: string[] = []
  for (const chunk of text.split('\n')) {
    let line = chunk.replace(/\s+/g, ' ').trim()
    // GitHub's generated notes end with "by @user in <link>" or "in #123".
    line = line.replace(/\s+by\s+@[\w-]+(?:\s+in(?:\s+.*)?)?$/i, '').trim()
    line = line.replace(/\s+in$/, '').trim()
    line = line.replace(/^[-–—:•]+\s*/, '').trim()
    if (line.length < 2) continue
    if (NOISE_LINE.test(line)) continue
    if (line.length > 160) line = `${line.slice(0, 157).trimEnd()}…`
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(line)
    if (lines.length >= Math.max(1, maxLines)) break
  }
  return lines
}

/** A human-friendly size for the download line: 12.4 MB, 131 MB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb >= 100) return `${Math.round(mb)} MB`
  return `${mb.toFixed(1)} MB`
}
