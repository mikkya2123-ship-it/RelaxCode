/**
 * Unit tests for Base URL repair. The bug that started this: a full address
 * pasted into a field that already carried a scheme produced
 * `http:/https://gen-api.ru`, which parsed with the host `https` and failed
 * with a bare "fetch failed" after a ten-second DNS wait.
 * Run with: npm run test:url
 */
import { normalizeBaseUrl } from '../src/shared/base-url.ts'

let failed = 0
function check(label, condition, extra) {
  if (condition) {
    console.log('ok   -', label)
  } else {
    failed += 1
    console.log('FAIL -', label, extra === undefined ? '' : JSON.stringify(extra))
  }
}

function value(input) {
  const result = normalizeBaseUrl(input)
  return result.ok ? result.value : `REJECTED:${result.reason}`
}
function fixed(input) {
  const result = normalizeBaseUrl(input)
  return result.ok ? result.fixed : `REJECTED:${result.reason}`
}

// 1. The reported failure: the scheme survived only partially.
check('partial scheme is rebuilt', value('http:/https://gen-api.ru') === 'https://gen-api.ru')
check('doubled scheme is rebuilt', value('http://https://gen-api.ru') === 'https://gen-api.ru')
check('doubled scheme without a slash', value('https://https//gen-api.ru') === 'https://gen-api.ru')
check(
  'address pasted after a prefilled one wins',
  value('https://api.openai.com/v1https://gen-api.ru') === 'https://gen-api.ru'
)
check('a rebuilt address counts as fixed', fixed('http:/https://gen-api.ru') === true)

// 2. Nothing is invented for an already good address.
for (const url of [
  'https://proxy.gen-api.ru/v1',
  'https://api.groq.com/openai/v1',
  'https://openrouter.ai/api/v1',
  'http://127.0.0.1:9199/v1',
  'http://localhost:11434/v1'
]) {
  check(`left alone: ${url}`, value(url) === url && fixed(url) === false)
}

// 3. The endpoint from the docs, not the API root.
check('a trailing slash goes', value('https://proxy.gen-api.ru/v1/') === 'https://proxy.gen-api.ru/v1')
check(
  'a full endpoint goes back to the root',
  value('https://proxy.gen-api.ru/v1/chat/completions') === 'https://proxy.gen-api.ru/v1'
)
check(
  'the models endpoint too',
  value('https://proxy.gen-api.ru/v1/models/') === 'https://proxy.gen-api.ru/v1'
)

// 4. A missing scheme is filled in, plain http for anything on this machine.
check('a bare public host', value('proxy.gen-api.ru/v1') === 'https://proxy.gen-api.ru/v1')
check('a bare localhost', value('localhost:11434/v1') === 'http://localhost:11434/v1')
check('a bare loopback', value('127.0.0.1:9199/v1') === 'http://127.0.0.1:9199/v1')
check('a docker-style name', value('ollama:11434') === 'http://ollama:11434')
check('a lan address', value('192.168.1.10:8080/v1') === 'http://192.168.1.10:8080/v1')

// 5. What people paste along with the address.
check('quotes around it', value('  "https://api.groq.com/openai/v1"  ') === 'https://api.groq.com/openai/v1')
check('a zero-width space in it', value('https://api.groq.com/openai/v1\u200b') === 'https://api.groq.com/openai/v1')
check(
  'a query string is dropped',
  value('https://gateway.example.com/v1?key=x') === 'https://gateway.example.com/v1'
)
check(
  'a query holding an address keeps its own host',
  value('https://gateway.example.com/v1?upstream=https://api.openai.com/v1') ===
    'https://gateway.example.com/v1'
)

// 6. What cannot be used is refused, with a reason, instead of failing later.
check('an empty field', normalizeBaseUrl('').ok === false && normalizeBaseUrl('').reason === 'empty')
check('an empty field with spaces', normalizeBaseUrl('   ').ok === false)
check('two addresses with a space', normalizeBaseUrl('https://a.ru/v1 https://b.ru/v1').ok === false)
check('prose', normalizeBaseUrl('это не адрес').ok === false)
check('another scheme', normalizeBaseUrl('ftp://files.example.com').ok === false)
check('no host', normalizeBaseUrl('https://').ok === false)
check(
  'the scheme that got eaten is not a host',
  normalizeBaseUrl('https://http://').ok === false
)

// 7. Repairing is stable: a fixed address is not fixed again.
for (const url of ['http:/https://gen-api.ru', 'gen-api.ru', 'localhost:11434/v1']) {
  check(`stable: ${url}`, fixed(value(url)) === false)
}

if (failed > 0) {
  console.log(`\n${failed} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL BASE URL TESTS PASSED')
