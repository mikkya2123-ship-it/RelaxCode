import type { FigureResult, FigureSpec, FigureTheme } from './figures'
import type { WebSearchMeta } from './web-search'

/**
 * Typed payloads a tool can attach to its result. The chat renders each kind as
 * a rich card instead of a raw tool row.
 */

/** A picture the model wanted the user to see, embedded as a data URL. */
export interface ImageMeta {
  kind: 'image'
  /** `data:image/...;base64,...` — already fetched, so the card never hits the network. */
  src: string
  alt: string
  caption?: string
  /** Page the picture was taken from, when it came from the web. */
  sourceUrl?: string
  sourceTitle?: string
  mime: string
  bytes: number
  width?: number
  height?: number
}

/** A drawing the model made, already rendered to a standalone SVG. */
export interface FigureMeta {
  kind: 'figure'
  title?: string
  caption?: string
  svg: string
  notes: string[]
  results: FigureResult[]
  warnings: string[]
  /** Geometry as the model described it, so the card can redraw it on drag. */
  spec?: FigureSpec
  /** Style the drawing was produced with (kept so a redraw looks the same). */
  style?: { grid: boolean; theme: FigureTheme; results: boolean }
}

/** A unified diff shown as a colored before/after card instead of raw text. */
export interface DiffMeta {
  kind: 'diff'
  title?: string
  /** File the change belongs to, workspace-relative. */
  file?: string
  /** Unified diff text (the `@@`/`+`/`-` lines). */
  patch: string
}

/** A small result table, rendered as a real grid instead of a text dump. */
export interface TableMeta {
  kind: 'table'
  title?: string
  columns: string[]
  rows: string[][]
}

/** A boxes-and-arrows diagram, already laid out and rendered to SVG. */
export interface DiagramMeta {
  kind: 'diagram'
  title?: string
  caption?: string
  svg: string
}

/** A film of the running app during one agent run (small JPEG data URLs). */
export interface TimelapseMeta {
  kind: 'timelapse'
  /** Frame 0 is the earliest shot. */
  frames: string[]
  /** Seconds between shots, so the card can replay at the real pace. */
  intervalSec: number
}

export type ToolMeta =
  | WebSearchMeta
  | ImageMeta
  | FigureMeta
  | DiffMeta
  | TableMeta
  | DiagramMeta
  | TimelapseMeta

export type ToolMetaKind = ToolMeta['kind']
