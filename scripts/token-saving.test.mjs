/**
 * Unit tests for token saving — the three modes and the window they send.
 *
 * The window is the part that can break a request: a tool result whose call was
 * trimmed away makes providers reject the whole thing, and a model that silently
 * lost the middle of a conversation starts inventing continuity. These tests
 * pin both down, plus the promise that nothing is deleted from the caller.
 *
 * Run with: npm run test:saving
 */
import {
  effectiveThinking,
  savingPlan,
  SAVING_PLANS,
  savingIsActive
} from '../src/shared/token-saving.ts'
import { trimForWire } from '../src/main/token-saving.ts'

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

/* ------------------------------ the mode table ----------------------------- */

same('saving is off by default', savingIsActive(undefined), false)
same('off is not active', savingIsActive('off'), false)
same('on is active', savingIsActive('on'), true)
same('super is active', savingIsActive('super'), true)
same('unknown mode falls back to off', savingPlan('nonsense'), SAVING_PLANS.off)
same('super caps thinking at low', SAVING_PLANS.super.thinkingCap, 'low')
same('on does not touch thinking', SAVING_PLANS.on.thinkingCap, null)

same('high becomes low under super', effectiveThinking('high', 'super'), 'low')
same('medium becomes low under super', effectiveThinking('medium', 'super'), 'low')
same('low stays low under super', effectiveThinking('low', 'super'), 'low')
same('off stays off: saving never raises', effectiveThinking('off', 'super'), 'off')
same('high is untouched when saving is on', effectiveThinking('high', 'on'), 'high')
same('high is untouched when saving is off', effectiveThinking('high', 'off'), 'high')

/* --------------------------------- fixtures -------------------------------- */

const CALL_READ = {
  id: 'call-read',
  type: 'function',
  function: { name: 'read_file', arguments: JSON.stringify({ path: 'src/a.ts' }) }
}
const CALL_WRITE = {
  id: 'call-write',
  type: 'function',
  function: { name: 'write_file', arguments: JSON.stringify({ path: 'src/b.ts', content: 'x' }) }
}
const CALL_RUN = {
  id: 'call-run',
  type: 'function',
  function: { name: 'run_command', arguments: JSON.stringify({ command: 'npm test' }) }
}

const BIG = 'A'.repeat(6000)
const PAD = 'P'.repeat(1500)

/** A conversation with a heavy middle, a goal at the top and work in flight. */
function fixture() {
  const padding = []
  for (let turn = 0; turn < 8; turn += 1) {
    padding.push({ role: 'user', content: `Уточнение ${turn}: ${PAD}` })
    padding.push({ role: 'assistant', content: `Понял ${turn}. ${PAD}` })
  }
  return [
    { role: 'user', content: 'Сделай так, чтобы тесты проходили' },
    { role: 'assistant', content: 'Хорошо, начинаю.' },
    { role: 'user', content: 'Посмотри ещё файл a.ts' },
    { role: 'assistant', content: '', tool_calls: [CALL_READ] },
    { role: 'tool', tool_call_id: 'call-read', content: `OK: ${BIG}` },
    { role: 'assistant', content: '', tool_calls: [CALL_WRITE] },
    { role: 'tool', tool_call_id: 'call-write', content: 'OK: wrote src/b.ts' },
    { role: 'assistant', content: 'Записал.' },
    ...padding,
    { role: 'user', content: 'Теперь запусти тесты' },
    { role: 'assistant', content: '', tool_calls: [CALL_RUN] },
    { role: 'tool', tool_call_id: 'call-run', content: 'OK: 12 passed' }
  ]
}

const SYSTEM = 'You are RelaxCode.'

/* ---------------------------------- off ----------------------------------- */

{
  const history = fixture()
  const trimmed = trimForWire(SYSTEM, history, SAVING_PLANS.off)
  same('off sends every message', trimmed.messages.length, history.length)
  same('off drops nothing', trimmed.dropped, 0)
  same('off appends no digest', trimmed.system, SYSTEM)
  check('off returns the caller array untouched', trimmed.messages === history)
}

/* ------------------------------ on: the window ----------------------------- */

{
  const history = fixture()
  const before = JSON.stringify(history)
  const trimmed = trimForWire(SYSTEM, history, SAVING_PLANS.on)

  check('on leaves something out', trimmed.dropped > 0, trimmed.dropped)
  check('on reports the characters it saved', trimmed.droppedChars > 0)
  same('on never mutates the caller', JSON.stringify(history), before)

  // Every kept tool result still has its call.
  const keptCalls = new Set()
  for (const message of trimmed.messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue
    for (const call of message.tool_calls) keptCalls.add(call.id)
  }
  const orphans = trimmed.messages.filter(
    (message) => message.role === 'tool' && !keptCalls.has(message.tool_call_id)
  )
  same('no tool result is left without its call', orphans.length, 0)

  const first = trimmed.messages[0]
  const last = trimmed.messages[trimmed.messages.length - 1]
  check('the goal still goes out', first.role === 'user' && String(first.content).includes('тесты'))
  check('the step in flight still goes out', last.role === 'tool' && last.tool_call_id === 'call-run')
  check(
    'the digest is appended to the system prompt',
    trimmed.system.startsWith(SYSTEM) && trimmed.system.includes('Left out:')
  )
  check(
    'the digest names what was already done',
    trimmed.system.includes('read_file src/a.ts'),
    trimmed.system
  )
  check(
    'the digest names files that were written',
    trimmed.system.includes('src/b.ts'),
    trimmed.system
  )
}

/* ------------------------ super: old results are cut ----------------------- */

{
  const history = fixture()
  const plan = { maxMessages: 40, maxChars: 40000, toolResultChars: 500, thinkingCap: null }
  const trimmed = trimForWire(SYSTEM, history, plan)

  same('nothing is dropped while the window is wide', trimmed.dropped, 0)
  check('an old tool result is shortened', trimmed.shortened >= 1, trimmed.shortened)
  const big = trimmed.messages.find((message) => message.role === 'tool' && message.tool_call_id === 'call-read')
  check('the shortened result says so', String(big?.content).includes('characters cut by token saving'))
  check('the shortened result stays inside the budget', String(big?.content).length <= 500 + 80)
  const live = trimmed.messages.find((message) => message.role === 'tool' && message.tool_call_id === 'call-run')
  same('the round in flight is never cut', live.content, 'OK: 12 passed')
}

/* ------------------- super: a huge step in flight survives ----------------- */

{
  const plan = SAVING_PLANS.super
  const history = fixture()
  const trimmed = trimForWire(SYSTEM, history, plan)
  const last = trimmed.messages[trimmed.messages.length - 1]
  same('the last tool result is kept verbatim', last.content, 'OK: 12 passed')
  const kept = trimForWire(SYSTEM, history, plan)
  check(
    'the window stays inside the message budget',
    kept.messages.length <= plan.maxMessages,
    { kept: kept.messages.length, budget: plan.maxMessages }
  )
}

/* --------------------------- the smallest window --------------------------- */

{
  const plan = { maxMessages: 5, maxChars: 3000, toolResultChars: 0, thinkingCap: null }
  const history = fixture()
  const trimmed = trimForWire(SYSTEM, history, plan)
  check('a tight window drops the old tool round', trimmed.dropped >= 4, trimmed.dropped)
  check(
    'the digest still mentions the dropped work',
    trimmed.system.includes('Steps already run:'),
    trimmed.system
  )
  check('the digest counts the dropped messages', /Left out: \d+/.test(trimmed.system), trimmed.system)
  const orphan = trimmed.messages.some(
    (message) => message.role === 'tool' && message.tool_call_id === 'call-read'
  )
  same('a dropped call takes its result with it', orphan, false)
}

/* ------------------------------- edge cases -------------------------------- */

{
  const trimmed = trimForWire(SYSTEM, [], SAVING_PLANS.super)
  same('an empty conversation is untouched', trimmed.messages.length, 0)
  same('and gets no digest', trimmed.system, SYSTEM)
}

{
  const history = [{ role: 'user', content: 'привет' }]
  const trimmed = trimForWire(SYSTEM, history, SAVING_PLANS.super)
  same('a single message is never dropped', trimmed.messages.length, 1)
  same('no digest for an empty gap', trimmed.system, SYSTEM)
}

if (failed > 0) {
  console.log(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall token-saving checks passed')
