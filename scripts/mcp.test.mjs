/**
 * MCP core: config normalisation, Claude Desktop import/export, result
 * flattening and a live round-trip against a mock stdio MCP server through
 * the official SDK client (the same path the RelaxCode manager uses).
 * Run with: npm run test:mcp
 */
import { fileURLToPath } from 'node:url'
import {
  applyMcpSchemaBudget,
  clampMcpDescription,
  MCP_NAME_RE,
  mcpResultToText,
  mcpToolEnabled,
  mcpToolFullName,
  normalizeMcpServer,
  parseMcpImport,
  parseMcpToolName,
  playbookFileName,
  serializeMcpExport,
  toolRiskFor
} from '../src/shared/mcp.ts'
import {
  ARTCRAFT_APPS,
  ARTCRAFT_PARTNER_LETTER,
  artCraftBridgeMcpArgs,
  artCraftBridgePort,
  artCraftBridgeTokenFile,
  artCraftControlArgs,
  artCraftGrantedRoot,
  artCraftMcpArgs,
  artCraftPlaybook,
  artCraftServerMode,
  artCraftServerName,
  isArtCraftAppId,
  sameArtCraftFolder
} from '../src/shared/artcraft.ts'

let failed = 0
function check(label, condition, extra) {
  if (condition) {
    console.log('ok   -', label)
  } else {
    failed += 1
    console.log('FAIL -', label, extra === undefined ? '' : JSON.stringify(extra))
  }
}

/* ------------------------------------------------------------ config shapes */

const bare = normalizeMcpServer({ command: 'uvx', args: ['blender-mcp@latest'] }, 'blender')
check('a bare Claude Desktop entry becomes a full config', bare !== null)
check('the fallback name is used', bare?.name === 'blender')
check('stdio is the default transport', bare?.transport === 'stdio')
check('imported servers are untrusted by default', bare?.trusted === false)
check('exec is the default risk', bare?.defaultRisk === 'exec')
check('the default timeout is one minute', bare?.timeoutMs === 60000)
check('args survive normalisation', JSON.stringify(bare?.args) === JSON.stringify(['blender-mcp@latest']))

check('an entry without a command is unusable', normalizeMcpServer({ args: ['x'] }, 'x') === null)

/* --------------------------------------------------------- ArtCraft suite */

check('the suite catalog lists every app', ARTCRAFT_APPS.length === 17, ARTCRAFT_APPS.length)
check(
  'app ids are unique and valid MCP server names',
  new Set(ARTCRAFT_APPS.map((app) => app.id)).size === ARTCRAFT_APPS.length &&
    ARTCRAFT_APPS.every((app) => MCP_NAME_RE.test(artCraftServerName(app.id)))
)
check(
  'every app has a repository, a page and playbook notes',
  ARTCRAFT_APPS.every(
    (app) => app.repo.startsWith('https://') && app.site.startsWith('https://') && app.notes.length > 40
  )
)
check('an unknown app id is rejected', !isArtCraftAppId('not-a-craft-app') && isArtCraftAppId('photocraft'))

check(
  'PhotoCraft grants both automation roots',
  JSON.stringify(artCraftMcpArgs('photocraft', 'D:\\work')) ===
    JSON.stringify([
      'mcp',
      '--automation-read-root',
      'D:\\work',
      '--automation-write-root',
      'D:\\work'
    ])
)
check(
  'PdfCraft takes one root',
  JSON.stringify(artCraftMcpArgs('pdfcraft', '/work')) ===
    JSON.stringify(['mcp', '--root', '/work'])
)
check(
  'TextureCraft takes read and write roots',
  JSON.stringify(artCraftMcpArgs('texturecraft', '/work')) ===
    JSON.stringify(['mcp', '--read-root', '/work', '--write-root', '/work'])
)
check(
  'LightCraft takes the folder positionally',
  JSON.stringify(artCraftMcpArgs('lightcraft', '/work')) === JSON.stringify(['mcp', '/work'])
)
check(
  'FilmCraft has no confinement flags',
  JSON.stringify(artCraftMcpArgs('filmcraft', '/work')) === JSON.stringify(['mcp'])
)
check(
  'no workspace means no granted roots',
  JSON.stringify(artCraftMcpArgs('photocraft', '  ')) === JSON.stringify(['mcp'])
)

const photoPlaybook = artCraftPlaybook('photocraft', 'D:\\work')
check(
  'the playbook names the app, its tools and its folder',
  photoPlaybook.includes('PhotoCraft') &&
    photoPlaybook.includes('mcp__photocraft__') &&
    photoPlaybook.includes('D:\\work') &&
    photoPlaybook.includes('https://github.com/storytold/photocraft')
)
check(
  'a headless playbook explains that its document is separate from the UI',
  photoPlaybook.includes('headless') && photoPlaybook.includes('separate from any window')
)
const livePlaybook = artCraftPlaybook('photocraft', 'D:\\work', 'live')
check(
  'a live playbook points the agent at the open window and UI tools',
  livePlaybook.includes('bridged to the running PhotoCraft window') &&
    livePlaybook.includes('ui_inspect') &&
    livePlaybook.includes('doc_save')
)
check(
  'the granted root is read back from the registered arguments',
  artCraftGrantedRoot('photocraft', artCraftMcpArgs('photocraft', 'D:\\work')) === 'D:\\work' &&
    artCraftGrantedRoot('pdfcraft', artCraftMcpArgs('pdfcraft', '/work')) === '/work' &&
    artCraftGrantedRoot('lightcraft', artCraftMcpArgs('lightcraft', '/work')) === '/work' &&
    artCraftGrantedRoot('photocraft', ['mcp']) === null
)
const bridgeArgs = artCraftBridgeMcpArgs('photocraft', 7878, 'C:\\secret\\control.token')
check(
  'the bridge command line carries the port and token file',
  artCraftServerMode(bridgeArgs) === 'live' &&
    artCraftBridgePort(bridgeArgs) === 7878 &&
    artCraftBridgeTokenFile(bridgeArgs) === 'C:\\secret\\control.token' &&
    artCraftGrantedRoot('photocraft', bridgeArgs) === null
)
const controlArgs = artCraftControlArgs('photocraft', 7878, 'C:\\secret\\control.token', 'D:\\work')
check(
  'the desktop launch opens the control channel and grants the workspace',
  controlArgs.includes('--control') &&
    controlArgs.includes('7878') &&
    controlArgs.includes('--automation-read-root') &&
    controlArgs.includes('--automation-write-root') &&
    controlArgs.filter((arg) => arg === 'D:\\work').length === 2 &&
    !controlArgs.includes('mcp')
)
check(
  'a bare port is accepted as a bridge address',
  artCraftBridgePort(['mcp', '--bridge', '7878']) === 7878 &&
    artCraftBridgePort(['mcp', '--bridge', '127.0.0.1:99999']) === null
)
check(
  'folder comparison is platform-aware and ignores a trailing separator',
  sameArtCraftFolder('D:\\work', 'd:\\work\\') &&
    sameArtCraftFolder('/home/me/work/', '/home/me/work') &&
    !sameArtCraftFolder('/home/me/work', '/home/me/WORK') &&
    !sameArtCraftFolder('', 'D:\\work')
)
check(
  'the partnership letter covers the suite',
  ARTCRAFT_APPS.every((app) => ARTCRAFT_PARTNER_LETTER.includes(app.label))
)
check(
  'a bad name is rejected',
  normalizeMcpServer({ command: 'x' }, 'bad name!') === null
)
check(
  'http needs a URL',
  normalizeMcpServer({ transport: 'http' }, 'web') === null
)
const http = normalizeMcpServer({ url: 'http://127.0.0.1:8000/mcp' }, 'web')
check('a bare URL implies the http transport', http?.transport === 'http' && http?.url === 'http://127.0.0.1:8000/mcp')

const overridden = normalizeMcpServer(
  {
    command: 'node',
    trusted: true,
    defaultRisk: 'read',
    toolRisk: { deploy: 'delete' },
    disabledTools: ['legacy'],
    timeoutMs: 5000,
    env: { API_KEY: 'abc', 'bad key': 'x', NUM: 42 }
  },
  'srv'
)
check('trust can come from the file', overridden?.trusted === true)
check('a per-tool risk override is kept', toolRiskFor(overridden, 'deploy') === 'delete')
check('tools without an override use the default', toolRiskFor(overridden, 'other') === 'read')
check('a disabled tool is disabled', mcpToolEnabled(overridden, 'legacy') === false)
check('other tools stay enabled', mcpToolEnabled(overridden, 'other') === true)
check('bad env keys are dropped', overridden && !('bad key' in overridden.env))
check('numeric env values become strings', overridden?.env.NUM === '42')
check('the timeout is clamped into range', overridden?.timeoutMs === 5000)

/* ----------------------------------------------------------- import/export */

const imported = parseMcpImport(
  JSON.stringify({ mcpServers: { blender: { command: 'uvx', args: ['blender-mcp@latest'] } } })
)
check('the Claude Desktop wrapper imports', imported.error === null && imported.servers.length === 1)
check('imported servers are never trusted', imported.servers[0]?.trusted === false)

const bareImport = parseMcpImport(JSON.stringify({ web: { url: 'http://127.0.0.1:8000/mcp' } }))
check('a bare { name: … } map also imports', bareImport.error === null && bareImport.servers[0]?.name === 'web')
check('garbage is rejected', parseMcpImport('{oops').error === 'invalid-json')
check('an empty map is rejected', parseMcpImport('{"mcpServers":{}}').error === 'no-servers')

const exported = JSON.parse(
  serializeMcpExport([
    { ...bare, env: { API_KEY: 'secret', HOST: '127.0.0.1' } }
  ])
)
check('the export keeps the mcpServers wrapper', typeof exported.mcpServers?.blender === 'object')
check('secret-looking env values are stripped from the export', exported.mcpServers.blender.env.API_KEY === undefined)
check('plain env values survive the export', exported.mcpServers.blender.env.HOST === '127.0.0.1')

/* ------------------------------------------------------------ naming helpers */

check('full names are prefixed', mcpToolFullName('blender', 'get_scene') === 'mcp__blender__get_scene')
const parsed = parseMcpToolName('mcp__blender__get_scene')
check('full names parse back', parsed?.server === 'blender' && parsed?.tool === 'get_scene')
check('non-MCP names are not parsed', parseMcpToolName('read_file') === null)
check('a lone prefix is not parsed', parseMcpToolName('mcp__') === null)
check('an empty tool part is not parsed', parseMcpToolName('mcp__blender__') === null)

/* ----------------------------------------------------------- result shaping */

const flat = mcpResultToText(
  { content: [{ type: 'text', text: 'line one' }, { type: 'text', text: 'line two' }] },
  1000
)
check('text parts are joined', flat.ok && flat.text === 'line one\nline two')

const failedCall = mcpResultToText(
  { isError: true, content: [{ type: 'text', text: 'boom' }] },
  1000
)
check('isError makes the result failed', failedCall.ok === false && failedCall.text === 'boom')

const structured = mcpResultToText({ content: [], structuredContent: { ok: true } }, 1000)
check('structuredContent becomes JSON text', structured.ok && structured.text.includes('"ok": true'))

const truncated = mcpResultToText({ content: [{ type: 'text', text: 'x'.repeat(50) }] }, 10)
check('long results are truncated with a note', truncated.text.includes('[truncated, 40 chars omitted]'))

check('descriptions are clamped', clampMcpDescription('y'.repeat(500)).length === 401)

/* ------------------------------------------------------------ MCP pictures */

const withImage = mcpResultToText(
  {
    content: [
      { type: 'text', text: 'viewport captured' },
      { type: 'image', mimeType: 'image/png', data: 'AAAA' }
    ]
  },
  1000
)
check('a picture part comes back separately', withImage.images.length === 1)
check(
  'the picture becomes a data URL',
  withImage.images[0]?.dataUrl === 'data:image/png;base64,AAAA' &&
    withImage.images[0]?.mime === 'image/png' &&
    withImage.images[0]?.bytes === 3
)
check('text next to a picture is kept', withImage.text === 'viewport captured' && withImage.ok)
check(
  'a broken picture part is ignored',
  mcpResultToText({ content: [{ type: 'image' }] }, 1000).images.length === 0
)

/* ------------------------------------------------------------- playbooks */

check('a playbook file name is lowercase and safe', playbookFileName('Blender') === 'blender.md')
check('odd characters are underscored', playbookFileName('my server#2') === 'my_server_2.md')

/* ---------------------------------------------------------- schema budget */

const schemaDef = (name, descriptionLength, schemaSize) => ({
  name,
  description: 'd'.repeat(descriptionLength),
  parameters: { type: 'object', x: 's'.repeat(schemaSize) }
})
const smallDefs = [schemaDef('a', 50, 50), schemaDef('b', 60, 60)]
check('defs under the budget pass through untouched', applyMcpSchemaBudget(smallDefs, 100000) === smallDefs)

const fatDefs = [schemaDef('tool_a', 3000, 3000), schemaDef('tool_b', 3000, 3000)]
const degraded = applyMcpSchemaBudget(fatDefs, 7000)
check('over the budget descriptions are trimmed first', degraded.every((def) => def.description.length === 80))
check('names survive the degradation', degraded.map((def) => def.name).join(',') === 'tool_a,tool_b')
check(
  'schemas survive the first step of degradation',
  degraded.every((def) => JSON.stringify(def.parameters).length > 20)
)
const degradedMore = applyMcpSchemaBudget(fatDefs, 500)
check(
  'a hard budget collapses the parameter schemas',
  degradedMore.every((def) => JSON.stringify(def.parameters) === '{"type":"object"}')
)
check('the input array is never mutated', fatDefs[0].description.length === 3000)

/* ------------------------------------------------------- live stdio session */

const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')

const mockPath = fileURLToPath(new URL('./mock-mcp-server.mjs', import.meta.url))
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [mockPath]
})
const client = new Client({ name: 'relaxcode-test', version: '0.0.0' })
try {
  await client.connect(transport)
  const listed = await client.listTools()
  const names = listed.tools.map((tool) => tool.name).sort()
  check(
    'the mock server lists its tools',
    JSON.stringify(names) === JSON.stringify(['add', 'echo', 'fail', 'slow', 'structured']),
    names
  )

  const echoed = await client.callTool({ name: 'echo', arguments: { text: 'привет' } })
  check(
    'a call round-trips (unicode too)',
    echoed.content?.[0]?.text === 'echo: привет',
    echoed.content
  )

  const summed = await client.callTool({ name: 'add', arguments: { a: 2, b: 40 } })
  check('arguments reach the tool', summed.content?.[0]?.text === 'sum: 42')

  const shaped = mcpResultToText(await client.callTool({ name: 'fail', arguments: {} }), 1000)
  check('a mock failure maps to a failed result', shaped.ok === false && shaped.text.includes('failed on purpose'))

  const structuredCall = mcpResultToText(
    await client.callTool({ name: 'structured', arguments: {} }),
    1000
  )
  check('a structured mock answer flattens', structuredCall.ok && structuredCall.text.includes('"items"'))
} catch (error) {
  failed += 1
  console.log('FAIL - live MCP session:', error instanceof Error ? error.message : error)
} finally {
  await client.close().catch(() => {})
}

if (failed > 0) {
  console.log(`\n${failed} MCP CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL MCP CHECKS PASSED')
