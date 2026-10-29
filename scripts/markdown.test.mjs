/**
 * The chat markdown parser: bold/italic/code inline, headings, lists (including
 * the "--" and "–" bullets weak models actually emit), quotes, fenced code and
 * [n] citation markers — tolerant of half-streamed input.
 * Run with: npm run test:markdown
 */
import { parseInline, parseMarkdown } from '../src/shared/markdown.ts'

let failed = 0
function check(label, condition, extra) {
  if (condition) {
    console.log('ok   -', label)
  } else {
    failed += 1
    console.log('FAIL -', label, extra === undefined ? '' : JSON.stringify(extra))
  }
}

/* ---------------------------------------------------------------- inline */

const bold = parseInline('**Полное имя:** Криштиану')
check('bold is recognised', bold[0]?.type === 'bold' && bold[0].text === 'Полное имя:')
check('text after bold survives', bold[1]?.type === 'text' && bold[1].text === ' Криштиану')

const mixed = parseInline('до *41* год и `code` тут')
check('italic is recognised', mixed.some((n) => n.type === 'italic' && n.text === '41'))
check('inline code is recognised', mixed.some((n) => n.type === 'code' && n.text === 'code'))

check(
  'an unclosed ** stays plain text (streaming)',
  parseInline('жирный **не закрыт')[1]?.text === 'жирный **не закрыт'.split('**')[0] ||
    parseInline('жирный **не закрыт').every((n) => n.type === 'text')
)
check(
  'a lone asterisk is text, not italic',
  parseInline('2 * 3 = 6').every((n) => n.type === 'text')
)

const cites = parseInline('лучший игрок [1] в истории [12] года [2026]')
check(
  'one and two digit markers become citations',
  cites.filter((n) => n.type === 'cite').map((n) => n.cite).join(',') === '1,12'
)
check('a four digit year is not a citation', !cites.some((n) => n.type === 'cite' && n.cite === 2026))

/* ---------------------------------------------------------------- blocks */

const rich = parseMarkdown(
  [
    '# Заголовок',
    '',
    '- **Позиция:** нападающий',
    '- Рост: 1,87 м',
    '',
    '> Сноска в рамке',
    '',
    '```python',
    'print(1)',
    ''
  ].join('\n')
)
check('heading is parsed with level 1', rich[0]?.type === 'h' && rich[0].level === 1)
check('a dash list groups its items', rich[1]?.type === 'ul' && rich[1].items.length === 2)
check('bold inside a list item works', rich[1]?.items[0]?.[0]?.type === 'bold')
check('a quote becomes a framed block', rich[2]?.type === 'quote' && rich[2].lines.length === 1)
check('a fenced block keeps its language', rich[3]?.type === 'code' && rich[3].lang === 'python')
check('the fence body is intact', rich[3]?.text === 'print(1)')

const dashed = parseMarkdown(['--**Дата:** 5 февраля 1985', '--Рост: 1,87'].join('\n'))
check(
  'double-dash bullets from weak models still become a list',
  dashed.length === 1 && dashed[0].type === 'ul' && dashed[0].items.length === 2,
  JSON.stringify(dashed)
)

const ordered = parseMarkdown(['3. третий', '4. четвёртый'].join('\n'))
check(
  'an ordered list keeps its start number',
  ordered[0]?.type === 'ol' && ordered[0].start === 3 && ordered[0].items.length === 2
)

const streaming = parseMarkdown(['Текст до кода', '', '```js', 'const a = 1'].join('\n'))
check(
  'an unclosed fence streams as code, not raw backticks',
  streaming.length === 2 && streaming[1].type === 'code' && streaming[1].text === 'const a = 1'
)

const plain = parseMarkdown(['Просто абзац', 'вторая строка'].join('\n'))
check('plain lines form one paragraph with a line break', plain.length === 1 && plain[0].lines.length === 2)
check('empty input renders nothing', parseMarkdown('').length === 0 && parseMarkdown('\n\n').length === 0)

if (failed > 0) {
  console.log(`\n${failed} MARKDOWN CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL MARKDOWN CHECKS PASSED')
