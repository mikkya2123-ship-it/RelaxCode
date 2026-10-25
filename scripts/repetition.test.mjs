/**
 * Unit tests for the thought-loop guard.
 *
 * The real failure this reproduces: "cohere/north-mini-code:free" on OpenRouter
 * spent 57 s streaming 21 000 characters of two alternating sentences in the
 * reasoning channel and never wrote an answer. The thinking card showed the
 * same two sentences dozens of times.
 *
 * Run with: npm run test:repetition
 */
import { findRepetition, RepetitionGuard } from '../src/main/repetition.ts'

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

/** True when the last `repeats * period` characters are the same block. */
function isBackToBackCopies(text, period, repeats) {
  const tail = text.slice(-period * repeats)
  for (let index = 0; index < repeats; index += 1) {
    if (tail.slice(index * period, (index + 1) * period) !== tail.slice(0, period)) return false
  }
  return true
}

// 1. Normal reasoning is left alone.
const normal = [
  'Пользователь просит сверстать одностраничный сайт для кофейни.',
  '',
  'Сначала посмотрю, что уже есть в проекте:',
  '- index.html отсутствует',
  '- styles.css отсутствует',
  '',
  'Значит, создам оба файла и подниму статический сервер, чтобы проверить.',
  'Потом покажу ответ curl и открою страницу.'
].join('\n')
same('normal thinking is not a loop', findRepetition(normal), null)

// 2. The exact degeneration from the failing run is caught.
const cycle =
  'Пользователь хочет, чтобы я показал, что сервер запущен: curl -I http://localhost:8000 → 200.\n\n' +
  'Пользователь хочет, чтобы я открыл страницу в браузере (или через curl показал, что HTML отдаётся).\n\n'
const looping = 'Пользователь хочет, чтобы я разработал сайт-визитку «Nordic Coffee». ' + cycle.repeat(40)
const hit = findRepetition(looping)
check('a repeating thought is caught', hit !== null, hit)
if (hit) {
  check('the reported cycle really repeats', isBackToBackCopies(looping, hit.period, hit.repeats), hit)
  check('the cycle is reported at least 5 times', hit.repeats >= 5, hit)
  check('the block is the two-sentence cycle', hit.period === cycle.length, {
    period: hit.period,
    cycle: cycle.length
  })
  same('extra chars are every copy but the first', hit.extraChars, (hit.repeats - 1) * hit.period)
  const kept = looping.slice(0, looping.length - hit.extraChars)
  check('cutting leaves exactly one copy', kept.endsWith(cycle), kept.slice(-cycle.length - 40))
  same('the cut text no longer loops', findRepetition(kept), null)
}

// 3. Two repeats are not a loop: models legitimately restate a short point.
const twice = 'Проверю сборку.\n\n' + cycle + cycle
same('two copies are tolerated', findRepetition(twice), null)

// 4. A chunked stream is caught too, and the chunk boundaries do not hide it.
const guard = new RepetitionGuard()
let caughtAt = -1
let fed = ''
for (const chunk of looping.match(/[\s\S]{1,37}/g) ?? []) {
  fed += chunk
  const found = guard.push(chunk)
  if (found) {
    caughtAt = fed.length
    check('chunked stream reports a real cycle', isBackToBackCopies(fed, found.period, found.repeats), found)
    break
  }
}
check('chunked stream is caught', caughtAt > 0, caughtAt)
check('caught long before the whole stream arrived', caughtAt < looping.length / 2, {
  caughtAt,
  total: looping.length
})

// 5. After a cut the guard is reset, so a new step starts from a clean tail.
guard.reset()
same('reset forgets the old tail', guard.push(cycle), null)

// 6. Short structural fragments are not treated as a thought loop.
same('a markdown separator row is too short to be a loop', findRepetition('| --- | --- |\n'.repeat(3)), null)
same('a short checklist is fine', findRepetition('- [ ] шаг\n'.repeat(6)), null)
same('empty text is not a loop', findRepetition(''), null)

// 7. The guard can be tuned, which is what the streaming path relies on.
const strict = findRepetition(cycle.repeat(3), { minRepeats: 3 })
check('minRepeats is honoured', strict !== null && strict.repeats >= 3, strict)
same('a longer minimum ignores the same text', findRepetition(cycle.repeat(3), { minRepeats: 8 }), null)

if (failed > 0) {
  console.log(`\n${failed} REPETITION TEST(S) FAILED`)
  process.exit(1)
}
console.log('\nALL REPETITION TESTS PASSED')
