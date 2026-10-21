/**
 * Localization checks.
 *
 * The TypeScript compiler already refuses a missing English key, but it cannot
 * catch an empty value, a placeholder that only exists in one language, a
 * literal `t('…')` pointing at a key that was renamed, or a destructive-command
 * code without a sentence. Those are the failures this script looks for.
 *
 * Run with: npm run test:i18n
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { dictionaries, en, ru } from '../src/shared/i18n.ts'
import { DANGER_REASON_CODES } from '../src/shared/terminal.ts'

let failed = 0

function check(label, condition, extra) {
  if (condition) {
    console.log(`ok   - ${label}`)
    return
  }
  failed += 1
  console.error(`FAIL - ${label}${extra ? `\n       ${extra}` : ''}`)
}

function placeholders(value) {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
}

const ruKeys = Object.keys(ru).sort()
const enKeys = Object.keys(en).sort()

check('ru and en define the same keys', ruKeys.join('\n') === enKeys.join('\n'))

const missingEn = ruKeys.filter((key) => !(key in en))
const missingRu = enKeys.filter((key) => !(key in ru))
check('no key is missing in en', missingEn.length === 0, missingEn.join(', '))
check('no key is missing in ru', missingRu.length === 0, missingRu.join(', '))

const empty = ruKeys.filter((key) => !ru[key] || !en[key])
check('every key has text in both languages', empty.length === 0, empty.join(', '))

const placeholderMismatch = ruKeys.filter(
  (key) => placeholders(ru[key] ?? '').join() !== placeholders(en[key] ?? '').join()
)
check(
  'placeholders match between languages',
  placeholderMismatch.length === 0,
  placeholderMismatch.join(', ')
)

const dangerMissing = DANGER_REASON_CODES.filter(
  (code) =>
    !(`chat.approval.danger.${code}` in ru) || !(`chat.approval.danger.${code}` in en)
)
check(
  'every destructive-command code has a sentence',
  dangerMissing.length === 0,
  dangerMissing.join(', ')
)

check('both locales are complete', Object.keys(dictionaries).sort().join() === 'en,ru')

/** Every literal `t('key')` in the app must point at a real key. */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  )
}

const roots = ['src/main', 'src/preload', 'src/renderer/src'].map((dir) =>
  resolve(dir)
)
const sources = roots
  .flatMap((dir) => walk(dir))
  .filter((file) => /\.(ts|tsx)$/.test(file) && !file.endsWith('i18n.ts'))

const unknown = new Set()
for (const file of sources) {
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(/\bt\(\s*'([^']+)'/g)) {
    if (!(match[1] in ru)) unknown.add(`${file}: ${match[1]}`)
  }
}

check('every literal t() key exists', unknown.size === 0, [...unknown].join('\n       '))

// Language names are written in their own language (`Русский`), so those keys
// are allowed to carry Cyrillic in the English dictionary.
const cyrillicInEnglish = Object.entries(en)
  .filter(([key, value]) => !key.startsWith('settings.language.') && /[А-Яа-яЁё]/.test(value))
  .map(([key]) => key)
check(
  'English strings contain no Russian leftovers',
  cyrillicInEnglish.length === 0,
  cyrillicInEnglish.join(', ')
)

console.log(failed === 0 ? '\nALL I18N TESTS PASSED' : `\n${failed} I18N TEST(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
