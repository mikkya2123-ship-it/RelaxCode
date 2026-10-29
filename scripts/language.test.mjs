/**
 * Language guard checks.
 *
 * The guard is the last line of defence against a weak model answering in the
 * language of the pages it just read. These tests keep its decisions honest:
 * Cyrillic/Latin counting, the `auto` rule and the mismatch thresholds.
 * Run with: npm run test:language
 */
import {
  answerLanguageMismatch,
  countScripts,
  expectedAnswerLanguage,
  hasCyrillic,
  requestsLanguageOverride
} from '../src/shared/language.ts'

let failed = 0
function check(label, condition, extra) {
  if (condition) {
    console.log('ok   -', label)
  } else {
    failed += 1
    console.log('FAIL -', label, extra === undefined ? '' : JSON.stringify(extra))
  }
}

/* ------------------------------- counting -------------------------------- */

const ru = 'Это довольно длинный ответ про модели, поиск и прочие обычные вещи.'
const en = 'This is a fairly long answer about models, search and other ordinary things.'

check('counts Cyrillic', countScripts(ru).cyrillic > 40 && countScripts(ru).latin === 0)
check('counts Latin', countScripts(en).latin > 40 && countScripts(en).cyrillic === 0)

/* ------------------------------ code and URLs ---------------------------- */

const mixed = 'Ответ на русском языке с кодом:\n```ts\nconst answer = 42\n```\nи ссылкой https://example.com/docs'
const mixedCounts = countScripts(mixed)
check('code fences do not vote', mixedCounts.cyrillic > mixedCounts.latin, mixedCounts)
check('inline code does not vote', countScripts('Ответ: `npm run build` — вот и всё, готово.').latin < 10)
check('urls do not vote', countScripts('Смотри тут https://www.typescriptlang.org/docs/handbook').latin < 10)

/* -------------------------------- cyrillic ------------------------------- */

check('cyrillic prose is cyrillic', hasCyrillic(ru))
check('english prose is not cyrillic', !hasCyrillic(en))
check('one quoted word is not enough', !hasCyrillic('The answer is "привет", nothing more here.'))
check('a short line is not enough', !hasCyrillic('да'))

/* --------------------------- expected language --------------------------- */

check('setting ru wins', expectedAnswerLanguage('ru', en) === 'ru')
check('setting en wins', expectedAnswerLanguage('en', ru) === 'en')
check('auto with a Russian question asks for Russian', expectedAnswerLanguage('auto', ru) === 'ru')
check('auto with a Latin question stays open', expectedAnswerLanguage('auto', en) === null)

/* ------------------------ explicit language request ---------------------- */

check(
  'a Russian request for an English answer is detected',
  requestsLanguageOverride('Ответь мне на английском что такое нейросеть')
)
check('an English request is detected', requestsLanguageOverride('Answer in English please'))
check('a Russian request is detected', requestsLanguageOverride('ответь по-русски'))
check('переведи на русский is detected', requestsLanguageOverride('переведи это на русский'))
check(
  'a plain Russian question is not an override',
  !requestsLanguageOverride('Что такое нейросеть и как она работает?')
)
check(
  'discussing English is not an override',
  !requestsLanguageOverride('Расскажи подробнее про нейросети и их виды.')
)
check(
  'the guard steps aside for an explicit request',
  expectedAnswerLanguage('auto', 'Ответь мне на английском что такое нейросеть') === null
)
check(
  'the setting also steps aside for an explicit request',
  expectedAnswerLanguage('ru', 'Answer in English, please') === null
)
check(
  'a plain Russian question still expects Russian',
  expectedAnswerLanguage('auto', 'Объясни, что такое нейросеть') === 'ru'
)

/* ------------------------------- mismatch -------------------------------- */

check('Russian question, English answer is a mismatch', answerLanguageMismatch('ru', en))
check('Russian question, Russian answer is fine', !answerLanguageMismatch('ru', ru))
check('English question, Russian answer is a mismatch', answerLanguageMismatch('en', ru))
check('English question, English answer is fine', !answerLanguageMismatch('en', en))
check('no expectation never mismatches', !answerLanguageMismatch(null, en))
check('a short answer is never flagged', !answerLanguageMismatch('ru', 'Ok, done.'))
check('a code-only answer is never flagged', !answerLanguageMismatch('ru', '```ts\nconst x: number = 1\n```'))
check(
  'a Russian answer with English terms is fine',
  !answerLanguageMismatch(
    'ru',
    'Модель GPT-6 Astra не найдена; в результатах были только GPT-4 и ChatGPT, официальной страницы продукта нет.'
  ),
  countScripts(
    'Модель GPT-6 Astra не найдена; в результатах были только GPT-4 и ChatGPT, официальной страницы продукта нет.'
  )
)
check(
  'an English answer with a Russian quote is a mismatch for Russian',
  answerLanguageMismatch('ru', 'I could not find anything about "GPT-6 Astra" in the sources I read online.')
)

if (failed > 0) {
  console.log(`\n${failed} LANGUAGE CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL LANGUAGE CHECKS PASSED')
