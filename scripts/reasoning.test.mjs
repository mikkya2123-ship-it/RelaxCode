/**
 * Unit tests for the "thinking" mapping and for reading reasoning out of a
 * stream. The mapping is what the user sees in the popover and what actually
 * goes on the wire, so the two must not drift.
 * Run with: npm run test:reasoning
 */
import {
  levelsFromEfforts,
  reasoningParams,
  reasoningStyle,
  reasoningWireLabel,
  supportsSampling,
  thinksByDefault
} from '../src/shared/reasoning.ts'
import {
  reasoningDeltaText,
  ThinkTagSplitter,
  unsupportedParam
} from '../src/main/reasoning.ts'

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

// 1. The provider family decides the spelling.
same('openrouter host', reasoningStyle('https://openrouter.ai/api/v1'), 'openrouter')
same('openai host', reasoningStyle('https://api.openai.com/v1'), 'effort')
same('xai host', reasoningStyle('https://api.x.ai/v1'), 'effort')
same('gemini compat host', reasoningStyle('https://generativelanguage.googleapis.com/v1beta'), 'effort')
same('groq host', reasoningStyle('https://api.groq.com/openai/v1'), 'groq')
same('dashscope host', reasoningStyle('https://dashscope.aliyuncs.com/compatible-mode/v1'), 'qwen')
same('dashscope intl host', reasoningStyle('https://dashscope-intl.aliyuncs.com/compatible-mode/v1'), 'qwen')
same('z.ai host', reasoningStyle('https://api.z.ai/api/paas/v4'), 'zai')
same('zhipu host', reasoningStyle('https://open.bigmodel.cn/api/paas/v4'), 'zai')
same('deepseek host', reasoningStyle('https://api.deepseek.com/v1'), 'model-only')
same('local gateway', reasoningStyle('http://127.0.0.1:9199/v1'), 'effort')
same('nonsense host', reasoningStyle('не url'), 'effort')

// 2. What each level sends.
same('openrouter high', reasoningParams('openrouter', 'high'), {
  reasoning: { effort: 'high', exclude: false }
})
same('openrouter off', reasoningParams('openrouter', 'off'), {
  reasoning: { enabled: false }
})
same('openai high', reasoningParams('effort', 'high'), { reasoning_effort: 'high' })
same('openai low', reasoningParams('effort', 'low'), { reasoning_effort: 'low' })
same('openai off', reasoningParams('effort', 'off'), {})
same('groq high', reasoningParams('groq', 'medium'), {
  reasoning_effort: 'medium',
  reasoning_format: 'parsed'
})
same('groq off', reasoningParams('groq', 'off'), {})
same('qwen on', reasoningParams('qwen', 'high'), { enable_thinking: true })
same('qwen off', reasoningParams('qwen', 'off'), { enable_thinking: false })
same('zai on', reasoningParams('zai', 'medium'), { thinking: { type: 'enabled' } })
same('zai off', reasoningParams('zai', 'off'), { thinking: { type: 'disabled' } })
same('deepseek sends nothing', reasoningParams('model-only', 'high', 'deepseek-reasoner'), {})

// 3. The label the popover shows has to name the real parameters.
check(
  'openrouter label names the effort',
  (reasoningWireLabel('openrouter', 'high') ?? '').includes('reasoning.effort = high'),
  reasoningWireLabel('openrouter', 'high')
)
check(
  'groq label names the format',
  (reasoningWireLabel('groq', 'low') ?? '').includes('reasoning_format = parsed'),
  reasoningWireLabel('groq', 'low')
)
same('nothing sent is reported as nothing', reasoningWireLabel('effort', 'off'), null)
same('model-only never sends a parameter', reasoningWireLabel('model-only', 'high'), null)

// 4. Models that decide on their own — the level cannot switch them off.
for (const model of ['deepseek-reasoner', 'o1-mini', 'o3', 'gpt-5', 'qwen3-thinking', 'QwQ-32B']) {
  check(`${model} always thinks`, thinksByDefault(model) === true)
}
for (const model of ['gpt-4o', 'llama-3.3-70b-versatile', 'gpt-4.1-mini', 'claude-3-5-sonnet']) {
  check(`${model} does not always think`, thinksByDefault(model) === false)
}

// 5. Sampling parameters these models reject outright.
check('o1 rejects sampling', supportsSampling('o1-mini') === false)
check('deepseek-reasoner rejects sampling', supportsSampling('deepseek-reasoner') === false)
check('gpt-4o takes sampling', supportsSampling('gpt-4o') === true)

// 6. The levels a model advertises.
same('efforts map onto levels', levelsFromEfforts(['minimal', 'low', 'high', 'xhigh']), [
  'low',
  'high'
])
same('an unknown effort adds nothing', levelsFromEfforts(['nonsense']), [])
same('an endpoint may also allow switching off', levelsFromEfforts(['none']), ['off'])

// 7. Reading reasoning out of a chunk, without showing it twice.
const chunk = (delta) => ({ choices: [{ index: 0, delta }] })
same('reasoning_content', reasoningDeltaText(chunk({ reasoning_content: 'думаю' })), 'думаю')
same('openrouter reasoning', reasoningDeltaText(chunk({ reasoning: 'hmm' })), 'hmm')
same(
  'reasoning_details',
  reasoningDeltaText(chunk({ reasoning_details: [{ type: 'reasoning.text', text: 'a' }, { text: 'b' }] })),
  'ab'
)
same(
  'both shapes at once are shown once',
  reasoningDeltaText(chunk({ reasoning: 'once', reasoning_details: [{ text: 'twice' }] })),
  'once'
)
same('no reasoning in a text delta', reasoningDeltaText(chunk({ content: 'привет' })), '')
same('encrypted details carry no text', reasoningDeltaText(chunk({ reasoning_details: [{ type: 'reasoning.encrypted', data: 'xx' }] })), '')

// 8. Inline ` thinking` tags, including ones split across chunks.
{
  const plain = new ThinkTagSplitter()
  same('plain text passes through', plain.push('просто ответ'), [{ kind: 'text', text: 'просто ответ' }])

  const split = new ThinkTagSplitter()
  same('a half-received tag is held back', split.push('до <thi'), [{ kind: 'text', text: 'до ' }])
  same('the rest of the tag opens it', split.push('nking>мысл'), [{ kind: 'reasoning', text: 'мысл' }])
  same('the closing tag ends it', split.push('и</thinking>Ответ'), [
    { kind: 'reasoning', text: 'и' },
    { kind: 'text', text: 'Ответ' }
  ])
  same('and the answer continues', split.push(' дальше'), [{ kind: 'text', text: ' дальше' }])

  const shortTag = new ThinkTagSplitter()
  same('the short tag opens too', shortTag.push('а<think>б'), [
    { kind: 'text', text: 'а' },
    { kind: 'reasoning', text: 'б' }
  ])
  same('and closes', shortTag.push('в</think>г'), [
    { kind: 'reasoning', text: 'в' },
    { kind: 'text', text: 'г' }
  ])

  const unclosed = new ThinkTagSplitter()
  same('an unclosed thought streams as reasoning', unclosed.push('<reasoning>долго'), [
    { kind: 'reasoning', text: 'долго' }
  ])
  same('with nothing left over', unclosed.flush(), [])

  const trailing = new ThinkTagSplitter()
  same('a lone < waits for its tag', trailing.push('2 <'), [{ kind: 'text', text: '2 ' }])
  same('and is kept in the buffer', trailing.push(' 3 яблока'), [{ kind: 'text', text: '< 3 яблока' }])
  same('nothing left to flush', trailing.flush(), [])

  const cut = new ThinkTagSplitter()
  same('a tag cut off mid-word holds the text back', cut.push('ответ <think'), [
    { kind: 'text', text: 'ответ ' }
  ])
  same('and the held text is flushed at the end', cut.flush(), [
    { kind: 'text', text: '<think' }
  ])
}

// 9. A parameter the provider does not know.
same(
  '400 about temperature',
  unsupportedParam("Unsupported parameter: 'temperature' is not supported with this model.", 400),
  'sampling'
)
same(
  '400 about reasoning',
  unsupportedParam('reasoning_effort is not supported for this model', 400),
  'reasoning'
)
same(
  '400 about thinking',
  unsupportedParam('Unknown field thinking', 422),
  'reasoning'
)
same('500 is not a refused parameter', unsupportedParam('reasoning not supported', 500), null)
same('404 is not a refused parameter', unsupportedParam('reasoning not found', 404), null)
same('a generic 400 names nothing', unsupportedParam('invalid request', 400), null)
same(
  'a context overflow stays a real error',
  unsupportedParam('This model maximum context length is 8192 tokens', 400),
  null
)

console.log(failed === 0 ? 'ALL REASONING TESTS PASSED' : `${failed} REASONING TEST(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
