import { Notification, shell } from 'electron'
import { safeHttpUrl } from '@shared/web-search'
import { diagramLayers, renderDiagramSvg, type DiagramSpec } from '@shared/diagram'
import type { DiagramMeta, TableMeta } from '@shared/tool-meta'
import { argNumber, argString, ToolError, type ToolDef } from './tool-utils'

/**
 * Tools that reach the person at the keyboard: opening files and links for
 * them, showing data as a real table, drawing a scheme, exporting the chat,
 * speaking an answer aloud and desktop notifications.
 */

const openInEditorTool: ToolDef = {
  name: 'open_in_editor',
  description:
    "Open a workspace file in the user's editor, optionally at a specific line, so they can look at exactly what you are talking about. Use it when referring them to a place in the code instead of pasting a path they must hunt for.",
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace file to open' },
      line: { type: 'number', description: 'Line to jump to' }
    },
    required: ['path']
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const shown = ctx.openInEditor?.(argString(args, 'path'), argNumber(args, 'line'))
    return shown === true
      ? { ok: true, summary: 'opened for the user', detail: 'The file is now open in the editor.' }
      : { ok: false, summary: 'no editor window', detail: 'The IDE window is not available right now.' }
  }
}

const showTableTool: ToolDef = {
  name: 'show_table',
  description:
    'Show results as a real table card in the chat (columns and rows) instead of a wall of text. Use it whenever you computed or collected structured data: comparisons, test results, dependency versions, query rows.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Table caption' },
      columns: { type: 'array', items: { type: 'string' }, description: 'Column headers' },
      rows: {
        type: 'array',
        description: 'Rows of cells (strings)',
        items: { type: 'array', items: { type: 'string' } }
      }
    },
    required: ['columns', 'rows']
  },
  risk: 'read',
  execute: async (args) => {
    const rawColumns = Array.isArray(args.columns) ? args.columns : []
    const columns = rawColumns.filter((c): c is string => typeof c === 'string').slice(0, 8)
    if (columns.length === 0) throw new ToolError('columns must be a non-empty array of strings')
    const rawRows = Array.isArray(args.rows) ? args.rows : []
    const rows = rawRows
      .filter((row): row is unknown[] => Array.isArray(row))
      .slice(0, 50)
      .map((row) => row.slice(0, columns.length).map((cell) => String(cell ?? '').slice(0, 200)))
    const meta: TableMeta = {
      kind: 'table',
      title: argString(args, 'title', false) || undefined,
      columns,
      rows
    }
    return {
      ok: true,
      summary: `table shown: ${rows.length} row(s) × ${columns.length} column(s)`,
      detail: 'The table is displayed in the chat. Reference it in your answer.',
      meta
    }
  }
}

const makeDiagramTool: ToolDef = {
  name: 'make_diagram',
  description:
    'Draw a boxes-and-arrows scheme as a card in the chat: how the project is structured, how a request flows, who talks to whom. Pass nodes (id, label, optional sub) and edges (from, to, optional label). Layered left-to-right layout is automatic.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Diagram caption' },
      nodes: {
        type: 'array',
        description: 'Boxes',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Short id used by edges' },
            label: { type: 'string', description: 'Text on the box' },
            sub: { type: 'string', description: 'Small second line (tech, role)' }
          },
          required: ['id', 'label']
        }
      },
      edges: {
        type: 'array',
        description: 'Arrows between boxes',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            label: { type: 'string', description: 'Text on the arrow' }
          },
          required: ['from', 'to']
        }
      }
    },
    required: ['nodes']
  },
  risk: 'read',
  execute: async (args) => {
    const rawNodes = Array.isArray(args.nodes) ? args.nodes : []
    const nodes = rawNodes
      .filter((node): node is Record<string, unknown> => !!node && typeof node === 'object')
      .slice(0, 20)
      .map((node, index) => ({
        id: typeof node.id === 'string' && node.id.length > 0 ? node.id : `n${index + 1}`,
        label: typeof node.label === 'string' && node.label.length > 0 ? node.label : `node ${index + 1}`,
        sub: typeof node.sub === 'string' ? node.sub : undefined
      }))
    if (nodes.length === 0) throw new ToolError('nodes must be a non-empty array')
    const ids = new Set(nodes.map((node) => node.id))
    const rawEdges = Array.isArray(args.edges) ? args.edges : []
    const edges = rawEdges
      .filter((edge): edge is Record<string, unknown> => !!edge && typeof edge === 'object')
      .map((edge) => ({
        from: String(edge.from ?? ''),
        to: String(edge.to ?? ''),
        label: typeof edge.label === 'string' ? edge.label : undefined
      }))
      .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
      .slice(0, 40)

    const spec: DiagramSpec = { title: argString(args, 'title', false) || undefined, nodes, edges }
    const layers = diagramLayers(spec)
    const svg = renderDiagramSvg(spec)
    const meta: DiagramMeta = { kind: 'diagram', title: spec.title, svg }
    return {
      ok: true,
      summary: `diagram shown: ${nodes.length} boxes, ${edges.length} arrows, ${layers.length} layer(s)`,
      detail: 'The diagram is displayed in the chat. Explain it in your answer.',
      meta
    }
  }
}

const openUrlTool: ToolDef = {
  name: 'open_url',
  description: "Open a link in the user's default browser so they can look at it themselves.",
  parameters: {
    type: 'object',
    properties: { url: { type: 'string', description: 'http(s) URL to open' } },
    required: ['url']
  },
  risk: 'read',
  execute: async (args) => {
    const url = safeHttpUrl(argString(args, 'url'))
    if (!url) throw new ToolError('Only public http(s) URLs can be opened')
    await shell.openExternal(url)
    return { ok: true, summary: `opened ${url}`, detail: 'The link is now open in the default browser.' }
  }
}

const exportChatTool: ToolDef = {
  name: 'export_chat',
  description:
    'Save the current conversation as a Markdown file in the workspace so the user can keep, re-read or share it. Use it when the user asks to save the conversation or when a long result is worth keeping.',
  parameters: {
    type: 'object',
    properties: { file_name: { type: 'string', description: 'File name (default: chat-<date>.md)' } }
  },
  risk: 'write',
  execute: async (args, ctx) => {
    const name = argString(args, 'file_name', false) || `chat-${new Date().toISOString().slice(0, 10)}.md`
    const written = (await ctx.exportChat?.(name)) ?? null
    return written
      ? { ok: true, summary: `chat saved to ${written}`, detail: `The conversation is written to ${written}.` }
      : { ok: false, summary: 'could not export', detail: 'The chat window did not answer; nothing was written.' }
  }
}

const voiceReadTool: ToolDef = {
  name: 'voice_read',
  description:
    'Read the given text aloud to the user with the system voice. Keep it short — a summary or the final answer, not the whole reasoning. Use it when the user is waiting hands-free.',
  parameters: {
    type: 'object',
    properties: { text: { type: 'string', description: 'What to say out loud' } },
    required: ['text']
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const spoken = ctx.speak?.(argString(args, 'text').slice(0, 2000))
    return spoken === true
      ? { ok: true, summary: 'spoken', detail: 'The text was read aloud.' }
      : { ok: false, summary: 'voice unavailable', detail: 'Speech is not available in the window right now.' }
  }
}

const notifyMeTool: ToolDef = {
  name: 'notify_me',
  description:
    'Send the user a desktop notification — use it when a long task finishes or needs their attention and they may be in another window.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short headline' },
      body: { type: 'string', description: 'One line of detail' }
    },
    required: ['title']
  },
  risk: 'read',
  execute: async (args) => {
    const title = argString(args, 'title').slice(0, 120)
    const body = argString(args, 'body', false).slice(0, 200)
    if (!Notification.isSupported()) {
      return { ok: false, summary: 'notifications unsupported', detail: 'This system does not allow desktop notifications.' }
    }
    new Notification({ title, body, silent: false }).show()
    return { ok: true, summary: `notified: ${title}`, detail: 'The notification was shown.' }
  }
}

export const UI_TOOLS: ToolDef[] = [
  openInEditorTool,
  showTableTool,
  makeDiagramTool,
  openUrlTool,
  exportChatTool,
  voiceReadTool,
  notifyMeTool
]
