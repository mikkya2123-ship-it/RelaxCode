/**
 * Verifies the background-process machinery the agent uses for dev servers:
 * a server really starts, its port is detected, its output is captured, it can
 * be reached and it can be killed with its whole tree.
 * Run with: npm run test:bg
 */
import net from 'node:net'
import { isAlive, detectPorts, localPortOpen } from '../src/main/proc.ts'
import {
  backgroundOutput,
  listBackground,
  startBackground,
  stopAllBackground,
  stopBackground,
  stopBackgroundByPort
} from '../src/main/proc.ts'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const PORT = 3987
const COMMAND = `node -e "require('http').createServer((q,s)=>{s.end('ok')}).listen(${PORT},()=>console.log('READY ${PORT}'))"`

let failed = 0
function check(label, condition, extra) {
  if (condition) {
    console.log('ok   -', label)
  } else {
    failed += 1
    console.log('FAIL -', label, extra === undefined ? '' : JSON.stringify(extra))
  }
}

const portAnswers = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const done = (result) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(400)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })

// 1. A server that stays up is reported as listening.
const started = await startBackground(COMMAND, process.cwd(), PORT, 15000)
check('server detected as listening', started.listening === true, {
  listening: started.listening,
  exited: started.exited,
  output: started.output
})
check('server did not exit during the wait', started.exited === null, started.exited)
check('server appears in the registry as running', started.info.running === true, started.info)
check('output was captured', /READY/.test(backgroundOutput(started.info.id)), backgroundOutput(started.info.id))
check('port really answers a request', await portAnswers(PORT))

const response = await fetch(`http://127.0.0.1:${PORT}/`)
check('http request returns the body', (await response.text()) === 'ok')

check('listBackground contains it', listBackground().some((item) => item.id === started.info.id))

// 2. Stopping it kills the process and frees the port.
const stopped = stopBackgroundByPort(PORT)
check('stopBackgroundByPort found it', stopped !== null && stopped.id === started.info.id, stopped)
await wait(1500)
check('process is dead after stop', !isAlive(started.info.pid), { pid: started.info.pid })
check('port is free after stop', !(await portAnswers(PORT)))

// 3. A command that dies immediately is reported as exited, not "running".
const crash = await startBackground('node -e "process.exit(3)"', process.cwd(), null, 3000)
check('crashing command reports an exit code', crash.exited?.code === 3, crash.exited)
check('crashing command is not running', crash.info.running === false, crash.info)

// 4. stopBackground on an unknown id is a no-op returning null.
check('unknown id returns null', stopBackground('nope') === null)

// 4b. Ports are read out of the process output.
check('detectPorts finds a localhost url', detectPorts('Server on http://localhost:3000').includes(3000))
check('detectPorts finds a port phrase', detectPorts('Listening on port 5173').includes(5173))
check('detectPorts finds a 0.0.0.0 url', detectPorts('http://0.0.0.0:8080').includes(8080))
check('detectPorts ignores prose numbers', detectPorts('compiled 42 modules').length === 0)

// 4c. A server bound with `listen(port, 'localhost')` may land on ::1 only.
// This machine blocks the IPv6 loopback entirely (EACCES), so a dual-stack or
// IPv4 listener is the only reliable one — that is what must be detected.
const dual = await startBackground(
  `node -e "require('http').createServer((q,s)=>{s.end('dual')}).listen(3098,()=>console.log('HTTP server listening on http://localhost:3098'))"`,
  process.cwd(),
  3098,
  15000
)
check('a dual-stack server is detected', dual.listening === true && dual.info.port === 3098, {
  listening: dual.listening,
  port: dual.info.port,
  output: dual.output
})
check('a free port is reported as closed', (await localPortOpen(3097)) === false)

// 4d. The requested port was a guess: the real one is taken from the output.
const guessed = await startBackground(
  `node -e "require('http').createServer((q,s)=>{s.end('real')}).listen(3096,()=>console.log('Server running on http://localhost:3096'))"`,
  process.cwd(),
  3099,
  15000
)
check('a wrong requested port falls back to the printed port', guessed.listeningPort === 3096, {
  requested: guessed.requestedPort,
  listening: guessed.listeningPort,
  output: guessed.output
})
check('the detected port is stored for the ui', guessed.info.port === 3096, guessed.info)
check('the detected port really answers', await portAnswers(3096))

// 5. A command that ignores "start" and just hangs is still tracked.
const hang = await startBackground('node -e "setInterval(()=>{},1000)"', process.cwd(), null, 500)
check('no-port process is tracked as running', hang.info.running === true, hang.info)
check('no-port process has port null', hang.info.port === null)

stopAllBackground()
await wait(1200)
check(
  'stopAllBackground killed everything',
  !isAlive(hang.info.pid) && !isAlive(crash.info.pid) && !isAlive(dual.info.pid) && !isAlive(guessed.info.pid),
  { hang: hang.info.pid, crash: crash.info.pid, dual: dual.info.pid, guessed: guessed.info.pid }
)

console.log(failed === 0 ? '\nALL BACKGROUND TESTS PASSED' : `\n${failed} BACKGROUND TEST(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
