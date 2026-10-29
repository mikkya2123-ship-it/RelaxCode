/* global EventSource */

const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]

const VIEWS = {
  overview: { title: 'Обзор', subtitle: 'Что происходит в IDE прямо сейчас', icon: 'overview' },
  runs: { title: 'Запуски', subtitle: 'Каждый запрос агента: шаги, файлы, команды, ошибки', icon: 'runs', search: true, placeholder: 'Поиск по запросу, ответу, ошибке…' },
  incidents: { title: 'Инциденты', subtitle: 'Автоматически найденные проблемы и подсказки', icon: 'incidents', search: true, placeholder: 'Поиск по инцидентам…' },
  events: { title: 'События', subtitle: 'Полный поток: шаги, файлы, команды, сеть, MCP', icon: 'events', search: true, placeholder: 'Поиск по событиям…' },
  tools: { title: 'Инструменты', subtitle: 'Надёжность и скорость каждого инструмента', icon: 'tools' },
  files: { title: 'Файлы', subtitle: 'Что агент создавал, менял и удалял', icon: 'files', search: true, placeholder: 'Поиск по пути файла…' },
  commands: { title: 'Команды', subtitle: 'Запуски, коды выхода, таймауты и вывод', icon: 'commands', search: true, placeholder: 'Поиск по команде или выводу…' },
  mcp: { title: 'MCP', subtitle: 'Серверы, их состояние и события', icon: 'mcp' },
  live: { title: 'Живой режим', subtitle: 'Поток событий из запущенного окна IDE', icon: 'live' },
  ai: { title: 'Для ИИ', subtitle: 'Готовый отчёт, который агент читает вместо расспросов', icon: 'ai' },
  diagnostics: { title: 'Диагностика', subtitle: 'Пути, источники, конфиг и здоровье сборщика', icon: 'diagnostics' }
}

const state = {
  view: 'overview',
  hours: 24,
  query: '',
  runsStatus: 'all',
  incidentsSeverity: 'all',
  eventsLevel: 'all',
  eventsKind: 'all',
  openEvents: new Set(),
  data: {},
  meta: null,
  health: null,
  brief: '',
  lastDigest: null,
  selectedRunId: null,
  selectedRun: null,
  selectedEvents: [],
  selectedIncidents: [],
  runTab: 'overview',
  busy: 0,
  lastUpdate: null,
  sseConnected: false,
  refreshTimer: null
}

const mainView = $('#view')
const drawer = $('#drawer')
const drawerBackdrop = $('#drawerBackdrop')
const drawerContent = $('#drawerContent')
const loadingBar = $('#loadingBar')
const toasts = $('#toasts')

/* ---------- helpers ---------- */

function h(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function num(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(1)}k`
  return new Intl.NumberFormat('ru-RU').format(n)
}

function bytes(value) {
  if (!Number.isFinite(value) || value <= 0) return '0 Б'
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} ГБ`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} МБ`
  if (value >= 1024) return `${Math.round(value / 1024)} КБ`
  return `${value} Б`
}

function dur(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} мс`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} с`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} мин ${Math.round((ms % 60_000) / 1000)} с`
  return `${Math.floor(ms / 3_600_000)} ч ${Math.round((ms % 3_600_000) / 60_000)} мин`
}

function time(at, withDate = false) {
  if (!at) return '—'
  const date = new Date(at)
  const today = new Date().toDateString() === date.toDateString()
  const timePart = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: withDate ? '2-digit' : undefined })
  if (today && !withDate) return timePart
  return `${date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${timePart}`
}

function rel(at) {
  if (!at) return '—'
  const diff = Date.now() - at
  if (diff < 15_000) return 'только что'
  if (diff < 60_000) return `${Math.round(diff / 1000)} с назад`
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} мин назад`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} ч назад`
  return time(at)
}

function pct(value) {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${Math.round(value * 100)}%`
}

function statusPill(run) {
  if (!run) return ''
  if (run.live || run.status === 'running') return '<span class="pill live">идёт</span>'
  if (run.status === 'error') return '<span class="pill error">ошибка</span>'
  if (run.status === 'incomplete') return '<span class="pill warn">оборван</span>'
  return '<span class="pill ok">ок</span>'
}

function severityPill(severity) {
  if (severity === 'critical') return '<span class="pill error">критично</span>'
  if (severity === 'warning') return '<span class="pill warn">важно</span>'
  return '<span class="pill info">инфо</span>'
}

function empty(title, text = '', icon = 'incidents') {
  return `<div class="empty"><svg class="ico"><use href="#i-${icon}"/></svg><b>${h(title)}</b>${text ? h(text) : ''}</div>`
}

function startBusy() {
  state.busy += 1
  loadingBar.classList.remove('done')
  loadingBar.classList.add('on')
}
function endBusy() {
  state.busy = Math.max(0, state.busy - 1)
  if (state.busy === 0) {
    loadingBar.classList.add('done')
    setTimeout(() => loadingBar.classList.remove('on', 'done'), 260)
  }
}

async function api(path, options = {}) {
  startBusy()
  try {
    const response = await fetch(path, {
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      ...options
    })
    const text = await response.text()
    let payload = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = null
    }
    if (!response.ok) throw new Error(payload?.error ?? `${response.status} ${response.statusText}`)
    return payload
  } finally {
    endBusy()
  }
}

function toast(message, kind = '') {
  const node = document.createElement('div')
  node.className = `toast ${kind}`
  node.textContent = message
  toasts.appendChild(node)
  setTimeout(() => {
    node.style.opacity = '0'
    node.style.transform = 'translateY(4px)'
    setTimeout(() => node.remove(), 220)
  }, 3200)
}

async function copyText(text, label = 'Скопировано') {
  try {
    await navigator.clipboard.writeText(String(text ?? ''))
    toast(label)
  } catch {
    const area = document.createElement('textarea')
    area.value = String(text ?? '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    try {
      document.execCommand('copy')
      toast(label)
    } catch {
      toast('Не удалось скопировать', 'error')
    }
    area.remove()
  }
}

/* ---------- markdown ---------- */

function inlineMd(text) {
  const codes = []
  let value = text.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code)
    return `\u0000${codes.length - 1}\u0000`
  })
  value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  value = value.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  value = value.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${codes[Number(index)]}</code>`)
  return value
}

function renderMarkdown(markdown) {
  const lines = String(markdown ?? '').replace(/\r/g, '').split('\n')
  const out = []
  let index = 0
  let listType = null
  let orderedCounter = 0
  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`)
      listType = null
      orderedCounter = 0
    }
  }
  const isSpecial = (line) =>
    /^```/.test(line) ||
    /^#{1,4}\s/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    /^\|/.test(line) ||
    /^>\s?/.test(line) ||
    /^---+$/.test(line)

  while (index < lines.length) {
    const line = lines[index]
    if (/^```/.test(line)) {
      closeList()
      const code = []
      index += 1
      while (index < lines.length && !/^```/.test(lines[index])) {
        code.push(lines[index])
        index += 1
      }
      index += 1
      out.push(`<pre><code>${h(code.join('\n'))}</code></pre>`)
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      closeList()
      out.push(`<h${heading[1].length}>${inlineMd(h(heading[2]))}</h${heading[1].length}>`)
      index += 1
      continue
    }
    if (/^---+$/.test(line)) {
      closeList()
      out.push('<hr>')
      index += 1
      continue
    }
    if (/^\|/.test(line)) {
      closeList()
      const rows = []
      while (index < lines.length && /^\|/.test(lines[index])) {
        const cells = lines[index].split('|').slice(1, -1).map((cell) => cell.trim())
        if (!cells.every((cell) => /^:?-{2,}:?$/.test(cell))) rows.push(cells)
        index += 1
      }
      if (rows.length > 0) {
        const head = rows.shift()
        out.push('<table><thead><tr>')
        for (const cell of head) out.push(`<th>${inlineMd(h(cell))}</th>`)
        out.push('</tr></thead><tbody>')
        for (const row of rows) {
          out.push('<tr>')
          for (const cell of row) out.push(`<td>${inlineMd(h(cell))}</td>`)
          out.push('</tr>')
        }
        out.push('</tbody></table>')
      }
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      if (listType !== 'ul') {
        closeList()
        out.push('<ul>')
        listType = 'ul'
      }
      out.push(`<li>${inlineMd(h(line.replace(/^\s*[-*]\s+/, '')))}</li>`)
      index += 1
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      if (listType !== 'ol') {
        closeList()
        out.push('<ol>')
        listType = 'ol'
        orderedCounter = 0
      }
      out.push(`<li>${inlineMd(h(line.replace(/^\s*\d+\.\s+/, '')))}</li>`)
      orderedCounter += 1
      index += 1
      continue
    }
    if (/^>\s?/.test(line)) {
      closeList()
      out.push(`<blockquote>${inlineMd(h(line.replace(/^>\s?/, '')))}</blockquote>`)
      index += 1
      continue
    }
    if (!line.trim()) {
      closeList()
      index += 1
      continue
    }
    closeList()
    const paragraph = []
    while (index < lines.length && lines[index].trim() && !isSpecial(lines[index])) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    if (paragraph.length) out.push(`<p>${inlineMd(h(paragraph.join(' ')))}</p>`)
    else index += 1
  }
  closeList()
  return out.join('\n')
}

/* ---------- shared renderers ---------- */

function eventRow(event, { inDrawer = false } = {}) {
  const key = String(event.id ?? `${event.at}:${event.kind}:${event.title}`)
  const open = state.openEvents.has(key)
  const clickable = Boolean(event.detail)
  return `<div class="event-row ${clickable ? 'expandable' : ''}" data-event-key="${h(key)}">
    <span class="event-time">${h(time(event.at, true))}</span>
    <span class="event-dot ${h(event.level ?? '')}"></span>
    <span class="event-kind">${h(event.kind ?? 'event')}</span>
    <span class="event-body">
      <span class="event-title">${h(event.title ?? '')}${event.approx ? ' <span class="faint">≈</span>' : ''}${
        event.runId ? `<span class="run-link">${h(String(event.runId).slice(0, 10))}</span>` : ''
      }</span>
      ${event.detail ? `<div class="event-detail ${open ? 'open' : ''}">${h(event.detail)}</div>` : ''}
    </span>
  </div>`
  void inDrawer
}

function incidentCard(incident, { compact = false } = {}) {
  return `<article class="incident" data-severity="${h(incident.severity ?? 'info')}">
    <div class="incident-head">
      <div class="title">${h(incident.title ?? 'Инцидент')}</div>
      ${severityPill(incident.severity)}
    </div>
    <div class="incident-meta">
      <span class="chip mono">${h(incident.kind ?? '—')}</span>
      <span>${h(time(incident.at, true))}</span>
      ${incident.count > 1 ? `<span class="chip">×${h(incident.count)}</span>` : ''}
      ${incident.runId ? `<button class="chip mono" data-run="${h(incident.runId)}">запуск ${h(String(incident.runId).slice(0, 10))}</button>` : ''}
      ${incident.stepIndex != null ? `<span>шаг ${incident.stepIndex + 1}</span>` : ''}
    </div>
    ${!compact && incident.detail ? `<div class="incident-detail">${h(incident.detail)}</div>` : ''}
    ${!compact && incident.hint ? `<div class="incident-hint"><b>Что делать:</b> ${h(incident.hint)}</div>` : ''}
    ${!compact && incident.evidence?.length ? `<div class="incident-evidence">${incident.evidence.map((item) => `<span>• ${h(item)}</span>`).join('')}</div>` : ''}
  </article>`
}

function toolBar(tool) {
  const total = Math.max(1, tool.calls)
  const ok = Math.round((tool.ok / total) * 100)
  const failed = Math.round((tool.failed / total) * 100)
  const timeout = Math.max(0, 100 - ok - failed)
  return `<div class="tool-bar"><i class="s-ok" style="width:${ok}%"></i><i class="s-fail" style="width:${failed}%"></i><i class="s-timeout" style="width:${timeout}%"></i></div>`
}

function toolList(tools) {
  if (!tools.length) return empty('Инструменты не вызывались', 'Агент ещё не запускал инструменты за это окно', 'tools')
  return tools
    .slice(0, 10)
    .map(
      (tool) => `<div class="tool-row">
        <div class="tool-top">
          <span class="name">${h(tool.name)}</span>
          <span class="nums">${num(tool.calls)} · ${tool.failed ? `<span style="color:var(--err)">${tool.failed} ош.</span>` : '0 ош.'} · ${pct(tool.successRate)}</span>
        </div>
        ${toolBar(tool)}
      </div>`
    )
    .join('')
}

/* ---------- overview ---------- */

function renderOverview(data) {
  const overview = data.overview
  const c = overview.counts
  const t = overview.timing
  const probe = overview.probe ?? {}
  const live = overview.live ?? { runs: 0, steps: 0 }
  const incidents = overview.topIncidents ?? []
  const critical = c.critical
  const statusClass = live.runs > 0 ? 'live' : critical > 0 ? 'bad' : c.warnings > 0 ? 'warn' : ''
  const title =
    live.runs > 0
      ? 'Агент работает'
      : critical > 0
        ? 'Требуется внимание'
        : c.warnings > 0
          ? 'Есть предупреждения'
          : 'Всё спокойно'
  const subtitle =
    live.runs > 0
      ? `${live.runs} запуск(ов) идут, ${live.steps} шаг(ов) в работе. Ниже — что уже произошло.`
      : `${c.runs} запусков за ${state.hours} ч · ${c.errorRuns} с ошибкой · ${c.incidents} инцидентов. ${
          probe.attached ? 'Живой зонд слушает IDE.' : 'Файловый режим: данные из отчётов обменов.'
        }`
  const maxActivity = Math.max(1, ...(overview.activity ?? []).map((bucket) => bucket.runs))

  const chart = (overview.activity ?? [])
    .map((bucket) => {
      const height = Math.max(2, Math.round((bucket.runs / maxActivity) * 100))
      const errorShare = bucket.runs > 0 ? Math.round((bucket.errors / bucket.runs) * 100) : 0
      return `<div class="activity-col" title="${h(time(bucket.at))} · ${bucket.runs} запусков, ${bucket.errors} ошибок">
        <div class="activity-stack" style="height:${height}%">
          ${bucket.errors ? `<div class="activity-errors" style="height:${errorShare}%"></div>` : ''}
          <div class="activity-runs" style="height:${100 - (bucket.errors ? errorShare : 0)}%"></div>
        </div>
      </div>`
    })
    .join('')

  const recent = overview.recentRuns ?? []
  const settings = state.meta?.meta?.settings ?? null
  const sources = overview.sources ?? {}
  const hints = []
  const seen = new Set()
  for (const incident of incidents) {
    if (!incident.hint || seen.has(incident.hint)) continue
    seen.add(incident.hint)
    hints.push(incident)
    if (hints.length >= 5) break
  }

  return `
  <section class="hero ${statusClass} ${live.runs > 0 ? 'hero-live' : ''}">
    <div class="hero-signal"></div>
    <div class="hero-copy">
      <div class="hero-kicker">пульс ide · ${h(state.hours)} ч</div>
      <h2>${title}</h2>
      <p>${h(subtitle)}</p>
      <div class="hero-chips">
        <span class="chip ${probe.attached ? 'ok' : 'warn'}">${probe.attached ? 'зонд подключён' : 'файловый режим'}</span>
        ${settings?.model ? `<span class="chip mono">${h(settings.model)}</span>` : ''}
        ${settings?.providerName ? `<span class="chip">${h(settings.providerName)}</span>` : ''}
        ${live.runs ? `<span class="chip accent">${live.runs} в работе</span>` : ''}
        ${critical ? `<span class="chip err">${critical} критических</span>` : '<span class="chip ok">критических нет</span>'}
        ${overview.generatedAt ? `<span class="chip">обновлено ${h(rel(overview.generatedAt))}</span>` : ''}
      </div>
    </div>
    <div class="hero-side">
      <div class="metric"><b>${num(c.runs)}</b><span>запусков</span></div>
      <div class="metric"><b class="${c.errorRuns ? 'err' : 'ok'}">${num(c.errorRuns)}</b><span>с ошибкой</span></div>
      <div class="metric"><b class="${c.critical ? 'err' : 'ok'}">${num(c.critical)}</b><span>критических</span></div>
    </div>
  </section>

  <div class="stats">
    <div class="stat">
      <div class="stat-label"><svg class="ico-sm"><use href="#i-runs"/></svg>Запуски</div>
      <div class="stat-value">${num(c.runs)}</div>
      <div class="stat-foot">${num(c.liveRuns)} идут · всего <b>${num(c.runsTotal)}</b></div>
    </div>
    <div class="stat ${c.errorRuns ? 'err' : 'ok'}">
      <div class="stat-label"><svg class="ico-sm"><use href="#i-incidents"/></svg>Ошибки</div>
      <div class="stat-value">${num(c.errorRuns)}</div>
      <div class="stat-foot">${num(c.incompleteRuns)} оборвано</div>
    </div>
    <div class="stat ${c.critical ? 'err' : c.warnings ? 'warn' : ''}">
      <div class="stat-label">Инциденты</div>
      <div class="stat-value">${num(c.incidents)}</div>
      <div class="stat-foot">${num(c.critical)} крит · ${num(c.warnings)} предупр</div>
    </div>
    <div class="stat ${c.failedTools ? 'warn' : ''}">
      <div class="stat-label"><svg class="ico-sm"><use href="#i-tools"/></svg>Инструменты</div>
      <div class="stat-value">${num(c.toolCalls)}</div>
      <div class="stat-foot">${num(c.failedTools)} ошибок · ${num(c.timeouts)} таймаутов</div>
    </div>
    <div class="stat ${t.p95RunMs > 300_000 ? 'warn' : ''}">
      <div class="stat-label">p95 запуска</div>
      <div class="stat-value">${h(dur(t.p95RunMs))}</div>
      <div class="stat-foot">медиана <b>${h(dur(t.medianRunMs))}</b></div>
    </div>
    <div class="stat accent">
      <div class="stat-label">Токены</div>
      <div class="stat-value">${num(overview.usage.promptTokens)}<small>prompt</small></div>
      <div class="stat-foot">completion <b>${num(overview.usage.completionTokens)}</b></div>
    </div>
  </div>

  <div class="grid main section">
    <div class="card">
      <div class="card-head">
        <h3>Активность</h3>
        <div class="legend"><span><i style="background:#6f8fb8"></i>запуски</span><span><i style="background:#fb7185"></i>ошибки</span></div>
      </div>
      <div class="chart">${chart}</div>
      <div class="chart-foot"><span>${h(time((overview.activity ?? [])[0]?.at))}</span><span>${h(time((overview.activity ?? [])[Math.floor((overview.activity ?? []).length / 2)]?.at))}</span><span>сейчас</span></div>
    </div>
    <div class="card">
      <div class="card-head">
        <h3>Требует внимания</h3>
        <button class="btn sm ghost" data-view="incidents">Все инциденты →</button>
      </div>
      ${incidents.length ? incidents.slice(0, 5).map((incident) => incidentCard(incident, { compact: true })).join('') : empty('Проблем не найдено', 'За это окно инцидентов не было', 'incidents')}
    </div>
  </div>

  <div class="grid main section">
    <div class="card flush">
      <div class="card-head" style="padding:15px 15px 0">
        <h3>Последние запуски</h3>
        <button class="btn sm ghost" data-view="runs">Все запуски →</button>
      </div>
      ${
        recent.length
          ? `<div class="table-wrap"><table class="table">
              <thead><tr><th>Статус</th><th>Когда</th><th>Запрос</th><th>Шаги</th><th class="num">Время</th></tr></thead>
              <tbody>${recent
                .map(
                  (run) => `<tr class="clickable" data-run="${h(run.id)}">
                    <td>${statusPill(run)}</td>
                    <td class="time">${h(rel(run.startedAt))}</td>
                    <td class="req"><b>${h(run.user || run.mode || '(без текста)')}</b></td>
                    <td class="num">${num(run.steps)}${run.failed ? ` <span style="color:var(--err)">(${run.failed})</span>` : ''}</td>
                    <td class="num">${h(dur(run.durationMs))}</td>
                  </tr>`
                )
                .join('')}</tbody>
            </table></div>`
          : empty('Запусков ещё нет', 'Сделайте запрос в IDE — Snitch подхватит его из отчёта обмена', 'runs')
      }
    </div>
    <div class="card">
      <div class="card-head">
        <h3>Здоровье инструментов</h3>
        <button class="btn sm ghost" data-view="tools">Подробнее →</button>
      </div>
      ${toolList(overview.toolHealth ?? [])}
    </div>
  </div>

  <div class="grid equal section">
    <div class="card">
      <div class="card-head"><h3>Что проверить</h3><span class="sub">подсказки по инцидентам</span></div>
      ${
        hints.length
          ? hints
              .map(
                (incident, index) => `<div class="list-item">
                  <div class="incident-meta"><span class="chip mono">${index + 1}</span>${severityPill(incident.severity)}<span>${h(time(incident.at))}</span></div>
                  <div style="font-size:12px;margin-top:4px"><b>${h(incident.title)}</b></div>
                  <div style="color:var(--muted);font-size:11px;margin-top:3px">${h(incident.hint ?? '')}</div>
                </div>`
              )
              .join('')
          : `<div class="list-item"><div class="incident-hint"><b>Явных проблем нет.</b> Откройте последние запуски и сверьте результат с ожиданием. Если что-то сломалось без ошибки в логе, проверьте шаги вручную.</div></div>`
      }
    </div>
    <div class="card">
      <div class="card-head"><h3>Источники</h3><button class="btn sm ghost" data-view="diagnostics">Диагностика →</button></div>
      <div class="kv"><span class="k">Профиль IDE</span><span class="v mono">${h(sources.userData ?? 'не найден')}</span></div>
      <div class="kv"><span class="k">Рабочая папка</span><span class="v mono">${h(sources.workspace ?? 'не открыта')}</span></div>
      <div class="kv"><span class="k">Отчёты обменов</span><span class="v mono">${h(sources.exchangeDir ?? '—')}</span></div>
      <div class="kv"><span class="k">Лог приложения</span><span class="v mono">${h(sources.logFile ?? 'нет файла')}</span></div>
      <div class="kv"><span class="k">Модель</span><span class="v">${h(settings?.model ?? 'не выбрана')}</span></div>
      <div class="kv"><span class="k">Режим подтверждений</span><span class="v">${h(settings?.approvalMode ?? '—')}</span></div>
      <div class="kv"><span class="k">Последний скан</span><span class="v">${h(state.health?.lastScan?.at ? time(state.health.lastScan.at, true) : '—')}</span></div>
    </div>
  </div>`
}

/* ---------- runs ---------- */

function renderRuns(data) {
  const runs = data.runs ?? []
  const query = state.query.toLowerCase()
  const filters = [
    ['all', 'Все', runs.length],
    ['error', 'Ошибки', runs.filter((run) => run.status === 'error').length],
    ['incomplete', 'Оборваны', runs.filter((run) => run.status === 'incomplete').length],
    ['live', 'Идут', runs.filter((run) => run.live).length],
    ['ok', 'Успешные', runs.filter((run) => run.status === 'ok' && !run.live).length]
  ]
  const filtered = runs.filter((run) => {
    if (state.runsStatus === 'live') return run.live
    if (state.runsStatus !== 'all' && run.status !== state.runsStatus) return false
    if (query && !`${run.user} ${run.answerPreview} ${run.model} ${run.error}`.toLowerCase().includes(query)) return false
    return true
  })

  return `
  <div class="filters">
    ${filters.map(([value, label, count]) => `<button class="filter-btn ${state.runsStatus === value ? 'active' : ''}" data-run-status="${value}">${label}<span class="count">${count}</span></button>`).join('')}
    <span class="filter-sep"></span>
    <span class="chip">${filtered.length} из ${runs.length}</span>
    <span class="chip">окно ${h(state.hours)} ч</span>
  </div>
  <div class="card flush">
    ${
      filtered.length
        ? `<div class="table-wrap"><table class="table">
            <thead><tr><th>Статус</th><th>Начало</th><th>Запрос</th><th>Модель</th><th class="num">Длительность</th><th class="num">Шаги</th><th class="num">Файлы</th><th class="num">Токены</th><th>ID</th></tr></thead>
            <tbody>${filtered
              .map(
                (run) => `<tr class="clickable" data-run="${h(run.id)}">
                  <td>${statusPill(run)}</td>
                  <td class="time">${h(time(run.startedAt))}</td>
                  <td class="req"><b>${h(run.user || '(без текста запроса)')}</b>${run.error ? `<div style="color:var(--err);font-size:10.5px;margin-top:2px">${h(String(run.error).slice(0, 140))}</div>` : ''}</td>
                  <td class="mono" style="font-size:10.5px;color:var(--muted)">${h(run.model ?? '—')}</td>
                  <td class="num">${h(dur(run.durationMs))}</td>
                  <td class="num">${num(run.counts?.steps ?? 0)}${run.counts?.failed ? ` <span style="color:var(--err)">(${run.counts.failed})</span>` : ''}</td>
                  <td class="num">${num(run.files ?? 0)}</td>
                  <td class="num">${run.usage ? num((run.usage.promptTokens ?? 0) + (run.usage.completionTokens ?? 0)) : '—'}</td>
                  <td class="id">${h(String(run.id).slice(0, 12))}</td>
                </tr>`
              )
              .join('')}</tbody>
          </table></div>`
        : empty(query ? 'Ничего не найдено' : 'Запусков нет', query ? 'Попробуйте другой запрос' : 'Сделайте запрос в IDE или измените окно наблюдения', 'runs')
    }
  </div>`
}

/* ---------- incidents ---------- */

function renderIncidents(data) {
  const incidents = data.incidents ?? []
  const query = state.query.toLowerCase()
  const filtered = incidents.filter((incident) => {
    if (state.incidentsSeverity !== 'all' && incident.severity !== state.incidentsSeverity) return false
    if (query && !`${incident.title} ${incident.detail} ${incident.kind}`.toLowerCase().includes(query)) return false
    return true
  })
  const counts = {
    all: incidents.length,
    critical: incidents.filter((item) => item.severity === 'critical').length,
    warning: incidents.filter((item) => item.severity === 'warning').length,
    info: incidents.filter((item) => item.severity === 'info').length
  }
  return `
  <div class="filters">
    ${[['all', 'Все'], ['critical', 'Критичные'], ['warning', 'Важные'], ['info', 'Инфо']]
      .map(([value, label]) => `<button class="filter-btn ${state.incidentsSeverity === value ? 'active' : ''}" data-severity="${value}">${label}<span class="count">${counts[value]}</span></button>`)
      .join('')}
    <span class="filter-sep"></span>
    <span class="chip err">${counts.critical} критичных</span>
    <span class="chip warn">${counts.warning} важных</span>
    <span class="chip">${filtered.length} показано</span>
  </div>
  ${filtered.length ? filtered.map((incident) => incidentCard(incident)).join('') : empty(query ? 'Ничего не найдено' : 'Инцидентов нет', query ? 'Попробуйте другой запрос' : 'Snitch не нашёл проблем за это окно', 'incidents')}`
}

/* ---------- events ---------- */

function renderEvents(data) {
  const events = (data.events ?? []).filter((event) => {
    if (state.eventsLevel !== 'all' && event.level !== state.eventsLevel) return false
    if (state.eventsKind !== 'all' && event.kind !== state.eventsKind) return false
    return true
  })
  const kinds = [...new Set((data.events ?? []).map((event) => event.kind).filter(Boolean))].sort()
  return `
  <div class="filters">
    ${[['all', 'Все'], ['error', 'Ошибки'], ['warning', 'Важные'], ['info', 'Инфо'], ['success', 'Успех']]
      .map(([value, label]) => `<button class="filter-btn ${state.eventsLevel === value ? 'active' : ''}" data-event-level="${value}">${label}</button>`)
      .join('')}
    <span class="filter-sep"></span>
    <select class="select" id="eventKind" aria-label="Тип события">
      <option value="all">все типы</option>
      ${kinds.map((kind) => `<option value="${h(kind)}" ${state.eventsKind === kind ? 'selected' : ''}>${h(kind)}</option>`).join('')}
    </select>
    <span class="chip">${events.length} из ${(data.events ?? []).length} · всего ${num(data.total ?? 0)}</span>
  </div>
  <div class="card">
    ${events.length ? events.map((event) => eventRow(event)).join('') : empty('Событий нет', 'За это окно ничего не произошло', 'events')}
  </div>`
}

/* ---------- tools ---------- */

function renderTools(data) {
  const tools = data.tools ?? []
  const totalCalls = tools.reduce((sum, tool) => sum + tool.calls, 0)
  const failed = tools.reduce((sum, tool) => sum + tool.failed, 0)
  const timeouts = tools.reduce((sum, tool) => sum + tool.timeouts, 0)
  const failures = tools
    .flatMap((tool) => (tool.topFailures ?? []).map((failure) => ({ ...failure, tool: tool.name })))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
  return `
  <div class="stats" style="grid-template-columns:repeat(4,minmax(0,1fr))">
    <div class="stat"><div class="stat-label">Вызовов</div><div class="stat-value">${num(totalCalls)}</div><div class="stat-foot">за ${h(state.hours)} ч</div></div>
    <div class="stat ${failed ? 'err' : 'ok'}"><div class="stat-label">Ошибок</div><div class="stat-value">${num(failed)}</div><div class="stat-foot">${totalCalls ? pct(failed / totalCalls) : '—'} от вызовов</div></div>
    <div class="stat ${timeouts ? 'warn' : ''}"><div class="stat-label">Таймаутов</div><div class="stat-value">${num(timeouts)}</div><div class="stat-foot">не уложились в лимит</div></div>
    <div class="stat"><div class="stat-label">Инструментов</div><div class="stat-value">${num(tools.length)}</div><div class="stat-foot">уникальных имён</div></div>
  </div>
  <div class="card flush section">
    ${
      tools.length
        ? `<div class="table-wrap"><table class="table">
            <thead><tr><th>Инструмент</th><th class="num">Вызовы</th><th class="num">Ок</th><th class="num">Ошибки</th><th class="num">Таймауты</th><th>Успех</th><th class="num">p95</th><th>Последний</th></tr></thead>
            <tbody>${tools
              .map(
                (tool) => `<tr>
                  <td class="mono strong">${h(tool.name)}</td>
                  <td class="num">${num(tool.calls)}</td>
                  <td class="num">${num(tool.ok)}</td>
                  <td class="num" style="${tool.failed ? 'color:var(--err)' : ''}">${num(tool.failed)}</td>
                  <td class="num" style="${tool.timeouts ? 'color:var(--warn)' : ''}">${num(tool.timeouts)}</td>
                  <td style="min-width:120px"><div class="bar-mini"><i class="${tool.successRate < 0.7 ? 'err' : tool.successRate < 0.9 ? 'warn' : ''}" style="width:${Math.round((tool.successRate ?? 0) * 100)}%"></i></div></td>
                  <td class="num">${h(dur(tool.p95Ms))}</td>
                  <td class="time">${h(rel(tool.lastAt))}</td>
                </tr>`
              )
              .join('')}</tbody>
          </table></div>`
        : empty('Инструменты не вызывались', 'За это окно агент не использовал инструменты', 'tools')
    }
  </div>
  <div class="grid equal">
    <div class="card">
      <div class="card-head"><h3>Частые ошибки</h3><span class="sub">топ по числу повторов</span></div>
      ${failures.length ? failures.map((failure) => `<div class="list-item"><div class="incident-meta"><span class="chip mono">${h(failure.tool)}</span><span>×${failure.count}</span></div><div style="font-size:11.5px;margin-top:3px">${h(failure.summary)}</div></div>`).join('') : empty('Ошибок нет', 'Все вызовы завершились успешно', 'tools')}
    </div>
    <div class="card">
      <div class="card-head"><h3>Распределение</h3><span class="sub">доля вызовов</span></div>
      ${tools.slice(0, 8).map((tool) => `<div class="tool-row"><div class="tool-top"><span class="name">${h(tool.name)}</span><span class="nums">${num(tool.calls)} · ${pct(tool.calls / Math.max(1, totalCalls))}</span></div><div class="bar-mini"><i style="width:${Math.round((tool.calls / Math.max(1, totalCalls)) * 100)}%"></i></div></div>`).join('') || empty('Нет данных', '', 'tools')}
    </div>
  </div>`
}

/* ---------- files ---------- */

function renderFiles(data) {
  const query = state.query.toLowerCase()
  const files = (data.files ?? []).filter((file) => !query || String(file.path).toLowerCase().includes(query))
  return `
  <div class="filters">
    <span class="chip">${files.length} файлов</span>
    <span class="chip">${num((data.files ?? []).reduce((sum, file) => sum + file.count, 0))} касаний</span>
    <span class="chip">окно ${h(state.hours)} ч</span>
  </div>
  <div class="card flush">
    ${
      files.length
        ? `<div class="table-wrap"><table class="table">
            <thead><tr><th>Файл</th><th>Действия</th><th class="num">Касаний</th><th class="num">Ошибок</th><th class="num">Запусков</th><th>Последний раз</th></tr></thead>
            <tbody>${files
              .map(
                (file) => `<tr>
                  <td class="mono" style="font-size:10.5px;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${h(file.path)}">${h(file.path)}</td>
                  <td>${(file.actions ?? []).map((action) => `<span class="chip mono">${h(action)}</span>`).join(' ')}</td>
                  <td class="num">${num(file.count)}</td>
                  <td class="num" style="${file.failed ? 'color:var(--err)' : ''}">${num(file.failed)}</td>
                  <td class="num">${num(file.runCount ?? (file.runIds ?? []).length)}</td>
                  <td class="time">${h(rel(file.lastAt))}</td>
                </tr>`
              )
              .join('')}</tbody>
          </table></div>`
        : empty(query ? 'Ничего не найдено' : 'Файлы не менялись', query ? 'Попробуйте другой путь' : 'Агент не трогал файлы за это окно', 'files')
    }
  </div>`
}

/* ---------- commands ---------- */

function renderCommands(data) {
  const query = state.query.toLowerCase()
  const commands = (data.commands ?? []).filter(
    (command) => !query || `${command.command} ${command.outputTail} ${command.summary}`.toLowerCase().includes(query)
  )
  const failed = (data.commands ?? []).filter((command) => command.ok === false || command.timedOut).length
  return `
  <div class="filters">
    <span class="chip">${commands.length} команд</span>
    <span class="chip ${failed ? 'err' : 'ok'}">${failed} с ошибкой</span>
    <span class="chip">окно ${h(state.hours)} ч</span>
  </div>
  ${
    commands.length
      ? `<div class="card">${commands
          .map(
            (command) => `<div class="command-item">
              <div class="command-top">
                <span class="step-idx">${command.ok ? '✓' : '✕'}</span>
                <span class="cmd">${h(command.command)}</span>
                ${command.timedOut ? '<span class="pill warn">таймаут</span>' : `<span class="pill ${command.ok ? 'ok' : 'error'}">${command.exitCode != null ? `код ${h(command.exitCode)}` : command.ok ? 'ок' : 'ошибка'}</span>`}
              </div>
              <div class="command-meta">
                <span>${h(time(command.at, true))}</span>
                <span>${h(dur(command.durationMs))}</span>
                ${command.runId ? `<button class="chip mono" data-run="${h(command.runId)}">${h(String(command.runId).slice(0, 10))}</button>` : ''}
                ${command.port ? `<span>порт ${h(command.port)}</span>` : ''}
              </div>
              ${command.outputTail ? `<details class="command-output"><summary class="faint" style="cursor:pointer;font-size:10px">вывод</summary><pre class="code-block">${h(command.outputTail)}</pre></details>` : ''}
            </div>`
          )
          .join('')}</div>`
      : empty(query ? 'Ничего не найдено' : 'Команд не было', query ? 'Попробуйте другой запрос' : 'Агент не запускал команды за это окно', 'commands')
  }`
}

/* ---------- mcp ---------- */

function renderMcp(data) {
  const configured = data.configured ?? []
  const runtime = data.runtime ?? []
  const events = data.events ?? []
  return `
  <div class="grid c2 section">
    <div class="card">
      <div class="card-head"><h3>Настроенные серверы</h3><span class="sub">${configured.length}</span></div>
      ${
        configured.length
          ? configured
              .map(
                (server) => `<div class="list-item">
                  <div style="display:flex;align-items:center;gap:8px">
                    <b style="font-size:12px">${h(server.name)}</b>
                    <span class="chip mono">${h(server.transport)}</span>
                    ${server.enabled ? '<span class="pill ok">включён</span>' : '<span class="pill neutral">выключен</span>'}
                    ${server.trusted ? '<span class="chip accent">доверенный</span>' : ''}
                  </div>
                  <div class="incident-meta">
                    ${server.command ? `<span class="mono">${h(server.command)}${server.argsCount ? ` +${server.argsCount}` : ''}</span>` : ''}
                    ${server.urlHost ? `<span class="mono">${h(server.urlHost)}</span>` : ''}
                    ${server.timeoutMs ? `<span>таймаут ${h(server.timeoutMs)} мс</span>` : ''}
                    ${server.defaultRisk ? `<span>риск ${h(server.defaultRisk)}</span>` : ''}
                    ${server.envKeys?.length ? `<span>env: ${server.envKeys.map((key) => h(key)).join(', ')}</span>` : ''}
                  </div>
                </div>`
              )
              .join('')
          : empty('MCP не настроен', 'Добавьте серверы в mcp.json профиля IDE', 'mcp')
      }
    </div>
    <div class="card">
      <div class="card-head"><h3>Состояние сейчас</h3><span class="sub">${runtime.length} процессов</span></div>
      ${
        runtime.length
          ? runtime
              .map(
                (server) => `<div class="list-item">
                  <div style="display:flex;align-items:center;gap:8px">
                    <b style="font-size:12px">${h(server.name)}</b>
                    <span class="pill ${server.status === 'ready' ? 'ok' : server.status === 'error' ? 'error' : 'neutral'}">${h(server.status ?? 'unknown')}</span>
                    ${server.pid ? `<span class="chip mono">pid ${h(server.pid)}</span>` : ''}
                  </div>
                  <div class="incident-meta">
                    <span>${h(server.tools ?? 0)} инструментов</span>
                    ${server.restarts ? `<span>перезапусков ${h(server.restarts)}</span>` : ''}
                  </div>
                  ${server.error ? `<div class="incident-detail">${h(server.error)}</div>` : ''}
                </div>`
              )
              .join('')
          : empty('Нет живых данных', 'Состояние появится, когда зонд подключён к IDE', 'mcp')
      }
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h3>События MCP</h3><span class="sub">${events.length}</span></div>
    ${events.length ? events.map((event) => eventRow(event)).join('') : empty('Событий MCP нет', '', 'mcp')}
  </div>`
}

/* ---------- live ---------- */

function renderLive(data) {
  const probe = data.live ?? {}
  const meta = data.meta ?? {}
  const attached = probe.attached === true || meta.attached === true
  const lastSeen = meta.lastSeen ?? probe.lastSeen
  const events = (data.events ?? []).filter((event) =>
    ['probe', 'step-start', 'step-end', 'run-start', 'run-end', 'error', 'notice', 'mcp', 'terminal', 'network', 'approval', 'console', 'renderer-error', 'workspace'].includes(event.kind)
  )
  const servers = data.servers ?? []
  return `
  <div class="live-hero">
    <div class="live-orbit ${attached ? 'on' : ''}"><i></i></div>
    <div class="live-copy">
      <h2>${attached ? 'Живой зонд подключён' : 'Живой режим не подключён'}</h2>
      <p>${
        attached
          ? `События идут из окна IDE${probe.port ? ` на порту ${h(probe.port)}` : ''}. Последний сигнал: ${h(rel(lastSeen))}.`
          : `Сейчас работает файловый режим: Snitch читает отчёты обменов после каждого запуска. Для токенов и шагов в реальном времени откройте DevTools-порт IDE и нажмите «Подключить».`
      }</p>
      <div class="hero-chips">
        <span class="chip ${attached ? 'ok' : 'warn'}">${attached ? 'подключён' : 'не подключён'}</span>
        ${probe.port ? `<span class="chip mono">порт ${h(probe.port)}</span>` : ''}
        ${data.detectedPort ? `<span class="chip mono">DevTools ${h(data.detectedPort)}</span>` : ''}
        ${probe.reason ? `<span class="chip">${h(probe.reason)}</span>` : ''}
      </div>
    </div>
    <div style="display:flex;gap:7px;flex-wrap:wrap">
      <button class="btn accent" data-action="attach"><svg class="ico-sm"><use href="#i-live"/></svg>Подключить</button>
      <button class="btn ghost" data-action="scan"><svg class="ico-sm"><use href="#i-scan"/></svg>Скан</button>
    </div>
  </div>

  <div class="grid c2 section">
    <div class="card">
      <div class="card-head"><h3>Как включить живой режим</h3><span class="sub">один перезапуск IDE</span></div>
      <div class="note" style="margin-bottom:10px">Snitch не меняет исходники IDE. Он подключается к уже существующему DevTools-порту и подписывается на события через <span class="mono">window.relaxcode</span>.</div>
      <div class="faint" style="font-size:10px;text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">cmd.exe</div>
      <div class="code-block" style="margin-bottom:9px">set RELAXCODE_DEBUG_PORT=9333
npm run dev</div>
      <div class="faint" style="font-size:10px;text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">PowerShell</div>
      <div class="code-block" style="margin-bottom:9px">$env:RELAXCODE_DEBUG_PORT=9333; npm run dev</div>
      <div class="muted" style="font-size:11px">После запуска IDE нажмите «Подключить». Порт также ищется автоматически: ${(data.ports ?? []).map((port) => `<span class="chip mono">${port}</span>`).join(' ') || '—'}.</div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Состояние зонда</h3><span class="sub">${attached ? 'online' : 'offline'}</span></div>
      <div class="kv"><span class="k">Подключён</span><span class="v">${attached ? 'да' : 'нет'}</span></div>
      <div class="kv"><span class="k">Порт</span><span class="v mono">${h(probe.port ?? '—')}</span></div>
      <div class="kv"><span class="k">Окно</span><span class="v mono">${h(probe.target?.url ?? probe.target ?? meta.target ?? '—')}</span></div>
      <div class="kv"><span class="k">Последний сигнал</span><span class="v">${h(lastSeen ? time(lastSeen, true) : '—')}</span></div>
      <div class="kv"><span class="k">Последнее внедрение</span><span class="v">${h(probe.lastInjectAt ? time(probe.lastInjectAt, true) : '—')}</span></div>
      <div class="kv"><span class="k">Попыток подключения</span><span class="v">${h(probe.attempts ?? 0)}</span></div>
      <div class="kv"><span class="k">Причина</span><span class="v">${h(probe.reason ?? '—')}</span></div>
      <div class="kv"><span class="k">Живой режим в конфиге</span><span class="v">${data.enabled ? 'включён' : 'выключен'}</span></div>
    </div>
  </div>

  <div class="grid main">
    <div class="card">
      <div class="card-head"><h3>Живая лента</h3><span class="sub">${events.length} событий</span></div>
      ${events.length ? `<div class="list">${events.slice(0, 60).map((event) => eventRow(event)).join('')}</div>` : empty('Пока тихо', 'Подключите зонд — события появятся здесь без перезагрузки', 'live')}
    </div>
    <div class="card">
      <div class="card-head"><h3>Фоновые процессы</h3><span class="sub">${servers.length}</span></div>
      ${
        servers.length
          ? servers
              .map(
                (server) => `<div class="list-item">
                  <div style="display:flex;gap:8px;align-items:center">
                    <span class="probe-dot ${server.running ? 'on' : ''}"></span>
                    <span class="mono" style="font-size:10.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(server.command ?? server.id ?? 'процесс')}</span>
                    ${server.port ? `<span class="chip mono">:${h(server.port)}</span>` : ''}
                  </div>
                </div>`
              )
              .join('')
          : empty('Процессов нет', 'Данные появятся из живого зонда', 'commands')
      }
    </div>
  </div>`
}

/* ---------- AI brief ---------- */

function renderAi(data) {
  const brief = state.brief || data.brief || ''
  const meta = state.meta?.meta ?? {}
  return `
  <div class="brief-layout">
    <div class="card brief-card">
      <div class="brief-meta">
        <span class="chip accent">готово для вставки</span>
        <span class="chip">окно ${h(state.hours)} ч</span>
        <span class="chip">${num(brief.length)} символов</span>
        <span class="chip">${h(state.health?.stats?.runs ?? 0)} запусков в хранилище</span>
      </div>
      <div class="md">${brief ? renderMarkdown(brief) : empty('Отчёт пуст', 'Нажмите «Обновить»', 'ai')}</div>
    </div>
    <aside class="brief-side">
      <div class="card">
        <h4>Как это использовать</h4>
        <p>Скопируйте отчёт и вставьте агенту в чат вместо объяснения проблемы. Или подключите MCP — агент сам вызовет <span class="mono">snitch_brief</span>.</p>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:9px">
          <button class="btn accent wide" data-action="copy-brief"><svg class="ico-sm"><use href="#i-copy"/></svg>Копировать отчёт</button>
          <a class="btn ghost wide" href="/api/brief?hours=${h(state.hours)}&amp;download=1"><svg class="ico-sm"><use href="#i-download"/></svg>Скачать .md</a>
          <button class="btn ghost wide" data-action="write-digest">Записать в out/</button>
        </div>
        ${state.lastDigest ? `<div class="faint" style="font-size:10px;margin-top:7px">сохранено: <span class="mono">${h(state.lastDigest)}</span></div>` : ''}
      </div>
      <div class="card">
        <h4>Что внутри</h4>
        <ul>
          <li>Точные запуски, шаги и упавшие команды с хвостом вывода.</li>
          <li>Инциденты с severity, деталями и подсказкой.</li>
          <li>Тайминги, таймауты и здоровье инструментов.</li>
          <li>Правила: не переспрашивать, проверять, не выдумывать успех.</li>
        </ul>
      </div>
      <div class="card">
        <h4>MCP</h4>
        <p>Добавьте в настройки MCP IDE:</p>
        <div class="code-block" style="margin-top:6px;font-size:10px">{
  "mcpServers": {
    "snitch": {
      "command": "node",
      "args": ["<SNITCH>/src/mcp.mjs"]
    }
  }
}</div>
        <p style="margin-top:7px">Вместо <span class="mono">&lt;SNITCH&gt;</span>:<br><span class="mono">${h(meta.sources?.snitchRoot ?? 'папка snitch')}</span></p>
      </div>
      <div class="card">
        <h4>HTTP</h4>
        <div class="code-block" style="font-size:10px">GET /api/brief
GET /api/runs/:id
GET /api/incidents
GET /api/events</div>
      </div>
    </aside>
  </div>`
}

/* ---------- diagnostics ---------- */

function renderDiagnostics(data) {
  const paths = data.paths ?? {}
  const counts = data.counts ?? {}
  const probe = data.probe ?? {}
  const config = data.config ?? {}
  const errors = data.errors ?? []
  const pathRows = [
    ['Snitch', paths.snitchRoot],
    ['Данные', paths.dataDir],
    ['Отчёты', paths.outDir],
    ['Профиль IDE', paths.userData],
    ['Рабочая папка', paths.workspace],
    ['Обмены', paths.exchanges],
    ['Кадры', paths.frames],
    ['Лог', paths.log],
    ['MCP-конфиг', paths.mcp],
    ['state.json', paths.state]
  ]
  return `
  <div class="stats" style="grid-template-columns:repeat(4,minmax(0,1fr))">
    <div class="stat"><div class="stat-label">Версия</div><div class="stat-value" style="font-size:19px">${h(data.version)}</div><div class="stat-foot">${h(data.platform)} · Node ${h(data.node)}</div></div>
    <div class="stat"><div class="stat-label">Аптайм</div><div class="stat-value" style="font-size:19px">${h(dur(data.uptimeMs))}</div><div class="stat-foot">с ${h(time(data.startedAt))}</div></div>
    <div class="stat"><div class="stat-label">Запусков в хранилище</div><div class="stat-value">${num(data.stats?.runs ?? 0)}</div><div class="stat-foot">${num(data.stats?.events ?? 0)} событий</div></div>
    <div class="stat ${counts.state?.bytes > 20 * 1024 * 1024 ? 'warn' : ''}"><div class="stat-label">state.json</div><div class="stat-value" style="font-size:19px">${h(bytes(counts.state?.bytes))}</div><div class="stat-foot">${num(counts.state?.incidents ?? 0)} инцидентов</div></div>
  </div>

  <div class="grid c2 section">
    <div class="card">
      <div class="card-head"><h3>Пути</h3><span class="sub">клик по копии — скопировать</span></div>
      ${pathRows
        .map(
          ([key, value]) => `<div class="path-row"><span class="k">${h(key)}</span><span class="v ${value ? '' : 'missing'}" title="${h(value ?? '')}">${h(value ?? 'не найден')}</span>${value ? `<button class="copy-btn" data-copy="${h(value)}" title="Копировать"><svg><use href="#i-copy"/></svg></button>` : ''}</div>`
        )
        .join('')}
    </div>
    <div class="card">
      <div class="card-head"><h3>Источники</h3><span class="sub">что реально прочитано</span></div>
      <div class="kv"><span class="k">Файлов обменов</span><span class="v">${num(counts.exchanges?.files ?? 0)} · ${h(bytes(counts.exchanges?.bytes))}</span></div>
      <div class="kv"><span class="k">В архиве Snitch</span><span class="v">${num(counts.archived?.files ?? 0)} · ${h(bytes(counts.archived?.bytes))}</span></div>
      <div class="kv"><span class="k">Кадров</span><span class="v">${num(counts.frames ?? 0)}</span></div>
      <div class="kv"><span class="k">Лог приложения</span><span class="v mono">${h(counts.log?.path ?? 'нет файла')} ${counts.log?.bytes != null ? `· ${h(bytes(counts.log.bytes))}` : ''}</span></div>
      <div class="kv"><span class="k">Последний скан</span><span class="v">${h(data.lastScan ? `${time(data.lastScan.at, true)} · ${dur(data.lastScan.durationMs)}` : '—')}</span></div>
      <div class="kv"><span class="k">Новых запусков</span><span class="v">${num(data.lastScan?.newRuns ?? 0)}</span></div>
      <div class="kv"><span class="k">Строк лога</span><span class="v">${num(data.lastScan?.logLines ?? 0)}</span></div>
      <div class="kv"><span class="k">MCP-серверов</span><span class="v">${num(data.lastScan?.mcpServers ?? 0)}</span></div>
      <div style="display:flex;gap:6px;margin-top:11px;flex-wrap:wrap">
        <button class="btn sm" data-action="scan">Сканировать</button>
        <button class="btn sm" data-action="attach">Подключить зонд</button>
        <button class="btn sm" data-action="write-digest">Записать отчёт</button>
        <a class="btn sm ghost" href="/api/export">Экспорт JSON</a>
      </div>
    </div>
  </div>

  <div class="grid c2 section">
    <div class="card">
      <div class="card-head"><h3>Живой зонд</h3><span class="sub">${probe.attached ? 'подключён' : 'не подключён'}</span></div>
      <div class="kv"><span class="k">Порт</span><span class="v mono">${h(probe.port ?? probe.detectedPort ?? '—')}</span></div>
      <div class="kv"><span class="k">Обнаруженный порт</span><span class="v mono">${h(probe.detectedPort ?? '—')}</span></div>
      <div class="kv"><span class="k">Настроенные порты</span><span class="v mono">${(probe.configuredPorts ?? []).map((port) => h(port)).join(', ') || '—'}</span></div>
      <div class="kv"><span class="k">Причина</span><span class="v">${h(probe.reason ?? probe.meta?.reason ?? '—')}</span></div>
      <div class="kv"><span class="k">Последний сигнал</span><span class="v">${h(probe.meta?.lastSeen ? time(probe.meta.lastSeen, true) : '—')}</span></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Конфиг</h3><span class="sub">data/config.json</span></div>
      <pre class="code-block" style="max-height:250px">${h(JSON.stringify(config, null, 2))}</pre>
      <div class="faint" style="font-size:10px;margin-top:7px">Меняется вручную в <span class="mono">data/config.json</span>, применяется после перезапуска.</div>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h3>Ошибки сборщика</h3><span class="sub">${errors.length}</span></div>
    ${errors.length ? errors.slice().reverse().map((error) => `<div class="list-item"><div class="incident-meta"><span class="chip mono">${h(time(error.at, true))}</span></div><div class="incident-detail">${h(error.message)}</div></div>`).join('') : empty('Ошибок нет', 'Сборщик работает штатно', 'diagnostics')}
  </div>`
}

/* ---------- shell ---------- */

function renderHealth() {
  const health = state.health
  const meta = state.meta?.meta ?? {}
  const probe = health?.probe ?? {}
  const strip = $('#healthStrip')
  if (!health) {
    strip.innerHTML = '<span class="h-item"><span class="dot"></span>соединение…</span>'
  } else {
    const settings = meta.settings ?? {}
    strip.innerHTML = `
      <span class="h-item"><span class="dot ${probe.attached ? 'ok' : 'warn'}"></span>${probe.attached ? 'живой зонд' : 'файловый режим'}</span>
      <span class="sep"></span>
      <span class="h-item">запусков <b>${num(health.stats?.runs ?? 0)}</b></span>
      <span class="h-item">инцидентов <b>${num(health.stats?.incidents ?? 0)}</b></span>
      <span class="sep"></span>
      <span class="h-item">скан <b>${h(health.lastScan?.at ? time(health.lastScan.at, true) : '—')}</b></span>
      <span class="sep"></span>
      <span class="h-item">${settings.model ? `модель <b class="mono">${h(settings.model)}</b>` : 'модель не выбрана'}</span>
      <span class="h-item">подтверждения <b>${h(settings.approvalMode ?? '—')}</b></span>
      <span class="h-item" style="margin-left:auto">v${h(health.version ?? '')}</span>`
  }
  const probeCard = $('#probeCard')
  const title = $('#probeTitle')
  const text = $('#probeText')
  const dot = $('#probeDot')
  const attached = probe.attached === true
  dot.className = `probe-dot ${attached ? 'on' : probe.reason ? 'err' : ''}`
  title.textContent = attached ? 'Зонд подключён' : 'Файловый режим'
  text.textContent = attached
    ? probe.port
      ? `порт ${probe.port} · ${probe.target?.url ?? 'IDE'}`
      : 'IDE слушает события'
    : 'отчёты · лог · кадры'
  probeCard.title = probe.reason ?? text.textContent
  $('#versionLabel').textContent = `snitch ${health?.version ?? ''}`.trim()
  const sse = $('#sseLabel')
  sse.className = `sse ${state.sseConnected ? 'on' : 'off'}`
  sse.textContent = state.sseConnected ? 'live' : 'reconnect'
}

function setView(view, { push = true } = {}) {
  if (!VIEWS[view]) view = 'overview'
  state.view = view
  state.query = ''
  const search = $('#search')
  search.value = ''
  if (push && location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`)
  $$('#nav .nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view))
  const config = VIEWS[view]
  $('#viewTitle').textContent = config.title
  $('#viewSubtitle').textContent = config.subtitle
  const wrap = $('#searchWrap')
  wrap.classList.toggle('hidden', !config.search)
  if (config.search) search.placeholder = config.placeholder ?? 'Поиск…'
  loadView()
}

function renderView() {
  const view = state.view
  const data = state.data[view]
  if (!data) {
    mainView.innerHTML = `<div class="skeleton-grid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`
    return
  }
  if (view === 'overview') mainView.innerHTML = renderOverview(data)
  else if (view === 'runs') mainView.innerHTML = renderRuns(data)
  else if (view === 'incidents') mainView.innerHTML = renderIncidents(data)
  else if (view === 'events') mainView.innerHTML = renderEvents(data)
  else if (view === 'tools') mainView.innerHTML = renderTools(data)
  else if (view === 'files') mainView.innerHTML = renderFiles(data)
  else if (view === 'commands') mainView.innerHTML = renderCommands(data)
  else if (view === 'mcp') mainView.innerHTML = renderMcp(data)
  else if (view === 'live') mainView.innerHTML = renderLive(data)
  else if (view === 'ai') mainView.innerHTML = renderAi(data)
  else if (view === 'diagnostics') mainView.innerHTML = renderDiagnostics(data)
}

function renderErrorView(error) {
  mainView.innerHTML = `<div class="card"><div class="empty"><b>Не удалось загрузить данные</b>${h(error.message)}<div style="margin-top:12px"><button class="btn" data-action="refresh">Повторить</button></div></div></div>`
}

async function loadMeta() {
  try {
    state.meta = await api('/api/meta')
  } catch {
    // The meta endpoint is optional chrome around the data.
  }
}

async function loadView({ silent = false } = {}) {
  const view = state.view
  if (!silent) {
    renderView()
    if (!state.data[view]) {
      mainView.innerHTML = `<div class="skeleton-grid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`
    }
  }
  try {
    const hours = state.hours
    let data = null
    if (view === 'overview') {
      data = { overview: await api(`/api/overview?hours=${hours}`) }
    } else if (view === 'runs') {
      data = await api(`/api/runs?hours=${hours}&limit=300&query=${encodeURIComponent(state.query)}`)
    } else if (view === 'incidents') {
      const since = Date.now() - hours * 3_600_000
      const incidents = await api(`/api/incidents?since=${since}&limit=500`)
      data = { incidents }
    } else if (view === 'events') {
      data = await api(`/api/events?limit=400&query=${encodeURIComponent(state.query)}`)
    } else if (view === 'tools') {
      data = await api(`/api/tools?hours=${hours}`)
    } else if (view === 'files') {
      data = await api(`/api/files?hours=${hours}&limit=500`)
    } else if (view === 'commands') {
      data = await api(`/api/commands?hours=${hours}&limit=500`)
    } else if (view === 'mcp') {
      data = await api('/api/mcp')
    } else if (view === 'live') {
      const [probe, events, meta] = await Promise.all([
        api('/api/probe'),
        api('/api/events?limit=120'),
        api('/api/meta')
      ])
      data = { ...probe, events: events.events ?? [], servers: probe.servers ?? meta.meta?.servers ?? [] }
    } else if (view === 'ai') {
      startBusy()
      try {
        const response = await fetch(`/api/brief?hours=${hours}`)
        if (!response.ok) throw new Error(`не удалось собрать отчёт: ${response.status}`)
        state.brief = await response.text()
      } finally {
        endBusy()
      }
      data = { brief: state.brief }
    } else if (view === 'diagnostics') {
      data = await api('/api/diagnostics')
    }
    state.data[view] = data
    if (view !== 'ai') state.lastUpdate = Date.now()
    if (['overview', 'runs', 'incidents', 'live', 'diagnostics'].includes(view)) {
      try {
        state.health = await api('/api/health')
      } catch {
        // keep the previous health snapshot
      }
    }
    if (!state.meta && (view === 'overview' || view === 'ai' || view === 'diagnostics')) {
      await loadMeta()
    }
    renderView()
    renderHealth()
    updateBadges()
  } catch (error) {
    if (!silent) renderErrorView(error)
    toast(error.message, 'error')
  }
}

function updateBadges() {
  const overview = state.data.overview?.overview
  const runs = $('#badgeRuns')
  const incidents = $('#badgeIncidents')
  if (overview) {
    runs.textContent = overview.counts?.liveRuns ? String(overview.counts.liveRuns) : ''
    incidents.textContent = overview.counts?.critical ? String(overview.counts.critical) : ''
  } else if (state.health) {
    runs.textContent = ''
    incidents.textContent = state.health.stats?.incidents ? String(state.health.stats.incidents) : ''
  }
}

/* ---------- drawer ---------- */

let drawerCloseTimer = null
function openDrawer() {
  if (drawerCloseTimer) clearTimeout(drawerCloseTimer)
  drawer.classList.remove('hidden', 'open')
  drawerBackdrop.classList.remove('hidden', 'show')
  // Force a frame so the transform transition runs even in a background tab.
  void drawer.offsetWidth
  drawer.classList.add('open')
  drawerBackdrop.classList.add('show')
}

function closeDrawer() {
  drawer.classList.remove('open')
  drawerBackdrop.classList.remove('show')
  if (drawerCloseTimer) clearTimeout(drawerCloseTimer)
  drawerCloseTimer = setTimeout(() => {
    drawer.classList.add('hidden')
    drawerBackdrop.classList.add('hidden')
  }, 220)
  state.selectedRunId = null
  state.selectedRun = null
}

async function openRun(id) {
  state.selectedRunId = id
  state.runTab = 'overview'
  state.selectedRun = null
  openDrawer()
  drawerContent.innerHTML = `<div class="drawer-head"><div class="grow"><h2>Запуск</h2></div><button class="icon-btn" data-action="close-drawer"><svg><use href="#i-close"/></svg></button></div><div class="drawer-body"><div class="skeleton" style="height:180px"></div></div>`
  try {
    const [runData, events, incidents] = await Promise.all([
      api(`/api/runs/${encodeURIComponent(id)}`),
      api(`/api/events?runId=${encodeURIComponent(id)}&limit=300`),
      api(`/api/incidents?runId=${encodeURIComponent(id)}&limit=100`)
    ])
    state.selectedRun = runData.run
    state.selectedEvents = events.events ?? []
    state.selectedIncidents = incidents.incidents ?? []
    renderDrawer()
  } catch (error) {
    drawerContent.innerHTML = `<div class="drawer-head"><div class="grow"><h2>Запуск</h2></div><button class="icon-btn" data-action="close-drawer"><svg><use href="#i-close"/></svg></button></div><div class="drawer-body"><div class="empty"><b>Не удалось открыть запуск</b>${h(error.message)}</div></div>`
  }
}

function renderDrawer() {
  const run = state.selectedRun
  if (!run) return
  const steps = run.steps ?? []
  const tabs = [
    ['overview', 'Обзор', null],
    ['steps', 'Шаги', steps.length],
    ['files', 'Файлы', run.files?.length ?? 0],
    ['commands', 'Команды', run.commands?.length ?? 0],
    ['events', 'События', state.selectedEvents.length],
    ['incidents', 'Инциденты', state.selectedIncidents.length]
  ]
  let body = ''
  if (state.runTab === 'overview') {
    body = `<div class="drawer-section"><h4>Запрос пользователя</h4>${run.user ? `<div class="user-prompt">${h(run.user)}</div>` : '<div class="faint">текст запроса не записан</div>'}</div>
      ${run.error ? `<div class="drawer-section"><h4>Ошибка</h4><div class="error-block">${h(run.error)}</div></div>` : ''}
      <div class="drawer-section"><h4>Ответ агента</h4>${run.answer ? `<div class="answer-block">${h(run.answer)}</div>` : '<div class="faint">ответа нет</div>'}</div>
      <div class="drawer-section"><h4>Показатели</h4>
        <div class="kv"><span class="k">Длительность</span><span class="v">${h(dur(run.durationMs))}</span></div>
        <div class="kv"><span class="k">Шаги</span><span class="v">${num(run.counts?.steps ?? steps.length)} · ок ${num(run.counts?.ok ?? 0)} · ошибок <span style="color:var(--err)">${num(run.counts?.failed ?? 0)}</span> · без результата ${num(run.counts?.pending ?? 0)}</span></div>
        <div class="kv"><span class="k">Файлы / команды</span><span class="v">${num(run.files?.length ?? 0)} / ${num(run.commands?.length ?? 0)}</span></div>
        <div class="kv"><span class="k">Токены</span><span class="v">${run.usage ? `prompt ${num(run.usage.promptTokens)} · completion ${num(run.usage.completionTokens)} · контекст ${num(run.usage.contextTokens)}` : '—'}</span></div>
        <div class="kv"><span class="k">Модель</span><span class="v">${h(run.model ?? '—')}</span></div>
        <div class="kv"><span class="k">Режим</span><span class="v">${h(run.mode ?? '—')}${run.thinking ? ` · thinking ${h(run.thinking)}` : ''}</span></div>
        <div class="kv"><span class="k">Начат</span><span class="v">${h(time(run.startedAt, true))}</span></div>
        <div class="kv"><span class="k">Источник</span><span class="v">${run.live ? 'живой зонд' : 'отчёт обмена'}</span></div>
      </div>
      ${run.tags?.length ? `<div class="drawer-section"><h4>Теги</h4><div>${run.tags.map((tag) => `<span class="chip mono">${h(tag)}</span>`).join(' ')}</div></div>` : ''}
      ${run.notices?.length ? `<div class="drawer-section"><h4>Предупреждения</h4>${run.notices.map((notice) => `<div class="incident-hint" style="margin-bottom:5px"><b>${h(notice.severity ?? 'info')}:</b> ${h(notice.text)}</div>`).join('')}</div>` : ''}
      ${run.approvals?.length ? `<div class="drawer-section"><h4>Подтверждения</h4>${run.approvals.map((approval) => `<div class="kv"><span class="k">${h(approval.tool)} · ${h(approval.risk)}</span><span class="v">${h(approval.preview)}</span></div>`).join('')}</div>` : ''}
      <div class="drawer-section"><h4>Данные</h4><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm" data-copy="${h(run.id)}">Копировать ID</button>${run.archiveFile ? `<a class="btn sm ghost" href="/api/runs/${encodeURIComponent(run.id)}/archive" target="_blank" rel="noreferrer">Сырой отчёт</a>` : ''}<span class="chip mono">${h(String(run.id).slice(0, 16))}</span></div></div>`
  } else if (state.runTab === 'steps') {
    body = steps.length
      ? steps
          .map(
            (step) => `<details class="step">
              <summary>
                <span class="step-idx">${step.index + 1}</span>
                <span class="step-name">${h(step.name)}</span>
                <span class="step-summary">${h(step.summary || step.argsText || '')}</span>
                ${step.ok === false ? '<span class="pill error">ошибка</span>' : step.ok === null || step.ok === undefined ? '<span class="pill warn">нет результата</span>' : '<span class="pill ok">ок</span>'}
                <span class="step-dur">${h(dur(step.durationMs))}</span>
              </summary>
              <div class="step-body">
                ${step.args && typeof step.args === 'object' ? `<h5>Аргументы</h5><table class="args-table">${Object.entries(step.args).map(([key, value]) => `<tr><td>${h(key)}</td><td>${h(typeof value === 'object' ? JSON.stringify(value) : value).slice(0, 500)}</td></tr>`).join('')}</table>` : ''}
                ${step.summary ? `<h5>Итог</h5><div class="muted" style="font-size:11.5px">${h(step.summary)}</div>` : ''}
                ${step.detail ? `<h5 style="margin-top:9px">Детали</h5><pre class="code-block">${h(step.detail)}</pre>` : ''}
                ${step.warnings?.length ? `<h5>Предупреждения</h5>${step.warnings.map((warning) => `<div class="incident-hint">${h(warning)}</div>`).join('')}` : ''}
                ${step.meta ? `<h5>Результат инструмента</h5><pre class="code-block" style="max-height:180px">${h(JSON.stringify(step.meta, null, 2))}</pre>` : ''}
              </div>
            </details>`
          )
          .join('')
      : empty('Шагов нет', '', 'runs')
  } else if (state.runTab === 'files') {
    body = run.files?.length
      ? run.files
          .map(
            (file) => `<div class="file-chip"><span class="act ${h(file.action)}">${h(file.action)}</span><b>${h(file.path)}</b>${file.from ? `<span class="faint">← ${h(file.from)}</span>` : ''}<span class="faint">${h(time(file.at))}</span>${file.ok === false ? '<span class="pill error">ошибка</span>' : ''}</div>`
          )
          .join('')
      : empty('Файлы не менялись', '', 'files')
  } else if (state.runTab === 'commands') {
    body = run.commands?.length
      ? run.commands
          .map(
            (command) => `<div class="command-item"><div class="command-top"><span class="step-idx">${command.ok ? '✓' : '✕'}</span><span class="cmd">${h(command.command)}</span>${command.timedOut ? '<span class="pill warn">таймаут</span>' : `<span class="pill ${command.ok ? 'ok' : 'error'}">${command.exitCode != null ? `код ${h(command.exitCode)}` : command.ok ? 'ок' : 'ошибка'}</span>`}<span class="step-dur">${h(dur(command.durationMs))}</span></div>${command.outputTail ? `<pre class="code-block" style="margin-top:6px;max-height:240px">${h(command.outputTail)}</pre>` : ''}</div>`
          )
          .join('')
      : empty('Команд не было', '', 'commands')
  } else if (state.runTab === 'events') {
    body = state.selectedEvents.length
      ? `<div class="card" style="border:0;padding:0;background:transparent">${state.selectedEvents.map((event) => eventRow(event)).join('')}</div>`
      : empty('Событий нет', '', 'events')
  } else if (state.runTab === 'incidents') {
    body = state.selectedIncidents.length
      ? state.selectedIncidents.map((incident) => incidentCard(incident)).join('')
      : empty('Инцидентов нет', 'Этот запуск не породил проблем', 'incidents')
  }

  drawerContent.innerHTML = `
    <div class="drawer-head">
      <div class="grow">
        <h2>${h(run.user || run.answer || `Запуск ${String(run.id).slice(0, 10)}`)}</h2>
        <div class="meta">
          ${statusPill(run)}
          <span class="chip mono">${h(String(run.id).slice(0, 12))}</span>
          <span class="chip">${h(time(run.startedAt, true))}</span>
          <span class="chip">${h(dur(run.durationMs))}</span>
          ${run.model ? `<span class="chip mono">${h(run.model)}</span>` : ''}
          <span class="chip">${h(run.mode ?? '—')}</span>
        </div>
      </div>
      <button class="icon-btn" data-action="close-drawer" title="Закрыть (Esc)"><svg><use href="#i-close"/></svg></button>
    </div>
    <div class="drawer-body">
      <div class="drawer-tabs">${tabs.map(([id, label, count]) => `<button class="tab ${state.runTab === id ? 'active' : ''}" data-run-tab="${id}">${label}${count ? `<span class="count">${count}</span>` : ''}</button>`).join('')}</div>
      ${body}
    </div>`
}

/* ---------- actions ---------- */

async function doScan() {
  try {
    const result = await api('/api/scan', { method: 'POST', body: '{}' })
    const summary = result.summary ?? {}
    toast(`Скан: +${summary.newRuns ?? 0} запусков, ${summary.logLines ?? 0} строк лога`)
    state.data = {}
    await loadMeta()
    await loadView()
    state.health = await api('/api/health').catch(() => state.health)
    renderHealth()
  } catch (error) {
    toast(error.message, 'error')
  }
}

async function doDigest() {
  try {
    const result = await api(`/api/digest?hours=${state.hours}`, { method: 'POST', body: '{}' })
    state.lastDigest = result.markdownPath
    toast(`Отчёт записан: ${result.markdownPath}`)
  } catch (error) {
    toast(error.message, 'error')
  }
}

async function doAttach() {
  try {
    const result = await api('/api/attach', { method: 'POST', body: '{}' })
    toast(result.attached ? 'Живой зонд подключён' : `Не подключился: ${result.probe?.reason ?? 'причина неизвестна'}`, result.attached ? '' : 'warn')
    state.health = await api('/api/health').catch(() => state.health)
    renderHealth()
    if (state.view === 'live') await loadView({ silent: true })
  } catch (error) {
    toast(error.message, 'error')
  }
}

function refresh() {
  loadView()
  loadMeta().then(renderHealth)
}

/* ---------- events ---------- */

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-view], [data-action], [data-run], [data-run-tab], [data-run-status], [data-severity], [data-event-level], [data-copy], [data-event-key]')
  if (!target) return
  if (target.dataset.copy != null) {
    event.stopPropagation()
    copyText(target.dataset.copy, 'Скопировано')
    return
  }
  if (target.dataset.view) {
    setView(target.dataset.view)
    return
  }
  if (target.dataset.runTab) {
    state.runTab = target.dataset.runTab
    renderDrawer()
    return
  }
  if (target.dataset.runStatus) {
    state.runsStatus = target.dataset.runStatus
    renderView()
    return
  }
  if (target.dataset.severity) {
    state.incidentsSeverity = target.dataset.severity
    renderView()
    return
  }
  if (target.dataset.eventLevel) {
    state.eventsLevel = target.dataset.eventLevel
    renderView()
    return
  }
  if (target.dataset.run) {
    event.stopPropagation()
    openRun(target.dataset.run)
    return
  }
  if (target.dataset.eventKey) {
    const key = target.dataset.eventKey
    if (state.openEvents.has(key)) state.openEvents.delete(key)
    else state.openEvents.add(key)
    const detail = target.querySelector('.event-detail')
    if (detail) detail.classList.toggle('open')
    return
  }
  const action = target.dataset.action
  if (action === 'refresh') {
    const icon = target.closest('.icon-btn')
    icon?.classList.add('spin')
    setTimeout(() => icon?.classList.remove('spin'), 700)
    refresh()
  } else if (action === 'scan') {
    void doScan()
  } else if (action === 'digest' || action === 'write-digest') {
    void doDigest()
  } else if (action === 'attach') {
    void doAttach()
  } else if (action === 'copy-brief') {
    void copyText(state.brief, 'Отчёт скопирован')
  } else if (action === 'close-drawer') {
    closeDrawer()
  }
})

drawerBackdrop.addEventListener('click', closeDrawer)

$('#hours').addEventListener('change', (event) => {
  state.hours = Number(event.target.value) || 24
  state.data = {}
  loadView()
})

let searchTimer = null
$('#search').addEventListener('input', (event) => {
  state.query = event.target.value
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    if (state.view === 'runs' || state.view === 'events') loadView({ silent: true })
    else renderView()
  }, 220)
})

$('#eventKind')?.addEventListener('change', (event) => {
  state.eventsKind = event.target.value
  renderView()
})

document.addEventListener('change', (event) => {
  if (event.target.id === 'eventKind') {
    state.eventsKind = event.target.value
    renderView()
  }
})

document.addEventListener('keydown', (event) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')
  if (event.key === 'Escape') {
    if (!drawer.classList.contains('hidden')) closeDrawer()
    else if (typing) document.activeElement.blur()
    return
  }
  if (typing) return
  if (event.key === '/') {
    event.preventDefault()
    const search = $('#search')
    if (!$('#searchWrap').classList.contains('hidden')) search.focus()
  }
  if (event.key.toLowerCase() === 'r' && !event.metaKey && !event.ctrlKey) {
    event.preventDefault()
    refresh()
  }
})

window.addEventListener('hashchange', () => {
  const view = location.hash.slice(1)
  if (VIEWS[view] && view !== state.view) setView(view, { push: false })
})

/* ---------- live stream ---------- */

function setSse(connected) {
  state.sseConnected = connected
  const label = $('#sseLabel')
  label.className = `sse ${connected ? 'on' : 'off'}`
  label.textContent = connected ? 'live' : 'reconnect'
}

function scheduleLiveRefresh(reason = '') {
  clearTimeout(state.refreshTimer)
  state.refreshTimer = setTimeout(async () => {
    try {
      state.health = await api('/api/health')
      renderHealth()
      updateBadges()
      if (['overview', 'runs', 'incidents', 'live'].includes(state.view)) {
        await loadView({ silent: true })
      } else if (reason === 'probe' && state.view === 'diagnostics') {
        await loadView({ silent: true })
      }
    } catch {
      // The EventSource reconnect loop will catch up.
    }
  }, 800)
}

function connectStream() {
  if (!window.EventSource) {
    setSse(false)
    return
  }
  const source = new EventSource('/api/stream')
  source.onopen = () => setSse(true)
  source.onerror = () => setSse(false)
  source.addEventListener('hello', (event) => {
    setSse(true)
    try {
      const data = JSON.parse(event.data)
      if (data.probe) {
        state.health = { ...(state.health ?? {}), probe: data.probe, stats: data.stats }
        renderHealth()
      }
    } catch {
      // A malformed hello is not fatal.
    }
  })
  for (const kind of ['run-created', 'run-updated', 'event', 'incident', 'probe', 'scan', 'digest']) {
    source.addEventListener(kind, () => {
      scheduleLiveRefresh(kind === 'probe' ? 'probe' : '')
    })
  }
}

/* ---------- boot ---------- */

async function boot() {
  const initial = location.hash.slice(1)
  state.view = VIEWS[initial] ? initial : 'overview'
  if (!location.hash) history.replaceState(null, '', `#${state.view}`)
  setView(state.view, { push: false })
  try {
    await Promise.all([loadMeta(), api('/api/health').then((health) => (state.health = health))])
  } catch (error) {
    toast(error.message, 'error')
  }
  renderHealth()
  connectStream()
  setInterval(() => {
    if (!state.sseConnected && (state.view === 'overview' || state.view === 'live')) {
      loadView({ silent: true })
    }
  }, 25_000)
}

void boot()
