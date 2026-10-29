import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, join } from 'node:path'
import { safeHttpUrl } from '@shared/web-search'
import { formatBytes } from './visuals'
import { getWorkspaceRoot } from './workspace'
import { decodeXmlText, readZip } from './zip-reader'
import { extractPdfText } from './pdf-text'
import {
  argString,
  NO_WORKSPACE,
  relPath,
  resolveInWorkspace,
  ToolError,
  truncate,
  type ToolDef
} from './tool-utils'

/**
 * Documents and data without new dependencies: JSON/CSV are summarised by
 * structure, DOCX/XLSX are unzipped with Node's own zlib, PDF text is pulled
 * from the content streams. `db_query` borrows the project's own installed
 * driver (better-sqlite3 / pg) instead of shipping one.
 */

const MAX_DOC_CHARS = 120_000
const MAX_DOC_BYTES = 50 * 1024 * 1024

// --- JSON / CSV --------------------------------------------------------------

interface JsonSummary {
  summary: string
}

function describeValue(value: unknown, depth: number): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `array(${value.length})`
  if (typeof value === 'object') return depth > 0 ? 'object' : 'object'
  return `${typeof value} ${JSON.stringify(value).slice(0, 40)}`
}

function summarizeJson(value: unknown, depth = 0, out: string[] = [], prefix = ''): JsonSummary {
  if (out.length > 40) return { summary: out.join('\n') }
  if (Array.isArray(value)) {
    out.push(`${prefix}: array of ${value.length} item(s)`)
    if (value.length > 0 && depth < 2) summarizeJson(value[0], depth + 1, out, `${prefix}[0]`)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value).slice(0, 25)) {
      if (child && typeof child === 'object') {
        summarizeJson(child, depth + 1, out, prefix ? `${prefix}.${key}` : key)
      } else {
        out.push(`${prefix ? `${prefix}.` : ''}${key} = ${describeValue(child, depth)}`)
      }
    }
  }
  return { summary: out.join('\n') }
}

function parseCsv(text: string, limit = 5): { headers: string[]; total: number; sample: string[][] } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  const split = (line: string): string[] => line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''))
  return {
    headers: lines.length > 0 ? split(lines[0]) : [],
    total: Math.max(lines.length - 1, 0),
    sample: lines.slice(1, 1 + limit).map(split)
  }
}

const parseStructuredTool: ToolDef = {
  name: 'parse_structured',
  description:
    'Open a big JSON or CSV file in the workspace WITHOUT loading it all into the conversation: reports the structure (keys, array sizes, column names, row count) and a small sample of rows. Pass `query` to filter CSV rows by a substring.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace .json or .csv file' },
      query: { type: 'string', description: 'CSV: only sample rows containing this substring' }
    },
    required: ['path']
  },
  risk: 'read',
  execute: async (args) => {
    const absolute = resolveInWorkspace(argString(args, 'path'))
    if (basename(absolute).toLowerCase().endsWith('.json')) {
      const text = await fs.readFile(absolute, 'utf8')
      const value = JSON.parse(text)
      const { summary } = summarizeJson(value)
      return { ok: true, summary: `${relPath(absolute)} — JSON structure`, detail: truncate(summary) }
    }
    const csv = await fs.readFile(absolute, 'utf8')
    const query = argString(args, 'query', false).toLowerCase()
    const parsed = parseCsv(csv)
    const matching = query
      ? csv
          .split(/\r?\n/)
          .filter((line) => line.toLowerCase().includes(query))
          .slice(0, 5)
      : parsed.sample.map((row) => row.join(','))
    const detail = [
      `Columns (${parsed.headers.length}): ${parsed.headers.join(', ')}`,
      `Rows: ${parsed.total}`,
      `Sample:`,
      ...matching
    ].join('\n')
    return { ok: true, summary: `${relPath(absolute)} — CSV, ${parsed.total} rows`, detail: truncate(detail) }
  }
}

// --- DOCX / XLSX via the ZIP reader ------------------------------------------

function docxText(entries: { name: string; data: Buffer }[]): string {
  const doc = entries.find((entry) => entry.name === 'word/document.xml')
  if (!doc) return ''
  const xml = doc.data.toString('utf8')
  const paragraphs = xml.split(/<\/w:p>/).map((chunk) =>
    [...chunk.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => decodeXmlText(m[1])).join('')
  )
  return paragraphs.filter((line) => line.trim() !== '').join('\n')
}

function xlsxText(entries: { name: string; data: Buffer }[]): string {
  const sharedRaw = entries.find((entry) => entry.name === 'xl/sharedStrings.xml')
  const shared: string[] = []
  if (sharedRaw) {
    for (const match of sharedRaw.data.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push([...match[1].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => decodeXmlText(t[1])).join(''))
    }
  }
  const sheets = entries.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name)).slice(0, 5)
  const out: string[] = []
  for (const sheet of sheets) {
    const xml = sheet.data.toString('utf8')
    const rows: string[] = []
    for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [...rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)].map((cellMatch) => {
        const attrs = cellMatch[1]
        const inner = cellMatch[2]
        const value = /<v>([^<]*)<\/v>/.exec(inner)?.[1] ?? ''
        if (/t="s"/.test(attrs)) return shared[Number(value)] ?? ''
        return decodeXmlText(value)
      })
      if (cells.length > 0) rows.push(cells.join(' | '))
      if (rows.length >= 200) break
    }
    out.push(`### ${sheet.name}\n${rows.join('\n')}`)
  }
  return out.join('\n\n')
}

const readDocxTool: ToolDef = {
  name: 'read_docx',
  description: 'Read the text of a Word (.docx) file from the workspace: paragraphs, headings and table cells as plain text.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Workspace .docx file' } },
    required: ['path']
  },
  risk: 'read',
  execute: async (args) => {
    const absolute = resolveInWorkspace(argString(args, 'path'))
    const buffer = await fs.readFile(absolute)
    const text = docxText(readZip(buffer))
    if (text.trim() === '') return { ok: false, summary: 'no text found', detail: 'The file opened but contained no readable text.' }
    return { ok: true, summary: `${basename(absolute)} — ${text.length} chars`, detail: truncate(text, MAX_DOC_CHARS) }
  }
}

const readXlsxTool: ToolDef = {
  name: 'read_xlsx',
  description:
    'Read an Excel (.xlsx) file from the workspace as text: every sheet (up to 5) becomes a table with | separators, up to 200 rows each. Good for data questions ("how many rows", "which value is largest").',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Workspace .xlsx file' } },
    required: ['path']
  },
  risk: 'read',
  execute: async (args) => {
    const absolute = resolveInWorkspace(argString(args, 'path'))
    const buffer = await fs.readFile(absolute)
    const text = xlsxText(readZip(buffer))
    if (text.trim() === '') return { ok: false, summary: 'no data found', detail: 'The file opened but contained no readable sheets.' }
    return { ok: true, summary: `${basename(absolute)} — sheets read`, detail: truncate(text, MAX_DOC_CHARS) }
  }
}

const readPdfTool: ToolDef = {
  name: 'read_pdf',
  description:
    'Read the text layer of a PDF from the workspace (documentation, invoices, specs). Scanned PDFs contain pictures instead of text — the tool says so honestly when that happens.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Workspace .pdf file' } },
    required: ['path']
  },
  risk: 'read',
  execute: async (args) => {
    const absolute = resolveInWorkspace(argString(args, 'path'))
    const stat = await fs.stat(absolute)
    if (stat.size > MAX_DOC_BYTES) throw new ToolError(`File too large (${formatBytes(stat.size)}); the cap is ${formatBytes(MAX_DOC_BYTES)}`)
    const text = extractPdfText(await fs.readFile(absolute), MAX_DOC_CHARS)
    if (text === null) {
      return {
        ok: false,
        summary: 'no text layer found',
        detail: 'This PDF has no extractable text — it is probably a scan (pictures of pages). OCR is not available.'
      }
    }
    return { ok: true, summary: `${basename(absolute)} — ${text.length} chars`, detail: truncate(text, MAX_DOC_CHARS) }
  }
}

// --- download ------------------------------------------------------------------

const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024

const downloadFileTool: ToolDef = {
  name: 'download_file',
  description:
    'Download a file from a public http(s) URL into the workspace and report where it landed and its size. Use it for datasets, images and archives the task needs locally.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Direct http(s) link to the file' },
      path: { type: 'string', description: 'Workspace path to save as (default: the URL file name)' }
    },
    required: ['url']
  },
  risk: 'write',
  execute: async (args, ctx) => {
    const root = getWorkspaceRoot()
    if (!root) throw new ToolError(NO_WORKSPACE)
    const url = safeHttpUrl(argString(args, 'url'))
    if (!url) throw new ToolError('Only public http(s) URLs are allowed')
    const target = resolveInWorkspace(argString(args, 'path', false) || basename(new URL(url).pathname) || 'download')

    const response = await fetch(url, { signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(120000)]) })
    if (!response.ok) return { ok: false, summary: `HTTP ${response.status}`, detail: `Downloading ${url} failed.` }
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > MAX_DOWNLOAD_BYTES) {
      return { ok: false, summary: 'too large', detail: `The file is ${formatBytes(declared)}; the cap is ${formatBytes(MAX_DOWNLOAD_BYTES)}.` }
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > MAX_DOWNLOAD_BYTES) {
      return { ok: false, summary: 'too large', detail: `The file is ${formatBytes(buffer.length)}; the cap is ${formatBytes(MAX_DOWNLOAD_BYTES)}.` }
    }
    await fs.writeFile(target, buffer)
    return {
      ok: true,
      summary: `saved ${relPath(target)} (${formatBytes(buffer.length)})`,
      detail: `${url} → ${relPath(target)}\n${formatBytes(buffer.length)}, ${response.headers.get('content-type') ?? 'unknown type'}`
    }
  }
}

// --- database ------------------------------------------------------------------

const SELECT_ONLY = /^\s*(select|with|explain|pragma)\b/i

const dbQueryTool: ToolDef = {
  name: 'db_query',
  description:
    'Run a SQL query against a database using the DRIVER THE PROJECT ITSELF has installed (better-sqlite3 for a .db file, pg for PostgreSQL). SELECT/WITH/EXPLAIN only — it never writes. If the driver is missing, install it first with install_package (better-sqlite3 for sqlite, pg for postgres) and tell the user.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The SQL query (read-only)' },
      sqlite_path: { type: 'string', description: 'SQLite: workspace path of the .db/.sqlite file' },
      postgres_url: { type: 'string', description: 'Postgres: connection string (postgres://…)' },
      limit: { type: 'number', description: 'Max rows to return (default 20, max 100)' }
    },
    required: ['query']
  },
  risk: 'exec',
  execute: async (args) => {
    const query = argString(args, 'query')
    if (!SELECT_ONLY.test(query)) {
      throw new ToolError('Only SELECT / WITH / EXPLAIN / PRAGMA queries are allowed.')
    }
    const limit = Math.min(Math.max(args.limit && typeof args.limit === 'number' ? args.limit : 20, 1), 100)
    const root = getWorkspaceRoot()
    if (!root) throw new ToolError(NO_WORKSPACE)

    const sqlitePath = argString(args, 'sqlite_path', false)
    const postgresUrl = argString(args, 'postgres_url', false)
    const projectRequire = createRequire(join(root, 'package.json'))

    if (sqlitePath) {
      const absolute = resolveInWorkspace(sqlitePath)
      let Database: new (path: string) => { prepare: (sql: string) => { all: (...p: unknown[]) => unknown[] } }
      try {
        Database = projectRequire('better-sqlite3')
      } catch {
        return {
          ok: false,
          summary: 'better-sqlite3 is not installed',
          detail: 'Install it into the project first (install_package with ["better-sqlite3"]), or read the sqlite file with another tool.'
        }
      }
      const db = new Database(absolute)
      try {
        const rows = db.prepare(`select * from (${query.replace(/;\s*$/, '')}) limit ${limit}`).all()
        return { ok: true, summary: `${rows.length} row(s)`, detail: truncate(JSON.stringify(rows, null, 2)) }
      } finally {
        void (db as unknown as { close?: () => void }).close?.()
      }
    }

    if (postgresUrl) {
      let pg: { Client: new (config: string) => { connect: () => Promise<void>; query: (sql: string) => Promise<{ rows: unknown[] }>; end: () => Promise<void> } }
      try {
        pg = projectRequire('pg')
      } catch {
        return { ok: false, summary: 'pg is not installed', detail: 'Install the pg package into the project first (install_package with ["pg"]).' }
      }
      const client = new pg.Client(postgresUrl)
      await client.connect()
      try {
        const result = await client.query(`select * from (${query.replace(/;\s*$/, '')}) limit ${limit}`)
        return { ok: true, summary: `${result.rows.length} row(s)`, detail: truncate(JSON.stringify(result.rows, null, 2)) }
      } finally {
        await client.end().catch(() => undefined)
      }
    }

    throw new ToolError('Pass sqlite_path or postgres_url (one of them).')
  }
}

export const DATA_TOOLS: ToolDef[] = [
  parseStructuredTool,
  readDocxTool,
  readXlsxTool,
  readPdfTool,
  downloadFileTool,
  dbQueryTool
]
