/**
 * Updater checks.
 *
 * The updater itself talks to GitHub and NSIS, but its two decisions are pure:
 * is this release really newer, and what short text should the dialog show.
 * Those are what this script keeps honest.
 *
 * Run with: npm run test:updater
 */
import {
  compareVersions,
  formatBytes,
  isNewerVersion,
  releaseNotesLines
} from '../src/shared/updater.ts'

let failed = 0
function check(label, condition, extra) {
  if (condition) {
    console.log('ok   -', label)
  } else {
    failed += 1
    console.log('FAIL -', label, extra === undefined ? '' : JSON.stringify(extra))
  }
}

/* ------------------------------ version order ---------------------------- */

check('a newer patch is newer', compareVersions('0.3.0', '0.2.0') === 1)
check('an older patch is older', compareVersions('0.2.0', '0.2.1') === -1)
check('multi-digit patches compare as numbers', compareVersions('0.2.10', '0.2.9') === 1)
check('the leading v is ignored', compareVersions('v1.0.0', '1.0.0') === 0)
check('build metadata does not matter', compareVersions('1.0.0+build.4', '1.0.0') === 0)
check('a release beats its prerelease', compareVersions('1.0.0', '1.0.0-beta.1') === 1)
check('a prerelease loses to the release', compareVersions('1.0.0-beta.2', '1.0.0') === -1)
check('missing segments count as zero', compareVersions('2', '2.0.0') === 0)
check('isNewerVersion accepts a newer release', isNewerVersion('0.3.0', '0.2.0'))
check('isNewerVersion rejects the same version', !isNewerVersion('0.2.0', '0.2.0'))
check('isNewerVersion rejects an older release', !isNewerVersion('0.1.9', '0.2.0'))

/* ------------------------------- notes digest ---------------------------- */

const markdown = `## What's Changed
* Fixed the file tree flicker by @someone in https://github.com/x/y/pull/12
* The updater installs without leaving the app
* **Bold** claim and \`inline code\`

**Full Changelog**: https://github.com/x/y/compare/v0.2.0...v0.3.0`

const digest = releaseNotesLines(markdown)
check('markdown notes become plain lines', digest.length === 3, digest)
check('a bullet keeps its text', digest[0] === 'Fixed the file tree flicker', digest[0])
check('the author and link are dropped', !digest[0].includes('@someone') && !digest[0].includes('http'))
check('formatting is stripped', digest[2] === 'Bold claim and inline code', digest[2])
check('headings and changelog links are dropped', !digest.some((line) => /full changelog|what's changed/i.test(line)))

const html = '<h3>Fixes</h3><ul><li>Faster start &amp; a quieter launch</li><li>Crash on missing folders</li></ul>'
const fromHtml = releaseNotesLines(html)
check('html notes are decoded', fromHtml[0] === 'Fixes' && fromHtml[1] === 'Faster start & a quieter launch', fromHtml)

check('an empty body gives no lines', releaseNotesLines('   ').length === 0)
check('null gives no lines', releaseNotesLines(null).length === 0)
check('per-version notes are joined', releaseNotesLines([{ version: '1.0.0', note: 'One fix' }])[0] === 'One fix')

const many = releaseNotesLines(
  ['one', 'two', 'three', 'four', 'five', 'six', 'seven'].map((line) => `- ${line}`).join('\n')
)
check('the digest is capped', many.length === 6, many)
check('duplicates are removed', releaseNotesLines('- Same line\n- same line\n- other').length === 2)

const longLine = releaseNotesLines(`- ${'word '.repeat(60)}`)
check(
  'a long line is shortened with an ellipsis',
  longLine.length === 1 && longLine[0].length <= 160 && longLine[0].endsWith('…'),
  longLine[0]?.length
)

const pullRequests = releaseNotesLines(
  '* Add tray menu by @alice in #42\n* Fix build by @bob in https://github.com/x/y/pull/7'
)
check('pull request tails are removed', pullRequests.join('|') === 'Add tray menu|Fix build', pullRequests)

/* -------------------------------- formatting ----------------------------- */

check('megabytes are friendly', formatBytes(13 * 1024 * 1024) === '13.0 MB')
check('a big installer is rounded', formatBytes(131 * 1024 * 1024) === '131 MB')
check('zero is safe', formatBytes(0) === '0 MB')

if (failed > 0) {
  console.error(`\n${failed} updater check(s) failed`)
  process.exitCode = 1
} else {
  console.log('\nall updater checks passed')
}
