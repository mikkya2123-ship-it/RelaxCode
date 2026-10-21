/**
 * Explorer file operations: name rules and the real filesystem work behind
 * create/rename/move/duplicate/delete. The operations are built with injected
 * dependencies, so this runs under plain node without Electron.
 * Run with: npm run test:entries
 */
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createFileOps } from '../src/main/fileOps.ts'
import {
  conflictName,
  createPathSegments,
  entryNameIssue,
  isPathInside,
  isSamePath,
  joinPath,
  nameOf,
  parentDirOf,
  relativeTo,
  splitExtension
} from '../src/shared/entries.ts'

let failed = 0
function check(label, condition, extra) {
  if (condition) {
    console.log('ok   -', label)
  } else {
    failed += 1
    console.log('FAIL -', label, extra === undefined ? '' : JSON.stringify(extra))
  }
}

const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase()

/* ------------------------------ names and paths ----------------------------- */

for (const valid of ['index.ts', 'my file.txt', '.env', 'Архив 2026', 'a'.repeat(255)]) {
  check(`valid name: ${valid.slice(0, 24)}`, entryNameIssue(valid) === null)
}

check('empty name', entryNameIssue('') === 'empty')
check('dot', entryNameIssue('.') === 'dots')
check('double dot', entryNameIssue('..') === 'dots')
check('slash is a separator', entryNameIssue('src/app.ts') === 'separator')
check('backslash is a separator', entryNameIssue('src\\app.ts') === 'separator')
check('illegal character', entryNameIssue('what?.ts') === 'illegal')
check('colon', entryNameIssue('C:file') === 'illegal')
check('trailing dot', entryNameIssue('report.') === 'trailing')
check('trailing space', entryNameIssue('report ') === 'trailing')
check('reserved device name', entryNameIssue('CON') === 'reserved')
check('reserved device name with extension', entryNameIssue('con.txt') === 'reserved')
check('too long', entryNameIssue('a'.repeat(256)) === 'too-long')

const nested = createPathSegments('src/utils/date.ts')
check('a typed path is split', nested.ok && nested.segments.join('/') === 'src/utils/date.ts')
const mixed = createPathSegments('src\\utils/date.ts')
check('both separators work', mixed.ok && mixed.segments.join('/') === 'src/utils/date.ts')
const messy = createPathSegments('./src//utils/date.ts')
check('empty and current segments are skipped', messy.ok && messy.segments.join('/') === 'src/utils/date.ts')
check('an empty path is refused', createPathSegments('   /  ').ok === false)
check('dot-dot in a path is refused', createPathSegments('src/../date.ts').ok === false)
check(
  'a bad segment is refused with its issue',
  createPathSegments('src/what?.ts').ok === false && createPathSegments('src/what?.ts').issue === 'illegal'
)

check('split extension', splitExtension('file.tar.gz').base === 'file.tar')
check('split extension keeps the last one', splitExtension('file.tar.gz').ext === '.gz')
check('dotfile has no extension', splitExtension('.env').base === '.env')
check('dotfile has no extension at all', splitExtension('.env').ext === '')
check('conflict names a copy', conflictName('notes.txt', ['notes.txt']) === 'notes copy.txt')
check('conflict counts up', conflictName('notes.txt', ['notes copy.txt']) === 'notes copy 2.txt')
check(
  'conflict works for folders without an extension',
  conflictName('assets', ['assets copy']) === 'assets copy 2'
)

check('paths compare case-insensitively', isSamePath('D:\\App\\', 'd:/app'))
check('inside', isPathInside('D:\\app', 'D:\\app\\src'))
check('a path is not inside itself', isPathInside('D:\\app', 'D:\\app') === false)
check('a prefix is not a parent', isPathInside('D:\\app', 'D:\\app2') === false)
check('parent of a file', parentDirOf('/a/b/c.txt') === '/a/b')
check('name of a path', nameOf('/a/b/c.txt') === 'c.txt')
check('join uses the separator of the base', joinPath('/a/b', 'c.txt') === '/a/b/c.txt')
check('relative to the root', relativeTo('/root', '/root/src/a.ts') === 'src/a.ts')
check('relative leaves an outside path alone', relativeTo('/root', '/elsewhere/a.ts') === '/elsewhere/a.ts')

/* -------------------------------- real files -------------------------------- */

const root = await mkdtemp(join(tmpdir(), 'relaxcode-ops-'))
const trashed = []
const revealed = []
const ops = createFileOps({
  workspaceRoot: () => root,
  useTrash: () => true,
  trash: async (path) => {
    trashed.push(path)
    await rm(path, { recursive: true, force: true })
  },
  reveal: (path) => revealed.push(path)
})

try {
  const file = await ops.create({ kind: 'file', parentPath: root, name: 'index.html' })
  check('create a file', file.ok && samePath(file.path, join(root, 'index.html')), file)
  check('the new file is empty', (await readFile(join(root, 'index.html'), 'utf8')) === '')

  const deep = await ops.create({ kind: 'file', parentPath: root, name: 'src/utils/date.ts' })
  check('create a nested file', deep.ok, deep)
  check('missing folders are created', (await stat(join(root, 'src', 'utils'))).isDirectory())

  const folder = await ops.create({ kind: 'dir', parentPath: root, name: 'assets/icons' })
  check('create nested folders', folder.ok && (await stat(join(root, 'assets', 'icons'))).isDirectory())

  check(
    'an existing path is refused',
    (await ops.create({ kind: 'file', parentPath: root, name: 'index.html' })).reason === 'exists'
  )
  const reserved = await ops.create({ kind: 'file', parentPath: root, name: 'con.txt' })
  check(
    'an invalid name is refused with the rule',
    reserved.reason === 'invalid-name' && reserved.issue === 'reserved'
  )
  check(
    'dot-dot cannot escape the workspace',
    (await ops.create({ kind: 'file', parentPath: root, name: '../escape.txt' })).reason ===
      'invalid-name'
  )
  check(
    'a parent outside the workspace is refused',
    (await ops.create({ kind: 'file', parentPath: '/', name: 'x.txt' })).reason ===
      'outside-workspace'
  )
  check(
    'a missing parent is reported',
    (await ops.create({ kind: 'file', parentPath: join(root, 'nope'), name: 'x.txt' })).reason ===
      'not-found'
  )

  await writeFile(join(root, 'index.html'), 'hello', 'utf8')
  const renamed = await ops.rename(join(root, 'index.html'), 'home.html')
  check('rename a file', renamed.ok && samePath(renamed.path, join(root, 'home.html')), renamed)
  check('rename keeps the content', (await readFile(join(root, 'home.html'), 'utf8')) === 'hello')
  check(
    'rename onto an existing name is refused',
    (await ops.rename(join(root, 'home.html'), 'assets')).reason === 'exists'
  )
  check('rename with a separator is refused', (await ops.rename(join(root, 'home.html'), 'a/b.html')).reason === 'invalid-name')
  check('the root cannot be renamed', (await ops.rename(root, 'other')).reason === 'root')

  const folderRename = await ops.rename(join(root, 'assets'), 'media')
  check(
    'rename a folder',
    folderRename.ok && (await stat(join(root, 'media', 'icons'))).isDirectory()
  )

  const moved = await ops.move(join(root, 'home.html'), join(root, 'src'))
  check('move a file into a folder', moved.ok && samePath(moved.path, join(root, 'src', 'home.html')), moved)
  check(
    'move refuses a folder into itself',
    (await ops.move(join(root, 'src'), join(root, 'src'))).reason === 'inside-itself'
  )
  check(
    'move refuses a folder into its child',
    (await ops.move(join(root, 'src'), join(root, 'src', 'utils'))).reason === 'inside-itself'
  )
  await writeFile(join(root, 'src', 'utils', 'home.html'), 'other', 'utf8')
  check(
    'move refuses to overwrite',
    (await ops.move(join(root, 'src', 'home.html'), join(root, 'src', 'utils'))).reason === 'exists'
  )
  check('move a folder into a folder', (await ops.move(join(root, 'media'), join(root, 'src'))).ok)

  const copy = await ops.duplicate(join(root, 'src', 'home.html'))
  check('duplicate a file', copy.ok && samePath(copy.path, join(root, 'src', 'home copy.html')), copy)
  const copyAgain = await ops.duplicate(join(root, 'src', 'home.html'))
  check(
    'the second copy counts up',
    copyAgain.ok && samePath(copyAgain.path, join(root, 'src', 'home copy 2.html'))
  )
  check('a copy has the same content', (await readFile(copy.path, 'utf8')) === 'hello')

  const folderCopy = await ops.duplicate(join(root, 'src', 'media'))
  check('duplicate a folder', folderCopy.ok && (await stat(join(folderCopy.path, 'icons'))).isDirectory())
  check(
    'the folder copy is next to the original',
    folderCopy.ok && samePath(folderCopy.path, join(root, 'src', 'media copy'))
  )

  const revealedResult = ops.reveal(join(root, 'src', 'home.html'))
  check(
    'reveal resolves the path',
    revealedResult.ok && samePath(revealed.at(-1), join(root, 'src', 'home.html'))
  )

  const removed = await ops.remove(join(root, 'src', 'home copy.html'))
  check('delete a file', removed.ok)
  check('delete uses the trash', trashed.some((path) => samePath(path, join(root, 'src', 'home copy.html'))))
  check('the file is gone', (await readdir(join(root, 'src'))).every((name) => name !== 'home copy.html'))

  const removedFolder = await ops.remove(join(root, 'src', 'media copy'))
  check('delete a folder', removedFolder.ok)
  check(
    'the folder is gone',
    (await readdir(join(root, 'src'))).every((name) => name !== 'media copy')
  )

  check('the root cannot be deleted', (await ops.remove(root)).reason === 'root')
  check('deleting a missing entry is reported', (await ops.remove(join(root, 'gone.txt'))).reason === 'not-found')

  const noWorkspace = createFileOps({
    workspaceRoot: () => null,
    useTrash: () => true,
    trash: async () => {},
    reveal: () => {}
  })
  check(
    'without a workspace nothing happens',
    (await noWorkspace.create({ kind: 'file', parentPath: root, name: 'x.txt' })).reason ===
      'outside-workspace'
  )

  const permanent = createFileOps({
    workspaceRoot: () => root,
    useTrash: () => false,
    trash: async () => {},
    reveal: () => {}
  })
  await writeFile(join(root, 'temp.txt'), 'x', 'utf8')
  check('deleting without the trash removes the file', (await permanent.remove(join(root, 'temp.txt'))).ok)
  check('the permanently deleted file is gone', (await readdir(root)).every((name) => name !== 'temp.txt'))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failed > 0) {
  console.log(`\n${failed} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nall explorer entry checks passed')
