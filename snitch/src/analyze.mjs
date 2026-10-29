import { hash, percentile, truncate } from './util.mjs'

export const SEVERITY_ORDER = { critical: 3, warning: 2, info: 1 }

const TIMEOUT_RE = /\btimed?\s?-?out\b|\btimeout\b|тайм-?аут|превышено время/i
const MCP_NOT_READY_RE = /is not ready|not connected|transport closed|server .* (restarting|error)|MCP server .* (failed|closed)/i
const NETWORK_RE = /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket hang up|network error|UND_ERR/i
const CLAIMS_SUCCESS_RE =
  /(✅|готово|запущен|работает|успешн|выполнен|завершен|теперь можно|\bdone\b|\bworks\b|\bworking\b|\brunning\b|\bcompleted\b|\bsuccess)/i

const HINTS = {
  'run-error': 'Прочитайте error и последние шаги запуска. Если это сеть или провайдер — проверьте Base URL, ключ и статус модели; если инструмент — откройте его detail.',
  'rate-limit': 'Провайдер вернул 429. Смените модель или провайдера, уменьшите частоту запросов; у free-моделей лимиты жёстче.',
  'provider-error': 'Ошибка на стороне провайдера. Повторите позже или переключитесь на другую модель; проверьте баланс и лимиты ключа.',
  'auth-error': 'Проверьте API-ключ и Base URL выбранного провайдера: 401/403 означают, что ключ не принят.',
  'network-error': 'Запрос не дошёл до сервера. Проверьте интернет, прокси, DNS и адрес API.',
  'key-unreadable': 'Сохранённый ключ не расшифровывается на этой машине. Введите ключ заново в настройках провайдера.',
  'no-model': 'Модель не выбрана. Откройте настройки подключения и выберите модель с поддержкой tools.',
  'tool-failed': 'Откройте шаг и прочитайте detail. Для файловых ошибок проверьте путь и права; для MCP — статус сервера и его stderr.',
  'tool-timeout': 'Инструмент не уложился в таймаут. Для серверов используйте start_server, для долгих установок увеличьте timeout_ms; для MCP проверьте, не занято ли приложение.',
  'command-failed': 'Команда завершилась с ненулевым кодом. Прочитайте хвост вывода: чаще всего не хватает зависимости, неверный путь или не запущен сервис.',
  'command-timeout': 'Команда всё ещё работала на момент таймаута. Не запускайте долгоживущие процессы через run_command — для них есть start_server.',
  'step-no-result': 'У шага нет результата: вызов оборвался. Проверьте, не закрылось ли приложение, не упал ли MCP-сервер и не был ли запуск прерван.',
  'step-hung': 'Шаг висит дольше ожидаемого. Проверьте процесс инструмента (MCP, сервер, shell) и при необходимости остановите его.',
  'run-stalled': 'Запуск не подаёт событий. Вероятно, завис запрос к провайдеру или инструменту; проверьте сеть и таймауты, при необходимости нажмите «Стоп».',
  'no-answer': 'Модель не написала финальный ответ. Проверьте лимит шагов, зацикливание reasoning и поддержку tools выбранной моделью.',
  'empty-answer': 'Запуск завершился без текста ответа. Возможно, модель вернула пустой шаг; попробуйте другую модель или повторите запрос.',
  'thinking-loop': 'Модель зациклилась в рассуждении. Понизьте уровень размышлений или смените модель; приложение уже снижает его автоматически.',
  'text-call-fallback': 'Модель вызвала инструмент текстом. Это признак слабого tool-calling; рассмотрите модель с поддержкой functions.',
  'fabricated-work': 'Агент заявил о работе, но ни один инструмент не запускался. Проверьте режим (chat вместо agent) и вызовы модели.',
  'unverified-result': 'Инструмент упал, а ответ сообщает об успехе. Перепроверьте результат вручную или повторите запуск.',
  'param-dropped': 'Провайдер отверг параметр запроса; приложение повторило запрос без него. Это не ошибка, но объясняет отличия поведения.',
  'image-dropped': 'Модель не принимает изображения; картинки вырезаны из запроса. Выберите vision-модель, если они нужны.',
  'night-limit': 'Ночной автопилот остановился по лимиту шагов, токенов или времени. Увеличьте лимиты в настройках, если задача не успела.',
  'context-pressure': 'Контекст близок к пределу модели. Включите экономию токенов, начните новый чат или сократите историю.',
  'high-cost': 'Запуск потратил много токенов. Проверьте, не зациклился ли агент, и включите экономию токенов.',
  'file-thrash': 'Один файл переписывался много раз за запуск. Похоже на цикл правок; проверьте шаги и итоговый diff.',
  'repeated-failure': 'Одинаковый вызов несколько раз завершился ошибкой. Агент не должен повторять его без изменений; проверьте причину в detail.',
  'log-error': 'В логе приложения есть ошибка. Откройте строку и контекст: это может быть сбой main-процесса или MCP.',
  'renderer-error': 'Ошибка в окне приложения. Откройте стек и повторите действие; если повторяется — это баг UI.',
  'network-request': 'Сетевой запрос из окна завершился ошибкой. Проверьте URL, CORS и доступность dev-сервера.',
  'mcp-unavailable': 'MCP-сервер недоступен. Проверьте, запущено ли приложение, и посмотрите его stderr в настройках MCP.',
  'slow-tool': 'Инструмент работает долго. Это может быть нормально для сборки или рендера; сравните с обычным временем.',
  'slow-run': 'Запуск длится долго. Проверьте, нет ли зависшего шага или ожидания подтверждения.',
  'run-snapshot': 'Перед изменениями снят снапшот проекта — к нему можно откатиться из чата.',
  'probe-lost': 'Живой зонд отключился. Перезапустите IDE с RELAXCODE_DEBUG_PORT=9333 и выполните snitch attach, либо работайте в файловом режиме.'
}

export function hintFor(kind) {
  return HINTS[kind] ?? 'Откройте запуск и шаг, затем прочитайте detail и повторите проблемное действие.'
}

export function makeIncident({
  kind,
  severity,
  title,
  detail = '',
  runId = null,
  stepIndex = null,
  at = Date.now(),
  evidence = [],
  fingerprintExtra = ''
}) {
  const fingerprint = `${kind}|${runId ?? 'global'}|${stepIndex ?? ''}|${hash(
    `${title}|${detail}|${fingerprintExtra}`,
    10
  )}`
  return {
    kind,
    severity,
    title,
    detail: truncate(detail, 1200),
    hint: hintFor(kind),
    runId,
    stepIndex,
    at,
    evidence: evidence.slice(0, 8).map((item) => truncate(item, 300)),
    fingerprint
  }
}

export function classifyNotice(notice) {
  const text = String(notice?.text ?? notice ?? '')
  const kind = notice?.kind ?? null
  const byKind = kind ? `notice-${kind}` : ''
  if (kind) {
    const map = {
      'rate-limit-retry': ['rate-limit', 'warning'],
      'server-retry': ['provider-error', 'warning'],
      'no-answer': ['no-answer', 'warning'],
      'thinking-loop': ['thinking-loop', 'warning'],
      'thinking-lowered': ['param-dropped', 'info'],
      'param-dropped': ['param-dropped', 'info'],
      'text-call-fallback': ['text-call-fallback', 'warning'],
      'no-tool-calls': ['fabricated-work', 'critical'],
      'unverified-result': ['unverified-result', 'critical'],
      'image-dropped': ['image-dropped', 'info'],
      'night-limit': ['night-limit', 'warning']
    }
    if (map[kind]) return { kind: map[kind][0], severity: map[kind][1] }
  }
  if (/Ограничение частоты|429|rate.?limit/i.test(text)) return { kind: 'rate-limit', severity: 'warning' }
  if (/Ошибка сервера|server.?retry|5\d\d/i.test(text)) return { kind: 'provider-error', severity: 'warning' }
  if (/не написала ответ|no answer|пустой шаг|лимит шагов/i.test(text)) return { kind: 'no-answer', severity: 'warning' }
  if (/зациклил|thinking.?loop/i.test(text)) return { kind: 'thinking-loop', severity: 'warning' }
  if (/отверг параметр|param.?dropped/i.test(text)) return { kind: 'param-dropped', severity: 'info' }
  if (/вызвала инструмент текстом|text.?call/i.test(text)) return { kind: 'text-call-fallback', severity: 'warning' }
  if (/ни один инструмент не запускался|no.?tool/i.test(text)) return { kind: 'fabricated-work', severity: 'critical' }
  if (/сообщил об успехе|unverified/i.test(text)) return { kind: 'unverified-result', severity: 'critical' }
  if (/изображен|картин|image/i.test(text)) return { kind: 'image-dropped', severity: 'info' }
  if (/ночн|night/i.test(text)) return { kind: 'night-limit', severity: 'warning' }
  if (/повтор|retry/i.test(text)) return { kind: 'provider-error', severity: 'warning' }
  return { kind: byKind || 'notice', severity: 'info' }
}

export function classifyError(message) {
  const text = String(message ?? '')
  if (/rate.?limited|HTTP 429/i.test(text)) return { kind: 'rate-limit', severity: 'critical' }
  if (/key-unreadable/i.test(text)) return { kind: 'key-unreadable', severity: 'critical' }
  if (/no-model/i.test(text)) return { kind: 'no-model', severity: 'critical' }
  if (/HTTP 401|HTTP 403|unauthor|forbidden/i.test(text)) return { kind: 'auth-error', severity: 'critical' }
  if (/HTTP 5\d\d|overloaded|upstream|provider returned/i.test(text)) {
    return { kind: 'provider-error', severity: 'critical' }
  }
  if (/^net:|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket hang up/i.test(text)) {
    return { kind: 'network-error', severity: 'critical' }
  }
  if (/context.{0,3}(length|window)|maximum context|too many tokens/i.test(text)) {
    return { kind: 'context-pressure', severity: 'critical' }
  }
  return { kind: 'run-error', severity: 'critical' }
}

function stepDetail(step) {
  return `${step.summary ?? ''}\n${step.detail ?? ''}`.slice(0, 4000)
}

function isTimeout(step) {
  return TIMEOUT_RE.test(stepDetail(step))
}

function isMcpUnavailable(step) {
  return step.name?.startsWith('mcp__') && MCP_NOT_READY_RE.test(stepDetail(step))
}

/** Incidents that can be derived from one finished (or live) run. */
export function analyzeRun(run) {
  const incidents = []
  const at = run.endedAt ?? run.lastEventAt ?? run.startedAt ?? Date.now()
  const runId = run.id
  const steps = run.steps ?? []

  if (run.error) {
    const { kind, severity } = classifyError(run.error)
    incidents.push(
      makeIncident({
        kind,
        severity,
        title: `Запуск завершился ошибкой: ${truncate(run.error, 180)}`,
        detail: run.error,
        runId,
        at,
        evidence: [`модель: ${run.model ?? '—'}`, `провайдер: ${run.provider ?? '—'}`, `шагов: ${steps.length}`]
      })
    )
  }

  for (const step of steps) {
    const stepAt = step.endedAt ?? step.startedAt ?? at
    if (step.ok === false) {
      if (isTimeout(step)) {
        incidents.push(
          makeIncident({
            kind: 'tool-timeout',
            severity: 'critical',
            title: `Таймаут: ${step.name}`,
            detail: `${step.summary ?? ''}\n${truncate(step.detail ?? '', 600)}`,
            runId,
            stepIndex: step.index,
            at: stepAt,
            evidence: [`аргументы: ${truncate(step.argsText ?? '', 200)}`, `длительность: ${step.durationMs ?? '—'} мс`]
          })
        )
      } else if (isMcpUnavailable(step)) {
        incidents.push(
          makeIncident({
            kind: 'mcp-unavailable',
            severity: 'warning',
            title: `MCP недоступен: ${step.name}`,
            detail: `${step.summary ?? ''}\n${truncate(step.detail ?? '', 600)}`,
            runId,
            stepIndex: step.index,
            at: stepAt
          })
        )
      } else {
        incidents.push(
          makeIncident({
            kind: 'tool-failed',
            severity: 'warning',
            title: `Инструмент упал: ${step.name}`,
            detail: `${step.summary ?? ''}\n${truncate(step.detail ?? '', 600)}`,
            runId,
            stepIndex: step.index,
            at: stepAt,
            evidence: [`аргументы: ${truncate(step.argsText ?? '', 200)}`]
          })
        )
      }
    }
    if (Number.isFinite(step.durationMs) && step.durationMs > 120_000) {
      incidents.push(
        makeIncident({
          kind: 'slow-tool',
          severity: 'info',
          title: `Долгий инструмент: ${step.name} (${Math.round(step.durationMs / 1000)} с)`,
          detail: truncate(step.summary ?? '', 300),
          runId,
          stepIndex: step.index,
          at: stepAt
        })
      )
    }
  }

  // The run was closed (or read from disk) with steps that never got a result.
  if (!run.live && run.status !== 'running') {
    const pending = steps.filter((step) => step.ok === null || step.ok === undefined)
    for (const step of pending) {
      incidents.push(
        makeIncident({
          kind: 'step-no-result',
          severity: 'critical',
          title: `Нет результата шага: ${step.name}`,
          detail: 'Вызов начался, но результат не был записан — запуск оборвался.',
          runId,
          stepIndex: step.index,
          at: run.endedAt ?? at
        })
      )
    }
  }

  for (const notice of run.notices ?? []) {
    const { kind, severity } = classifyNotice(notice)
    incidents.push(
      makeIncident({
        kind,
        severity,
        title: truncate(notice.text ?? String(notice), 200),
        detail: notice.text ?? '',
        runId,
        at: notice.at ?? at
      })
    )
  }

  for (const command of run.commands ?? []) {
    if (command.timedOut) {
      incidents.push(
        makeIncident({
          kind: 'command-timeout',
          severity: 'critical',
          title: `Команда не успела: ${truncate(command.command, 140)}`,
          detail: command.outputTail ?? '',
          runId,
          at: command.at ?? at
        })
      )
    } else if (command.ok === false) {
      incidents.push(
        makeIncident({
          kind: 'command-failed',
          severity: 'warning',
          title: `Команда завершилась ошибкой: ${truncate(command.command, 140)}`,
          detail: command.outputTail ?? '',
          runId,
          at: command.at ?? at
        })
      )
    }
  }

  // The same failing call repeated inside one run is a stuck agent.
  const failures = new Map()
  for (const step of steps) {
    if (step.ok !== false) continue
    const key = `${step.name}|${step.summary ?? ''}`
    failures.set(key, [...(failures.get(key) ?? []), step])
  }
  for (const [key, list] of failures) {
    if (list.length < 2) continue
    const [name, summary] = key.split('|')
    incidents.push(
      makeIncident({
        kind: 'repeated-failure',
        severity: 'warning',
        title: `Повторяющаяся ошибка: ${name} ×${list.length}`,
        detail: summary,
        runId,
        stepIndex: list[list.length - 1].index,
        at: list[list.length - 1].endedAt ?? at
      })
    )
  }

  // One file rewritten again and again usually means the model is going in circles.
  const touches = new Map()
  for (const file of run.files ?? []) {
    if (!['write', 'edit'].includes(file.action)) continue
    touches.set(file.path, (touches.get(file.path) ?? 0) + 1)
  }
  for (const [path, count] of touches) {
    if (count < 5) continue
    incidents.push(
      makeIncident({
        kind: 'file-thrash',
        severity: 'warning',
        title: `Файл переписан ${count} раз: ${path}`,
        detail: 'Похоже на цикл правок внутри одного запуска.',
        runId,
        at
      })
    )
  }

  const contextTokens = run.usage?.contextTokens
  if (Number.isFinite(contextTokens) && contextTokens >= 100_000) {
    incidents.push(
      makeIncident({
        kind: 'context-pressure',
        severity: contextTokens >= 180_000 ? 'critical' : 'warning',
        title: `Контекст ${Math.round(contextTokens / 1000)}k токенов`,
        detail: 'Размер разговора, который увидит следующий запрос.',
        runId,
        at
      })
    )
  }

  const totalTokens = (run.usage?.promptTokens ?? 0) + (run.usage?.completionTokens ?? 0)
  if (totalTokens >= 300_000) {
    incidents.push(
      makeIncident({
        kind: 'high-cost',
        severity: 'warning',
        title: `Запуск потратил ${Math.round(totalTokens / 1000)}k токенов`,
        detail: `prompt ${run.usage?.promptTokens ?? 0}, completion ${run.usage?.completionTokens ?? 0}`,
        runId,
        at
      })
    )
  }

  if (
    !run.live &&
    run.status === 'ok' &&
    steps.length > 0 &&
    !String(run.answer ?? '').trim() &&
    !(run.notices ?? []).some((notice) => classifyNotice(notice).kind === 'no-answer')
  ) {
    incidents.push(
      makeIncident({
        kind: 'empty-answer',
        severity: 'warning',
        title: 'Запуск без текста ответа',
        detail: `Инструментов: ${steps.length}, но пользователю ничего не написано.`,
        runId,
        at
      })
    )
  }

  if (
    !run.live &&
    steps.length > 0 &&
    (run.steps ?? []).some((step) => step.ok === false) &&
    CLAIMS_SUCCESS_RE.test(String(run.answer ?? '').slice(-800))
  ) {
    incidents.push(
      makeIncident({
        kind: 'unverified-result',
        severity: 'critical',
        title: 'Ответ сообщает об успехе после ошибки инструмента',
        detail: 'Последние шаги содержат ошибку, но итоговый ответ утверждает, что всё сработало.',
        runId,
        at
      })
    )
  }

  if (!run.live && Number.isFinite(run.durationMs) && run.durationMs > 300_000) {
    incidents.push(
      makeIncident({
        kind: 'slow-run',
        severity: 'info',
        title: `Долгий запуск: ${Math.round(run.durationMs / 60_000)} мин`,
        detail: `шагов: ${steps.length}, токенов: ${totalTokens}`,
        runId,
        at
      })
    )
  }

  return incidents
}

export function recordRunIncidents(store, run) {
  let created = 0
  for (const incident of analyzeRun(run)) {
    const result = store.addIncident(incident)
    if (result.created) created += 1
  }
  return created
}

export function detectStalls(store, now, stale) {
  let created = 0
  for (const run of store.listRuns()) {
    const active = run.live || run.status === 'running'
    if (!active) continue
    const last = run.lastEventAt ?? run.startedAt ?? now
    const idle = now - last
    const runLevel =
      idle >= stale.runCriticalSec * 1000
        ? 'critical'
        : idle >= stale.runSec * 1000
          ? 'warning'
          : null
    if (runLevel) {
      const result = store.addIncident(
        makeIncident({
          kind: 'run-stalled',
          severity: runLevel,
          title: `Запуск молчит ${Math.round(idle / 1000)} с`,
          detail: `Последнее событие: ${new Date(last).toLocaleString('ru-RU')}.`,
          runId: run.id,
          at: last,
          fingerprintExtra: `run:${runLevel}`
        })
      )
      if (result.created) created += 1
    }
    for (const step of run.steps ?? []) {
      if (step.ok !== null && step.ok !== undefined) continue
      if (!step.startedAt) continue
      const stepIdle = now - step.startedAt
      const level =
        stepIdle >= stale.stepCriticalSec * 1000
          ? 'critical'
          : stepIdle >= stale.stepSec * 1000
            ? 'warning'
            : null
      if (!level) continue
      const result = store.addIncident(
        makeIncident({
          kind: 'step-hung',
          severity: level,
          title: `Шаг висит ${Math.round(stepIdle / 1000)} с: ${step.name}`,
          detail: `Аргументы: ${truncate(step.argsText ?? '', 300)}`,
          runId: run.id,
          stepIndex: step.index,
          at: step.startedAt,
          fingerprintExtra: `step:${level}:${step.callId ?? step.index}`
        })
      )
      if (result.created) created += 1
    }
  }
  return created
}

export function computeToolStats(runs) {
  const stats = new Map()
  for (const run of runs) {
    for (const step of run.steps ?? []) {
      const name = step.name ?? 'unknown'
      const item =
        stats.get(name) ??
        {
          name,
          calls: 0,
          ok: 0,
          failed: 0,
          pending: 0,
          timeouts: 0,
          durations: [],
          lastAt: 0,
          failures: new Map()
        }
      item.calls += 1
      if (step.ok === true) item.ok += 1
      else if (step.ok === false) {
        item.failed += 1
        const summary = truncate(step.summary ?? 'ошибка', 160)
        item.failures.set(summary, (item.failures.get(summary) ?? 0) + 1)
      } else item.pending += 1
      if (isTimeout(step)) item.timeouts += 1
      if (Number.isFinite(step.durationMs)) item.durations.push(step.durationMs)
      item.lastAt = Math.max(item.lastAt, step.endedAt ?? step.startedAt ?? run.endedAt ?? run.startedAt ?? 0)
      stats.set(name, item)
    }
  }
  return [...stats.values()]
    .map((item) => {
      const finished = item.ok + item.failed
      return {
        name: item.name,
        calls: item.calls,
        ok: item.ok,
        failed: item.failed,
        pending: item.pending,
        timeouts: item.timeouts,
        successRate: finished > 0 ? item.ok / finished : null,
        avgMs: item.durations.length
          ? Math.round(item.durations.reduce((sum, value) => sum + value, 0) / item.durations.length)
          : null,
        p95Ms: percentile(item.durations, 95),
        lastAt: item.lastAt,
        topFailures: [...item.failures.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([summary, count]) => ({ summary, count }))
      }
    })
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
}

export function computeFileStats(runs) {
  const map = new Map()
  for (const run of runs) {
    for (const file of run.files ?? []) {
      const item =
        map.get(file.path) ??
        {
          path: file.path,
          actions: new Set(),
          count: 0,
          failed: 0,
          lastAt: 0,
          runIds: new Set(),
          from: file.from ?? null
        }
      item.actions.add(file.action)
      item.count += 1
      if (file.ok === false) item.failed += 1
      if (file.from) item.from = file.from
      item.lastAt = Math.max(item.lastAt, file.at ?? run.endedAt ?? run.startedAt ?? 0)
      item.runIds.add(run.id)
      map.set(file.path, item)
    }
  }
  return [...map.values()]
    .map((item) => ({
      ...item,
      actions: [...item.actions],
      runIds: [...item.runIds],
      runCount: item.runIds.size
    }))
    .sort((a, b) => b.lastAt - a.lastAt)
}

export function computeCommandStats(runs) {
  const items = []
  for (const run of runs) {
    for (const command of run.commands ?? []) {
      items.push({
        ...command,
        runId: run.id,
        model: run.model,
        mode: run.mode,
        at: command.at ?? run.endedAt ?? run.startedAt
      })
    }
  }
  return items.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
}

export function computeOverview(store, { now = Date.now(), hours = 24 } = {}) {
  const since = now - hours * 3_600_000
  const allRuns = store.listRuns()
  const runs = allRuns.filter((run) => (run.startedAt ?? 0) >= since)
  const incidents = store.incidents({ limit: 5_000 }).filter((item) => (item.at ?? 0) >= since)
  const toolHealth = computeToolStats(runs)
  const commands = computeCommandStats(runs)
  const files = computeFileStats(runs)
  const ended = runs.filter((run) => Number.isFinite(run.durationMs) && run.durationMs > 0)
  const durations = ended.map((run) => run.durationMs)

  const usage = runs.reduce(
    (sum, run) => {
      sum.promptTokens += run.usage?.promptTokens ?? 0
      sum.completionTokens += run.usage?.completionTokens ?? 0
      sum.reasoningTokens += run.usage?.reasoningTokens ?? 0
      return sum
    },
    { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 }
  )

  const buckets = new Map()
  for (let index = 23; index >= 0; index -= 1) {
    const at = now - index * 3_600_000
    const key = new Date(at).toISOString().slice(0, 13)
    buckets.set(key, { at: new Date(at).setMinutes(0, 0, 0), runs: 0, errors: 0 })
  }
  for (const run of runs) {
    const key = new Date(run.startedAt ?? 0).toISOString().slice(0, 13)
    const bucket = buckets.get(key)
    if (!bucket) continue
    bucket.runs += 1
    if (run.status === 'error') bucket.errors += 1
  }

  const failedSteps = toolHealth.reduce((sum, item) => sum + item.failed, 0)
  const calls = toolHealth.reduce((sum, item) => sum + item.calls, 0)
  const timeouts = toolHealth.reduce((sum, item) => sum + item.timeouts, 0)
  const critical = incidents.filter((item) => item.severity === 'critical')
  const warnings = incidents.filter((item) => item.severity === 'warning')
  const liveRuns = allRuns.filter((run) => run.live || run.status === 'running')

  return {
    generatedAt: now,
    windowHours: hours,
    sources: store.meta.sources ?? {},
    probe: store.meta.probe ?? {},
    live: {
      runs: liveRuns.length,
      steps: liveRuns.reduce(
        (sum, run) => sum + (run.steps ?? []).filter((step) => step.ok == null).length,
        0
      )
    },
    counts: {
      runs: runs.length,
      runsTotal: allRuns.length,
      errorRuns: runs.filter((run) => run.status === 'error').length,
      incompleteRuns: runs.filter((run) => run.status === 'incomplete').length,
      toolCalls: calls,
      failedTools: failedSteps,
      files: files.length,
      fileTouches: files.reduce((sum, item) => sum + item.count, 0),
      commands: commands.length,
      failedCommands: commands.filter((item) => item.ok === false).length,
      timeouts,
      incidents: incidents.length,
      critical: critical.length,
      warnings: warnings.length,
      liveRuns: liveRuns.length
    },
    timing: {
      medianRunMs: percentile(durations, 50),
      p95RunMs: percentile(durations, 95),
      slowestRun: ended.sort((a, b) => b.durationMs - a.durationMs)[0]
        ? {
            id: ended.sort((a, b) => b.durationMs - a.durationMs)[0].id,
            durationMs: ended.sort((a, b) => b.durationMs - a.durationMs)[0].durationMs
          }
        : null
    },
    usage,
    activity: [...buckets.values()],
    recentRuns: runs.slice(0, 8).map((run) => ({
      id: run.id,
      startedAt: run.startedAt,
      durationMs: run.durationMs,
      mode: run.mode,
      model: run.model,
      status: run.status,
      user: truncate(run.user ?? '', 140),
      steps: run.counts?.steps ?? run.steps?.length ?? 0,
      failed: run.counts?.failed ?? 0
    })),
    topIncidents: incidents
      .slice()
      .sort(
        (a, b) =>
          (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0) ||
          (b.at ?? 0) - (a.at ?? 0)
      )
      .slice(0, 8),
    toolHealth: toolHealth.slice(0, 12),
    topFailures: toolHealth
      .flatMap((item) => item.topFailures.map((failure) => ({ tool: item.name, ...failure })))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    models: store.meta.modelMemory ?? { entries: [], weak: [] }
  }
}
