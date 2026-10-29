/**
 * Unit tests for the shared line diff used by the file-tool cards.
 *
 * Run with: npm run test:diff
 */
import { diffText, diffCountsLabel } from '../src/shared/diff.ts'

let failed = 0
function check(label, condition, extra) {
  if (condition) {
    console.log('ok   -', label)
  } else {
    failed += 1
    console.log('FAIL -', label, extra === undefined ? '' : JSON.stringify(extra))
  }
}

const same = diffText('a\nb\nc', 'a\nb\nc')
check('identical text is empty', same.patch === '' && same.added === 0 && same.removed === 0)

const added = diffText('a\nc', 'a\nb\nc')
check('one line added', added.added === 1 && added.removed === 0, added)
check('added line is in the patch', added.patch.split('\n').includes('+b'), added.patch)

const removed = diffText('a\nb\nc', 'a\nc')
check('one line removed', removed.removed === 1 && removed.added === 0, removed)
check('removed line is in the patch', removed.patch.split('\n').includes('-b'), removed.patch)

const replaced = diffText('function a() {\n  return 1\n}\n', 'function a() {\n  return 2\n}\n')
check('replacement counts', replaced.added === 1 && replaced.removed === 1, replaced)
check('replacement has a hunk header', replaced.patch.includes('@@'), replaced.patch)
check('old line negative', replaced.patch.split('\n').includes('-  return 1'))
check('new line positive', replaced.patch.split('\n').includes('+  return 2'))

const newFile = diffText('', 'one\ntwo\nthree')
check('new file is all additions', newFile.added === 3 && newFile.removed === 0, newFile)
check('new file has three + lines', newFile.patch.split('\n').filter((l) => l.startsWith('+')).length === 3, newFile.patch)

const emptied = diffText('one\ntwo', '')
check('emptied file is all removals', emptied.removed === 2 && emptied.added === 0, emptied)

const twoHunks = diffText(
  ['1', 'keep', 'x', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'y'].join('\n'),
  ['1', 'keep', 'z', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q'].join('\n')
)
check('distant changes make two hunks', twoHunks.patch.split('\n').filter((l) => l.startsWith('@@')).length === 2, twoHunks.patch)

const capped = diffText('', Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n'))
check('oversized input is truncated safely', capped.patch.includes('diff truncated') || capped.patch.split('\n').length < 5200, {
  lines: capped.patch.split('\n').length
})
check('counts still honest when truncated', capped.added === 5000, capped.added)

check('label formats counts', diffCountsLabel({ added: 12, removed: 3 }) === '+12 −3')
check('label empty when unchanged', diffCountsLabel({ added: 0, removed: 0 }) === '')

console.log(failed === 0 ? '\nall ok' : `\n${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
