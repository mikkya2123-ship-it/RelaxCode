#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { computeOverview, computeToolStats } from './analyze.mjs'
import { buildAiBrief } from './brief.mjs'
import { loadConfig } from './config.mjs'
import { DATA_DIR } from './paths.mjs'
import { Store } from './store.mjs'

/**
 * MCP over stdio. No dependency on the dashboard process: every call reads the
 * state file, so an agent can inspect what happened even when Snitch's server is
 * stopped (the data is at most one flush behind).
 */

const VERSION = '0.1.0'
const PROTOCOL = '2024-11-05'
const TEXT_LIMIT = 60_000

const HOURS = {
  type: 'number',
  description: 'Окно в часах (по умолчанию 24)',
  minimum: 1,
  maximum: 720
}

const TOOLS = [
  {
    name: 'snitch_brief',
    description:
      'ГЛАВНЫЙ инструмент. Подробный Markdown-отчёт о том, что происходило в IDE: инциденты, упавшие запуски, шаги, команды, ошибки, таймауты, тайминги и подсказки. Прочитай его ПЕРЕД тем, как спрашивать пользователя о проблеме. Read-only.',
    inputSchema: { type: 'object', properties: { hours: HOURS } }
  },
  {
    name: 'snitch_overview',
    description:
      'Сводка за окно: количество запусков, ошибок, инцидентов, вызовов инструментов, тайминги, токены, здоровье инструментов, последние запуски. Начни с этого, если нужен общий контекст.',
    inputSchema: { type: 'object', properties: { hours: HOURS } }
  },
  {
    name: 'snitch_incidents',
    description:
      'Список автоматически найденных проблем: ошибки запусков, rate-limit, таймауты, зависшие шаги, упавшие команды, MCP, ошибки окна, сетевые сбои. У каждого инцидента есть severity, detail, hint и runId.',
    inputSchema: {
      type: 'object',
      properties: {
        severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
        kind: { type: 'string', description: 'Тип инцидента, например tool-timeout или run-error' },
        runId: { type: 'string' },
        hours: HOURS,
        limit: { type: 'number', minimum: 1, maximum: 200 }
      }
    }
  },
  {
    name: 'snitch_runs',
    description:
      'Список запусков агента: id, запрос, статус, модель, длительность, число шагов/файлов/команд, ошибка. Фильтры: status=ok|error|incomplete|running|live, query по тексту.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        query: { type: 'string' },
        hours: HOURS,
        limit: { type: 'number', minimum: 1, maximum: 200 }
      }
    }
  },
  {
    name: 'snitch_run',
    description:
      'Полная детализация одного запуска: каждый шаг с аргументами, результатом, ошибкой и длительностью; все файлы, команды с хвостом вывода, уведомления, согласования, usage, incident-ы. Используй после snitch_runs/incidents, чтобы увидеть причину.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Полный id или уникальный префикс' } },
      required: ['id']
    }
  },
  {
    name: 'snitch_events',
    description:
      'Хронологический поток событий: старт/конец шагов, файлы, команды, предупреждения, ошибки, MCP, сеть, консоль. Фильтры по kind, level, runId и тексту.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        level: { type: 'string', enum: ['success', 'info', 'warning', 'error'] },
        runId: { type: 'string' },
        query: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 500 }
      }
    }
  },
  {
    name: 'snitch_tools',
    description:
      'Здоровье инструментов за окно: вызовы, ошибки, таймауты, success rate, медиана и p95, частые ошибки. Помогает понять, какой инструмент ломается.',
    inputSchema: { type: 'object', properties: { hours: HOURS } }
  },
  {
    name: 'snitch_search',
    description:
      'Поиск по текстам запросов/ответов/ошибок запусков и по инцидентам. Например: имя файла, текст ошибки, команда, модель.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 100 }
      },
      required: ['query']
    }
  },
  {
    name: 'snitch_scan',
    description:
      'Попросить запущенную панель Snitch перечитать отчёты обменов, лог и кадры прямо сейчас (полезно после завершения запуска). Если панель не запущена — вернёт пояснение. Не меняет код проекта.',
    inputSchema: { type: 'object' }
  }
]

function clampText(text) {
  if (text.length <= TEXT_LIMIT) return text
  return `${text.slice(0, TEXT_LIMIT)}\n\n… отчёт обрезан (${text.length} символов). Запроси snitch_run для конкретного запуска.`
}

async function loadStore() {
  return new Store(DATA_DIR).load()
}

function hoursSince(hours) {
  return Date.now() - Math.max(1, Math.min(720, Number(hours) || 24)) * 3_600_000
}

function slimRun(run) {
  return {
    id: run.id,
    status: run.status,
    live: run.live === true,
    startedAt: run.startedAt,
    durationMs: run.durationMs,
    mode: run.mode,
    model: run.model,
    provider: run.provider,
    user: run.user,
    error: run.error,
    steps: run.steps?.length ?? 0,
    failedSteps: (run.steps ?? []).filter((step) => step.ok === false).length,
    files: run.files?.length ?? 0,
    commands: run.commands?.length ?? 0,
    archiveFile: run.archiveFile ?? null
  }
}

async function callTool(name, args) {
  const store = await loadStore()
  switch (name) {
    case 'snitch_brief': {
      return buildAiBrief(store, { hours: args.hours })
    }
    case 'snitch_overview': {
      const overview = computeOverview(store, { hours: args.hours })
      return JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          sources: overview.sources,
          probe: overview.probe,
          live: overview.live,
          counts: overview.counts,
          timing: overview.timing,
          usage: overview.usage,
          activity: overview.activity,
          toolHealth: overview.toolHealth,
          topIncidents: overview.topIncidents,
          topFailures: overview.topFailures,
          recentRuns: overview.recentRuns,
          models: overview.models
        },
        null,
        2
      )
    }
    case 'snitch_incidents': {
      const incidents = store.incidents({
        severity: args.severity || null,
        kind: args.kind || null,
        runId: args.runId || null,
        since: hoursSince(args.hours),
        limit: Math.min(Number(args.limit) || 50, 200)
      })
      return JSON.stringify({ total: incidents.length, incidents }, null, 2)
    }
    case 'snitch_runs': {
      const query = String(args.query ?? '').toLowerCase()
      let runs = store.listRuns().filter((run) => (run.startedAt ?? 0) >= hoursSince(args.hours))
      if (args.status === 'live') runs = runs.filter((run) => run.live)
      else if (args.status) runs = runs.filter((run) => run.status === args.status)
      if (query) {
        runs = runs.filter((run) =>
          `${run.user ?? ''} ${run.answer ?? ''} ${run.error ?? ''} ${run.model ?? ''}`
            .toLowerCase()
            .includes(query)
        )
      }
      return JSON.stringify(
        {
          total: runs.length,
          runs: runs.slice(0, Math.min(Number(args.limit) || 30, 200)).map(slimRun)
        },
        null,
        2
      )
    }
    case 'snitch_run': {
      const id = String(args.id ?? '')
      const run =
        store.getRun(id) ??
        store.listRuns().find((item) => item.requestId === id) ??
        store.listRuns().find((item) => String(item.id).startsWith(id))
      if (!run) throw new Error(`Запуск не найден: ${id}`)
      const incidents = store.incidents({ runId: run.id, limit: 100 })
      return clampText(JSON.stringify({ run, incidents }, null, 2))
    }
    case 'snitch_events': {
      const events = store.events({
        kind: args.kind || null,
        level: args.level || null,
        runId: args.runId || null,
        query: args.query || '',
        limit: Math.min(Number(args.limit) || 100, 500)
      })
      return JSON.stringify({ total: store.state.events.length, events }, null, 2)
    }
    case 'snitch_tools': {
      const runs = store
        .listRuns()
        .filter((run) => (run.startedAt ?? 0) >= hoursSince(args.hours))
      return JSON.stringify({ tools: computeToolStats(runs) }, null, 2)
    }
    case 'snitch_search': {
      return JSON.stringify(store.search(String(args.query ?? ''), Math.min(Number(args.limit) || 30, 100)), null, 2)
    }
    case 'snitch_scan': {
      const config = await loadConfig()
      const base = `http://${config.host}:${config.port}`
      try {
        const response = await fetch(`${base}/api/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(20_000)
        })
        if (!response.ok) {
          const body = await response.text()
          throw new Error(`панель ответила ${response.status}: ${body.slice(0, 300)}`)
        }
        const result = await response.json()
        return JSON.stringify({ ok: true, summary: result.summary }, null, 2)
      } catch (error) {
        throw new Error(
          `Панель Snitch не отвечает на ${base} (${error.message}). Запустите: node src/cli.mjs serve`
        )
      }
    }
    default:
      throw new Error(`Неизвестный инструмент: ${name}`)
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handleMessage(message) {
  if (!message || typeof message !== 'object') return
  if (message.id == null && message.method) return // notification
  const id = message.id ?? null
  const method = message.method
  try {
    if (method === 'initialize') {
      reply(id, {
        protocolVersion: message.params?.protocolVersion ?? PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'snitch', version: VERSION },
        instructions:
          'Snitch хранит историю запусков RelaxCode: запросы, шаги, файлы, команды, ошибки, таймауты. Начинайте с snitch_brief, чтобы понять проблему без расспросов пользователя.'
      })
      return
    }
    if (method === 'ping') {
      reply(id, {})
      return
    }
    if (method === 'tools/list') {
      reply(id, { tools: TOOLS })
      return
    }
    if (method === 'tools/call') {
      const name = message.params?.name
      const args = message.params?.arguments ?? {}
      try {
        const text = await callTool(name, args)
        reply(id, { content: [{ type: 'text', text: clampText(String(text ?? '')) }] })
      } catch (error) {
        reply(id, {
          content: [{ type: 'text', text: `Ошибка Snitch: ${error.message}` }],
          isError: true
        })
      }
      return
    }
    if (method === 'resources/list') {
      reply(id, {
        resources: [
          {
            uri: 'snitch://brief',
            name: 'Snitch brief',
            description: 'Подробный отчёт о проблемах IDE',
            mimeType: 'text/markdown'
          },
          {
            uri: 'snitch://state',
            name: 'Snitch state',
            description: 'Полное состояние хранилища',
            mimeType: 'application/json'
          }
        ]
      })
      return
    }
    if (method === 'resources/read') {
      const uri = message.params?.uri
      const store = await loadStore()
      if (uri === 'snitch://brief') {
        reply(id, {
          contents: [{ uri, mimeType: 'text/markdown', text: buildAiBrief(store, { hours: 24 }) }]
        })
        return
      }
      if (uri === 'snitch://state') {
        reply(id, {
          contents: [
            { uri, mimeType: 'application/json', text: clampText(JSON.stringify(store.state, null, 1)) }
          ]
        })
        return
      }
      replyError(id, -32602, `Неизвестный ресурс: ${uri}`)
      return
    }
    replyError(id, -32601, `Метод не поддерживается: ${method}`)
  } catch (error) {
    replyError(id, -32603, error.message)
  }
}

export async function runMcpServer() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  rl.on('line', (line) => {
    const text = line.trim()
    if (!text) return
    let message = null
    try {
      message = JSON.parse(text)
    } catch {
      replyError(null, -32700, 'Некорректный JSON')
      return
    }
    void handleMessage(message)
  })
  rl.on('close', () => process.exit(0))
  await new Promise(() => {})
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMcpServer().catch((error) => {
    console.error(`[snitch-mcp] ${error.stack ?? error.message}`)
    process.exit(1)
  })
}
