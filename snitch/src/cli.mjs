#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { applyCliOverrides, loadConfig } from './config.mjs'
import { collectSources } from './ingest.mjs'
import { buildDigest, writeDigest } from './digest.mjs'
import { buildAiBrief } from './brief.mjs'
import { detectStalls } from './analyze.mjs'
import {
  DATA_DIR,
  OUT_DIR,
  SNITCH_ROOT,
  candidateUserDataDirs,
  detectDevToolsPort,
  detectLogFile,
  detectUserDataDir,
  detectWorkspace,
  exchangesDir,
  exists,
  framesDir,
  isUserDataDir,
  mcpFile,
  statSafe
} from './paths.mjs'
import { openBrowser, startSnitch, VERSION } from './server.mjs'
import { Store } from './store.mjs'
import { formatBytes, formatDuration } from './util.mjs'

const HELP = `Snitch ${VERSION} — наблюдатель RelaxCode

  snitch serve [--open] [--port 7777] [--user-data PATH] [--workspace PATH] [--no-live]
      Запустить сборщик и панель. Панель: http://127.0.0.1:7777

  snitch scan [--user-data PATH] [--workspace PATH]
      Один проход по отчётам, логу, кадрам и MCP без запуска сервера.

  snitch digest [--hours 24] [--write]
      Напечатать сводку для ИИ (Markdown). --write сохраняет out/SITUATION.md.

  snitch brief [--hours 24]
      Подробный отчёт для агента: инциденты, упавшие шаги, команды, тайминги.

  snitch status
      Короткое состояние хранилища и последнего скана.

  snitch doctor
      Проверить, что Snitch видит профиль IDE, лог, отчёты и DevTools-порт.

  snitch attach
      Подключить живой зонд к уже запущенной панели.

  snitch mcp
      MCP-сервер на stdio (обычно запускается хостом, а не руками).

  snitch paths
      Показать все пути, которые использует Snitch.

Переменные окружения:
  RELAXCODE_DEBUG_PORT=9333   включить DevTools-порт в IDE для живого режима
  RELAXCODE_USER_DATA=PATH    явный профиль IDE
  SNITCH_DATA_DIR / SNITCH_OUT_DIR   перенести хранилище и отчёты
`

function parseArgs(argv) {
  const options = { command: argv[0] && !argv[0].startsWith('-') ? argv[0] : 'serve', rest: [] }
  const args = argv[0] && !argv[0].startsWith('-') ? argv.slice(1) : argv
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const [flag, inline] = arg.split('=')
    const value = () => {
      if (inline != null) return inline
      const next = args[index + 1]
      if (!next || next.startsWith('--')) return null
      index += 1
      return next
    }
    switch (flag) {
      case '--port':
        options.port = Number(value())
        break
      case '--host':
        options.host = value()
        break
      case '--user-data':
      case '--profile':
        options.userData = value()
        break
      case '--workspace':
        options.workspace = value()
        break
      case '--hours':
        options.hours = Number(value())
        break
      case '--no-live':
        options.noLive = true
        break
      case '--open':
        options.open = true
        break
      case '--write':
        options.write = true
        break
      case '--quiet':
        options.quiet = true
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        if (!flag.startsWith('-')) options.rest.push(arg)
        else options.unknown = arg
    }
  }
  return options
}

async function resolveContext(options) {
  const base = applyCliOverrides(await loadConfig(), {
    port: options.port,
    host: options.host,
    userData: options.userData,
    workspace: options.workspace,
    noLive: options.noLive
  })
  const userData = base.userData || detectUserDataDir() || null
  const workspace = base.workspace || (await detectWorkspace(userData)) || null
  return {
    config: { ...base, userData, workspace },
    userData,
    workspace,
    logFile: detectLogFile(userData)
  }
}

function line(key, value, pad = 22) {
  return `${key.padEnd(pad, ' ')} ${value}`
}

async function commandServe(options) {
  const { config, userData, workspace } = await resolveContext(options)
  if (!userData) {
    console.log('! Профиль RelaxCode не найден. Укажите --user-data или RELAXCODE_USER_DATA.')
    console.log('  Проверенные пути:')
    for (const path of candidateUserDataDirs()) console.log(`  - ${path}`)
  }
  if (config.port === 0) config.port = 7777
  let server = null
  try {
    server = await startSnitch({
      config,
      userData,
      workspace,
      quiet: options.quiet === true
    })
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      console.error(`! Порт ${config.port} занят. Запустите с --port 7778 или закройте другой экземпляр.`)
    } else {
      console.error(`! Не удалось запустить Snitch: ${error.message}`)
    }
    process.exitCode = 1
    return
  }

  console.log('')
  console.log(`  Snitch ${VERSION} · панель ${server.apiUrl('/')}`)
  console.log(line('Профиль IDE:', userData ?? 'не найден'))
  console.log(line('Рабочая папка:', workspace ?? 'не открыта'))
  console.log(line('Лог:', server.logFile ?? 'нет файла'))
  console.log(line('Данные:', DATA_DIR))
  console.log(line('Живой режим:', config.live.enabled ? `включён (порт ${server.probe?.status.port ?? 'ждёт IDE'})` : 'выключен'))
  console.log(line('Отчёты агента:', join(OUT_DIR, 'SITUATION.md')))
  console.log('')
  if (userData && config.live.enabled && !detectDevToolsPort(userData)) {
    console.log('  Живой режим: перезапустите IDE с RELAXCODE_DEBUG_PORT=9333, чтобы видеть токены и шаги в реальном времени.')
    console.log('  Файловый режим собирает данные и без этого: отчёты обменов пишутся после каждого запуска.')
    console.log('')
  }
  if (options.open) openBrowser(server.apiUrl('/'))

  await new Promise((resolveStop) => {
    let stopping = false
    const stop = async (signal) => {
      if (stopping) return
      stopping = true
      console.log(`\n[snitch] ${signal}: сохраняю состояние…`)
      await server.close().catch(() => {})
      resolveStop()
    }
    process.on('SIGINT', () => void stop('SIGINT'))
    process.on('SIGTERM', () => void stop('SIGTERM'))
  })
}

async function commandScan(options) {
  const { config, userData, workspace, logFile } = await resolveContext(options)
  const store = new Store(config.dataDir || DATA_DIR)
  await store.load()
  const summary = await collectSources(store, {
    userData,
    workspace,
    logFile,
    doRedact: config.redact !== false,
    retention: config.retention
  })
  detectStalls(store, Date.now(), config.stale)
  store.setMeta({ lastScan: summary })
  await store.flush()
  console.log(`Скан завершён за ${formatDuration(summary.durationMs)}`)
  console.log(line('Новых запусков:', summary.newRuns))
  console.log(line('Обновлено:', summary.updatedRuns))
  console.log(line('Файлов обменов:', summary.exchangeFiles))
  console.log(line('Строк лога:', summary.logLines, 22))
  console.log(line('Ошибок лога:', summary.logErrors, 22))
  console.log(line('Кадров:', summary.frames, 22))
  console.log(line('MCP-серверов:', summary.mcpServers, 22))
  console.log(line('Запусков в хранилище:', store.listRuns().length, 22))
  console.log(line('Инцидентов:', store.state.incidents.length, 22))
  for (const error of summary.errors.slice(0, 5)) console.log(`! ${error}`)
}

async function commandDigest(options, { brief = false } = {}) {
  const { config, userData, workspace, logFile } = await resolveContext(options)
  const store = new Store(config.dataDir || DATA_DIR)
  await store.load()
  if (options.rest.length > 0 || (!store.listRuns().length && !store.meta.lastScan)) {
    await collectSources(store, {
      userData,
      workspace,
      logFile,
      doRedact: config.redact !== false,
      retention: config.retention
    })
    await store.flush()
  }
  const hours = Number.isFinite(options.hours) ? options.hours : 24
  if (brief) {
    process.stdout.write(buildAiBrief(store, { hours }))
    return
  }
  const digest = buildDigest(store, { hours })
  if (options.write) {
    const result = await writeDigest(store, { hours, outDir: OUT_DIR })
    const briefText = buildAiBrief(store, { hours })
    await fs.writeFile(join(OUT_DIR, 'SNITCH-BRIEF.md'), briefText, 'utf8')
    console.log(`Записано: ${result.markdownPath}`)
    console.log(`JSON:     ${result.jsonPath}`)
    console.log(`Для ИИ:   ${join(OUT_DIR, 'SNITCH-BRIEF.md')}`)
    return
  }
  process.stdout.write(digest.markdown)
}

async function commandStatus() {
  const file = join(DATA_DIR, 'state.json')
  const raw = await fs.readFile(file, 'utf8').catch(() => null)
  if (!raw) {
    console.log('Snitch ещё не запускался: state.json отсутствует.')
    console.log(`Запустите: node ${join(SNITCH_ROOT, 'src', 'cli.mjs')} serve --open`)
    return
  }
  let state = null
  try {
    state = JSON.parse(raw)
  } catch {
    console.log('! state.json повреждён. Запустите serve: он сохранит копию и начнёт заново.')
    return
  }
  const runs = Object.values(state.runs ?? {})
  const stats = {
    runs: runs.length,
    live: runs.filter((run) => run.live).length,
    errors: runs.filter((run) => run.status === 'error').length,
    events: (state.events ?? []).length,
    incidents: (state.incidents ?? []).length
  }
  console.log(`Snitch ${VERSION}`)
  console.log(line('Данные:', DATA_DIR))
  console.log(line('Размер:', formatBytes(statSafe(file)?.size ?? 0)))
  console.log(line('Обновлено:', state.updatedAt ? new Date(state.updatedAt).toLocaleString('ru-RU') : '—'))
  console.log(line('Запусков:', `${stats.runs} (идёт ${stats.live}, ошибок ${stats.errors})`))
  console.log(line('Событий:', stats.events))
  console.log(line('Инцидентов:', stats.incidents))
  console.log(line('Профиль:', state.meta?.sources?.userData ?? '—'))
  console.log(line('Папка:', state.meta?.sources?.workspace ?? '—'))
  console.log(line('Зонд:', state.meta?.probe?.attached ? 'подключён' : state.meta?.probe?.reason ?? 'не подключён'))
  if (state.meta?.lastScan) {
    console.log(line('Последний скан:', new Date(state.meta.lastScan.at).toLocaleString('ru-RU')))
  }
}

async function commandDoctor(options) {
  const base = applyCliOverrides(await loadConfig(), {
    userData: options.userData,
    workspace: options.workspace
  })
  const userData = base.userData || detectUserDataDir()
  const workspace = userData ? await detectWorkspace(userData, base.workspace) : base.workspace
  const logFile = detectLogFile(userData)
  const check = (ok, label, detail = '') =>
    console.log(`${ok ? '✓' : '!'} ${label}${detail ? ` — ${detail}` : ''}`)

  console.log(`Snitch ${VERSION} doctor`)
  console.log('')
  check(Number(process.versions.node.split('.')[0]) >= 20, 'Node.js', process.version)
  check(Boolean(userData), 'Профиль IDE', userData ?? 'не найден')
  if (!userData) {
    console.log('  Проверены:')
    for (const path of candidateUserDataDirs()) console.log(`  - ${path}${isUserDataDir(path) ? ' (похож на профиль)' : ''}`)
  }
  check(Boolean(workspace), 'Рабочая папка', workspace ?? 'не определена')
  check(Boolean(logFile), 'Лог приложения', logFile ?? 'нет файла (включите error-логи в настройках)')
  const exchanges = exchangesDir(userData)
  const exchangeList = exchanges ? await fs.readdir(exchanges).catch(() => []) : []
  check(
    exchangeList.filter((name) => name.endsWith('.json') && name !== 'latest.json').length > 0,
    'Отчёты обменов',
    exchanges
      ? `${exchanges} · ${exchangeList.length} файл(ов)`
      : 'профиль не найден'
  )
  const frames = framesDir(userData)
  const frameCount = frames ? (await fs.readdir(frames).catch(() => [])).length : 0
  check(true, 'Кадры инструментов', `${frameCount} файл(ов)`)
  check(Boolean(mcpFile(userData) && exists(mcpFile(userData))), 'MCP-конфиг', mcpFile(userData) ?? '—')
  const devPort = detectDevToolsPort(userData)
  check(
    Boolean(devPort),
    'DevTools-порт (живой режим)',
    devPort
      ? `порт ${devPort}`
      : 'не открыт; перезапустите IDE с RELAXCODE_DEBUG_PORT=9333'
  )
  check(exists(join(DATA_DIR, 'state.json')), 'Хранилище Snitch', join(DATA_DIR, 'state.json'))
  check(exists(join(OUT_DIR, 'SITUATION.md')), 'Сводка для ИИ', join(OUT_DIR, 'SITUATION.md'))
  console.log('')
  console.log(`Панель: http://${base.host}:${base.port}`)
  console.log(`Запуск: node ${join(SNITCH_ROOT, 'src', 'cli.mjs')} serve --open`)
}

async function commandAttach(options) {
  const { config } = await resolveContext(options)
  const url = `http://${config.host}:${config.port}/api/attach`
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10_000)
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? response.statusText)
    console.log(result.attached ? '✓ Живой зонд подключён.' : `! Зонд не подключился: ${result.probe?.reason ?? 'причина неизвестна'}`)
    if (result.probe?.target) console.log(`  Окно: ${result.probe.target}`)
    if (result.probe?.port) console.log(`  Порт: ${result.probe.port}`)
  } catch (error) {
    console.log(`! Панель недоступна на ${config.host}:${config.port} (${error.message}).`)
    console.log(`  Сначала запустите: node ${join(SNITCH_ROOT, 'src', 'cli.mjs')} serve --open`)
    if (!detectDevToolsPort(detectUserDataDir())) {
      console.log('  Для живого режима перезапустите IDE с RELAXCODE_DEBUG_PORT=9333.')
    }
  }
}

async function commandPaths() {
  const userData = detectUserDataDir()
  const workspace = await detectWorkspace(userData)
  console.log(line('Snitch:', SNITCH_ROOT))
  console.log(line('Данные:', DATA_DIR))
  console.log(line('Отчёты:', OUT_DIR))
  console.log(line('Панель:', join(SNITCH_ROOT, 'public')))
  console.log(line('Профиль IDE:', userData ?? 'не найден'))
  console.log(line('Рабочая папка:', workspace ?? 'не открыта'))
  console.log(line('Обмены:', exchangesDir(userData) ?? '—'))
  console.log(line('Кадры:', framesDir(userData) ?? '—'))
  console.log(line('Лог:', detectLogFile(userData) ?? '—'))
  console.log(line('MCP:', mcpFile(userData) ?? '—'))
  console.log(line('DevTools-порт:', detectDevToolsPort(userData) ?? 'не открыт'))
}

async function commandMcp() {
  const { runMcpServer } = await import('./mcp.mjs')
  await runMcpServer()
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(HELP)
    return
  }
  if (options.unknown) {
    console.error(`Неизвестный флаг: ${options.unknown}\n`)
    console.log(HELP)
    process.exitCode = 2
    return
  }
  switch (options.command) {
    case 'serve':
    case 'start':
      await commandServe(options)
      break
    case 'scan':
      await commandScan(options)
      break
    case 'digest':
    case 'report':
      await commandDigest(options, { brief: options.command === 'brief' })
      break
    case 'brief':
      await commandDigest(options, { brief: true })
      break
    case 'status':
      await commandStatus()
      break
    case 'doctor':
      await commandDoctor(options)
      break
    case 'attach':
      await commandAttach(options)
      break
    case 'paths':
      await commandPaths()
      break
    case 'mcp':
      await commandMcp()
      break
    case 'help':
      console.log(HELP)
      break
    default:
      console.error(`Неизвестная команда: ${options.command}\n`)
      console.log(HELP)
      process.exitCode = 2
  }
}

process.on('unhandledRejection', (error) => {
  console.error(`[snitch] необработанная ошибка: ${error?.stack ?? error}`)
})
process.on('uncaughtException', (error) => {
  console.error(`[snitch] критическая ошибка: ${error?.stack ?? error}`)
})

main().catch((error) => {
  console.error(`[snitch] ${error.stack ?? error.message}`)
  process.exitCode = 1
})
