/**
 * Technical drawings for the chat.
 *
 * The model does not write SVG or ASCII art — it describes the figure as
 * geometry (points, segments, angles, graphs, dimensions) and this module turns
 * that into a clean, labelled drawing. Everything here is pure: it runs in the
 * main process before the card is emitted, and in plain Node tests.
 *
 * Coordinates are ordinary maths coordinates (y grows upwards). The renderer
 * flips them, adds the grid and picks the scale from the content, so a model
 * never has to think about pixels.
 */

export const FIGURE_THEMES = ['paper', 'blueprint'] as const
export type FigureTheme = (typeof FIGURE_THEMES)[number]

export interface FigureResult {
  label: string
  value: string
  formula?: string
}

export type FigurePoint = [number, number]

export type FigureElement =
  | {
      type: 'segment'
      from: FigurePoint
      to: FigurePoint
      label?: string
      dashed?: boolean
      color?: string
      /** Tick marks across the middle (equal-length markers, like in textbooks). */
      ticks?: number
    }
  | { type: 'line'; from: FigurePoint; to: FigurePoint; label?: string; dashed?: boolean; color?: string }
  | { type: 'ray'; from: FigurePoint; through: FigurePoint; label?: string; dashed?: boolean; color?: string }
  | {
      type: 'polygon'
      points: FigurePoint[]
      label?: string
      filled?: boolean
      color?: string
    }
  | {
      type: 'point'
      at: FigurePoint
      label?: string
      side?: 'nw' | 'ne' | 'sw' | 'se'
      hollow?: boolean
      color?: string
    }
  | { type: 'circle'; center: FigurePoint; radius: number; label?: string; dashed?: boolean; color?: string }
  | {
      type: 'angle'
      vertex: FigurePoint
      from: FigurePoint
      to: FigurePoint
      label?: string
      /** Draws the square mark instead of an arc. */
      right?: boolean
      /** Draws the long (reflex) arc, for a stated measure above 180°. */
      reflex?: boolean
      radius?: number
      color?: string
    }
  | { type: 'vector'; from: FigurePoint; to: FigurePoint; label?: string; color?: string }
  | {
      type: 'dimension'
      from: FigurePoint
      to: FigurePoint
      /** Perpendicular offset from the measured segment, in maths units. */
      offset?: number
      label?: string
      color?: string
    }
  | { type: 'text'; at: FigurePoint; text: string; align?: 'start' | 'middle' | 'end'; size?: number; color?: string }
  | {
      type: 'axes'
      from: FigurePoint
      to: FigurePoint
      step?: number
      labels?: boolean
      xLabel?: string
      yLabel?: string
    }
  | {
      type: 'graph'
      /** Expression of x: `x^2 - 4`, `sin(x)`, `sqrt(abs(x))`, `2x + 1`. */
      expr: string
      from: number
      to: number
      samples?: number
      label?: string
      color?: string
    }

export interface FigureSpec {
  title?: string
  caption?: string
  elements: FigureElement[]
  /** Computed values shown under the drawing (a table, not part of it). */
  results?: FigureResult[]
  notes?: string[]
}

export interface FigureRenderOptions {
  grid: boolean
  theme: FigureTheme
  results: boolean
  /**
   * Redraw with measured values: labels that read like a measurement ("120°",
   * "4 см") are replaced by what the current coordinates actually give. The
   * interactive card switches this on once a point is dragged.
   */
  live?: boolean
}

/** Everything the interactive card needs to map pointer positions to maths. */
export interface FigureProjection {
  /** SVG user units, including the title strip. */
  width: number
  height: number
  titleHeight: number
  /** Maths point → position inside the `<svg>` (viewBox units). */
  toPixel: (point: FigurePoint) => [number, number]
  /** Position inside the `<svg>` (viewBox units) → maths point. */
  toMath: (x: number, y: number) => FigurePoint
}

export interface FigureRender {
  svg: string
  warnings: string[]
  results: FigureResult[]
  projection: FigureProjection
}

/* ------------------------------------------------------------------------- *
 * Numbers and text
 * ------------------------------------------------------------------------- */

const MAX_COORD = 1_000_000

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function finite(value: unknown): number | null {
  if (typeof value === 'string') {
    // Weak models wrap numbers in text: "4", " -2,5 ", "3.0".
    const clean = value.trim().replace(/\s+/g, '').replace(',', '.')
    if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(clean)) return null
    const parsed = Number(clean)
    return Number.isFinite(parsed) && Math.abs(parsed) <= MAX_COORD ? parsed : null
  }
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COORD
    ? value
    : null
}

/** Reads a measurement from loose text: 60, "60°", "1,5 рад", "∠AOB = 120°". */
function measureFromText(value: unknown): { value: number; rad: boolean } | null {
  if (typeof value === 'number') return Number.isFinite(value) ? { value, rad: false } : null
  if (typeof value !== 'string') return null
  const radians = /(?:^|[^\p{L}])(?:rad|рад)/iu.test(value)
  const match =
    value.match(/(-?\d+(?:[.,]\d+)?)\s*(?:°|º|deg(?:rees)?|градус\p{L}*)/iu) ??
    value.match(/=\s*(-?\d+(?:[.,]\d+)?)/u) ??
    value.match(/^\s*(-?\d+(?:[.,]\d+)?)\s*$/u) ??
    (radians ? value.match(/(-?\d+(?:[.,]\d+)?)/u) : null)
  if (!match) return null
  const parsed = Number(match[1].replace(',', '.'))
  return Number.isFinite(parsed) ? { value: parsed, rad: radians } : null
}



/** Two decimals, without `-0` or trailing zeros that make labels look noisy. */
export function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—'
  const factor = 10 ** digits
  const rounded = Math.round(value * factor) / factor
  const clean = Object.is(rounded, -0) ? 0 : rounded
  return String(clean)
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function px(value: number): string {
  return formatNumber(value, 2)
}

/* ------------------------------------------------------------------------- *
 * Safe expression evaluation (graphs)
 *
 * No `eval`, no `new Function`: a tiny tokenizer and a recursive-descent
 * parser, so a model cannot run anything but arithmetic.
 * ------------------------------------------------------------------------- */

type ExprNode =
  | { kind: 'number'; value: number }
  | { kind: 'x' }
  | { kind: 'unary'; op: '-' | '+'; value: ExprNode }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '%' | '^'; left: ExprNode; right: ExprNode }
  | { kind: 'call'; name: string; args: ExprNode[] }

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2
}

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  cot: (a) => 1 / Math.tan(a),
  tg: Math.tan,
  ctg: (a) => 1 / Math.tan(a),
  sec: (a) => 1 / Math.cos(a),
  csc: (a) => 1 / Math.sin(a),
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  arcsin: Math.asin,
  arccos: Math.acos,
  arctan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  abs: Math.abs,
  ln: Math.log,
  lg: Math.log10,
  log: Math.log10,
  log10: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  mod: (a, b) => ((a % b) + b) % b
}

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: string }

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = []
  let index = 0
  while (index < input.length) {
    const char = input[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (/[0-9.]/.test(char)) {
      const match = input.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i)
      if (!match) return null
      const value = Number(match[0])
      if (!Number.isFinite(value)) return null
      tokens.push({ kind: 'number', value })
      index += match[0].length
      continue
    }
    if (/[a-z_]/i.test(char)) {
      const match = input.slice(index).match(/^[a-z_][a-z0-9_]*/i)
      if (!match) return null
      tokens.push({ kind: 'ident', value: match[0].toLowerCase() })
      index += match[0].length
      continue
    }
    if ('+-*/^%(),'.includes(char)) {
      tokens.push({ kind: 'op', value: char })
      index += 1
      continue
    }
    return null
  }
  return tokens
}

/** Parses `expr` once; returns null when the expression is not plain maths. */
export function compileExpression(expr: string): ((x: number) => number) | null {
  if (typeof expr !== 'string' || expr.trim().length === 0 || expr.length > 200) return null
  // Textbook spelling that models write: `y = x²`, `3(x+1)`, `x sin(x)`,
  // `√x`, `2,5x`, `π/2`.
  const source = expr
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/[\u00d7\u00b7\u2219]/g, '*')
    .replace(/\u00f7/g, '/')
    .replace(/[\u03c0]/g, 'pi')
    .replace(/\u221a\s*/g, 'sqrt')
    .replace(/\u00b2/g, '^2')
    .replace(/\u00b3/g, '^3')
    .replace(/^\s*(?:y|f\s*\(\s*x\s*\)|g\s*\(\s*x\s*\))\s*=\s*/i, '')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\*\*/g, '^')
    .replace(/(\d)\s*([a-z(])/gi, '$1*$2')
    .replace(/(?<![\p{L}])x\s*\(/giu, 'x*(')
    .replace(/\)\s*(?=[a-z0-9(])/gi, ')*')
    .replace(/\b(pi|e|tau)\b/gi, (match) => match.toLowerCase())
  const tokens = tokenize(source)
  if (!tokens || tokens.length === 0) return null

  let position = 0
  const peek = (): Token | undefined => tokens[position]
  const takeOp = (value: string): boolean => {
    const token = peek()
    if (token?.kind === 'op' && token.value === value) {
      position += 1
      return true
    }
    return false
  }

  const parseExpression = (): ExprNode | null => {
    let left = parseTerm()
    if (!left) return null
    for (;;) {
      if (takeOp('+')) {
        const right = parseTerm()
        if (!right) return null
        left = { kind: 'binary', op: '+', left, right }
      } else if (takeOp('-')) {
        const right = parseTerm()
        if (!right) return null
        left = { kind: 'binary', op: '-', left, right }
      } else {
        return left
      }
    }
  }

  const parseTerm = (): ExprNode | null => {
    let left = parseUnary()
    if (!left) return null
    for (;;) {
      if (takeOp('*')) {
        const right = parseUnary()
        if (!right) return null
        left = { kind: 'binary', op: '*', left, right }
      } else if (takeOp('/')) {
        const right = parseUnary()
        if (!right) return null
        left = { kind: 'binary', op: '/', left, right }
      } else if (takeOp('%')) {
        const right = parseUnary()
        if (!right) return null
        left = { kind: 'binary', op: '%', left, right }
      } else {
        return left
      }
    }
  }

  const parseUnary = (): ExprNode | null => {
    if (takeOp('-')) {
      const value = parseUnary()
      return value ? { kind: 'unary', op: '-', value } : null
    }
    if (takeOp('+')) return parseUnary()
    return parsePower()
  }

  const parsePower = (): ExprNode | null => {
    const base = parsePrimary()
    if (!base) return null
    if (takeOp('^')) {
      const exponent = parseUnary()
      if (!exponent) return null
      return { kind: 'binary', op: '^', left: base, right: exponent }
    }
    return base
  }

  const parsePrimary = (): ExprNode | null => {
    const token = peek()
    if (!token) return null
    if (token.kind === 'number') {
      position += 1
      return { kind: 'number', value: token.value }
    }
    if (token.kind === 'ident') {
      position += 1
      const name = token.value
      if (takeOp('(')) {
        const args: ExprNode[] = []
        if (!takeOp(')')) {
          for (;;) {
            const arg = parseExpression()
            if (!arg) return null
            args.push(arg)
            if (takeOp(',')) continue
            if (takeOp(')')) break
            return null
          }
        }
        if (!FUNCTIONS[name]) return null
        return { kind: 'call', name, args }
      }
      if (name === 'x') return { kind: 'x' }
      const constant = CONSTANTS[name]
      if (constant !== undefined) return { kind: 'number', value: constant }
      return null
    }
    if (takeOp('(')) {
      const inner = parseExpression()
      if (!inner || !takeOp(')')) return null
      return inner
    }
    return null
  }

  const root = parseExpression()
  if (!root || position !== tokens.length) return null

  const evaluate = (node: ExprNode, x: number): number => {
    switch (node.kind) {
      case 'number':
        return node.value
      case 'x':
        return x
      case 'unary': {
        const value = evaluate(node.value, x)
        return node.op === '-' ? -value : value
      }
      case 'binary': {
        const left = evaluate(node.left, x)
        const right = evaluate(node.right, x)
        switch (node.op) {
          case '+':
            return left + right
          case '-':
            return left - right
          case '*':
            return left * right
          case '/':
            return left / right
          case '%':
            return left % right
          case '^':
            return left ** right
        }
        return NaN
      }
      case 'call': {
        const fn = FUNCTIONS[node.name]
        const args = node.args.map((arg) => evaluate(arg, x))
        return fn(...args)
      }
    }
  }

  return (x: number): number => {
    try {
      return evaluate(root, x)
    } catch {
      return NaN
    }
  }
}

/** One-off evaluation, mostly for tests and for checking a model's arithmetic. */
export function evaluateExpression(expr: string, x = 0): number {
  const fn = compileExpression(expr)
  return fn ? fn(x) : NaN
}

/* ------------------------------------------------------------------------- *
 * Loose input → typed spec
 * ------------------------------------------------------------------------- */

function text(value: unknown, max = 160): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return clean.length > 0 ? clean.slice(0, max) : undefined
}

/** Label → coordinate map, so `from: "A"` works like `from: [0, 0]`. */
type PointRegistry = Map<string, FigurePoint>

function labelKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^(?:point|dot|vertex|точка|вершина)\s+/u, '')
    .replace(/[.,;:]+$/u, '')
    .trim()
}

function objectPoint(raw: Record<string, unknown>, registry?: PointRegistry): FigurePoint | null {
  const x = finite(raw.x ?? raw[0] ?? raw.x1)
  const y = finite(raw.y ?? raw[1] ?? raw.y1)
  if (x !== null && y !== null) return [x, y]
  const nested =
    raw.at ?? raw.pos ?? raw.position ?? raw.coord ?? raw.coords ?? raw.coordinates ?? raw.xy ?? raw.point
  if (nested !== undefined) return point(nested, registry)
  // `{ "name": "A" }` points at a point defined earlier.
  const ref = raw.name ?? raw.label ?? raw.ref ?? raw.id
  if (typeof ref === 'string' && registry) return registry.get(labelKey(ref)) ?? null
  return null
}

function point(value: unknown, registry?: PointRegistry): FigurePoint | null {
  if (Array.isArray(value) && value.length >= 2) {
    const x = finite(value[0])
    const y = finite(value[1])
    return x === null || y === null ? null : [x, y]
  }
  if (typeof value === 'string') {
    // Sloppy models send coordinates as text: "0,0", "[3 2]", "1;2".
    const parts = value
      .replace(/[[\]()]/g, '')
      .split(/[,;]|\s+/)
      .filter(Boolean)
    if (parts.length >= 2) {
      const x = finite(parts[0])
      const y = finite(parts[1])
      if (x !== null && y !== null) return [x, y]
    }
    // …or a reference to a named point: "A", "точка O".
    return registry ? registry.get(labelKey(value)) ?? null : null
  }
  if (value && typeof value === 'object') {
    return objectPoint(value as Record<string, unknown>, registry)
  }
  return null
}

function color(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.trim().toLowerCase()
  if (['accent', 'ink', 'muted', 'danger', 'success'].includes(clean)) return clean
  return /^#[0-9a-f]{3,8}$/.test(clean) ? clean : undefined
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function radius(value: unknown): number | null {
  const number = finite(value)
  return number === null || number <= 0 ? null : number
}

function stripFence(value: string): string {
  return value
    .replace(/^\s*```(?:json|javascript|js)?/i, '')
    .replace(/```\s*$/, '')
    .trim()
}

/** Cuts prose around the JSON and fixes the spelling weak models actually use. */
function repairJsonText(value: string): string {
  let source = stripFence(value)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
  const start = source.search(/[[{]/)
  if (start > 0) source = source.slice(start)
  const end = Math.max(source.lastIndexOf('}'), source.lastIndexOf(']'))
  if (end >= 0 && end < source.length - 1) source = source.slice(0, end + 1)
  return source
}

/** Weak models wrap JSON in markdown fences or use single quotes; accept both. */
function parseLooseJson(value: string): unknown {
  const base = repairJsonText(value)
  const attempts = [base]
  if (!base.includes('"') && base.includes("'")) attempts.push(base.replace(/'/g, '"'))
  const repaired = base
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/:\s*([A-Za-z_$][\w$]*)(?=\s*[,}])/g, (match, value: string) =>
      /^(?:true|false|null)$/i.test(value) ? match : `:"${value}"`
    )
  attempts.push(repaired)
  if (repaired.includes("'")) attempts.push(repaired.replace(/'/g, '"'))
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt)
    } catch {
      /* try the next shape */
    }
  }
  return undefined
}

/**
 * Keeps every complete object of an elements array that was cut off in the
 * middle (`finish_reason: length`, a dropped stream). Half a figure is better
 * than an empty error box.
 */
function salvageJsonArray(value: string): unknown[] | null {
  const source = repairJsonText(value)
  const start = source.indexOf('[')
  if (start < 0) return null
  const items: unknown[] = []
  let depth = 0
  let itemStart = -1
  let inString = false
  let quote = ''
  let escaped = false
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) inString = false
      continue
    }
    if (char === '"' || char === "'") {
      inString = true
      quote = char
      continue
    }
    if (char === '{' || char === '[') {
      if (depth === 0 && char === '{') itemStart = index
      depth += 1
      continue
    }
    if (char === '}' || char === ']') {
      if (depth === 0) continue
      depth -= 1
      if (depth === 0 && itemStart >= 0) {
        const parsed = parseLooseJson(source.slice(itemStart, index + 1))
        if (parsed && typeof parsed === 'object') items.push(parsed)
        itemStart = -1
      }
    }
  }
  return items.length > 0 ? items : null
}

/** `points` arrives as [x,y] pairs, flat [x1,y1,…], or names of defineable points. */
function pointList(value: unknown, registry?: PointRegistry): FigurePoint[] {
  if (!Array.isArray(value)) return []
  if (value.length >= 4 && value.every((entry) => finite(entry) !== null)) {
    const pairs: FigurePoint[] = []
    for (let index = 0; index + 1 < value.length; index += 2) {
      const x = finite(value[index])
      const y = finite(value[index + 1])
      if (x !== null && y !== null) pairs.push([x, y])
    }
    return pairs
  }
  return value.map((entry) => point(entry, registry)).filter((entry): entry is FigurePoint => entry !== null)
}

const TYPE_ALIASES: Record<string, FigureElement['type']> = {
  segment: 'segment',
  line_segment: 'segment',
  linesegment: 'segment',
  side: 'segment',
  edge: 'segment',
  отрезок: 'segment',
  сторона: 'segment',
  line: 'line',
  straight_line: 'line',
  infinite_line: 'line',
  прямая: 'line',
  ray: 'ray',
  half_line: 'ray',
  halfline: 'ray',
  луч: 'ray',
  полупрямая: 'ray',
  vector: 'vector',
  arrow: 'vector',
  вектор: 'vector',
  polygon: 'polygon',
  polyline: 'polygon',
  triangle: 'polygon',
  quadrilateral: 'polygon',
  многоугольник: 'polygon',
  треугольник: 'polygon',
  четырёхугольник: 'polygon',
  четырехугольник: 'polygon',
  point: 'point',
  dot: 'point',
  vertex: 'point',
  node: 'point',
  точка: 'point',
  вершина: 'point',
  circle: 'circle',
  circumference: 'circle',
  окружность: 'circle',
  круг: 'circle',
  angle: 'angle',
  angle_arc: 'angle',
  anglemark: 'angle',
  угол: 'angle',
  dimension: 'dimension',
  measure: 'dimension',
  measurement: 'dimension',
  size: 'dimension',
  размер: 'dimension',
  text: 'text',
  label: 'text',
  annotation: 'text',
  note: 'text',
  текст: 'text',
  подпись: 'text',
  надпись: 'text',
  axes: 'axes',
  axis: 'axes',
  coordinate_axes: 'axes',
  coordinate_system: 'axes',
  оси: 'axes',
  graph: 'graph',
  function: 'graph',
  plot: 'graph',
  curve: 'graph',
  график: 'graph',
  функция: 'graph'
}

function normalizeTypeName(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : ''
}

/**
 * Russian models sometimes write the whole call with Russian keys. The values
 * are what matters, so map the common keys without touching the element type.
 */
const KEY_ALIASES: Record<string, string> = {
  тип: 'type',
  точки: 'points',
  вершины: 'vertices',
  от: 'from',
  до: 'to',
  начало: 'start',
  конец: 'end',
  вершина: 'vertex',
  центр: 'center',
  радиус: 'radius',
  диаметр: 'diameter',
  подпись: 'label',
  имя: 'name',
  текст: 'text',
  содержимое: 'text',
  выражение: 'expr',
  формула: 'formula',
  диапазон: 'range',
  область: 'range',
  градусы: 'degrees',
  угол: 'degrees',
  мера: 'measure',
  значение: 'value',
  длина: 'length',
  направление: 'direction',
  координаты: 'at',
  позиция: 'at',
  цвет: 'color',
  пунктир: 'dashed',
  заливка: 'filled'
}

function translateKeys(item: Record<string, unknown>): Record<string, unknown> {
  let result: Record<string, unknown> | null = null
  for (const [rawKey, value] of Object.entries(item)) {
    const english = KEY_ALIASES[rawKey.trim().toLowerCase()]
    // `угол` usually means `degrees`, but `{"угол": {…}}` is an angle element.
    if (english === 'degrees' && value && typeof value === 'object' && !Array.isArray(value)) continue
    if (english && item[english] === undefined) {
      result ??= { ...item }
      result[english] = value
    }
  }
  return result ?? item
}

/**
 * The type is sometimes the key rather than a field: `{"point": [10, 10]}`,
 * `{"angle": {...}}`, `{"segment": {"from": …, "to": …}}`. Such keys are also
 * field names in other shapes, so the value's form decides what they mean.
 */
const TYPE_KEY_SKIP_ARRAY = new Set([
  'label',
  'text',
  'annotation',
  'note',
  'measure',
  'size',
  'vertex',
  'function',
  'axis',
  'подпись',
  'текст',
  'надпись',
  'мера',
  'размер',
  'вершина',
  'функция',
  'ось'
])

function liftImplicitType(item: Record<string, unknown>): Record<string, unknown> {
  if (item.type !== undefined) return item
  for (const [key, value] of Object.entries(item)) {
    if (key === 'type') continue
    const type = TYPE_ALIASES[normalizeTypeName(key)]
    if (!type) continue
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const inner = value as Record<string, unknown>
      const lifted: Record<string, unknown> = { ...inner, ...item, type }
      // The key still holds the old payload; `point`/`circle` read it, but a
      // stale object under a type name confuses nothing once `type` is set.
      if (type === 'point' && lifted.at === undefined) lifted.at = value
      return lifted
    }
    if (Array.isArray(value)) {
      if (TYPE_KEY_SKIP_ARRAY.has(key.trim().toLowerCase())) continue
      if (type === 'point') return { ...item, type, ...(item.at === undefined ? { at: value } : {}) }
      if (type === 'circle') {
        const numbers = value.map((entry) => finite(entry))
        if (numbers.length >= 3 && numbers.every((entry) => entry !== null)) {
          return {
            ...item,
            type,
            center: item.center ?? [numbers[0] as number, numbers[1] as number],
            radius: item.radius ?? item.r ?? numbers[2]
          }
        }
      }
      if (
        type === 'segment' ||
        type === 'line' ||
        type === 'ray' ||
        type === 'vector' ||
        type === 'polygon' ||
        type === 'angle' ||
        type === 'dimension' ||
        type === 'axes'
      ) {
        return { ...item, type, ...(item.points === undefined ? { points: value } : {}) }
      }
      continue
    }
    if (type === 'point' && typeof value === 'string' && item.at === undefined) {
      return { ...item, type, at: value }
    }
  }
  return item
}

/** The type a weak model forgot to send, guessed from the fields it did send. */
function inferElementType(item: Record<string, unknown>): FigureElement['type'] | '' {
  const has = (key: string): boolean => item[key] !== undefined && item[key] !== null
  if (has('vertex') || (has('degrees') && (has('at') || has('from')))) return 'angle'
  if (has('expr') || has('expression') || has('formula')) return 'graph'
  if ((has('center') || has('centre')) && (has('radius') || has('r') || has('diameter') || has('through'))) {
    return 'circle'
  }
  if (Array.isArray(item.points) || Array.isArray(item.vertices)) return 'polygon'
  if (has('from') && (has('to') || has('through'))) {
    if (has('through')) return 'ray'
    return has('arrow') ? 'vector' : 'segment'
  }
  if (has('at') || has('position')) return 'point'
  if (has('text')) return 'text'
  if (has('axes')) return 'axes'
  const lifted = liftImplicitType(item)
  if (typeof lifted.type === 'string') return TYPE_ALIASES[normalizeTypeName(lifted.type)] ?? ''
  return ''
}

/**
 * Accepts whatever the model actually sent and returns a spec the renderer can
 * trust. Anything unrecognised is dropped with a warning, so the model can fix
 * its call instead of the card silently losing a piece.
 */
export function normalizeFigureSpec(value: unknown): { spec: FigureSpec | null; warnings: string[] } {
  const warnings: string[] = []
  // The whole argument may itself be the list of elements.
  const boxed: unknown = Array.isArray(value) ? { elements: value } : value
  if (!boxed || typeof boxed !== 'object') {
    return { spec: null, warnings: ['The figure argument is not an object.'] }
  }
  // …or the whole spec may be nested under `figure`/`spec`.
  const wrapper = boxed as Record<string, unknown>
  const nested = wrapper.figure ?? wrapper.spec
  const raw =
    wrapper.elements === undefined && nested && typeof nested === 'object'
      ? (nested as Record<string, unknown>)
      : wrapper
  // Weak models sometimes send the list under another name; accept the common ones.
  let rawList: unknown =
    raw.elements ??
    raw.items ??
    raw.data ??
    raw.shapes ??
    raw.objects ??
    raw.geometry ??
    raw.marks ??
    raw.figureElements ??
    raw.figure_elements ??
    raw.drawingElements ??
    raw.элементы ??
    raw.фигуры
  if (typeof rawList === 'string') {
    let parsed = parseLooseJson(rawList)
    if (parsed === undefined) {
      const salvaged = salvageJsonArray(rawList)
      if (salvaged) {
        parsed = salvaged
        warnings.push(`The elements JSON was cut off; kept the ${salvaged.length} complete element(s).`)
      }
    }
    if (parsed === undefined) {
      warnings.push('The `elements` value was a string that is not valid JSON, so it was ignored.')
      rawList = null
    } else {
      rawList = parsed
    }
  }
  // A single element object, or a name → element map, instead of an array.
  if (rawList && typeof rawList === 'object' && !Array.isArray(rawList)) {
    const asObject = rawList as Record<string, unknown>
    const values = Object.values(asObject)
    rawList =
      typeof asObject.type === 'string' || inferElementType(asObject) !== ''
        ? [asObject]
        : values.length > 0 && values.every((entry) => !!entry && typeof entry === 'object')
          ? values
          : []
  }
  // The arguments may be one bare element: {"type":"point","at":[0,0],…}
  if (
    !Array.isArray(rawList) &&
    (typeof raw.type === 'string' || inferElementType(raw) !== '')
  ) {
    rawList = [raw]
  }
  const list = Array.isArray(rawList)
    ? rawList
        .filter(
          (entry): entry is Record<string, unknown> =>
            !!entry && typeof entry === 'object' && !Array.isArray(entry)
        )
        .map((entry) => liftImplicitType(translateKeys(entry)))
    : []

  // First pass: remember every named point, so `from: "A"` works like
  // `from: [0, 0]`. Weak models naturally think in letters, not coordinates.
  const registry: PointRegistry = new Map()
  const definitions: Record<string, unknown>[] = []
  if (Array.isArray(raw.points) || Array.isArray(raw.точки)) {
    for (const entry of (raw.points ?? raw.точки) as unknown[]) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        definitions.push(liftImplicitType(translateKeys(entry as Record<string, unknown>)))
      }
    }
  }
  definitions.push(...list)
  for (const item of definitions) {
    const label = text(item.label ?? item.name, 40)
    if (!label) continue
    const type = TYPE_ALIASES[normalizeTypeName(item.type)] ?? inferElementType(item)
    if (type !== 'point') continue
    const at = point(item.at ?? item.point ?? item.pos ?? item.position)
    if (at) registry.set(labelKey(label), at)
  }

  // A graph without its own range borrows the visible range of the axes.
  let graphRangeHint: [number, number] | null = null
  for (const item of list) {
    const type = TYPE_ALIASES[normalizeTypeName(item.type)] ?? inferElementType(item)
    if (type !== 'axes') continue
    const a = point(item.from ?? item.start, registry)
    const b = point(item.to ?? item.end, registry)
    if (a && b && b[0] - a[0] > 1e-6) graphRangeHint = [a[0], b[0]]
  }

  const elements: FigureElement[] = []

  for (const item of list.slice(0, 120)) {
    const typeName = normalizeTypeName(item.type)
    const type = TYPE_ALIASES[typeName] ?? (typeName === '' ? inferElementType(item) : '')
    if (!type) {
      warnings.push(
        typeName
          ? `Unknown element type "${typeName}" was skipped.`
          : 'An element has no type and was skipped.'
      )
      continue
    }
    const dashed = bool(item.dashed)
    const tint = color(item.color)
    const label = text(item.label ?? item.name)
    const base = {
      ...(label ? { label } : {}),
      ...(dashed ? { dashed } : {}),
      ...(tint ? { color: tint } : {})
    }
    const rawPoints = typeof item.points === 'string' ? parseLooseJson(item.points) ?? item.points : item.points
    const pointsList = pointList(rawPoints ?? item.vertices ?? item.coords, registry)
    const from = point(
      item.from ?? item.start ?? item.a ?? item.p1 ?? item.begin ?? pointsList[0],
      registry
    )
    const to = point(
      item.to ?? item.end ?? item.b ?? item.p2 ?? pointsList[1],
      registry
    )
    const at = point(item.at ?? item.point ?? item.pos ?? item.position ?? item.coord, registry)

    switch (type) {
      case 'segment': {
        let a = from
        let b = to
        const length = finite(item.length ?? item.len)
        const direction = measureFromText(
          item.direction ?? item.angle ?? item.degrees ?? item.deg ?? item.rotation
        )
        if (a && !b && length !== null) {
          const radians = direction
            ? direction.rad
              ? direction.value
              : (direction.value * Math.PI) / 180
            : 0
          b = [a[0] + Math.cos(radians) * length, a[1] + Math.sin(radians) * length]
        }
        if (a && b) {
          const ticks = finite(item.ticks)
          elements.push({
            type: 'segment',
            from: a,
            to: b,
            ...base,
            ...(ticks !== null && ticks >= 1 && ticks <= 4 ? { ticks: Math.round(ticks) } : {})
          })
        } else warnings.push('A segment needs from and to points.')
        break
      }
      case 'line':
        if (from && to) elements.push({ type: 'line', from, to, ...base })
        else warnings.push('A line needs from and to points.')
        break
      case 'ray':
        if (from && (to ?? at)) elements.push({ type: 'ray', from, through: (to ?? at) as FigurePoint, ...base })
        else warnings.push('A ray needs from and through (as from/to).')
        break
      case 'vector':
        if (from && to) elements.push({ type: 'vector', from, to, ...base })
        else warnings.push('A vector needs from and to points.')
        break
      case 'polygon': {
        const points = pointList(rawPoints ?? item.vertices ?? item.coords, registry)
        if (points.length >= 3) {
          const filled = bool(item.filled)
          elements.push({ type: 'polygon', points, ...base, ...(filled ? { filled } : {}) })
        } else warnings.push('A polygon needs at least three points.')
        break
      }
      case 'point':
        if (at) {
          const hollow = bool(item.hollow)
          const side = typeof item.side === 'string' ? item.side.toLowerCase() : undefined
          elements.push({
            type: 'point',
            at,
            ...base,
            ...(hollow ? { hollow } : {}),
            ...(side === 'nw' || side === 'ne' || side === 'sw' || side === 'se' ? { side } : {})
          })
        } else warnings.push('A point needs an at position.')
        break
      case 'circle': {
        const center = point(item.center ?? item.centre ?? item.at, registry)
        let r = radius(item.radius ?? item.r)
        if (r === null) {
          const diameter = radius(item.diameter ?? item.d)
          if (diameter !== null) r = diameter / 2
        }
        if (r === null && center) {
          const through = point(item.through ?? item.to ?? item.pointOn, registry)
          if (through) r = distance(center, through)
        }
        if (center && r !== null) elements.push({ type: 'circle', center, radius: r, ...base })
        else warnings.push('A circle needs a center and a positive radius.')
        break
      }
      case 'angle': {
        // The label (or the points list) often carries the names: `∠AOB` means
        // from A, vertex O, to B — even when no point elements define them yet.
        const labelNames = label?.match(
          /^\s*(?:∠|∡|angle|угол)?\s*([A-ZА-Я])\s*([A-ZА-Я])\s*([A-ZА-Я])(?![A-Za-zА-Яа-я])/u
        )
        const listedNames = ((): string[] | null => {
          const entries =
            typeof rawPoints === 'string' ? rawPoints.split(/[\s,;]+/).filter(Boolean) : rawPoints
          return Array.isArray(entries) &&
            entries.length === 3 &&
            entries.every((entry) => typeof entry === 'string' && /^[A-ZА-Я]$/u.test(entry.trim()))
            ? entries.map((entry) => entry.trim())
            : null
        })()
        const names = labelNames
          ? [labelNames[1], labelNames[2], labelNames[3]]
          : listedNames
        // `points: [A, O, B]` (vertex in the middle) is the other common shape.
        let vertex = point(
          item.vertex ??
            item.center ??
            item.at ??
            (pointsList.length === 3 ? pointsList[1] : undefined) ??
            (names ? labelKey(names[1]) : undefined),
          registry
        )
        let angleFrom = point(
          item.from ??
            item.a ??
            item.start ??
            item.ray1 ??
            item.arm1 ??
            (pointsList.length === 3 ? pointsList[0] : pointsList.length === 2 ? pointsList[0] : undefined) ??
            (names ? labelKey(names[0]) : undefined),
          registry
        )
        let angleTo = point(
          item.to ??
            item.b ??
            item.end ??
            item.ray2 ??
            item.arm2 ??
            (pointsList.length === 3 ? pointsList[2] : pointsList.length === 2 ? pointsList[1] : undefined) ??
            (names ? labelKey(names[2]) : undefined),
          registry
        )
        const requestedRaw =
          item.degrees ?? item.deg ?? item.measure ?? item.value ?? item.angle ?? item.size
        const requestedMeasure = measureFromText(requestedRaw) ?? measureFromText(label)
        const target = requestedMeasure
          ? requestedMeasure.rad
            ? (requestedMeasure.value * 180) / Math.PI
            : requestedMeasure.value
          : null
        // `{type:"angle", label:"∠AOB = 60°"}` and `{points:["A","O","B"], degrees:50}`
        // name every point but give no coordinates. Rebuild such an angle at the
        // origin: the measure sets the opening and the names label the arms.
        if (!vertex) {
          if (names || target !== null) {
            vertex = [0, 0]
            angleFrom = [4, 0]
            angleTo = null
            warnings.push(
              'The angle had no coordinates, so it was drawn at the origin with a standard arm length.'
            )
          } else if (angleFrom && angleTo) {
            // Two arms without a vertex: the first arm's foot is the vertex.
            vertex = angleFrom
            angleFrom = angleTo
            angleTo = null
            warnings.push('The angle had no vertex; its first arm was used as the vertex.')
          } else if (angleFrom) {
            vertex = angleFrom
            angleFrom = null
            warnings.push('The angle had no vertex; its first arm was used as the vertex.')
          }
        }
        const rightAngle = bool(item.right) === true

        if (vertex && !angleFrom && angleTo) angleFrom = [vertex[0] + 1, vertex[1]]
        if (vertex && !angleFrom && target !== null) {
          angleFrom = [vertex[0] + 1, vertex[1]]
        }
        if (vertex && angleFrom && !angleTo && target !== null) {
          angleTo = rotateAround(angleFrom, vertex, (target * Math.PI) / 180)
        }
        if (vertex && angleFrom && !angleTo && target === null) {
          // One arm was given and no measure: a right angle is the least
          // surprising guess, and the arc label shows its real measure.
          angleTo = rotateAround(angleFrom, vertex, Math.PI / 2)
          warnings.push('An angle had only one arm; the second one was drawn at 90°.')
        }

        if (vertex && angleFrom && angleTo) {
          const sameArm = distance(vertex, angleFrom) < 1e-9 && distance(vertex, angleTo) < 1e-9
          if (sameArm) {
            warnings.push('An angle has both arms in its vertex and was skipped.')
            break
          }
          if (distance(vertex, angleFrom) < 1e-9) angleFrom = rotateAround(angleTo, vertex, (Math.PI * 3) / 2)
          if (distance(vertex, angleTo) < 1e-9) angleTo = rotateAround(angleFrom, vertex, Math.PI / 2)

          let reflex = bool(item.reflex) === true
          if (rightAngle) {
            const actual = signedAngleDegrees(vertex, angleFrom, angleTo)
            if (Math.abs(Math.abs(actual) - 90) > 0.5) {
              angleTo = rotateAround(angleFrom, vertex, (Math.sign(actual || 1) * Math.PI) / 2)
            }
          } else if (target !== null && Math.abs(target) > 1e-9) {
            const actual = signedAngleDegrees(vertex, angleFrom, angleTo)
            const wantedShort = ((target % 360) + 540) % 360 - 180
            if (Math.abs(Math.abs(actual) - Math.abs(wantedShort)) > 0.75) {
              angleTo = rotateAround(angleFrom, vertex, (wantedShort * Math.PI) / 180)
              warnings.push(
                `The angle at ${formatPoint(vertex)} was adjusted to the stated ${formatNumber(target, 1)}°.`
              )
            }
            if (Math.abs(target) > 180) reflex = true
          }
          const arcRadius = radius(item.radius ?? item.r)
          elements.push({
            type: 'angle',
            vertex,
            from: angleFrom,
            to: angleTo,
            ...base,
            ...(names && !labelNames ? { label: `∠${names.join('')}` } : {}),
            ...(rightAngle ? { right: rightAngle } : {}),
            ...(reflex ? { reflex } : {}),
            ...(arcRadius !== null ? { radius: arcRadius } : {})
          })
          // Remember the named points, so a following `∠BOC` shares arm OB
          // instead of being drawn somewhere else.
          if (names) {
            const remember: Array<[string, FigurePoint]> = [
              [names[0], angleFrom],
              [names[1], vertex],
              [names[2], angleTo]
            ]
            for (const [letter, position] of remember) {
              const key = labelKey(letter)
              if (!registry.has(key)) registry.set(key, position)
            }
          }
        } else warnings.push('An angle needs vertex, from and to points (or vertex + degrees).')
        break
      }
      case 'dimension': {
        const between = Array.isArray(item.between) ? item.between : []
        const a = point(item.from ?? item.start ?? item.p1 ?? between[0] ?? pointsList[0], registry)
        const b = point(item.to ?? item.end ?? item.p2 ?? between[1] ?? pointsList[1], registry)
        if (a && b) {
          const offset = finite(item.offset)
          elements.push({
            type: 'dimension',
            from: a,
            to: b,
            ...base,
            ...(offset !== null ? { offset: clamp(offset, -50, 50) } : {})
          })
        } else warnings.push('A dimension needs from and to points.')
        break
      }
      case 'text': {
        const content = text(
          item.text ?? item.content ?? item.value ?? item.string ?? item.label ?? item.name,
          240
        )
        if (at && content) {
          const align = item.align
          elements.push({
            type: 'text',
            at,
            text: content,
            ...(tint ? { color: tint } : {}),
            ...(align === 'start' || align === 'middle' || align === 'end'
              ? { align }
              : bool(item.centered)
                ? { align: 'middle' as const }
                : {}),
            ...(finite(item.size) !== null ? { size: clamp(finite(item.size) as number, 8, 32) } : {})
          })
        } else warnings.push('A text element needs at and text.')
        break
      }
      case 'axes': {
        const a = from ?? [-5, -5]
        const b = to ?? (from ? [-from[0], -from[1]] : [5, 5])
        const step = radius(item.step)
        const labels = bool(item.labels)
        elements.push({
          type: 'axes',
          from: a,
          to: b,
          ...(step !== null ? { step } : {}),
          ...(labels === false ? { labels } : {}),
          ...(text(item.xLabel ?? item.xName) ? { xLabel: text(item.xLabel ?? item.xName) } : {}),
          ...(text(item.yLabel ?? item.yName) ? { yLabel: text(item.yLabel ?? item.yName) } : {})
        })
        break
      }
      case 'graph': {
        let expr = text(
          item.expr ?? item.expression ?? item.formula ?? item.function ?? item.f ?? item.y,
          200
        )
        if (expr) {
          expr = expr
            .replace(/^\s*(?:y|f\s*\(\s*x\s*\)|g\s*\(\s*x\s*\))\s*=\s*/i, '')
            .trim()
        }
        const rangeSource = item.range ?? item.domain ?? item.xRange ?? item.interval
        const range = Array.isArray(rangeSource) ? rangeSource : []
        const start = finite(item.from ?? item.xFrom ?? item.xMin ?? item.min ?? range[0])
        const end = finite(item.to ?? item.xTo ?? item.xMax ?? item.max ?? range[1])
        const fallback = graphRangeHint ?? [-5, 5]
        const finalStart = start ?? (end !== null ? -Math.abs(end) : fallback[0])
        const finalEnd = end ?? (start !== null ? Math.abs(start) : fallback[1])
        if (expr && Math.abs(finalEnd - finalStart) > 1e-6) {
          const samples = finite(item.samples)
          elements.push({
            type: 'graph',
            expr,
            from: Math.min(finalStart, finalEnd),
            to: Math.max(finalStart, finalEnd),
            ...base,
            label: label ?? `y = ${expr}`,
            ...(samples !== null ? { samples: Math.round(clamp(samples, 24, 400)) } : {})
          })
        } else warnings.push('A graph needs expr and a numeric range.')
        break
      }
    }
  }

  if (elements.length === 0) {
    return { spec: null, warnings: [...warnings, 'The figure has no drawable elements.'] }
  }

  const rawResults = raw.results ?? raw.values ?? raw.computed ?? raw.answers ?? raw.результаты
  const results: FigureResult[] = Array.isArray(rawResults)
    ? rawResults
        .slice(0, 20)
        .flatMap((entry) => {
          if (!entry || typeof entry !== 'object') return []
          const item = entry as Record<string, unknown>
          const resultLabel = text(item.label ?? item.name, 80)
          const rawValue = item.value ?? item.result ?? item.answer
          const value = text(rawValue, 120) ?? (typeof rawValue === 'number' ? formatNumber(rawValue) : undefined)
          if (!resultLabel || !value) return []
          const formula = text(item.formula ?? item.expr ?? item.calculation, 160)
          return [{ label: resultLabel, value, ...(formula ? { formula } : {}) }]
        })
    : []

  const rawNotes = raw.notes ?? raw.steps ?? raw.solution ?? raw.примечания ?? raw.шаги
  const notes = (Array.isArray(rawNotes) ? rawNotes : typeof rawNotes === 'string' ? [rawNotes] : [])
    .map((note) => text(note, 300))
    .filter((note): note is string => note !== undefined)
    .slice(0, 12)

  const title = text(raw.title ?? raw.heading ?? raw.name ?? raw.заголовок, 120)
  const caption = text(raw.caption ?? raw.description ?? raw.subtitle ?? raw.подпись, 300)
  const enhanced = enhanceFigureElements(elements, warnings)
  // Three dots alone are almost never what the user asked to see: the model
  // named the points but forgot the segments or the angle between them.
  if (enhanced.length > 0 && enhanced.every((element) => element.type === 'point')) {
    warnings.push('Only points were drawn; add a segment or an angle so the shape is visible.')
  }

  const spec: FigureSpec = {
    elements: enhanced,
    ...(title ? { title } : {}),
    ...(caption ? { caption } : {}),
    ...(results.length > 0 ? { results } : {}),
    ...(notes.length > 0 ? { notes } : {})
  }
  return { spec, warnings }
}

/* ------------------------------------------------------------------------- *
 * Geometry helpers
 * ------------------------------------------------------------------------- */

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function emptyBox(): Box {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
}

function includePoint(box: Box, [x, y]: FigurePoint): void {
  box.minX = Math.min(box.minX, x)
  box.minY = Math.min(box.minY, y)
  box.maxX = Math.max(box.maxX, x)
  box.maxY = Math.max(box.maxY, y)
}

function distance(a: FigurePoint, b: FigurePoint): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

function samePointTolerance(a: FigurePoint, b: FigurePoint, epsilon = 1e-9): boolean {
  return Math.abs(a[0] - b[0]) <= epsilon && Math.abs(a[1] - b[1]) <= epsilon
}

function formatPoint([x, y]: FigurePoint): string {
  return `(${formatNumber(x, 2)}; ${formatNumber(y, 2)})`
}

/** Counter-clockwise is positive, the result is in (-180°, 180°]. */
function signedAngleDegrees(vertex: FigurePoint, from: FigurePoint, to: FigurePoint): number {
  const start = Math.atan2(from[1] - vertex[1], from[0] - vertex[0])
  const end = Math.atan2(to[1] - vertex[1], to[0] - vertex[0])
  return (normalisedDelta(start, end) * 180) / Math.PI
}

function rotateAround(point: FigurePoint, center: FigurePoint, radians: number): FigurePoint {
  const dx = point[0] - center[0]
  const dy = point[1] - center[1]
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return [center[0] + dx * cos - dy * sin, center[1] + dx * sin + dy * cos]
}

/** Perpendicular distance is compared with a relative epsilon, so huge coordinates still work. */
function collinear(a: FigurePoint, b: FigurePoint, c: FigurePoint): boolean {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const length = Math.hypot(abx, aby)
  if (length < 1e-12) return false
  const cross = abx * (c[1] - a[1]) - aby * (c[0] - a[0])
  return Math.abs(cross) <= 1e-6 * length * Math.max(1, distance(a, c))
}

function pointOnSegment(p: FigurePoint, a: FigurePoint, b: FigurePoint): boolean {
  if (!collinear(a, b, p)) return false
  return (
    p[0] >= Math.min(a[0], b[0]) - 1e-9 &&
    p[0] <= Math.max(a[0], b[0]) + 1e-9 &&
    p[1] >= Math.min(a[1], b[1]) - 1e-9 &&
    p[1] <= Math.max(a[1], b[1]) + 1e-9
  )
}

/** Is the arm vertex→arm already one of the drawn straight elements? */
function armCovered(elements: FigureElement[], vertex: FigurePoint, arm: FigurePoint): boolean {
  if (distance(vertex, arm) < 1e-9) return true
  const dirX = arm[0] - vertex[0]
  const dirY = arm[1] - vertex[1]
  const forward = (p: FigurePoint): number => (p[0] - vertex[0]) * dirX + (p[1] - vertex[1]) * dirY

  for (const element of elements) {
    switch (element.type) {
      case 'line':
        if (collinear(element.from, element.to, vertex) && collinear(element.from, element.to, arm)) {
          return true
        }
        break
      case 'ray': {
        if (!collinear(element.from, element.through, vertex) || !collinear(element.from, element.through, arm)) {
          break
        }
        const rayX = element.through[0] - element.from[0]
        const rayY = element.through[1] - element.from[1]
        const along = (p: FigurePoint): number => (p[0] - element.from[0]) * rayX + (p[1] - element.from[1]) * rayY
        if (along(vertex) >= -1e-9 && along(arm) >= along(vertex)) return true
        break
      }
      case 'segment':
      case 'vector':
        if (pointOnSegment(vertex, element.from, element.to) && collinear(element.from, element.to, arm)) {
          if (Math.max(forward(element.from), forward(element.to)) > 1e-9) return true
        }
        break
      case 'polygon': {
        for (let index = 0; index < element.points.length; index += 1) {
          const a = element.points[index]
          const b = element.points[(index + 1) % element.points.length]
          if (pointOnSegment(vertex, a, b) && collinear(a, b, arm)) return true
        }
        break
      }
    }
  }
  return false
}

/**
 * A model that sends only `{type:"angle", vertex, from, to}` expects an angle
 * with visible arms, not a floating arc. Arms that no segment/ray/polygon side
 * already draws are added as segments, and shared arms between adjacent angles
 * are drawn once.
 */
function addAngleArms(elements: FigureElement[]): FigureElement[] {
  const result: FigureElement[] = []
  for (const element of elements) {
    if (element.type !== 'angle') {
      result.push(element)
      continue
    }
    const arms: FigureElement[] = []
    const pool = (): FigureElement[] => [...elements, ...result, ...arms]
    for (const arm of [element.from, element.to]) {
      if (distance(element.vertex, arm) < 1e-9) continue
      if (armCovered(pool(), element.vertex, arm)) continue
      arms.push({
        type: 'segment',
        from: [element.vertex[0], element.vertex[1]],
        to: [arm[0], arm[1]],
        ...(element.color ? { color: element.color } : {})
      })
    }
    result.push(...arms, element)
  }
  return result
}

function sideFromDirection(direction: FigurePoint): 'ne' | 'nw' | 'se' | 'sw' {
  return `${direction[1] >= 0 ? 'n' : 's'}${direction[0] >= 0 ? 'e' : 'w'}` as
    | 'ne'
    | 'nw'
    | 'se'
    | 'sw'
}

function niceUnitStep(span: number): number {
  if (!Number.isFinite(span) || span <= 0) return 1
  const raw = span / 8
  const power = 10 ** Math.floor(Math.log10(raw))
  const normalised = raw / power
  const multiplier =
    normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10
  return multiplier * power
}

/**
 * Second normalisation pass, after coordinates are known: names from labels are
 * added to the drawing, text `"AB"` becomes points A and B, and a bare angle
 * gets arms to stand on.
 */
function enhanceFigureElements(elements: FigureElement[], _warnings: string[]): FigureElement[] {
  const result = addAngleArms(elements)
  const additions: FigureElement[] = []
  const usedLabels = new Set<string>()
  const key = (label: string): string => label.trim().toLowerCase().replace(/\s+/g, '')
  for (const element of result) {
    if (element.type === 'point' && element.label) usedLabels.add(key(element.label))
  }
  const all = (): FigureElement[] => [...result, ...additions]
  // The same letter may be repeated with slightly rounded coordinates
  // (`2.5` against `2.5000000000000004`); such a point is still the same point.
  const sameNamePoint = (labelKey: string, at: FigurePoint): boolean => {
    const tolerance = Math.max(0.05, Math.max(Math.abs(at[0]), Math.abs(at[1])) * 0.002)
    return all().some(
      (element) =>
        element.type === 'point' &&
        !!element.label &&
        key(element.label) === labelKey &&
        distance(element.at, at) <= tolerance
    )
  }
  const place = (
    at: FigurePoint,
    label: string,
    side?: 'ne' | 'nw' | 'se' | 'sw'
  ): boolean => {
    const clean = label.trim()
    if (!clean) return false
    const labelKey = key(clean)
    const atPoint = all().find(
      (element): element is Extract<FigureElement, { type: 'point' }> =>
        element.type === 'point' && samePointTolerance(element.at, at)
    )
    if (atPoint?.label) return key(atPoint.label) === labelKey
    if (!atPoint && usedLabels.has(labelKey)) return sameNamePoint(labelKey, at)
    additions.push({
      type: 'point',
      at: [at[0], at[1]],
      label: clean,
      ...(side ? { side } : {})
    })
    usedLabels.add(labelKey)
    return true
  }

  const placeGroup = (
    items: Array<{ at: FigurePoint; label: string; side?: 'ne' | 'nw' | 'se' | 'sw' }>
  ): boolean => {
    if (items.length === 0) return false
    const pending = new Set<string>()
    for (const item of items) {
      const clean = item.label.trim()
      if (!clean) return false
      const labelKey = key(clean)
      const atPoint = all().find(
        (element): element is Extract<FigureElement, { type: 'point' }> =>
          element.type === 'point' && samePointTolerance(element.at, item.at)
      )
      if (atPoint?.label) {
        if (key(atPoint.label) !== labelKey) return false
        continue
      }
      if (!atPoint && (usedLabels.has(labelKey) || pending.has(labelKey))) {
        if (sameNamePoint(labelKey, item.at)) continue
        return false
      }
      pending.add(labelKey)
    }
    for (const item of items) place(item.at, item.label, item.side)
    return true
  }

  const twoLetters =
    /^\s*(?:(?:segment|line|side|отрезок|сторона|прямая)\s+)?([A-ZА-Я])\s*[-–—]?\s*([A-ZА-Я])(?:\s*=\s*(.+))?\s*$/u
  const lettersOnly = /^[A-ZА-Я]{3,8}$/u
  const threeNames =
    /(?:∠|∡|angle|угол)?\s*([A-ZА-Я])\s*([A-ZА-Я])\s*([A-ZА-Я])(?![A-Za-zА-Яа-я])/u
  const cleaned: FigureElement[] = []

  for (const element of result) {
    if (element.type === 'segment' && element.label) {
      const match = element.label.match(twoLetters)
      if (match) {
        const mid: FigurePoint = [
          (element.from[0] + element.to[0]) / 2,
          (element.from[1] + element.to[1]) / 2
        ]
        const first = placeGroup([
          {
            at: element.from,
            label: match[1],
            side: sideFromDirection([element.from[0] - mid[0], element.from[1] - mid[1]])
          },
          {
            at: element.to,
            label: match[2],
            side: sideFromDirection([element.to[0] - mid[0], element.to[1] - mid[1]])
          }
        ])
        if (first) {
          cleaned.push({ ...element, label: match[3]?.trim() || undefined })
          continue
        }
      }
    }

    if (element.type === 'polygon' && element.label) {
      const letters = element.label.replace(/\s+/g, '')
      if (lettersOnly.test(letters) && letters.length === element.points.length) {
        const cx = element.points.reduce((sum, p) => sum + p[0], 0) / element.points.length
        const cy = element.points.reduce((sum, p) => sum + p[1], 0) / element.points.length
        const placed = placeGroup(
          letters.split('').map((letter, index) => ({
            at: element.points[index],
            label: letter,
            side: sideFromDirection([
              element.points[index][0] - cx,
              element.points[index][1] - cy
            ])
          }))
        )
        if (placed) {
          cleaned.push({ ...element, label: undefined })
          continue
        }
      }
    }

    if (element.type === 'angle' && element.label) {
      const names = element.label.match(threeNames)
      if (names) {
        const fromDirection: FigurePoint = [
          element.from[0] - element.vertex[0],
          element.from[1] - element.vertex[1]
        ]
        const toDirection: FigurePoint = [
          element.to[0] - element.vertex[0],
          element.to[1] - element.vertex[1]
        ]
        const fromLength = Math.hypot(fromDirection[0], fromDirection[1]) || 1
        const toLength = Math.hypot(toDirection[0], toDirection[1]) || 1
        const bisector: FigurePoint = [
          fromDirection[0] / fromLength + toDirection[0] / toLength,
          fromDirection[1] / fromLength + toDirection[1] / toLength
        ]
        placeGroup([
          { at: element.from, label: names[1], side: sideFromDirection(fromDirection) },
          {
            at: element.vertex,
            label: names[2],
            side: sideFromDirection([-bisector[0] || -1, -bisector[1] || -1])
          },
          { at: element.to, label: names[3], side: sideFromDirection(toDirection) }
        ])
        const measure = measureFromText(element.label)
        const degrees = measure ? (measure.rad ? (measure.value * 180) / Math.PI : measure.value) : null
        cleaned.push({
          ...element,
          label: degrees !== null ? `${formatNumber(Math.abs(degrees), 1)}°` : undefined
        })
        continue
      }
    }

    if (element.type === 'circle' && element.label && /^[A-ZА-Я]$/u.test(element.label.trim())) {
      if (place(element.center, element.label, 'ne')) {
        cleaned.push({ ...element, label: undefined })
        continue
      }
    }

    cleaned.push(element)
  }

  // A graph with no axes at all is a floating line: put a measured grid under it.
  const hasGraph = cleaned.some((element) => element.type === 'graph')
  const hasAxes = cleaned.some((element) => element.type === 'axes')
  if (hasGraph && !hasAxes) {
    const box = emptyBox()
    let found = false
    for (const element of cleaned) {
      if (element.type !== 'graph') continue
      const samples = graphSamples(element)
      if (samples.length === 0) continue
      found = true
      const xs = samples.map((entry) => entry[0])
      const ys = samples.map((entry) => entry[1])
      includePoint(box, [percentile(xs, 0.01), percentile(ys, 0.02)])
      includePoint(box, [percentile(xs, 0.99), percentile(ys, 0.98)])
    }
    if (found) {
      const spanX = Math.max(box.maxX - box.minX, 1e-6)
      const spanY = Math.max(box.maxY - box.minY, 1e-6)
      if (box.minX > 0 && box.minX < spanX) box.minX = 0
      if (box.maxX < 0 && box.maxX > -spanX) box.maxX = 0
      if (box.minY > 0 && box.minY < spanY) box.minY = 0
      if (box.maxY < 0 && box.maxY > -spanY) box.maxY = 0
      const padX = Math.max(spanX * 0.08, 0.5)
      const padY = Math.max(spanY * 0.08, 0.5)
      box.minX -= padX
      box.maxX += padX
      box.minY -= padY
      box.maxY += padY
      const span = Math.max(box.maxX - box.minX, box.maxY - box.minY)
      cleaned.unshift({
        type: 'axes',
        from: [box.minX, box.minY],
        to: [box.maxX, box.maxY],
        step: niceUnitStep(span),
        xLabel: 'x',
        yLabel: 'y'
      })
    }
  }

  return [...cleaned, ...additions]
}

function normalisedDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return delta
}

function graphSamples(element: Extract<FigureElement, { type: 'graph' }>): FigurePoint[] {
  const fn = compileExpression(element.expr)
  if (!fn) return []
  const count = element.samples ?? 160
  const points: FigurePoint[] = []
  for (let index = 0; index <= count; index += 1) {
    const x = element.from + ((element.to - element.from) * index) / count
    const y = fn(x)
    if (Number.isFinite(y) && Math.abs(y) <= 1e6) points.push([x, y])
  }
  return points
}

/** Average of every placed point: used to push dimensions away from the figure. */
function figureCenter(elements: FigureElement[]): FigurePoint {
  let sumX = 0
  let sumY = 0
  let count = 0
  const add = (point: FigurePoint): void => {
    sumX += point[0]
    sumY += point[1]
    count += 1
  }
  for (const element of elements) {
    switch (element.type) {
      case 'segment':
      case 'line':
      case 'vector':
      case 'dimension':
        add(element.from)
        add(element.to)
        break
      case 'ray':
        add(element.from)
        add(element.through)
        break
      case 'polygon':
        element.points.forEach(add)
        break
      case 'point':
        add(element.at)
        break
      case 'circle':
        add(element.center)
        break
      case 'angle':
        add(element.vertex)
        add(element.from)
        add(element.to)
        break
      case 'text':
        add(element.at)
        break
      case 'axes':
        add(element.from)
        add(element.to)
        break
      case 'graph':
        add([element.from, 0])
        add([element.to, 0])
        break
    }
  }
  return count > 0 ? [sumX / count, sumY / count] : [0, 0]
}

/**
 * Which side of a measured segment a dimension line belongs on. The normal is
 * flipped when it would point into the figure, so distances sit outside like on
 * a real drawing.
 */
function dimensionNormal(from: FigurePoint, to: FigurePoint, center: FigurePoint): FigurePoint {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const len = Math.hypot(dx, dy) || 1
  let nx = -dy / len
  let ny = dx / len
  const midX = (from[0] + to[0]) / 2
  const midY = (from[1] + to[1]) / 2
  if ((midX - center[0]) * nx + (midY - center[1]) * ny < 0) {
    nx = -nx
    ny = -ny
  }
  return [nx, ny]
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  const index = clamp(Math.round((sorted.length - 1) * ratio), 0, sorted.length - 1)
  return sorted[index]
}

/* ------------------------------------------------------------------------- *
 * SVG
 * ------------------------------------------------------------------------- */

const THEMES: Record<
  FigureTheme,
  { bg: string; grid: string; ink: string; muted: string; accent: string; danger: string; success: string }
> = {
  paper: {
    bg: '#fcfbf7',
    grid: '#e9e4d8',
    ink: '#243244',
    muted: '#6b7280',
    accent: '#2563eb',
    danger: '#dc2626',
    success: '#15803d'
  },
  blueprint: {
    bg: '#10263d',
    grid: 'rgba(148,197,253,0.16)',
    ink: '#dbeafe',
    muted: '#93b4d4',
    accent: '#7dd3fc',
    danger: '#fca5a5',
    success: '#86efac'
  }
}

const WIDTH = 720
const PAD = 30
const MIN_HEIGHT = 220
const MAX_HEIGHT = 760
const FONT = "'Segoe UI', system-ui, -apple-system, sans-serif"

/**
 * A label that reads like a measurement is recomputed while dragging. A name or
 * a formula label ("угол 2", "a", "гипотенуза") stays exactly as written.
 */
function liveMeasure(
  label: string | undefined,
  computed: string,
  suffix: string,
  live: boolean | undefined
): string {
  if (!label) return `${computed}${suffix}`
  if (!live) return label
  const match = label.match(/^\s*-?\d+(?:[.,]\d+)?\s*(.*)$/)
  if (!match) return label
  const unit = match[1].trim()
  if (unit.length === 0) return `${computed}${suffix}`
  if (unit === '°') return `${computed}°`
  return `${computed} ${unit}`
}

function niceStep(scale: number, minPixels = 22): number {
  const candidates = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 500, 1000]
  for (const step of candidates) {
    if (step * scale >= minPixels) return step
  }
  return 1000
}

interface Painter {
  scale: number
  /** Maths point → SVG pixel. */
  map: (point: FigurePoint) => [number, number]
  box: Box
  palette: (typeof THEMES)[FigureTheme]
  height: number
  warnings: string[]
}

/**
 * Turns a spec into one standalone `<svg>` string. The caller puts it into the
 * card; nothing in it references the network, scripts or external fonts.
 */
export function renderFigureSvg(
  spec: FigureSpec,
  options: Partial<FigureRenderOptions> = {}
): FigureRender {
  const palette = THEMES[options.theme ?? 'paper'] ?? THEMES.paper
  const warnings: string[] = []
  const box = emptyBox()
  const center = figureCenter(spec.elements)

  // First pass: bounds of everything that has a position.
  for (const element of spec.elements) {
    switch (element.type) {
      case 'segment':
      case 'line':
      case 'vector':
        includePoint(box, element.from)
        includePoint(box, element.to)
        break
      case 'dimension': {
        includePoint(box, element.from)
        includePoint(box, element.to)
        // The dimension line sits away from the figure, so the view has to
        // include the offset endpoints too — otherwise it is cropped.
        const normal = dimensionNormal(element.from, element.to, center)
        const offset = Math.abs(element.offset ?? 0.4)
        includePoint(box, [element.from[0] + normal[0] * offset, element.from[1] + normal[1] * offset])
        includePoint(box, [element.to[0] + normal[0] * offset, element.to[1] + normal[1] * offset])
        break
      }
      case 'ray':
        includePoint(box, element.from)
        includePoint(box, element.through)
        break
      case 'polygon':
        element.points.forEach((entry) => includePoint(box, entry))
        break
      case 'point':
        includePoint(box, element.at)
        break
      case 'circle':
        includePoint(box, [element.center[0] - element.radius, element.center[1] - element.radius])
        includePoint(box, [element.center[0] + element.radius, element.center[1] + element.radius])
        break
      case 'angle':
        includePoint(box, element.vertex)
        includePoint(box, element.from)
        includePoint(box, element.to)
        break
      case 'text':
        // Text is measured in pixels after the scale is known: its font size is
        // 14 px whatever the maths units are, so it cannot define the maths box.
        break
      case 'axes':
        includePoint(box, element.from)
        includePoint(box, element.to)
        break
      case 'graph': {
        const points = graphSamples(element)
        if (points.length === 0) {
          warnings.push(`The graph "${element.expr}" is not a plain maths expression and was skipped.`)
          break
        }
        // Percentiles keep an asymptote (tan, 1/x) from defining the whole view.
        const xs = points.map((entry) => entry[0])
        const ys = points.map((entry) => entry[1])
        includePoint(box, [percentile(xs, 0.01), percentile(ys, 0.02)])
        includePoint(box, [percentile(xs, 0.99), percentile(ys, 0.98)])
        break
      }
    }
  }

  if (!Number.isFinite(box.minX) || !Number.isFinite(box.minY)) {
    box.minX = -1
    box.minY = -1
    box.maxX = 1
    box.maxY = 1
  }
  // A single point (or a horizontal line) still needs two dimensions.
  if (box.maxX - box.minX < 0.2) {
    const mid = (box.minX + box.maxX) / 2
    box.minX = mid - 1
    box.maxX = mid + 1
  }
  if (box.maxY - box.minY < 0.2) {
    const mid = (box.minY + box.maxY) / 2
    box.minY = mid - 1
    box.maxY = mid + 1
  }

  const fit = (target: Box): { scale: number; height: number; offsetY: number } => {
    const extentX = target.maxX - target.minX
    const extentY = target.maxY - target.minY
    let nextScale = (WIDTH - PAD * 2) / extentX
    let nextHeight = extentY * nextScale + PAD * 2
    if (nextHeight > MAX_HEIGHT) {
      nextScale *= (MAX_HEIGHT - PAD * 2) / (extentY * nextScale)
      nextHeight = MAX_HEIGHT
    }
    if (nextHeight < MIN_HEIGHT) nextHeight = MIN_HEIGHT
    const contentHeight = extentY * nextScale
    const nextOffset = PAD + Math.max(0, (nextHeight - PAD * 2 - contentHeight) / 2)
    return { scale: nextScale, height: nextHeight, offsetY: nextOffset }
  }

  let layout = fit(box)
  // Annotations are drawn at a fixed pixel size. Measure them in pixels and
  // widen the maths view, instead of treating a 14 px font as 14 maths units
  // (which used to shrink a whole figure down to a thumbnail).
  const textElements = spec.elements.filter(
    (element): element is Extract<FigureElement, { type: 'text' }> => element.type === 'text'
  )
  for (let pass = 0; pass < 3 && textElements.length > 0; pass += 1) {
    const toScreen = ([x, y]: FigurePoint): [number, number] => [
      PAD + (x - box.minX) * layout.scale,
      layout.offsetY + (box.maxY - y) * layout.scale
    ]
    let left = 0
    let right = 0
    let top = 0
    let bottom = 0
    for (const element of textElements) {
      const [x, y] = toScreen(element.at)
      const size = element.size ?? 14
      const width = element.text.length * size * 0.56 + 8
      const height = size * 1.25
      const align = element.align ?? 'start'
      const startX = align === 'start' ? x : align === 'middle' ? x - width / 2 : x - width
      left = Math.max(left, PAD - startX)
      right = Math.max(right, startX + width - (WIDTH - PAD))
      top = Math.max(top, PAD - (y - height))
      bottom = Math.max(bottom, y + size * 0.3 - (layout.height - PAD))
    }
    if (left + right + top + bottom <= 0.5) break
    box.minX -= Math.max(0, left) / layout.scale
    box.maxX += Math.max(0, right) / layout.scale
    box.maxY += Math.max(0, top) / layout.scale
    box.minY -= Math.max(0, bottom) / layout.scale
    layout = fit(box)
  }

  const { scale, height, offsetY } = layout

  const map = (target: FigurePoint): [number, number] => [
    PAD + (target[0] - box.minX) * scale,
    offsetY + (box.maxY - target[1]) * scale
  ]

  const painter: Painter = { scale, map, box, palette, height, warnings }
  const parts: string[] = []
  const stroke = (value?: string): string => {
    if (!value) return palette.ink
    return value in palette ? palette[value as keyof typeof palette] : value
  }

  const labelAt = (
    [x, y]: [number, number],
    value: string,
    anchor: 'start' | 'middle' | 'end' = 'middle',
    size = 14,
    tint = palette.ink,
    baseline: 'auto' | 'hanging' = 'auto'
  ): string =>
    `<text x="${px(x)}" y="${px(y)}" text-anchor="${anchor}" font-family="${FONT}" font-size="${size}" font-weight="600" fill="${tint}"${baseline === 'hanging' ? ' dominant-baseline="hanging"' : ''} stroke="${palette.bg}" stroke-width="3.2" paint-order="stroke" stroke-linejoin="round">${escapeXml(value)}</text>`

  const line = (a: [number, number], b: [number, number], tint: string, width = 1.7, dashed = false): string =>
    `<line x1="${px(a[0])}" y1="${px(a[1])}" x2="${px(b[0])}" y2="${px(b[1])}" stroke="${tint}" stroke-width="${width}" stroke-linecap="round"${dashed ? ' stroke-dasharray="6 5"' : ''} />`

  const circleDot = (a: [number, number], tint: string, hollow = false): string =>
    `<circle cx="${px(a[0])}" cy="${px(a[1])}" r="3.1" fill="${hollow ? palette.bg : tint}" stroke="${tint}" stroke-width="1.4" />`

  const arrowHead = (tip: [number, number], from: [number, number], tint: string, size = 8): string => {
    const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0])
    const spread = 0.42
    const p1 = [tip[0] - Math.cos(angle - spread) * size, tip[1] - Math.sin(angle - spread) * size]
    const p2 = [tip[0] - Math.cos(angle + spread) * size, tip[1] - Math.sin(angle + spread) * size]
    return `<path d="M ${px(tip[0])} ${px(tip[1])} L ${px(p1[0])} ${px(p1[1])} L ${px(p2[0])} ${px(p2[1])} Z" fill="${tint}" />`
  }

  // Grid under everything, aligned with whole maths units.
  if (options.grid) {
    const step = niceStep(scale)
    const gridTint = palette.grid
    const startX = Math.ceil(box.minX / step) * step
    const startY = Math.ceil(box.minY / step) * step
    for (let x = startX; x <= box.maxX + 1e-9; x += step) {
      const [sx] = map([x, box.minY])
      parts.push(
        `<line x1="${px(sx)}" y1="${px(PAD / 2)}" x2="${px(sx)}" y2="${px(height - PAD / 2)}" stroke="${gridTint}" stroke-width="1" />`
      )
    }
    for (let y = startY; y <= box.maxY + 1e-9; y += step) {
      const [, sy] = map([box.minX, y])
      parts.push(
        `<line x1="${px(PAD / 2)}" y1="${px(sy)}" x2="${px(WIDTH - PAD / 2)}" y2="${px(sy)}" stroke="${gridTint}" stroke-width="1" />`
      )
    }
  }

  const drawElement = (element: FigureElement): void => {
    const tint = stroke('color' in element ? element.color : undefined)
    switch (element.type) {
      case 'segment': {
        const a = map(element.from)
        const b = map(element.to)
        parts.push(line(a, b, tint, 1.9, element.dashed))
        if (element.label) {
          const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
          const angle = Math.atan2(b[1] - a[1], b[0] - a[0])
          const nx = Math.sin(angle)
          const ny = -Math.cos(angle)
          const readable = Math.cos(angle) < -0.2
          parts.push(
            labelAt(
              [mid[0] + nx * 14 * (readable ? -1 : 1), mid[1] + ny * 14 * (readable ? -1 : 1)],
              element.label,
              'middle',
              12,
              palette.muted,
              'hanging'
            )
          )
        }
        if (element.ticks) {
          const ticks = element.ticks
          for (let index = 0; index < ticks; index += 1) {
            const offset = (index - (ticks - 1) / 2) * 6
            const mx = (a[0] + b[0]) / 2
            const my = (a[1] + b[1]) / 2
            const ux = (b[0] - a[0]) / Math.max(1, distance(a, b))
            const uy = (b[1] - a[1]) / Math.max(1, distance(a, b))
            const nx = -uy
            const ny = ux
            const anchor: [number, number] = [mx + ux * offset, my + uy * offset]
            parts.push(line([anchor[0] - nx * 5, anchor[1] - ny * 5], [anchor[0] + nx * 5, anchor[1] + ny * 5], tint, 1.5))
          }
        }
        break
      }
      case 'line': {
        const a = map(element.from)
        const b = map(element.to)
        const dx = b[0] - a[0]
        const dy = b[1] - a[1]
        const len = Math.hypot(dx, dy) || 1
        const far = 4000
        const start: [number, number] = [a[0] - (dx / len) * far, a[1] - (dy / len) * far]
        const end: [number, number] = [b[0] + (dx / len) * far, b[1] + (dy / len) * far]
        parts.push(line(start, end, tint, 1.6, element.dashed))
        break
      }
      case 'ray': {
        const a = map(element.from)
        const b = map(element.through)
        const dx = b[0] - a[0]
        const dy = b[1] - a[1]
        const len = Math.hypot(dx, dy) || 1
        const end: [number, number] = [b[0] + (dx / len) * 4000, b[1] + (dy / len) * 4000]
        parts.push(line(a, end, tint, 1.6, element.dashed))
        parts.push(circleDot(a, tint, true))
        break
      }
      case 'vector': {
        const a = map(element.from)
        const b = map(element.to)
        parts.push(line(a, b, tint, 1.9))
        parts.push(arrowHead(b, a, tint))
        if (element.label) {
          const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
          const angle = Math.atan2(b[1] - a[1], b[0] - a[0])
          parts.push(
            labelAt([mid[0] + Math.sin(angle) * 16, mid[1] - Math.cos(angle) * 16], element.label, 'middle', 13, tint)
          )
        }
        break
      }
      case 'polygon': {
        const points = element.points.map(map)
        const d = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${px(x)} ${px(y)}`).join(' ') + ' Z'
        parts.push(
          `<path d="${d}" fill="${element.filled ? tint : palette.bg}" fill-opacity="${element.filled ? 0.12 : 0}" stroke="${tint}" stroke-width="1.9" stroke-linejoin="round" />`
        )
        if (element.label) {
          const cx = points.reduce((sum, entry) => sum + entry[0], 0) / points.length
          const cy = points.reduce((sum, entry) => sum + entry[1], 0) / points.length
          parts.push(labelAt([cx, cy], element.label, 'middle', 13, tint))
        }
        break
      }
      case 'point': {
        const at = map(element.at)
        parts.push(circleDot(at, tint, element.hollow))
        if (element.label) {
          const side = element.side ?? 'ne'
          const dx = side === 'nw' || side === 'sw' ? -10 : 10
          const dy = side === 'nw' || side === 'ne' ? -10 : 14
          parts.push(
            labelAt(
              [at[0] + dx, at[1] + dy],
              element.label,
              side === 'nw' || side === 'sw' ? 'end' : 'start',
              14,
              palette.ink
            )
          )
        }
        break
      }
      case 'circle': {
        const center = map(element.center)
        const r = element.radius * scale
        parts.push(
          `<circle cx="${px(center[0])}" cy="${px(center[1])}" r="${px(r)}" fill="${palette.bg}" fill-opacity="0" stroke="${tint}" stroke-width="1.8"${element.dashed ? ' stroke-dasharray="6 5"' : ''} />`
        )
        parts.push(circleDot(center, tint))
        if (element.label) {
          parts.push(labelAt([center[0], center[1] - r - 8], element.label, 'middle', 13, tint))
        }
        break
      }
      case 'angle': {
        const vertex = map(element.vertex)
        const from = map(element.from)
        const to = map(element.to)
        const a1 = Math.atan2(from[1] - vertex[1], from[0] - vertex[0])
        const a2 = Math.atan2(to[1] - vertex[1], to[0] - vertex[0])
        const shortDelta = normalisedDelta(a1, a2)
        const delta =
          element.reflex && Math.abs(shortDelta) > 1e-6
            ? -Math.sign(shortDelta) * (Math.PI * 2 - Math.abs(shortDelta))
            : shortDelta
        const radiusPx = Math.min(
          Math.hypot(from[0] - vertex[0], from[1] - vertex[1]),
          Math.hypot(to[0] - vertex[0], to[1] - vertex[1])
        )
        const r = element.radius ? element.radius * scale : clamp(radiusPx * 0.22, 14, 44)

        if (element.right || Math.abs(Math.abs(delta) - Math.PI / 2) < 0.02) {
          const sign = delta >= 0 ? 1 : -1
          const step = r * 0.78
          const p1: [number, number] = [
            vertex[0] + Math.cos(a1) * step,
            vertex[1] + Math.sin(a1) * step
          ]
          const p2: [number, number] = [
            p1[0] + Math.cos(a1 + sign * (Math.PI / 2)) * step,
            p1[1] + Math.sin(a1 + sign * (Math.PI / 2)) * step
          ]
          const p3: [number, number] = [
            vertex[0] + Math.cos(a2) * step,
            vertex[1] + Math.sin(a2) * step
          ]
          parts.push(
            `<path d="M ${px(p1[0])} ${px(p1[1])} L ${px(p2[0])} ${px(p2[1])} L ${px(p3[0])} ${px(p3[1])}" fill="none" stroke="${tint}" stroke-width="1.5" />`
          )
        } else {
          const end = [vertex[0] + Math.cos(a1 + delta) * r, vertex[1] + Math.sin(a1 + delta) * r]
          const largeArc = Math.abs(delta) > Math.PI ? 1 : 0
          parts.push(
            `<path d="M ${px(vertex[0] + Math.cos(a1) * r)} ${px(vertex[1] + Math.sin(a1) * r)} A ${px(r)} ${px(r)} 0 ${largeArc} ${delta >= 0 ? 1 : 0} ${px(end[0])} ${px(end[1])}" fill="none" stroke="${tint}" stroke-width="1.6" />`
          )
        }

        const degrees = Math.round(Math.abs((delta * 180) / Math.PI) * 10) / 10
        const value = liveMeasure(element.label, formatNumber(degrees, 1), '°', options.live)
        const midAngle = a1 + delta / 2
        const labelRadius = r + 16
        parts.push(
          labelAt(
            [vertex[0] + Math.cos(midAngle) * labelRadius, vertex[1] + Math.sin(midAngle) * labelRadius],
            value,
            'middle',
            12,
            tint
          )
        )
        break
      }
      case 'dimension': {
        const normal = dimensionNormal(element.from, element.to, center)
        // Keep the line readable on tiny drawings, within the SVG padding.
        const offset = Math.max(Math.abs(element.offset ?? 0.4), 16 / scale)
        const a2 = map([
          element.from[0] + normal[0] * offset,
          element.from[1] + normal[1] * offset
        ])
        const b2 = map([
          element.to[0] + normal[0] * offset,
          element.to[1] + normal[1] * offset
        ])
        const a = map(element.from)
        const b = map(element.to)
        parts.push(line(a, a2, palette.muted, 1))
        parts.push(line(b, b2, palette.muted, 1))
        parts.push(line(a2, b2, tint, 1.3))
        parts.push(arrowHead(b2, a2, tint, 7))
        parts.push(arrowHead(a2, b2, tint, 7))

        const value = liveMeasure(
          element.label,
          formatNumber(distance(element.from, element.to), 2),
          '',
          options.live
        )
        const midpoint: [number, number] = [(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2]
        // In pixel space the normal's y decides whether the label sits above or
        // below the dimension line, so it never covers the line itself.
        const screenNormalY = a2[1] - a[1]
        parts.push(
          labelAt(
            [midpoint[0], midpoint[1] + (screenNormalY >= 0 ? 13 : -8)],
            value,
            'middle',
            13,
            tint,
            screenNormalY >= 0 ? 'hanging' : 'auto'
          )
        )
        break
      }
      case 'text': {
        const at = map(element.at)
        parts.push(
          `<text x="${px(at[0])}" y="${px(at[1])}" text-anchor="${element.align ?? 'start'}" font-family="${FONT}" font-size="${element.size ?? 14}" fill="${tint}">${escapeXml(element.text)}</text>`
        )
        break
      }
      case 'axes': {
        // `from`/`to` are the visible range, and the axes cross at the origin
        // (or at the edge of the range when it does not contain zero).
        const minX = Math.min(element.from[0], element.to[0])
        const maxX = Math.max(element.from[0], element.to[0])
        const minY = Math.min(element.from[1], element.to[1])
        const maxY = Math.max(element.from[1], element.to[1])
        const xAxis = clamp(0, minX, maxX)
        const yAxis = clamp(0, minY, maxY)

        const left = map([minX, yAxis])
        const right = map([maxX, yAxis])
        const bottom = map([xAxis, minY])
        const top = map([xAxis, maxY])
        parts.push(line(left, right, palette.muted, 1.3))
        parts.push(line(bottom, top, palette.muted, 1.3))
        parts.push(arrowHead(right, left, palette.muted, 7))
        parts.push(arrowHead(top, bottom, palette.muted, 7))
        if (element.xLabel) {
          parts.push(labelAt([right[0] + 7, right[1] - 11], element.xLabel, 'start', 14, palette.ink))
        }
        if (element.yLabel) {
          parts.push(labelAt([top[0] + 9, top[1] - 6], element.yLabel, 'start', 14, palette.ink))
        }

        if (element.labels !== false) {
          const step = element.step && element.step > 0 ? element.step : niceStep(scale, 44)
          const rangeX = maxX - minX || 1
          const rangeY = maxY - minY || 1
          const axisAtBottom = yAxis - minY < rangeY * 0.18
          const axisAtLeft = xAxis - minX < rangeX * 0.18

          for (let x = Math.ceil(minX / step) * step; x <= maxX + 1e-9; x += step) {
            if (Math.abs(x) < 1e-9) continue
            const at = map([x, yAxis])
            parts.push(
              `<line x1="${px(at[0])}" y1="${px(at[1] - 3)}" x2="${px(at[0])}" y2="${px(at[1] + 3)}" stroke="${palette.muted}" stroke-width="1.2" />`,
              labelAt(
                [at[0], at[1] + (axisAtBottom ? -8 : 15)],
                formatNumber(x, 2),
                'middle',
                11,
                palette.muted,
                axisAtBottom ? 'auto' : 'hanging'
              )
            )
          }
          for (let y = Math.ceil(minY / step) * step; y <= maxY + 1e-9; y += step) {
            if (Math.abs(y) < 1e-9) continue
            const at = map([xAxis, y])
            parts.push(
              `<line x1="${px(at[0] - 3)}" y1="${px(at[1])}" x2="${px(at[0] + 3)}" y2="${px(at[1])}" stroke="${palette.muted}" stroke-width="1.2" />`,
              labelAt(
                [at[0] + (axisAtLeft ? 8 : -7), at[1] + 4],
                formatNumber(y, 2),
                axisAtLeft ? 'start' : 'end',
                11,
                palette.muted
              )
            )
          }
          if (minX <= 0 && maxX >= 0 && minY <= 0 && maxY >= 0) {
            const origin = map([0, 0])
            parts.push(
              labelAt(
                [origin[0] - 7, origin[1] + 15],
                '0',
                'end',
                11,
                palette.muted
              )
            )
          }
        }
        break
      }
      case 'graph': {
        const points = graphSamples(element)
        const fn = compileExpression(element.expr)
        if (!fn || points.length === 0) {
          warnings.push(`The graph "${element.expr}" could not be evaluated and was skipped.`)
          break
        }
        let d = ''
        let previous: [number, number] | null = null
        const jumpLimit = Math.max(30, painter.height * 0.4)
        for (const sample of points) {
          const mapped = map(sample)
          if (previous && Math.abs(mapped[1] - previous[1]) > jumpLimit) {
            d += ` M ${px(mapped[0])} ${px(mapped[1])}`
          } else if (previous) {
            d += ` L ${px(mapped[0])} ${px(mapped[1])}`
          } else {
            d += `M ${px(mapped[0])} ${px(mapped[1])}`
          }
          previous = mapped
        }
        parts.push(
          `<path d="${d}" fill="none" stroke="${tint === palette.ink ? palette.accent : tint}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />`
        )
        if (element.label) {
          const last = map(points[points.length - 1])
          parts.push(labelAt([last[0] - 6, last[1] - 10], element.label, 'end', 12, tint === palette.ink ? palette.accent : tint))
        }
        break
      }
    }
  }

  for (const element of spec.elements) drawElement(element)

  const titleHeight = spec.title ? 26 : 0
  const titleSize = spec.title
    ? clamp((WIDTH - PAD * 2) / Math.max(12, spec.title.length * 0.56), 11, 18)
    : 18
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height + titleHeight}" width="${WIDTH}" height="${Math.round(height + titleHeight)}" role="img" aria-label="${escapeXml(spec.title ?? spec.caption ?? 'Figure')}">`,
    `<rect x="0" y="0" width="${WIDTH}" height="${Math.round(height + titleHeight)}" fill="${palette.bg}" />`,
    spec.title
      ? `<text x="${PAD}" y="20" font-family="${FONT}" font-size="${px(titleSize)}" font-weight="600" fill="${palette.ink}">${escapeXml(spec.title)}</text>`
      : '',
    `<g transform="translate(0 ${titleHeight})">`,
    ...parts,
    '</g>',
    '</svg>'
  ]
    .filter((part) => part.length > 0)
    .join('')

  const projection: FigureProjection = {
    width: WIDTH,
    height: height + titleHeight,
    titleHeight,
    toPixel: (point) => {
      const [x, y] = map(point)
      return [x, y + titleHeight]
    },
    toMath: (x, y) => [
      box.minX + (x - PAD) / scale,
      box.maxY - (y - titleHeight - offsetY) / scale
    ]
  }

  const results = options.results ? (spec.results ?? []) : []
  return { svg, warnings, results, projection }
}

/* ------------------------------------------------------------------------- *
 * Interactive editing
 * ------------------------------------------------------------------------- */

const POINT_EPSILON = 1e-6

/** Every distinct coordinate a user can grab, in drawing order. */
export function figurePoints(spec: FigureSpec): FigurePoint[] {
  const points: FigurePoint[] = []
  const seen = new Set<string>()
  const add = (point: FigurePoint): void => {
    const key = `${Math.round(point[0] / POINT_EPSILON)}:${Math.round(point[1] / POINT_EPSILON)}`
    if (seen.has(key)) return
    seen.add(key)
    points.push([point[0], point[1]])
  }

  for (const element of spec.elements) {
    switch (element.type) {
      case 'segment':
      case 'line':
      case 'vector':
      case 'dimension':
        add(element.from)
        add(element.to)
        break
      case 'ray':
        add(element.from)
        add(element.through)
        break
      case 'polygon':
        element.points.forEach(add)
        break
      case 'point':
        add(element.at)
        break
      case 'circle':
        add(element.center)
        break
      case 'angle':
        add(element.vertex)
        add(element.from)
        add(element.to)
        break
      case 'text':
        add(element.at)
        break
      case 'axes':
      case 'graph':
        break
    }
  }
  return points
}

const samePoint = (a: FigurePoint, b: FigurePoint): boolean =>
  Math.abs(a[0] - b[0]) < POINT_EPSILON && Math.abs(a[1] - b[1]) < POINT_EPSILON

/**
 * Moves every coordinate that sits on `from` to `to`, so shared vertices (the
 * vertex of an angle and an endpoint of a segment, say) stay welded together.
 * Pure: the caller keeps the returned spec in its own state.
 */
export function moveFigurePoint(spec: FigureSpec, from: FigurePoint, to: FigurePoint): FigureSpec {
  const move = (point: FigurePoint): FigurePoint => (samePoint(point, from) ? [to[0], to[1]] : point)
  const elements = spec.elements.map((element): FigureElement => {
    switch (element.type) {
      case 'segment':
      case 'line':
      case 'vector':
      case 'dimension':
        return { ...element, from: move(element.from), to: move(element.to) }
      case 'ray':
        return { ...element, from: move(element.from), through: move(element.through) }
      case 'polygon':
        return { ...element, points: element.points.map(move) }
      case 'point':
        return { ...element, at: move(element.at) }
      case 'circle':
        return { ...element, center: move(element.center) }
      case 'angle':
        return { ...element, vertex: move(element.vertex), from: move(element.from), to: move(element.to) }
      case 'text':
        return { ...element, at: move(element.at) }
      case 'axes':
      case 'graph':
        return element
    }
  })
  return { ...spec, elements }
}

/** Rounds to the nearest `step`, used for snap-to-grid dragging. */
export function snapValue(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value
  return Math.round(value / step) * step
}
