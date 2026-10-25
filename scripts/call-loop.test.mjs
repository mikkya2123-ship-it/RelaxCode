/**
 * Loop-guard checks: when an identical call cannot answer anything new, the
 * engine must skip it instead of paying for the same failure again — but a
 * retest after an edit must still run.
 * Run with: npm run test:call-loop
 */
import {
  callSignature,
  repeatBlock,
  repeatNotice
} from '../src/main/call-loop.ts'

let failed = 0
function check(label, condition, extra) {
  if (condition) {
    console.log('ok   -', label)
  } else {
    failed += 1
    console.log('FAIL -', label, extra === undefined ? '' : JSON.stringify(extra))
  }
}

check('same tool and arguments share a signature', callSignature('edit_file', ' {"a":1} ') === callSignature('edit_file', '{"a":1}'))
check('different arguments differ', callSignature('edit_file', '{"a":1}') !== callSignature('edit_file', '{"a":2}'))
check('different tools differ', callSignature('read_file', '{"path":"a"}') !== callSignature('write_file', '{"path":"a"}'))

check(
  'a failed call with nothing changed is blocked',
  repeatBlock({ attempts: 1, ok: false, mutations: 0 }, 0, 'edit_file')
)
check(
  'the same failed call after an edit is allowed (retest)',
  !repeatBlock({ attempts: 1, ok: false, mutations: 0 }, 1, 'run_command')
)
check(
  'a third identical read is blocked',
  repeatBlock({ attempts: 2, ok: true, mutations: 0 }, 0, 'read_file')
)
check(
  'a second identical read is allowed',
  !repeatBlock({ attempts: 1, ok: true, mutations: 0 }, 0, 'read_file')
)
check(
  'repeating a successful write is pointless even once',
  repeatBlock({ attempts: 1, ok: true, mutations: 1 }, 1, 'write_file')
)
check(
  'repeating a successful edit is pointless even once',
  repeatBlock({ attempts: 1, ok: true, mutations: 1 }, 1, 'edit_file')
)
check(
  'an unseen call is never blocked',
  !repeatBlock(undefined, 0, 'edit_file')
)
check(
  'a repeated pytest after an edit still runs',
  !repeatBlock({ attempts: 1, ok: true, mutations: 1 }, 2, 'run_command')
)

const notice = repeatNotice('edit_file', { attempts: 3, ok: false, mutations: 0 })
check('the notice names the tool and the count', notice.includes('edit_file') && notice.includes('3 time(s)'))
check('the notice says the call failed', notice.includes('failed'))
check('the notice tells the model what to do instead', notice.includes('Read the file again'))
const commandNotice = repeatNotice('run_command', { attempts: 2, ok: false, mutations: 0 })
check(
  'a command notice asks for a different command, not a re-read',
  commandNotice.includes('Change the command') && !commandNotice.includes('Read the file again'),
  commandNotice
)
check(
  'a successful call is described as succeeded',
  repeatNotice('write_file', { attempts: 1, ok: true, mutations: 1 }).includes('succeeded')
)

if (failed > 0) {
  console.log(`\n${failed} CALL LOOP CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CALL LOOP CHECKS PASSED')
