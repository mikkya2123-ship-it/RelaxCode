/**
 * Verifies that killing a command removes the processes it started, not just
 * the shell. This is what used to leave an orphaned `npx serve` holding a port.
 * Run with: npm run test:proc
 */
import { spawn } from 'node:child_process'
import { killTree, isAlive } from '../src/main/proc.ts'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let failed = 0
function check(label, condition, extra) {
  if (condition) {
    console.log('ok   -', label)
  } else {
    failed += 1
    console.log('FAIL -', label, extra === undefined ? '' : JSON.stringify(extra))
  }
}

// The shell starts a grandchild that outlives a naive `shell.kill()`.
const child = spawn('node -e "console.log(process.pid); setInterval(() => {}, 1000)"', {
  shell: true,
  windowsHide: true
})

let firstLine = ''
child.stdout.on('data', (data) => {
  firstLine += data.toString()
})

const grandchildPid = await new Promise((resolve) => {
  const started = Date.now()
  const poll = () => {
    const line = firstLine.split('\n')[0].trim()
    if (/^\d+$/.test(line)) return resolve(Number(line))
    if (Date.now() - started > 15000) return resolve(null)
    setTimeout(poll, 50)
  }
  poll()
})

check('grandchild started and is alive', grandchildPid !== null && isAlive(grandchildPid), {
  grandchildPid,
  firstLine
})

killTree(child.pid)
await wait(2000)

check('grandchild is gone after killTree', grandchildPid !== null && !isAlive(grandchildPid), {
  grandchildPid
})
check('shell is gone too', !isAlive(child.pid), { shellPid: child.pid })

if (grandchildPid && isAlive(grandchildPid)) {
  // Do not leak the process if the check failed.
  try {
    process.kill(grandchildPid, 'SIGKILL')
  } catch {
    // ignore
  }
}

console.log(failed === 0 ? '\nALL PROC TESTS PASSED' : `\n${failed} PROC TEST(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
