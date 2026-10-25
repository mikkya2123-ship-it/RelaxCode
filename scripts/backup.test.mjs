/**
 * backup_file: workspace files get bounded, per-file snapshots in
 * userData/backups before risky bulk changes.
 * Run with: npm run test:backup
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BACKUP_LIMIT, backupFile, backupRoot, displayRelative } from '../src/main/backup.ts'

let failed = 0
function check(label, condition, extra) {
  if (condition) {
    console.log('ok   -', label)
  } else {
    failed += 1
    console.log('FAIL -', label, extra === undefined ? '' : JSON.stringify(extra))
  }
}

const base = join(tmpdir(), `relaxcode-backup-test-${Date.now()}`)
const userData = join(base, 'userData')
const workspace = join(base, 'workspace')
const scenes = join(workspace, 'scenes')
mkdirSync(join(scenes, 'sub'), { recursive: true })
writeFileSync(join(scenes, 'forest.blend'), 'blend-v1', 'utf8')
writeFileSync(join(scenes, 'sub', 'deep.blend'), 'deep-v1', 'utf8')

const first = backupFile(userData, workspace, join(scenes, 'forest.blend'), Date.parse('2026-01-01T10:00:00Z'))
check('a file is copied into the backup store', first.ok)
check('the backup path lives under userData/backups', first.ok && first.backupPath.startsWith(backupRoot(userData)))
check('the workspace name is part of the path', first.ok && first.backupPath.includes('workspace'))
check('the relative folders survive', first.ok && first.backupPath.includes(join('scenes', 'forest.blend')))
check('the copy holds the original bytes', first.ok && readFileSync(first.backupPath, 'utf8') === 'blend-v1')
check('the size is reported', first.ok && first.bytes === 8)
check('the kept count starts at one', first.ok && first.kept === 1)

const rel = backupFile(userData, workspace, 'scenes/forest.blend', Date.parse('2026-01-01T11:00:00Z'))
check('a workspace-relative path works too', rel.ok)

const deep = backupFile(userData, workspace, 'scenes/sub/deep.blend')
check('a nested file lands in nested folders', deep.ok && readFileSync(deep.backupPath, 'utf8') === 'deep-v1')

check(
  'a file outside the workspace is refused',
  backupFile(userData, workspace, join(base, 'outside.txt')).reason === 'outside-workspace'
)
check('nothing is backed up without a workspace', backupFile(userData, null, 'x.blend').reason === 'outside-workspace')
check('a missing file is refused', backupFile(userData, workspace, 'scenes/missing.blend').reason === 'not-found')
check(
  'a folder is refused',
  backupFile(userData, workspace, 'scenes/sub').reason === 'not-file'
)

for (let i = 0; i < BACKUP_LIMIT + 5; i += 1) {
  writeFileSync(join(scenes, 'forest.blend'), `blend-v${i}`, 'utf8')
  backupFile(userData, workspace, 'scenes/forest.blend', Date.now() + i * 1000)
}
const backups = readdirSync(join(backupRoot(userData), 'workspace', 'scenes')).filter((name) =>
  name.startsWith('forest.blend.')
)
check(`history is capped at ${BACKUP_LIMIT} copies`, backups.length === BACKUP_LIMIT, backups.length)
const newest = backups.sort().at(-1)
check(
  'the newest copy holds the newest bytes',
  readFileSync(join(backupRoot(userData), 'workspace', 'scenes', newest), 'utf8') === `blend-v${BACKUP_LIMIT + 4}`
)

check(
  'the display path uses forward slashes',
  displayRelative(workspace, join(scenes, 'sub', 'deep.blend')) === 'scenes/sub/deep.blend'
)

rmSync(base, { recursive: true, force: true })

if (failed > 0) {
  console.log(`\n${failed} BACKUP CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL BACKUP CHECKS PASSED')
