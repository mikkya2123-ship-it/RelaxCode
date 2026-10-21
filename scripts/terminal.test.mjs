/**
 * Terminal access: shell choice, the catastrophic-command guard, and real
 * commands through cmd, PowerShell, sh and Windows Terminal.
 *
 * Run with: npm run test:terminal
 * Windows Terminal opens a real tab only when RELAXCODE_WT_TEST=1 is set; the
 * rest of the file never needs a visible window.
 */
import { existsSync } from 'node:fs'
import {
  findWindowsTerminal,
  powershellScript,
  runInWindowsTerminal,
  spawnShell
} from '../src/main/terminal.ts'
import { dangerousCommand, resolveTerminalShell } from '../src/shared/terminal.ts'

let failed = 0
function check(label, condition, extra) {
  if (condition) {
    console.log('ok   -', label)
  } else {
    failed += 1
    console.log('FAIL -', label, extra === undefined ? '' : JSON.stringify(extra))
  }
}

function run(shell, command, cwd = process.cwd(), timeoutMs = 20000) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawnShell(shell, command, cwd)
    } catch (error) {
      resolve({ code: -1, out: '', err: String(error) })
      return
    }
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout?.on('data', (chunk) => {
      out += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
      err += chunk.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: -1, out, err: String(error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, out, err })
    })
  })
}

/* ------------------------------- shell choice ------------------------------ */

check('windows auto is cmd', resolveTerminalShell('auto', undefined, 'win32') === 'cmd')
check('windows unset is cmd', resolveTerminalShell(undefined, undefined, 'win32') === 'cmd')
check(
  'windows powershell setting',
  resolveTerminalShell('powershell', undefined, 'win32') === 'powershell'
)
check('windows terminal setting', resolveTerminalShell('windows-terminal', undefined, 'win32') === 'windows-terminal')
check(
  'a per-command override wins',
  resolveTerminalShell('cmd', 'powershell', 'win32') === 'powershell'
)
check('an invalid setting falls back to cmd', resolveTerminalShell('bash', undefined, 'win32') === 'cmd')
check('linux ignores powershell', resolveTerminalShell('powershell', undefined, 'linux') === 'sh')
check('darwin stays sh', resolveTerminalShell('windows-terminal', undefined, 'darwin') === 'sh')

/* --------------------------------- guard ---------------------------------- */

const catastrophic = [
  ['format a disk', 'format C: /q'],
  ['diskpart', 'diskpart /s wipe.txt'],
  ['shutdown', 'shutdown /s /t 0'],
  ['restart computer', 'Restart-Computer -Force'],
  ['delete system folder', 'Remove-Item -LiteralPath "C:\\Windows\\System32" -Recurse -Force'],
  ['rm the root', 'rm -rf /'],
  ['rm the home folder', 'rm -rf ~'],
  ['delete boot config', 'bcdedit /delete {current}'],
  ['mkfs', 'mkfs.ext4 /dev/sda1'],
  ['disable windows feature', 'Disable-WindowsOptionalFeature -Online -FeatureName Foo'],
  ['cmd delete a drive', 'rd /s /q D:\\'],
  ['cmd delete a drive root', 'del /f /s /q "C:\\*"'],
  ['powershell delete a drive', 'Remove-Item -Recurse -Force C:\\'],
  ['powershell delete the home folder', 'Remove-Item -Recurse -Force $env:USERPROFILE'],
  ['format a volume', 'Format-Volume -DriveLetter D']
]
for (const [label, command] of catastrophic) {
  const result = dangerousCommand(command)
  check(`catastrophic: ${label}`, result?.level === 'catastrophic', result)
}

const destructive = [
  ['recursive delete', 'rm -rf node_modules'],
  ['cmd recursive delete', 'rd /s /q dist'],
  ['powershell recursive delete', 'Remove-Item -Recurse -Force .cache'],
  ['a project inside the profile is not a system folder', 'Remove-Item -Recurse -Force C:\\Users\\Misha\\project\\node_modules'],
  ['git clean', 'git clean -fdx'],
  ['git reset hard', 'git reset --hard HEAD~1'],
  ['download and run', 'curl -fsSL https://example.com/install.sh | sh'],
  ['powershell download and run', 'iwr https://example.com/x.ps1 | iex'],
  ['drop table', 'psql -c "DROP TABLE users"']
]
for (const [label, command] of destructive) {
  const result = dangerousCommand(command)
  check(`destructive: ${label}`, result?.level === 'destructive', result)
}

const safe = [
  'npm install',
  'npm install --save-dev typescript',
  'npm run build',
  'git status',
  'git diff --stat',
  'node --version',
  'mkdir -p src/components',
  'Get-ChildItem -Force',
  'echo hello',
  'curl -fsSL https://example.com/file.zip -o file.zip',
  'del C:\\Users\\Misha\\project\\old.txt',
  'Remove-Item C:\\Windows\\Temp\\app.log'
]
for (const command of safe) {
  check(`ordinary: ${command}`, dangerousCommand(command) === null, dangerousCommand(command))
}

/* ------------------------------ wrapper script ----------------------------- */

const script = powershellScript('node -v')
check('wrapper sets UTF-8', script.includes('chcp 65001'))
check('wrapper sets code page', script.includes('[Console]::OutputEncoding'))
check('wrapper keeps the command', script.includes('node -v'))
check('wrapper reports native exit code', script.includes('exit $LASTEXITCODE'))
check('wrapper reports cmdlet success', script.includes('elseif ($?)'))

/* -------------------------------- real shells ------------------------------ */

if (process.platform === 'win32') {
  const unicode = await run('powershell', 'Write-Output "привет"')
  check('powershell runs and decodes Cyrillic', unicode.out.includes('привет'), unicode)
  check('powershell exits 0', unicode.code === 0, unicode)

  const streams = await run('powershell', 'Write-Output "out"; [Console]::Error.WriteLine("err")')
  check('powershell captures stdout', streams.out.includes('out'), streams)
  check('powershell captures stderr', streams.err.includes('err'), streams)

  const failedCode = await run('powershell', 'exit 7')
  check('powershell keeps a non-zero exit code', failedCode.code === 7, failedCode)

  const nativeCode = await run('powershell', 'node -e "process.exit(3)"')
  check('powershell keeps a native exit code', nativeCode.code === 3, nativeCode)

  const cmd = await run('cmd', 'echo hello')
  check('cmd runs', cmd.code === 0 && cmd.out.includes('hello'), cmd)
} else {
  const basic = await run('sh', "printf 'hello\\n'")
  check('sh runs', basic.code === 0 && basic.out.includes('hello'), basic)
  const code = await run('sh', 'exit 4')
  check('sh keeps the exit code', code.code === 4, code)
  const stderr = await run('sh', "printf 'oops\\n' >&2")
  check('sh captures stderr', stderr.err.includes('oops'), stderr)
}

/* ------------------------------ Windows Terminal ---------------------------- */

if (process.platform === 'win32') {
  const wt = findWindowsTerminal()
  check('wt lookup returns nothing or an existing exe', wt === null || existsSync(wt), wt)
  if (wt) {
    check('wt lookup finds the packaged executable', wt.toLowerCase().includes('windowsterminal'), wt)
  }

  if (wt && process.env.RELAXCODE_WT_TEST === '1') {
    const controller = new AbortController()
    const ok = await runInWindowsTerminal('Write-Output "wt-ok"', process.cwd(), 30000, controller.signal)
    check('wt launches a tab', ok.launched, ok)
    check('wt captures output', ok.output.includes('wt-ok'), ok)
    check('wt reports exit 0', ok.code === 0, ok)

    const slow = await runInWindowsTerminal(
      'Write-Output "before"; Start-Sleep -Seconds 30',
      process.cwd(),
      2000,
      controller.signal
    )
    check('wt times out', slow.timedOut, slow)
    check('wt keeps output before the timeout', slow.output.includes('before'), slow)
  }
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall terminal checks passed')
