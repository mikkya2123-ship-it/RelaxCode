/**
 * Unit tests for "this model loops when asked to think".
 *
 * The rule is what the user feels: one loop costs a step of thinking depth, the
 * second one ends the experiment, and a connection that never looped is left
 * exactly as the user set it. The file half has to survive a missing folder, a
 * corrupt file and an old entry, because it runs before every single request.
 *
 * Run with: npm run test:memory
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isMemoryFresh,
  isWeakToolCaller,
  levelAfterLoops,
  LOOPS_BEFORE_OFF,
  MEMORY_LIMIT,
  MEMORY_TTL_MS,
  memoryKey,
  pruneMemory,
  WEAKNESS_THRESHOLD,
  weaknessOf
} from '../src/shared/model-memory.ts'
import {
  isWeakModel,
  rememberedLoops,
  rememberedWeakness,
  rememberLoop,
  rememberWeakFail,
  thinkingWithMemory
} from '../src/main/model-memory.ts'

let failed = 0
function check(label, condition, extra) {
  if (condition) {
    console.log('ok   -', label)
  } else {
    failed += 1
    console.log('FAIL -', label, extra === undefined ? '' : JSON.stringify(extra))
  }
}
function same(label, actual, expected) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected })
}

// 1. The key names one connection, however the address is spelled.
same(
  'the same endpoint in another spelling is the same connection',
  memoryKey('https://openrouter.ai/api/v1/', 'Cohere/North-Mini-Code:Free'),
  memoryKey('https://openrouter.ai/api/v1', 'cohere/north-mini-code:free')
)
check(
  'another endpoint is another connection',
  memoryKey('https://openrouter.ai/api/v1', 'x') !== memoryKey('https://api.z.ai/v4', 'x')
)

// 2. Nothing remembered means nothing changes.
same('a clean connection keeps the level', levelAfterLoops('high', 0), 'high')
same('a clean connection keeps thinking off', levelAfterLoops('off', 0), 'off')

// 3. One loop costs exactly one step of depth.
same('high drops to medium', levelAfterLoops('high', 1), 'medium')
same('medium drops to low', levelAfterLoops('medium', 1), 'low')
same('low drops to off', levelAfterLoops('low', 1), 'off')
same('off stays off', levelAfterLoops('off', 1), 'off')

// 4. A second loop ends the experiment.
same('the second loop switches thinking off', levelAfterLoops('high', LOOPS_BEFORE_OFF), 'off')
same('later loops keep it off', levelAfterLoops('medium', 9), 'off')

// 5. Entries age out, so a fixed model is not punished forever.
const now = 1_800_000_000_000
const entry = { loops: 2, level: 'low', at: now }
check('a fresh entry counts', isMemoryFresh(entry, now + 1000))
check('a stale entry is ignored', !isMemoryFresh(entry, now + MEMORY_TTL_MS + 1))
check('a missing entry is ignored', !isMemoryFresh(undefined, now))
check('an entry from the future by a clock change still counts', isMemoryFresh(entry, now - 60_000))
check('a wild timestamp is ignored', !isMemoryFresh({ ...entry, at: Number.NaN }, now))

// 6. Pruning drops what is stale and caps the file.
const pruned = pruneMemory(
  {
    fresh: { loops: 1, level: 'low', at: now },
    stale: { loops: 3, level: 'high', at: now - MEMORY_TTL_MS - 1 }
  },
  now
)
same('stale entries are dropped', Object.keys(pruned), ['fresh'])
const many = Object.fromEntries(
  Array.from({ length: MEMORY_LIMIT + 10 }, (_, index) => [
    `k${index}`,
    { loops: 1, level: 'low', at: now - index }
  ])
)
same('the file is capped', Object.keys(pruneMemory(many, now)).length, MEMORY_LIMIT)
check(
  'the newest entries survive the cap',
  pruned && Object.keys(pruneMemory(many, now)).includes('k0')
)

// 7. The file store round-trips, per connection.
const dir = mkdtempSync(join(tmpdir(), 'relaxcode-memory-'))
try {
  same('nothing is known about a new connection', rememberedLoops('https://a/v1', 'm', dir), 0)
  same('the first loop is counted', rememberLoop('https://a/v1', 'm', 'low', dir), 1)
  same('it is remembered', rememberedLoops('https://a/v1', 'm', dir), 1)
  same('another connection is untouched', rememberedLoops('https://b/v1', 'm', dir), 0)

  const first = thinkingWithMemory('high', 'https://a/v1', 'm', dir)
  same('the next request is asked for less', first, { level: 'medium', loops: 1 })

  same('a second loop is counted', rememberLoop('https://a/v1', 'm', 'medium', dir), 2)
  const second = thinkingWithMemory('high', 'https://a/v1', 'm', dir)
  same('after that thinking is off', second, { level: 'off', loops: 2 })

  // A damaged file must read as "nothing remembered", not as a crash.
  writeFileSync(join(dir, 'model-memory.json'), '{not json', 'utf8')
  same('a corrupt file reads as empty', rememberedLoops('https://a/v1', 'm', dir), 0)
  same(
    'and a loop recorded over it still works',
    rememberLoop('https://a/v1', 'm', 'low', dir),
    1
  )

  // An old entry must not lower the level any more.
  writeFileSync(
    join(dir, 'model-memory.json'),
    JSON.stringify({
      version: 1,
      entries: {
        [memoryKey('https://a/v1', 'm')]: {
          loops: 5,
          level: 'high',
          at: Date.now() - MEMORY_TTL_MS - 1000
        }
      }
    }),
    'utf8'
  )
  same(
    'a stale entry leaves the level alone',
    thinkingWithMemory('high', 'https://a/v1', 'm', dir),
    { level: 'high', loops: 0 }
  )

  // 8. Weak-tool-caller memory: assistive layers (Blender recipes) switch on
  // only after the connection has proven itself clumsy, and age out again.
  const weakDir = mkdtempSync(join(tmpdir(), 'relaxcode-weak-'))
  try {
    same('a fresh connection is not weak', isWeakModel('https://w/v1', 'm', weakDir), false)
    same('nothing is remembered', rememberedWeakness('https://w/v1', 'm', weakDir), 0)
    for (let i = 1; i <= WEAKNESS_THRESHOLD - 1; i += 1) {
      same(`fail ${i} is counted`, rememberWeakFail('https://w/v1', 'm', weakDir), i)
    }
    same(
      `below the threshold it is still not weak (${WEAKNESS_THRESHOLD - 1} fails)`,
      isWeakModel('https://w/v1', 'm', weakDir),
      false
    )
    same('the crossing fail is counted', rememberWeakFail('https://w/v1', 'm', weakDir), WEAKNESS_THRESHOLD)
    same('the connection is now weak', isWeakModel('https://w/v1', 'm', weakDir), true)
    same('another connection is unaffected', isWeakModel('https://w/v1', 'other', weakDir), false)

    // Reasoning memory and weakness share the file without stepping on each other.
    rememberLoop('https://w/v1', 'm', 'low', weakDir)
    same('weakness survives a loop record', rememberedWeakness('https://w/v1', 'm', weakDir), WEAKNESS_THRESHOLD)
    same('loops survive a weak record', rememberedLoops('https://w/v1', 'm', weakDir), 1)

    writeFileSync(
      join(weakDir, 'model-memory.json'),
      JSON.stringify({
        version: 1,
        entries: {},
        weak: { [memoryKey('https://w/v1', 'm')]: { fails: 99, at: Date.now() - MEMORY_TTL_MS - 1000 } }
      }),
      'utf8'
    )
    same('an aged-out weakness stops counting', weaknessOf({ fails: 99, at: Date.now() - MEMORY_TTL_MS - 1000 }), 0)
    same('an aged-out weakness is not weak', isWeakModel('https://w/v1', 'm', weakDir), false)

    writeFileSync(join(weakDir, 'model-memory.json'), '{broken', 'utf8')
    same('a corrupt file reads as not weak', isWeakModel('https://w/v1', 'm', weakDir), false)
    same('recording over the corrupt file works', rememberWeakFail('https://w/v1', 'm', weakDir), 1)
    same('pure: the threshold is crossed at exactly the limit', isWeakToolCaller({ fails: WEAKNESS_THRESHOLD, at: Date.now() }), true)
    same('pure: no entry is not weak', isWeakToolCaller(undefined), false)
  } finally {
    rmSync(weakDir, { recursive: true, force: true })
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

if (failed > 0) {
  console.log(`\n${failed} MODEL MEMORY TEST(S) FAILED`)
  process.exit(1)
}
console.log('\nALL MODEL MEMORY TESTS PASSED')
