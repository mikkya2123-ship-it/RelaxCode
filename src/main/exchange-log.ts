import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatEvent, ChatSendRequest, TodoItem } from '@shared/ipc'

/**
 * A post-mortem of one chat exchange: what the user asked, which tools ran,
 * what they answered, what the engine warned about and what the model finally
 * said. Written to the user-data folder when the run finishes, so a wrong or
 * empty answer can be explained afterwards instead of retold by hand.
 */

/** How many past reports stay on disk; the oldest are dropped. */
const MAX_REPORTS = 40
const ARGS_LIMIT = 2000
const DETAIL_LIMIT = 6000
const ANSWER_LIMIT = 24000
const SVG_LIMIT = 80000
const PROMPT_LIMIT = 60000

interface ToolStep {
  callId: string
  step: number
  name: string
  args: string
  ok: boolean | null
  summary: string
  detail: string
  warnings: string[]
  figure?: {
    title?: string
    caption?: string
    results: Array<{ label: string; value: string; formula?: string }>
    svg: string
  }
  metaKind?: string
}

interface Usage {
  promptTokens: number
  completionTokens: number
  steps: number
  reasoningTokens?: number
  contextTokens?: number
  saved?: { messages: number; chars: number }
}

export interface ExchangeLog {
  record: (event: ChatEvent) => void
  setTarget: (info: { model: string; provider: string; baseUrl: string }) => void
  setSystemPrompt: (prompt: string) => void
}

function clip(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n… [ещё ${value.length - limit} символов]`
}

/** Base64 images would swamp the report; their payload is not the point. */
function stripDataUrls(value: string): string {
  return value.replace(/data:[^;"'\s]+;base64,[A-Za-z0-9+/=]+/g, (match) => {
    const head = match.slice(0, match.indexOf(','))
    return `${head},[${match.length - head.length - 1} символов base64]`
  })
}

function prettyArgs(raw: string): string {
  const text = raw.trim()
  if (text.length === 0) return '(пусто)'
  try {
    return clip(stripDataUrls(JSON.stringify(JSON.parse(text), null, 1)), ARGS_LIMIT)
  } catch {
    return clip(stripDataUrls(text), ARGS_LIMIT)
  }
}

function describeNotice(event: Extract<ChatEvent, { type: 'notice' }>): string {
  switch (event.kind) {
    case 'no-tool-calls':
      return 'Ответ звучал как отчёт о работе, но ни один инструмент не запускался (подозрение на выдумку).'
    case 'unverified-result':
      return 'Последний инструмент завершился ошибкой, а ответ сообщил об успехе.'
    case 'no-answer':
      return `Модель не написала ответ (${event.reason === 'step-limit' ? 'кончился лимит шагов' : 'пустой шаг'}, шагов ${event.steps}).`
    case 'text-call-fallback':
      return `Модель вызвала инструмент текстом вместо функции: ${event.tools.join(', ')}.`
    case 'param-dropped':
      return `Провайдер отверг параметр «${event.param}», запрос повторён без него.`
    case 'rate-limit-retry':
      return `Ограничение частоты (429): повтор ${event.attempt}/${event.maxAttempts} через ${event.seconds} с.`
    case 'server-retry':
      return `Ошибка сервера: повтор ${event.attempt}/${event.maxAttempts} через ${event.seconds} с.`
    default:
      return `Служебное сообщение: ${JSON.stringify(event)}`
  }
}

function figureFromMeta(meta: unknown): ToolStep['figure'] {
  const value = meta as
    | {
        kind?: string
        title?: string
        caption?: string
        svg?: string
        results?: Array<{ label?: string; value?: string; formula?: string }>
      }
    | undefined
  if (!value || value.kind !== 'figure') return undefined
  return {
    ...(value.title ? { title: value.title } : {}),
    ...(value.caption ? { caption: value.caption } : {}),
    svg: clip(value.svg ?? '', SVG_LIMIT),
    results: (value.results ?? [])
      .filter((item): item is { label: string; value: string; formula?: string } =>
        typeof item.label === 'string' && typeof item.value === 'string'
      )
      .map((item) => ({
        label: item.label,
        value: item.value,
        ...(item.formula ? { formula: item.formula } : {})
      }))
  }
}

function metaKind(meta: unknown): string | undefined {
  const kind = (meta as { kind?: unknown } | undefined)?.kind
  return typeof kind === 'string' ? kind : undefined
}

function stepHeading(index: number, step: ToolStep): string {
  const status = step.ok === null ? 'без результата' : step.ok ? 'ok' : 'ошибка'
  return `### ${index + 1}. ${step.name} — ${status}`
}

function toMarkdown(report: Report): string {
  const lines: string[] = []
  const when = new Date(report.startedAt)
  lines.push(`# Обмен ${when.toLocaleString('ru-RU')} — ${report.mode}`)
  lines.push('')
  lines.push(`- **Модель:** ${report.provider} / ${report.model}`)
  lines.push(`- **База:** ${report.baseUrl}`)
  lines.push(
    `- **Итог:** ${report.error ? `ошибка — ${report.error}` : 'завершён'} · шагов ${report.usage?.steps ?? '?'}` +
      ` · инструментов ${report.summary.toolCalls} (ошибок ${report.summary.failed})` +
      (report.usage
        ? ` · токены запрос ${report.usage.promptTokens} / ответ ${report.usage.completionTokens}`
        : '') +
      ` · ${(report.durationMs / 1000).toFixed(1)} с`
  )
  lines.push(`- **История:** ${report.historyMessages} сообщ. · в ответе ${report.answer.length} символов`)
  lines.push('')
  lines.push('## Запрос пользователя')
  lines.push('')
  lines.push(report.user.trim() ? report.user.trim() : '(пустой запрос)')
  lines.push('')
  lines.push('## Инструменты')
  lines.push('')
  if (report.steps.length === 0) lines.push('(ни один инструмент не вызывался)')
  report.steps.forEach((step, index) => {
    lines.push(stepHeading(index, step))
    lines.push('')
    lines.push('```json')
    lines.push(step.args)
    lines.push('```')
    lines.push('')
    if (step.summary) lines.push(`Вывод: ${step.summary}`)
    if (step.detail.trim()) {
      lines.push('')
      lines.push('```')
      lines.push(step.detail.trim())
      lines.push('```')
    }
    if (step.figure) {
      lines.push('')
      const title = step.figure.title ? `«${step.figure.title}»` : 'без заголовка'
      lines.push(
        `Чертёж ${title}: ` +
          (step.figure.results.length > 0
            ? step.figure.results.map((item) => `${item.label} = ${item.value}`).join(', ')
            : 'значений нет')
      )
    }
    if (step.warnings.length > 0) {
      lines.push('')
      step.warnings.forEach((warning) => lines.push(`- ⚠ ${warning}`))
    }
    lines.push('')
  })
  if (report.notices.length > 0) {
    lines.push('## Замечания механизма')
    lines.push('')
    report.notices.forEach((notice) => lines.push(`- ${notice}`))
    lines.push('')
  }
  if (report.approvals.length > 0) {
    lines.push('## Запросы подтверждения')
    lines.push('')
    report.approvals.forEach((entry) => lines.push(`- ${entry}`))
    lines.push('')
  }
  lines.push('## Ответ модели')
  lines.push('')
  lines.push(report.answer.trim() ? report.answer.trim() : '(модель не написала текст)')
  lines.push('')
  if (report.todos.length > 0) {
    lines.push('## План (todo)')
    lines.push('')
    report.todos.forEach((todo) => lines.push(`- [${todo.status}] ${todo.content}`))
    lines.push('')
  }
  return lines.join('\n')
}

interface Report {
  startedAt: number
  durationMs: number
  requestId: string
  mode: string
  model: string
  provider: string
  baseUrl: string
  user: string
  historyMessages: number
  systemPrompt: string
  steps: ToolStep[]
  notices: string[]
  approvals: string[]
  todos: TodoItem[]
  answer: string
  reasoningChars: number
  usage: Usage | null
  error: string | null
  summary: { toolCalls: number; ok: number; failed: number; pending: number }
}

export function createExchangeLog(request: ChatSendRequest, dir: string): ExchangeLog {
  const startedAt = Date.now()
  const steps: ToolStep[] = []
  const byCall = new Map<string, ToolStep>()
  const notices: string[] = []
  const approvals: string[] = []
  const answerChunks: string[] = []
  const todos: TodoItem[] = []
  let answerLength = 0
  let reasoningChars = 0
  let systemPrompt = ''
  let target = { model: '(неизвестно)', provider: '(неизвестно)', baseUrl: '' }
  let usage: Usage | null = null
  let error: string | null = null
  let finished = false

  const history = request.messages ?? []
  const user = [...history].reverse().find((message) => message.role === 'user')?.content ?? ''

  const write = (): void => {
    const report: Report = {
      startedAt,
      durationMs: Date.now() - startedAt,
      requestId: request.requestId,
      mode: request.mode,
      model: target.model,
      provider: target.provider,
      baseUrl: target.baseUrl,
      user,
      historyMessages: history.length,
      systemPrompt: clip(systemPrompt, PROMPT_LIMIT),
      steps,
      notices,
      approvals,
      todos,
      answer: clip(answerChunks.join(''), ANSWER_LIMIT),
      reasoningChars,
      usage,
      error,
      summary: {
        toolCalls: steps.length,
        ok: steps.filter((step) => step.ok === true).length,
        failed: steps.filter((step) => step.ok === false).length,
        pending: steps.filter((step) => step.ok === null).length
      }
    }
    mkdirSync(dir, { recursive: true })
    const stamp = new Date(startedAt)
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19)
    const base = `${stamp}-${request.requestId.slice(0, 8)}`
    writeFileSync(join(dir, `${base}.json`), JSON.stringify(report, null, 1), 'utf8')
    const markdown = toMarkdown(report)
    writeFileSync(join(dir, `${base}.md`), markdown, 'utf8')
    writeFileSync(join(dir, 'latest.md'), markdown, 'utf8')
    writeFileSync(join(dir, 'latest.json'), JSON.stringify(report, null, 1), 'utf8')
    // Keep the folder bounded: the twenty newest exchanges are enough to look back at.
    try {
      const jsonFiles = readdirSync(dir)
        .filter((name) => name.endsWith('.json') && name !== 'latest.json')
        .sort()
        .reverse()
      for (const stale of jsonFiles.slice(MAX_REPORTS)) {
        rmSync(join(dir, stale), { force: true })
        rmSync(join(dir, stale.replace(/\.json$/, '.md')), { force: true })
      }
    } catch {
      // Cleanup is best-effort; the report itself is already written.
    }
  }

  const finish = (): void => {
    if (finished) return
    finished = true
    try {
      write()
    } catch {
      // Never let bookkeeping break the chat.
    }
  }

  return {
    setTarget: (info) => {
      target = info
    },
    setSystemPrompt: (prompt) => {
      systemPrompt = prompt
    },
    record: (event) => {
      switch (event.type) {
        case 'delta':
          answerChunks.push(event.text)
          answerLength += event.text.length
          if (answerLength > ANSWER_LIMIT * 2) {
            answerChunks.splice(0, Math.max(1, answerChunks.length - 64))
          }
          break
        case 'reasoning':
          reasoningChars += event.text.length
          break
        case 'tool-start': {
          const step: ToolStep = {
            callId: event.callId,
            step: event.step,
            name: event.name,
            args: prettyArgs(event.args),
            ok: null,
            summary: '',
            detail: '',
            warnings: []
          }
          steps.push(step)
          byCall.set(event.callId, step)
          break
        }
        case 'tool-result': {
          const step = byCall.get(event.callId)
          if (!step) break
          step.ok = event.ok
          step.summary = event.summary
          step.detail = clip(stripDataUrls(event.detail), DETAIL_LIMIT)
          const kind = metaKind(event.meta)
          if (kind) step.metaKind = kind
          const figure = figureFromMeta(event.meta)
          if (figure) step.figure = figure
          const warnings = (event.meta as { warnings?: unknown } | undefined)?.warnings
          if (Array.isArray(warnings)) {
            step.warnings = warnings.filter((entry): entry is string => typeof entry === 'string')
          }
          break
        }
        case 'tool-approval':
          approvals.push(
            `${event.request.toolName} (${event.request.risk}): ${clip(event.request.preview, 300)}`
          )
          break
        case 'notice':
          notices.push(describeNotice(event))
          break
        case 'todos':
          todos.splice(0, todos.length, ...event.todos)
          break
        case 'done':
          usage = {
            promptTokens: event.promptTokens,
            completionTokens: event.completionTokens,
            steps: event.steps,
            ...(event.reasoningTokens !== undefined ? { reasoningTokens: event.reasoningTokens } : {}),
            ...(event.contextTokens !== undefined ? { contextTokens: event.contextTokens } : {}),
            ...(event.saved ? { saved: event.saved } : {})
          }
          finish()
          break
        case 'error':
          error = event.message
          finish()
          break
        default:
          break
      }
    }
  }
}
