/**
 * Picture pipeline checks: format sniffing, the SSRF guard, redirects, size
 * limits and workspace files.
 * Run with: npm run test:visuals
 */
import { promises as dns } from 'node:dns'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  fetchRemoteImage,
  formatBytes,
  imageSize,
  readImageFile,
  sniffImageMime,
  toDataUrl
} from '../src/main/visuals.ts'

let failed = 0
function check(label, condition, extra) {
  if (condition) {
    console.log('ok   -', label)
  } else {
    failed += 1
    console.log('FAIL -', label, extra === undefined ? '' : JSON.stringify(extra))
  }
}

/** 1×1 transparent PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
const GIF = Buffer.from('R0lGODlhAgADAIAAAP///////yH5BAAAAAAALAAAAAACAA MAAAICjI8AOw=='.replace(' ', ''), 'base64')

check('png is sniffed', sniffImageMime(PNG) === 'image/png')
check('gif is sniffed', sniffImageMime(GIF) === 'image/gif')
check('html is not an image', sniffImageMime(Buffer.from('<!doctype html><p>hi')) === null)
check('png size is read', JSON.stringify(imageSize(PNG, 'image/png')) === '{"width":1,"height":1}')
check('data url carries the mime', toDataUrl('image/png', PNG).startsWith('data:image/png;base64,iVBOR'))
check('bytes are formatted', formatBytes(1536) === '2 KB' && formatBytes(3 * 1024 * 1024) === '3.0 MB')

/* ------------------------------- workspace ------------------------------- */

const dir = await fs.mkdtemp(join(tmpdir(), 'relaxcode-visuals-'))
const pngPath = join(dir, 'shot.png')
const bigPath = join(dir, 'big.png')
await fs.writeFile(pngPath, PNG)
await fs.writeFile(bigPath, Buffer.concat([PNG, Buffer.alloc(2048)]))

const local = await readImageFile(pngPath, 1024 * 1024)
check('a workspace picture is read', local.mime === 'image/png' && local.buffer.length === PNG.length)
let refused = ''
try {
  await readImageFile(bigPath, 512)
} catch (error) {
  refused = error.message
}
check('an oversized picture is refused', /larger than/.test(refused), refused)
let notImage = ''
try {
  await readImageFile(join(dir, 'notes.txt'), 1024)
} catch (error) {
  notImage = error.message
}
check('a missing file is refused', /not found/.test(notImage), notImage)
await fs.rm(dir, { recursive: true, force: true })

/* --------------------------------- network -------------------------------- */

const lookup = dns.lookup
const realFetch = globalThis.fetch
dns.lookup = async () => [{ address: '93.184.216.34', family: 4 }]

let fetchCount = 0
globalThis.fetch = async (input, init) => {
  fetchCount += 1
  const url = typeof input === 'string' ? input : input.url
  const signal = init?.signal
  if (signal?.aborted) throw new Error('aborted')
  if (url === 'https://example.com/pic.png') {
    return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
  }
  if (url === 'https://example.com/page') {
    return new Response('<html><body>not a picture</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' }
    })
  }
  if (url === 'https://example.com/redirect') {
    return new Response(null, {
      status: 302,
      headers: { location: 'https://example.com/pic.png' }
    })
  }
  if (url === 'https://example.com/to-local') {
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret.png' } })
  }
  if (url === 'https://example.com/huge.png') {
    return new Response(PNG, {
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': '9999999' }
    })
  }
  if (url === 'https://example.com/mislabelled') {
    return new Response('just text', { status: 200, headers: { 'content-type': 'image/png' } })
  }
  throw new Error(`unexpected fetch: ${url}`)
}

try {
  const signal = new AbortController().signal
  const remote = await fetchRemoteImage('https://example.com/pic.png', signal, 1024)
  check('a public picture is downloaded', remote.mime === 'image/png' && remote.buffer.length === PNG.length)
  check('the final url is reported', remote.url === 'https://example.com/pic.png')

  const redirected = await fetchRemoteImage('https://example.com/redirect', signal, 1024)
  check('a redirect to another public page is followed', redirected.mime === 'image/png')

  let error = ''
  try {
    await fetchRemoteImage('https://example.com/page', signal, 1024)
  } catch (caught) {
    error = caught.message
  }
  check('a web page is not accepted as a picture', /not an image/.test(error), error)

  const before = fetchCount
  error = ''
  try {
    await fetchRemoteImage('http://127.0.0.1/secret.png', signal, 1024)
  } catch (caught) {
    error = caught.message
  }
  check('loopback is refused before any request', /local or private/.test(error) && fetchCount === before, error)

  error = ''
  try {
    await fetchRemoteImage('http://192.168.1.10/a.png', signal, 1024)
  } catch (caught) {
    error = caught.message
  }
  check('a private range is refused', /local or private/.test(error), error)

  error = ''
  try {
    await fetchRemoteImage('https://example.com/to-local', signal, 1024)
  } catch (caught) {
    error = caught.message
  }
  check('a redirect into the local network is refused', /local or private/.test(error), error)

  error = ''
  try {
    await fetchRemoteImage('https://example.com/huge.png', signal, 1024)
  } catch (caught) {
    error = caught.message
  }
  check('content-length above the cap is refused', /larger than/.test(error), error)

  error = ''
  try {
    await fetchRemoteImage('https://example.com/mislabelled', signal, 1024)
  } catch (caught) {
    error = caught.message
  }
  check('a lying content-type is caught by sniffing', /supported image/.test(error), error)

  const aborted = new AbortController()
  aborted.abort()
  error = ''
  try {
    await fetchRemoteImage('https://example.com/pic.png', aborted.signal, 1024)
  } catch (caught) {
    error = caught.message
  }
  check('an aborted fetch stops early', /aborted/.test(error), error)
} finally {
  dns.lookup = lookup
  globalThis.fetch = realFetch
}

if (failed > 0) {
  console.error(`\n${failed} picture check(s) failed`)
  process.exit(1)
}
console.log('\nALL PICTURE CHECKS PASSED')
