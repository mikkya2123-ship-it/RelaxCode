/* ------------------------------------------------------------------------- *
 * Boxes-and-arrows diagrams, pure and dependency-free: the model describes
 * nodes and edges, this module lays them out in layers and renders a
 * standalone SVG the chat shows as a card.
 *
 * Layout: nodes are placed in horizontal layers (longest-path order for a
 * DAG; cycles are tolerated — a back edge just stops pushing its target
 * deeper). Layer width is the widest layer, so most software diagrams
 * (request → app → database) read left to right.
 * ------------------------------------------------------------------------- */

export interface DiagramNode {
  id: string
  label: string
  /** Optional short second line (a tech or role, e.g. "PostgreSQL"). */
  sub?: string
}

export interface DiagramEdge {
  from: string
  to: string
  label?: string
}

export interface DiagramSpec {
  title?: string
  nodes: DiagramNode[]
  edges: DiagramEdge[]
}

const NODE_W = 150
const NODE_H = 46
const GAP_X = 60
const GAP_Y = 24

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Layers by longest path; a node sits one layer right of every predecessor. */
export function diagramLayers(spec: DiagramSpec): DiagramNode[][] {
  const byId = new Map(spec.nodes.map((node) => [node.id, node]))
  const incoming = new Map<string, string[]>(spec.nodes.map((node) => [node.id, []]))
  for (const edge of spec.edges) {
    if (byId.has(edge.from) && byId.has(edge.to)) incoming.get(edge.to)?.push(edge.from)
  }
  const layerOf = new Map<string, number>()
  const visiting = new Set<string>()
  const depth = (id: string): number => {
    const known = layerOf.get(id)
    if (known !== undefined) return known
    // A cycle would recurse forever; the visiting set cuts it at this node.
    if (visiting.has(id)) return 0
    visiting.add(id)
    const parents = incoming.get(id) ?? []
    const value = parents.length === 0 ? 0 : Math.max(...parents.map(depth)) + 1
    visiting.delete(id)
    layerOf.set(id, value)
    return value
  }
  for (const node of spec.nodes) depth(node.id)

  const layers: DiagramNode[][] = []
  for (const node of spec.nodes) {
    const layer = layerOf.get(node.id) ?? 0
    if (!layers[layer]) layers[layer] = []
    layers[layer].push(node)
  }
  return layers.filter((layer) => layer.length > 0)
}

function truncateLabel(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Renders the spec as a standalone SVG string (no external fonts or CSS). */
export function renderDiagramSvg(spec: DiagramSpec): string {
  const layers = diagramLayers(spec)
  const position = new Map<string, { x: number; y: number }>()

  layers.forEach((layer, layerIndex) => {
    layer.forEach((node, rowIndex) => {
      position.set(node.id, { x: layerIndex * (NODE_W + GAP_X), y: rowIndex * (NODE_H + GAP_Y) })
    })
  })
  const rowsMax = Math.max(...layers.map((layer) => layer.length))
  const svgW = layers.length * (NODE_W + GAP_X) - GAP_X
  const svgH = rowsMax * (NODE_H + GAP_Y) - GAP_Y
  const parts: string[] = []

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${Math.max(svgH, 1)}" font-family="ui-sans-serif, system-ui, sans-serif">`
  )

  const arrows: string[] = []
  for (const edge of spec.edges) {
    const from = position.get(edge.from)
    const to = position.get(edge.to)
    if (!from || !to) continue
    const x1 = from.x + NODE_W
    const y1 = from.y + NODE_H / 2
    const x2 = to.x
    const y2 = to.y + NODE_H / 2
    // A straight shot when the layers are adjacent; otherwise route around.
    const midX = (x1 + x2) / 2
    const path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`
    arrows.push(`<path d="${path}" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="1.5"/>`)
    arrows.push(
      `<circle cx="${x2}" cy="${y2}" r="2.5" fill="currentColor" fill-opacity="0.6"/>`
    )
    if (edge.label) {
      arrows.push(
        `<text x="${midX}" y="${(y1 + y2) / 2 - 4}" font-size="9" text-anchor="middle" fill="currentColor" fill-opacity="0.6">${esc(
          truncateLabel(edge.label, 24)
        )}</text>`
      )
    }
  }
  parts.push(`<g stroke="none">${arrows.join('')}</g>`)

  for (const node of spec.nodes) {
    const at = position.get(node.id)
    if (!at) continue
    parts.push(
      `<g transform="translate(${at.x}, ${at.y})">` +
        `<rect width="${NODE_W}" height="${NODE_H}" rx="8" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-opacity="0.35"/>` +
        `<text x="${NODE_W / 2}" y="${node.sub ? 20 : 28}" font-size="11" font-weight="600" text-anchor="middle" fill="currentColor">${esc(
          truncateLabel(node.label, 22)
        )}</text>` +
        (node.sub
          ? `<text x="${NODE_W / 2}" y="34" font-size="9" text-anchor="middle" fill="currentColor" fill-opacity="0.6">${esc(
              truncateLabel(node.sub, 30)
            )}</text>`
          : '') +
        `</g>`
    )
  }

  parts.push('</svg>')
  return parts.join('')
}
