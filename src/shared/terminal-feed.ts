/**
 * The little wire format of the terminal dock's AI feed.
 *
 * A feed line is a NUL, `rc:`, the event kind, another NUL and the text — so a
 * line a shell printed can never be mistaken for an event. The main process
 * writes these lines (command, output, failure, file operation); the renderer
 * turns them into framed commands and coloured file chips instead of plain
 * text. Lines without the prefix are ordinary output.
 */

export type FeedEventKind =
  | 'command'
  | 'output'
  | 'error'
  | 'file-create'
  | 'file-write'
  | 'file-edit'
  | 'file-delete'
  | 'file-move'

const FEED_PREFIX = '\u0000rc:'

/** One feed event as a single line, safe to push through the line-split log. */
export function feedLine(kind: FeedEventKind, text: string): string {
  return `${FEED_PREFIX}${kind}\u0000${text.replace(/[\r\n]+/g, ' ').trimEnd()}`
}

export interface FeedEvent {
  kind: FeedEventKind
  text: string
}

const FEED_LINE_RE = /^\u0000rc:([a-z-]+)\u0000([\s\S]*)$/

/** The event in this line, or null when it is ordinary shell output. */
export function parseFeedLine(line: string): FeedEvent | null {
  const match = FEED_LINE_RE.exec(line)
  if (!match) return null
  return { kind: match[1] as FeedEventKind, text: match[2] ?? '' }
}

/** Whether the event is one of the file operations (drawn as a chip). */
export function isFileEvent(kind: FeedEventKind): boolean {
  return kind.startsWith('file-')
}
