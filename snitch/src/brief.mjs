import { computeOverview, SEVERITY_ORDER } from './analyze.mjs'
import { DATA_DIR, SNITCH_ROOT } from './paths.mjs'
import { firstLine, formatDuration, truncate } from './util.mjs'

/**
 * The handoff an agent receives. It is written to be pasted into a chat as-is:
 * facts first, evidence second, and explicit rules so the model verifies
 * instead of inventing a story or asking the user to retype what is already here.
 */

const STATUS_RU = {
  error: 'ошибка',
  incomplete: 'оборван',
  running: 'идёт',
  ok: 'ок'
}

function when(at) {
  if (!at) return '—'
  return new Date(at).toLocaleString('ru-RU')
}

function shortId(id) {
  return String(id ?? '').slice(0, 12)
}

function stepLine(step) {
  const state = step.ok === true ? 'ok' : step.ok === false ? 'FAIL' : 'висел'
  return `  - [${state}] ${step.name} · ${formatDuration(step.durationMs)} · ${
    firstLine(step.summary ?? step.argsText ?? '', 220) || 'без описания'
  }`
}

function failedRunBlock(run, index) {
  const steps = run.steps ?? []
  const failed = steps.filter((step) => step.ok === false)
  const pending = steps.filter((step) => step.ok == null)
  const lines = []
  lines.push(
    `### ${index + 1}. Запуск \`${shortId(run.id)}\` — ${STATUS_RU[run.status] ?? run.status} · ${when(
      run.startedAt
    )}`
  )
  lines.push(
    `- Режим: ${run.mode ?? '—'} · модель: ${run.model ?? 'не указана'} · провайдер: ${
      run.provider ?? '—'
    } · длительность: ${formatDuration(run.durationMs)}`
  )
  if (run.user) lines.push(`- Запрос пользователя: ${firstLine(run.user, 400)}`)
  if (run.error) lines.push(`- Ошибка: ${firstLine(run.error, 700)}`)
  lines.push(
    `- Шагов: ${steps.length}, упало: ${failed.length}, без результата: ${pending.length}, файлов: ${
      run.files?.length ?? 0
    }, команд: ${run.commands?.length ?? 0}`
  )
  if (failed.length > 0) {
    lines.push('- Упавшие шаги:')
    lines.push(...failed.slice(0, 6).map(stepLine))
    const detail = failed
      .map((step) => `${step.name}: ${step.detail ?? step.summary ?? ''}`)
      .filter((text) => text.length > 20)
      .join('\n---\n')
    if (detail) lines.push(`- Хвост ошибки:\n\`\`\`\n${truncate(detail, 1_800)}\n\`\`\``)
  }
  if (pending.length > 0) {
    lines.push('- Шаги без результата:')
    lines.push(...pending.slice(0, 6).map(stepLine))
  }
  const failedCommands = (run.commands ?? []).filter((command) => command.ok === false || command.timedOut)
  if (failedCommands.length > 0) {
    lines.push('- Команды с ошибкой:')
    for (const command of failedCommands.slice(0, 4)) {
      lines.push(
        `  - \`${firstLine(command.command, 200)}\` · ${
          command.timedOut ? 'таймаут' : `код ${command.exitCode ?? '?'}`
        } · ${formatDuration(command.durationMs)}`
      )
      if (command.outputTail) {
        lines.push(`\`\`\`\n${truncate(command.outputTail, 700)}\n\`\`\``)
      }
    }
  }
  if (run.notices?.length) {
    lines.push('- Предупреждения приложения:')
    for (const notice of run.notices.slice(-5)) {
      lines.push(`  - ${firstLine(notice.text, 300)}`)
    }
  }
  return lines
}

export function buildAiBrief(store, { hours = 24, now = Date.now() } = {}) {
  const overview = computeOverview(store, { now, hours })
  const since = now - hours * 3_600_000
  const incidents = store
    .incidents({ since, limit: 500 })
    .sort(
      (a, b) =>
        (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0) ||
        (b.at ?? 0) - (a.at ?? 0)
    )
  const runs = store.listRuns().filter((run) => (run.startedAt ?? 0) >= since)
  const problemRuns = runs
    .filter((run) => run.status === 'error' || run.status === 'incomplete' || run.live)
    .slice(0, 6)
  const stalled = runs.filter((run) => {
    const active = run.live || run.status === 'running'
    return active && now - (run.lastEventAt ?? run.startedAt ?? now) > 60_000
  })

  const lines = []
  lines.push('# SNITCH BRIEF — что происходит в RelaxCode')
  lines.push('')
  lines.push(`Сгенерировано: ${when(now)} · окно: ${hours} ч`)
  lines.push('')
  lines.push(
    'Ты — ИИ-агент, который продолжает работу в этом проекте. Ниже — автоматически собранные факты из IDE: запросы, действия агента, файлы, команды, ошибки, таймауты и тайминги. Это доказательства, а не пересказ пользователя. Не проси пользователя повторять проблему: сначала проверь эти данные, затем проверь код и окружение.'
  )
  lines.push('')
  lines.push('## Источники')
  lines.push('')
  lines.push(`- Профиль IDE: \`${overview.sources?.userData ?? 'не найден'}\``)
  lines.push(`- Рабочая папка: \`${overview.sources?.workspace ?? 'не открыта'}\``)
  lines.push(`- Отчёты обменов: \`${overview.sources?.exchangeDir ?? '—'}\``)
  lines.push(`- Лог приложения: \`${overview.sources?.logFile ?? 'нет файла'}\``)
  lines.push(`- Хранилище Snitch: \`${DATA_DIR}\``)
  lines.push(
    `- Живой зонд: ${
      overview.probe?.attached
        ? `подключён, последний сигнал ${when(overview.probe.lastSeen)}`
        : `не подключён (файловый режим). ${overview.probe?.reason ?? ''}`
    }`
  )
  lines.push('')
  lines.push('## Пульс')
  lines.push('')
  lines.push(`- Активных запусков: ${overview.live.runs}, незавершённых шагов: ${overview.live.steps}.`)
  lines.push(
    `- Запусков за окно: ${overview.counts.runs} (ошибок ${overview.counts.errorRuns}, оборвано ${overview.counts.incompleteRuns}). Всего в истории: ${overview.counts.runsTotal}.`
  )
  lines.push(
    `- Инцидентов: ${overview.counts.incidents} (критических ${overview.counts.critical}, предупреждений ${overview.counts.warnings}).`
  )
  lines.push(
    `- Инструменты: ${overview.counts.toolCalls} вызовов, ${overview.counts.failedTools} ошибок, ${overview.counts.timeouts} таймаутов.`
  )
  lines.push(
    `- Команды: ${overview.counts.commands}, из них с ошибкой ${overview.counts.failedCommands}. Файлов затронуто: ${overview.counts.files}.`
  )
  lines.push(
    `- Тайминги: медиана запуска ${formatDuration(overview.timing.medianRunMs)}, p95 ${formatDuration(
      overview.timing.p95RunMs
    )}. Токены: prompt ${overview.usage.promptTokens}, completion ${overview.usage.completionTokens}.`
  )
  if (stalled.length > 0) {
    lines.push(
      `- Похоже на зависание: ${stalled
        .map((run) => `\`${shortId(run.id)}\` (${Math.round((now - (run.lastEventAt ?? run.startedAt)) / 1000)} с без событий)`)
        .join(', ')}.`
    )
  }
  lines.push('')

  lines.push(`## Критические инциденты (${incidents.filter((item) => item.severity === 'critical').length})`)
  lines.push('')
  const critical = incidents.filter((item) => item.severity === 'critical')
  if (critical.length === 0) {
    lines.push('Критических инцидентов за окно нет.')
  } else {
    critical.slice(0, 10).forEach((incident, index) => {
      lines.push(
        `### ${index + 1}. ${firstLine(incident.title, 240)}`
      )
      lines.push(
        `- Тип: \`${incident.kind}\` · время: ${when(incident.at)} · повторов: ${incident.count ?? 1}${
          incident.runId ? ` · запуск: \`${shortId(incident.runId)}\`` : ''
        }${incident.stepIndex != null ? ` · шаг: ${incident.stepIndex + 1}` : ''}`
      )
      if (incident.detail) lines.push(`- Детали: ${firstLine(incident.detail, 900)}`)
      if (incident.hint) lines.push(`- Гипотеза и следующий шаг: ${incident.hint}`)
      if (incident.evidence?.length) {
        lines.push(`- Доказательства: ${incident.evidence.map((item) => firstLine(item, 180)).join(' · ')}`)
      }
      lines.push('')
    })
  }

  const warnings = incidents.filter((item) => item.severity === 'warning')
  if (warnings.length > 0) {
    lines.push(`## Предупреждения (${warnings.length})`)
    lines.push('')
    warnings.slice(0, 12).forEach((incident) => {
      lines.push(
        `- ${when(incident.at)} · **${firstLine(incident.title, 200)}**${
          incident.count > 1 ? ` (×${incident.count})` : ''
        }${incident.runId ? ` · \`${shortId(incident.runId)}\`` : ''}`
      )
    })
    lines.push('')
  }

  lines.push('## Проблемные запуски с деталями')
  lines.push('')
  if (problemRuns.length === 0) {
    lines.push('За окно нет запусков с ошибкой или обрывом.')
    lines.push('')
  } else {
    problemRuns.forEach((run, index) => {
      lines.push(...failedRunBlock(run, index))
      lines.push('')
    })
  }

  lines.push('## Здоровье инструментов')
  lines.push('')
  if (overview.toolHealth.length === 0) {
    lines.push('Вызовов инструментов не было.')
  } else {
    lines.push('| Инструмент | Вызовов | Ошибок | Таймаутов | Успех | Медиана | p95 |')
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |')
    for (const tool of overview.toolHealth.slice(0, 20)) {
      lines.push(
        `| \`${tool.name}\` | ${tool.calls} | ${tool.failed} | ${tool.timeouts} | ${
          tool.successRate == null ? '—' : `${Math.round(tool.successRate * 100)}%`
        } | ${formatDuration(tool.medianMs)} | ${formatDuration(tool.p95Ms)} |`
      )
    }
  }
  lines.push('')

  const failedCommands = runs
    .flatMap((run) => (run.commands ?? []).map((command) => ({ ...command, runId: run.id })))
    .filter((command) => command.ok === false || command.timedOut)
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
  if (failedCommands.length > 0) {
    lines.push('## Упавшие команды')
    lines.push('')
    for (const command of failedCommands.slice(0, 10)) {
      lines.push(
        `- ${when(command.at)} · \`${firstLine(command.command, 200)}\` · ${
          command.timedOut ? 'ТАЙМАУТ' : `код ${command.exitCode ?? '?'}`
        } · запуск \`${shortId(command.runId)}\``
      )
      if (command.outputTail) {
        lines.push(`\`\`\`\n${truncate(command.outputTail, 600)}\n\`\`\``)
      }
    }
    lines.push('')
  }

  lines.push('## Последние запуски')
  lines.push('')
  if (runs.length === 0) lines.push('Запусков за окно нет.')
  else {
    for (const run of runs.slice(0, 10)) {
      lines.push(
        `- ${when(run.startedAt)} · ${STATUS_RU[run.status] ?? run.status} · \`${shortId(run.id)}\` · ${
          run.mode ?? '—'
        } · ${run.model ?? 'модель не указана'} · ${formatDuration(run.durationMs)} · шагов ${
          run.steps?.length ?? 0
        } · ${firstLine(run.user ?? run.answer ?? '', 180) || '(без текста)'}`
      )
    }
  }
  lines.push('')

  lines.push('## Правила работы с этим отчётом')
  lines.push('')
  lines.push('1. Не переспрашивай пользователя о том, что уже есть выше. Сначала проверь доказательства и код.')
  lines.push('2. Каждый вывод подкрепляй ссылкой на запуск/шаг/файл/команду из отчёта. Если данных не хватает, скажи каких именно.')
  lines.push('3. Исправляй причину, а не симптом. После правки повтори ту же команду или сценарий, который упал, и покажи результат.')
  lines.push('4. Никогда не заявляй об успехе, если проверка не запускалась. Пустой вывод — не доказательство.')
  lines.push('5. Таймаут и «нет результата» — это разные классы: таймаут лечится лимитом/процессом, отсутствие результата — обрывом вызова.')
  lines.push('6. Если запуск ещё идёт (live), не редактируй файлы, которые он трогает, без явного указания пользователя.')
  lines.push('')
  lines.push('## Если нужно глубже')
  lines.push('')
  lines.push(`- Панель: http://127.0.0.1:7777 (запуск: \`node src/cli.mjs serve --open\` в ${SNITCH_ROOT}).`)
  lines.push('- HTTP: `/api/overview`, `/api/runs`, `/api/runs/:id`, `/api/events`, `/api/incidents`, `/api/tools`, `/api/brief`, `/api/digest?format=json`.')
  lines.push('- MCP: `node src/mcp.mjs` → `snitch_overview`, `snitch_incidents`, `snitch_runs`, `snitch_run`, `snitch_events`, `snitch_brief`, `snitch_search`.')
  lines.push('- Сырые отчёты обменов сохраняются в `data/archive/exchanges`; поле `archiveFile` у запуска указывает на файл.')
  lines.push('')
  return lines.join('\n')
}
