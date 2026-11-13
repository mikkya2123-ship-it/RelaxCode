/**
 * Выпуск новой версии: сборка установщика и публикация релиза на GitHub
 * вместе с latest.yml и .blockmap.
 *
 * Именно latest.yml читает electron-updater: без него проверка обновлений
 * падает с «Cannot find latest.yml in the latest release artifacts», и кнопка
 * «Обновить» в титлбаре никогда не появится. Поэтому релиз нельзя заливать
 * руками одним .exe — только этой командой.
 *
 * Порядок: поднять version в package.json → npm run release → открыть
 * черновик релиза, вписать «Что нового» (этот текст показывает диалог
 * обновления) и нажать Publish release.
 *
 * Run with: npm run release
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OWNER = 'mikkya2123-ship-it'
const REPO = 'RelaxCode'

function fail(message) {
  throw new Error(message)
}

/** shell нужен только ради npm/npx/gh, которые на Windows — это .cmd-обёртки. */
function shellRun(line, options = {}) {
  const result = spawnSync(line, { cwd: ROOT, shell: true, ...options })
  if (result.error) fail(`${line}: ${result.error.message}`)
  return result
}

function run(line, env, label) {
  console.log(`\n▶ ${label}`)
  const result = shellRun(line, { stdio: 'inherit', env })
  if (result.status !== 0) fail(`${label}: код ${result.status ?? result.signal}`)
}

/** GH_TOKEN из окружения или из уже авторизованного gh CLI. */
function githubToken() {
  const fromEnv = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim()
  const gh = shellRun('gh auth token', { encoding: 'utf8' })
  const token = gh.status === 0 ? String(gh.stdout).trim() : ''
  return token.length > 0 ? token : null
}

async function releases(token) {
  const response = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=30`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'relaxcode-release'
    }
  })
  if (!response.ok) fail(`GitHub ответил ${response.status} на список релизов`)
  return response.json()
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const version = pkg.version
  const tag = `v${version}`

  const token = githubToken()
  if (!token) fail('нет доступа к GitHub: задайте GH_TOKEN или выполните gh auth login')

  // Один и тот же тег дважды не выпускаем: electron-builder перезаписал бы
  // ассеты уже установленного релиза, и обновление сломалось бы у всех.
  const existing = (await releases(token)).find((release) => release.tag_name === tag)
  if (existing) fail(`релиз ${tag} уже существует — поднимите "version" в package.json`)
  console.log(`\n▶ выпускаем RelaxCode ${version}`)

  const env = { ...process.env, GH_TOKEN: token }
  run('npm run build', env, 'сборка приложения (out/)')
  run('npx electron-builder --win --publish always', env, 'сборка установщика и публикация')

  const metadata = path.join(ROOT, 'dist', 'latest.yml')
  if (!fs.existsSync(metadata)) {
    fail('electron-builder не создал dist/latest.yml — релиз без него приложение не увидит')
  }
  const saidVersion = /^version:\s*(\S+)$/m.exec(fs.readFileSync(metadata, 'utf8'))?.[1]
  if (saidVersion !== version) {
    fail(`dist/latest.yml указывает версию ${saidVersion ?? '?'}, а в package.json ${version}`)
  }

  // Проверяем то, что реально лежит на GitHub: latest.yml должен быть в ассетах.
  const release = (await releases(token)).find((item) => item.tag_name === tag)
  if (!release) fail(`релиз ${tag} не появился на GitHub`)
  const assets = release.assets.map((asset) => asset.name)
  for (const required of ['latest.yml', `RelaxCode-Setup-${version}.exe`]) {
    if (!assets.includes(required)) fail(`в релизе ${tag} нет ${required} (есть: ${assets.join(', ')})`)
  }

  console.log(`\n✔ релиз ${tag} собран и загружен`)
  console.log(`  ассеты: ${assets.join(', ')}`)
  console.log(`  страница: ${release.html_url}`)
  if (release.draft) {
    console.log('\n  Это черновик. Откройте страницу, впишите «Что нового» (его показывает')
    console.log('  диалог обновления) и нажмите Publish release — до этого приложение')
    console.log('  обновление не увидит.')
  } else {
    console.log('\n  Релиз опубликован: приложение увидит его при следующей проверке.')
  }
  console.log('  Установки без app-update.yml (сборки до 0.3.0) обновляются только')
  console.log('  вручную: им нужно один раз поставить этот установщик.\n')
}

// process.exit() в async-контексте на Windows роняет Node в libuv-ассерте,
// поэтому выход — только через код возврата.
try {
  await main()
} catch (error) {
  console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
