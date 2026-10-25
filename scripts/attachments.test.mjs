/**
 * Unit tests for chat attachments: classification, the history note and the
 * multimodal content the main process sends to the provider.
 *
 * Run with: npm run test:attachments
 */
import {
  ATTACHMENT_LIMITS,
  attachmentNote,
  buildUserContent,
  classifyAttachment,
  formatBytes
} from '../src/shared/attachments.ts'

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

// --- classifyAttachment -----------------------------------------------------

same('png by mime', classifyAttachment('a.png', 'image/png'), 'image')
same('jpg by name only', classifyAttachment('photo.jpg', ''), 'image')
same('svg is text, not a bitmap', classifyAttachment('vector.svg', 'image/svg+xml'), 'text')
same('mp4 by mime', classifyAttachment('clip.mp4', 'video/mp4'), 'video')
same('mkv by name only', classifyAttachment('movie.mkv', ''), 'video')
same('json by mime', classifyAttachment('data.json', 'application/json'), 'text')
same('typescript by name only', classifyAttachment('main.ts', ''), 'text')
same('txt by mime prefix', classifyAttachment('notes.txt', 'text/plain'), 'text')
same('zip is binary', classifyAttachment('build.zip', 'application/zip'), 'binary')
same('exe is binary', classifyAttachment('setup.exe', ''), 'binary')
same('pdf is binary', classifyAttachment('doc.pdf', 'application/pdf'), 'binary')
same('mime wins over extension', classifyAttachment('weird.png', 'video/mp4'), 'video')

// --- formatBytes ------------------------------------------------------------

same('bytes', formatBytes(500), '500 B')
same('kilobytes', formatBytes(240 * 1024), '240 KB')
same('megabytes', formatBytes(1.4 * 1024 * 1024), '1.4 MB')

// --- attachmentNote ---------------------------------------------------------

same(
  'note lists name, kind and size',
  attachmentNote({ id: '1', name: 'photo.jpg', mime: 'image/png', bytes: 240 * 1024, kind: 'image' }),
  '[attachment: photo.jpg (image, 240 KB)]'
)
same(
  'binary note lists the mime type',
  attachmentNote({ id: '2', name: 'build.zip', mime: 'application/zip', bytes: 1024, kind: 'binary' }),
  '[attachment: build.zip (application/zip, 1 KB)]'
)

// --- buildUserContent -------------------------------------------------------

same('no attachments keeps the plain string', buildUserContent('hello', undefined), 'hello')
same('empty list keeps the plain string', buildUserContent('hello', []), 'hello')

const image = {
  id: 'i1',
  name: 'photo.jpg',
  mime: 'image/jpeg',
  bytes: 1024,
  kind: 'image',
  dataUrl: 'data:image/jpeg;base64,AAA',
  status: 'ready'
}

const imageContent = buildUserContent('что на картинке?', [image])
check('image message becomes content parts', Array.isArray(imageContent))
if (Array.isArray(imageContent)) {
  same('text part comes first', imageContent[0], { type: 'text', text: 'что на картинке?' })
  same('name label before the picture', imageContent[1], { type: 'text', text: '[image: photo.jpg]' })
  same(
    'picture travels as image_url',
    imageContent[2],
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA' } }
  )
}

const imageOnly = buildUserContent('', [image])
check('attachment-only message still has parts', Array.isArray(imageOnly) && imageOnly.length === 2)
if (Array.isArray(imageOnly)) {
  check(
    'no empty text part without prose',
    imageOnly.every((part) => part.type !== 'text' || part.text.trim() !== '')
  )
}

const video = {
  id: 'v1',
  name: 'clip.mp4',
  mime: 'video/mp4',
  bytes: 5 * 1024 * 1024,
  kind: 'video',
  frames: ['data:image/jpeg;base64,F1', 'data:image/jpeg;base64,F2', 'data:image/jpeg;base64,F3'],
  status: 'ready'
}
const videoContent = buildUserContent('посмотри', [video])
check('video message becomes content parts', Array.isArray(videoContent))
if (Array.isArray(videoContent)) {
  const label = videoContent.find(
    (part) => part.type === 'text' && part.text.includes('keyframes')
  )
  check('video label mentions the frame count', !!label && label.text.includes('3'))
  same(
    'every frame becomes an image_url',
    videoContent.filter((part) => part.type === 'image_url').length,
    3
  )
}

const undecodedVideo = { ...video, frames: [] }
same(
  'video without frames degrades to a note',
  buildUserContent('смотри', [undecodedVideo]),
  [
    { type: 'text', text: 'смотри' },
    { type: 'text', text: '[attachment: clip.mp4 (video, 5.0 MB)]' }
  ]
)

const textFile = {
  id: 't1',
  name: 'notes.md',
  mime: 'text/markdown',
  bytes: 2048,
  kind: 'text',
  text: '# hello',
  status: 'ready'
}
same(
  'text file is inlined under its name',
  buildUserContent('', [textFile]),
  [{ type: 'text', text: '[file: notes.md]\n```\n# hello\n```' }]
)

const fenced = { ...textFile, name: 'snippet.md', text: 'outer\n```js\ninner\n```\n' }
same(
  'a file containing fences uses a longer fence',
  buildUserContent('', [fenced]),
  [{ type: 'text', text: '[file: snippet.md]\n````\nouter\n```js\ninner\n```\n\n````' }]
)

const archive = {
  id: 'z1',
  name: 'build.zip',
  mime: 'application/zip',
  bytes: 4.2 * 1024 * 1024,
  kind: 'binary',
  status: 'ready'
}
same(
  'archive is a note, not content parts',
  buildUserContent('что внутри?', [archive]),
  [
    { type: 'text', text: 'что внутри?' },
    { type: 'text', text: '[attachment: build.zip (application/zip, 4.2 MB)]' }
  ]
)

const errored = { ...image, status: 'error' }
same('errored attachments never reach the request', buildUserContent('hi', [errored, image]).length, 3)

// --- limits -----------------------------------------------------------------

same('eight attachments at most', ATTACHMENT_LIMITS.maxCount, 8)
check('text excerpt is bounded', ATTACHMENT_LIMITS.textExcerptChars > 0)
check('frames fit the plan', ATTACHMENT_LIMITS.videoFrames >= 2 && ATTACHMENT_LIMITS.videoFrames <= 8)

console.log(failed === 0 ? '\nall ok' : `\n${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
