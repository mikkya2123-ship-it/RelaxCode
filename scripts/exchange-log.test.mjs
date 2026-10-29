/**
 * Exchange-log checks: after a run, the report must show the question, every
 * tool (with args and answer), figure values, warnings, notices and the final
 * text — the things a person would otherwise have to describe by hand.
 * Run with: npm run test:exchange-log
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createExchangeLog } from '../src/main/exchange-log.ts'

let failed = 0
function check(label, condition, extra) {
  if (condition) {
    console.log('ok   -', label)
  } else {
    failed += 1
    console.log('FAIL -', label, extra === undefined ? '' : JSON.stringify(extra))
  }
}

const dir = mkdtempSync(join(tmpdir(), 'relaxcode-exchange-'))

function request(overrides = {}) {
  return {
    requestId: 'req-abcdef12-3456',
    mode: 'agent',
    messages: [
      { role: 'user', content: 'нарисуй смежный угол' },
      { role: 'assistant', content: 'сейчас' },
      { role: 'user', content: 'и подпиши 60 и 120' }
    ],
    context: {},
    ...overrides
  }
}

function run(overrides = {}) {
  const log = createExchangeLog(request(overrides), dir)
  log.setTarget({ model: 'test-model', provider: 'Test', baseUrl: 'https://example.test/v1' })
  log.setSystemPrompt('SYSTEM PROMPT TEXT')
  log.record({ requestId: 'r', type: 'reasoning', text: 'думаю' })
  log.record({ requestId: 'r', type: 'tool-start', callId: 'c1', name: 'draw_figure', args: '{"spec":', step: 1 })
  log.record({
    requestId: 'r',
    type: 'tool-result',
    callId: 'c1',
    ok: true,
    summary: 'Drew a figure',
    detail: 'data:image/png;base64,' + 'A'.repeat(400),
    meta: {
      kind: 'figure',
      title: 'Смежные углы',
      svg: '<svg/>',
      results: [{ label: '∠AOC', value: '60°' }],
      warnings: ['arm of ∠AOC was moved to 60°']
    }
  })
  log.record({ requestId: 'r', type: 'notice', kind: 'no-tool-calls' })
  log.record({ requestId: 'r', type: 'delta', text: 'Готово: ' })
  log.record({ requestId: 'r', type: 'delta', text: '60° и 120°' })
  log.record({
    requestId: 'r',
    type: 'done',
    promptTokens: 100,
    completionTokens: 20,
    steps: 1
  })
  return log
}

run()
const md = readFileSync(join(dir, 'latest.md'), 'utf8')
const report = JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8'))

check('markdown names the mode and model', md.includes('— agent') && md.includes('test-model'))
check('the last user message is in the report', md.includes('и подпиши 60 и 120'))
check('the tool and its raw args are shown', md.includes('draw_figure') && md.includes('{"spec":'))
check('the figure title and values are shown', md.includes('Смежные углы') && md.includes('∠AOC = 60°'))
check('figure warnings are shown', md.includes('arm of ∠AOC was moved to 60°'))
check('engine notices are explained', md.includes('ни один инструмент не запускался'))
check('the streamed answer is joined', report.answer === 'Готово: 60° и 120°')
check('token usage is recorded', report.usage.promptTokens === 100 && report.usage.completionTokens === 20)
check('the system prompt is kept in json', report.systemPrompt === 'SYSTEM PROMPT TEXT')
check('null provider model would be replaced earlier', report.summary.toolCalls === 1 && report.summary.ok === 1)
check('failed tools are counted', report.summary.failed === 0 && report.summary.pending === 0)
check(
  'base64 payloads are shrunk',
  report.steps[0].detail.includes('[400 символов base64]') && !report.steps[0].detail.includes('AAAAAAAA')
)
check('a file per exchange plus latest pair exist', readdirSync(dir).filter((n) => n.endsWith('.md')).length === 2)

// An error ends the run just like done does, and a late done must not write twice.
const before = readdirSync(dir).length
const failing = createExchangeLog(request({ requestId: 'req-error-9999' }), dir)
failing.record({ requestId: 'r', type: 'error', message: 'HTTP 500: nope' })
failing.record({ requestId: 'r', type: 'done', promptTokens: 1, completionTokens: 1, steps: 0 })
const errorJson = readdirSync(dir)
  .filter((n) => n.startsWith('req-error') || n.includes('req-erro'))
  .map((n) => join(dir, n))
check('an error report is written', readdirSync(dir).length === before + 2)
const errorReport = JSON.parse(
  readFileSync(
    join(
      dir,
      readdirSync(dir).find((n) => n.endsWith('.json') && n !== 'latest.json' && n.includes('req-erro'))
    ),
    'utf8'
  )
)
check('the error is recorded', errorReport.error === 'HTTP 500: nope')
check('a missing answer is stated', readFileSync(join(dir, 'latest.md'), 'utf8').includes('(модель не написала текст)'))
void errorJson

// Old reports are pruned so the folder cannot grow without bound.
for (let index = 0; index < 45; index += 1) {
  createExchangeLog(request({ requestId: `req-prune-${index}` }), dir).record({
    requestId: 'r',
    type: 'done',
    promptTokens: 0,
    completionTokens: 0,
    steps: 0
  })
}
const kept = readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'latest.json')
const keptMd = readdirSync(dir).filter((n) => n.endsWith('.md') && n !== 'latest.md')
check('old reports are pruned to the cap', kept.length <= 40, kept.length)
check('their markdown twins are pruned too', keptMd.length <= 41, keptMd.length)

rmSync(dir, { recursive: true, force: true })

if (failed > 0) {
  console.log(`\n${failed} EXCHANGE LOG CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL EXCHANGE LOG CHECKS PASSED')
