import { join } from 'node:path'
import { computeOverview, SEVERITY_ORDER } from './analyze.mjs'
import { DATA_DIR, OUT_DIR, SNITCH_ROOT } from './paths.mjs'
import { atomicWrite, ensureDir, formatDuration, truncate } from './util.mjs'

function mdCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
}

function shortId(id) {
  return String(id ?? '').slice(0, 12)
}

function severityLabel(severity) {
  return severity === 'critical' ? 'КРИТ' : severity === 'warning' ? 'ВАЖНО' : 'ИНФО'
}

function runLine(run) {
  const status =
    run.status === 'error'
      ? 'ошибка'
      : run.status === 'incomplete'
        ? 'оборван'
        : run.live
          ? 'идёт'
          : 'ок'
  return `- ${new Date(run.startedAt ?? 0).toLocaleString('ru-RU')} · ${status} · ${
    run.mode ?? '—'
  } · ${run.model ?? 'модель не указана'} · ${formatDuration(run.durationMs)} · шагов ${
    run.steps?.length ?? 0
  } · \`${shortId(run.id)}\` — ${run.user ? truncate(run.user.replace(/\s+/g, ' '), 140) : '(без текста запроса)'}`
}

export function buildDigest(store, { hours = 24, now = Date.now() } = {}) {
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
  const failedCommands = runs
    .flatMap((run) => (run.commands ?? []).map((command) => ({ ...command, runId: run.id })))
    .filter((command) => command.ok === false || command.timedOut)
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, 12)

  const nextSteps = []
  const seenHints = new Set()
  for (const incident of incidents) {
    if (!incident.hint || seenHints.has(incident.hint)) continue
    seenHints.add(incident.hint)
    nextSteps.push(`- **${incident.title}** — ${incident.hint}`)
    if (nextSteps.length >= 6) break
  }
  if (nextSteps.length === 0) nextSteps.push('- Явных проблем не найдено. Откройте последние запуски и проверьте, совпадает ли результат с ожиданием.')

  const json = {
    generatedAt: now,
    windowHours: hours,
    probe: overview.probe,
    live: overview.live,
    sources: overview.sources,
    counts: overview.counts,
    timing: overview.timing,
    usage: overview.usage,
    incidents: incidents.slice(0, 60).map((incident) => ({
      id: incident.id,
      at: incident.at,
      severity: incident.severity,
      kind: incident.kind,
      title: incident.title,
      detail: truncate(incident.detail, 500),
      hint: incident.hint,
      runId: incident.runId,
      stepIndex: incident.stepIndex ?? null,
      count: incident.count ?? 1
    })),
    toolHealth: overview.toolHealth,
    recentRuns: runs.slice(0, 12).map((run) => ({
      id: run.id,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      durationMs: run.durationMs,
      mode: run.mode,
      model: run.model,
      provider: run.provider,
      status: run.status,
      live: run.live === true,
      user: truncate(run.user ?? '', 300),
      error: run.error ?? null,
      steps: run.steps?.length ?? 0,
      failedSteps: (run.steps ?? []).filter((step) => step.ok === false).length,
      files: run.files?.length ?? 0,
      commands: run.commands?.length ?? 0,
      tokens: {
        prompt: run.usage?.promptTokens ?? 0,
        completion: run.usage?.completionTokens ?? 0,
        context: run.usage?.contextTokens ?? 0
      }
    })),
    failedCommands: failedCommands.map((command) => ({
      command: command.command,
      ok: command.ok,
      exitCode: command.exitCode,
      timedOut: command.timedOut,
      at: command.at,
      runId: command.runId,
      outputTail: truncate(command.outputTail, 400)
    })),
    nextSteps,
    paths: {
      snitch: SNITCH_ROOT,
      data: DATA_DIR,
      out: OUT_DIR,
      userData: overview.sources?.userData ?? null,
      workspace: overview.sources?.workspace ?? null,
      exchanges: overview.sources?.exchangeDir ?? null,
      log: overview.sources?.logFile ?? null
    }
  }

  const lines = []
  lines.push('# Snitch — сводка для ИИ-агента')
  lines.push('')
  lines.push(`Сгенерировано: ${new Date(now).toLocaleString('ru-RU')} · окно ${hours} ч`)
  lines.push('')
  lines.push('## Источники')
  lines.push('')
  lines.push(`- Профиль RelaxCode: \`${overview.sources?.userData ?? 'не найден'}\``)
  lines.push(`- Рабочая папка: \`${overview.sources?.workspace ?? 'не открыта'}\``)
  lines.push(`- Отчёты обменов: \`${overview.sources?.exchangeDir ?? '—'}\``)
  lines.push(`- Лог приложения: \`${overview.sources?.logFile ?? 'нет файла'}\``)
  lines.push(
    `- Живой зонд: ${
      overview.probe?.attached
        ? `подключён${overview.probe.lastSeen ? `, последний сигнал ${new Date(overview.probe.lastSeen).toLocaleTimeString('ru-RU')}` : ''}`
        : 'не подключён (файловый режим)'
    }`
  )
  lines.push('')
  lines.push('## Сейчас')
  lines.push('')
  lines.push(
    `- Активных запусков: ${overview.live.runs}, шагов в работе: ${overview.live.steps}.`
  )
  lines.push(
    `- Всего в истории: ${overview.counts.runsTotal} запусков; за окно: ${overview.counts.runs}, из них с ошибкой ${overview.counts.errorRuns}, оборваны ${overview.counts.incompleteRuns}.`
  )
  lines.push('')
  lines.push(`## За ${hours} ч`)
  lines.push('')
  lines.push('| Метрика | Значение |')
  lines.push('| --- | --- |')
  lines.push(`| Ошибки запусков | ${overview.counts.errorRuns} |`)
  lines.push(`| Критические инциденты | ${overview.counts.critical} |`)
  lines.push(`| Предупреждения | ${overview.counts.warnings} |`)
  lines.push(`| Вызовов инструментов | ${overview.counts.toolCalls} (ошибок ${overview.counts.failedTools}, таймаутов ${overview.counts.timeouts}) |`)
  lines.push(`| Команд | ${overview.counts.commands} (ошибок ${overview.counts.failedCommands}) |`)
  lines.push(`| Затронуто файлов | ${overview.counts.files} (касаний ${overview.counts.fileTouches}) |`)
  lines.push(`| Медиана запуска | ${formatDuration(overview.timing.medianRunMs)} |`)
  lines.push(`| p95 запуска | ${formatDuration(overview.timing.p95RunMs)} |`)
  lines.push(`| Токены (prompt / completion) | ${overview.usage.promptTokens} / ${overview.usage.completionTokens} |`)
  lines.push('')
  lines.push('## Главные проблемы')
  lines.push('')
  if (incidents.length === 0) {
    lines.push('Инцидентов за окно нет.')
  } else {
    incidents.slice(0, 10).forEach((incident, index) => {
      lines.push(
        `${index + 1}. **[${severityLabel(incident.severity)}] ${truncate(incident.title, 220)}**` +
          `${incident.runId ? ` · запуск \`${shortId(incident.runId)}\`` : ''}` +
          `${incident.count > 1 ? ` · повторов ${incident.count}` : ''} · ${new Date(incident.at).toLocaleString('ru-RU')}`
      )
      if (incident.detail) lines.push(`   ${truncate(incident.detail.replace(/\s+/g, ' '), 300)}`)
      if (incident.hint) lines.push(`   → ${incident.hint}`)
    })
  }
  lines.push('')
  lines.push('## Здоровье инструментов')
  lines.push('')
  if (overview.toolHealth.length === 0) {
    lines.push('Вызовов не было.')
  } else {
    lines.push('| Инструмент | Вызовов | Ошибок | Таймаутов | Успех | p95 |')
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: |')
    for (const tool of overview.toolHealth) {
      lines.push(
        `| \`${mdCell(tool.name)}\` | ${tool.calls} | ${tool.failed} | ${tool.timeouts} | ${
          tool.successRate == null ? '—' : `${Math.round(tool.successRate * 100)}%`
        } | ${formatDuration(tool.p95Ms)} |`
      )
    }
  }
  lines.push('')
  lines.push('## Последние запуски')
  lines.push('')
  if (runs.length === 0) lines.push('Запусков за окно нет.')
  else runs.slice(0, 10).forEach((run) => lines.push(runLine(run)))
  lines.push('')
  if (failedCommands.length > 0) {
    lines.push('## Упавшие команды')
    lines.push('')
    for (const command of failedCommands) {
      lines.push(
        `- ${new Date(command.at ?? 0).toLocaleTimeString('ru-RU')} · \`${truncate(command.command, 160)}\` · ${
          command.timedOut ? 'таймаут' : `код ${command.exitCode ?? '?'}`
        } · запуск \`${shortId(command.runId)}\``
      )
    }
    lines.push('')
  }
  lines.push('## Что проверить')
  lines.push('')
  lines.push(...nextSteps)
  lines.push('')
  lines.push('## Как смотреть')
  lines.push('')
  lines.push(`- Панель: запустите \`node src/cli.mjs serve --open\` в ${SNITCH_ROOT} и откройте http://127.0.0.1:7777.`)
  lines.push(`- JSON: GET http://127.0.0.1:7777/api/digest?format=json`)
  lines.push(`- MCP: \`node src/mcp.mjs\` (инструменты snitch_overview, snitch_incidents, snitch_runs, snitch_run, snitch_search).`)
  lines.push(`- Полные отчёты обменов лежат в \`${overview.sources?.exchangeDir ?? DATA_DIR}\`; Snitch хранит архив в \`${join(DATA_DIR, 'archive')}\`.`)
  lines.push('')
  return { markdown: lines.join('\n'), json }
}

export async function writeDigest(store, { hours = 24, now = Date.now(), outDir = OUT_DIR } = {}) {
  const { markdown, json } = buildDigest(store, { hours, now })
  await ensureDir(outDir)
  await atomicWrite(join(outDir, 'SITUATION.md'), markdown)
  await atomicWrite(join(outDir, 'situation.json'), JSON.stringify(json, null, 2))
  await atomicWrite(join(outDir, 'incidents.json'), JSON.stringify(json.incidents, null, 2))
  await atomicWrite(join(outDir, 'runs.json'), JSON.stringify(json.recentRuns, null, 2))
  return {
    markdownPath: join(outDir, 'SITUATION.md'),
    jsonPath: join(outDir, 'situation.json'),
    markdown,
    json
  }
}
