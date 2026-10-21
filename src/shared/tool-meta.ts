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

export type ToolMeta = WebSearchMeta | ImageMeta | FigureMeta

export type ToolMetaKind = ToolMeta['kind']
