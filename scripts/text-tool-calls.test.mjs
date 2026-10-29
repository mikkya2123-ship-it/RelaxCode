/**
 * Unit tests for the "model called a tool by writing it as text" fallback.
 * Run with: npm run test:parser
 */
import { parseTextToolCalls } from '../src/main/textToolCalls.ts'

const CANON = [
  'list_dir',
  'read_file',
  'write_file',
  'edit_file',
  'delete_path',
  'move_path',
  'search_files',
  'search_content',
  'todo_write',
  'ask_user',
  'run_command',
  'git_status',
  'git_diff',
  'fetch_url'
]
const ALIASES = {
  writecontent: 'write_file',
  write: 'write_file',
  createfile: 'write_file',
  writefile: 'write_file',
  todowrite: 'todo_write',
  todo: 'todo_write',
  readfile: 'read_file',
  read: 'read_file',
  bash: 'run_command',
  shell: 'run_command',
  grep: 'search_content',
  edit: 'edit_file',
  strreplace: 'edit_file'
}

const norm = (value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, '')

function resolveName(raw) {
  const key = norm(raw)
  if (!key) return null
  const direct = CANON.find((name) => norm(name) === key)
  if (direct) return direct
  return ALIASES[key] ?? null
}

let failed = 0
function check(label, condition, extra) {
  if (condition) {
    console.log('ok   -', label)
  } else {
    failed += 1
    console.log('FAIL -', label, extra === undefined ? '' : JSON.stringify(extra))
  }
}

// 1. The shape a weak model actually produced: wrong tool name, param_key/param_value pairs,
//    a leading sentence, and HTML inside the content argument.
const real =
  'Создаю файл.\n<tool_call>write_content' +
  '<param_key>path</param_key><param_value>D:\\Project\\Booted\\index.html</param_value>' +
  '<param_key>content</param_key><param_value><!DOCTYPE html>\n<html><body>hi</body></html>\n</param_value>' +
  '<param_key>file_type</param_key><param_value>html</param_value>' +
  '</tool_call>'
const p1 = parseTextToolCalls(real, resolveName)
check('real payload parsed', p1 && p1.calls.length === 1, p1)
check('real payload name normalised', p1 && p1.calls[0].name === 'write_file', p1 && p1.calls[0])
check('real payload startIndex after preamble', p1 && p1.startIndex === real.indexOf('<tool_call>'), p1 && p1.startIndex)
if (p1) {
  const args = JSON.parse(p1.calls[0].args)
  check('real payload path', args.path === 'D:\\Project\\Booted\\index.html', args.path)
  check(
    'real payload content keeps html',
    args.content.includes('<!DOCTYPE html>') && args.content.includes('<body>hi</body>'),
    args.content
  )
  check('unknown argument tolerated', args.file_type === 'html', args.file_type)
}

// 2. Truncated reply: no closing tag and the last value cut off mid-way.
const truncated =
  '<tool_call>create_file<param_key>path</param_key><param_value>src/App.tsx</param_value>' +
  '<param_key>content</param_key><param_value>export default function App() {'
const p2 = parseTextToolCalls(truncated, resolveName)
check('truncated parsed', p2 && p2.calls.length === 1, p2)
if (p2) {
  const args = JSON.parse(p2.calls[0].args)
  check('truncated name normalised', p2.calls[0].name === 'write_file', p2.calls[0].name)
  check('truncated path', args.path === 'src/App.tsx', args.path)
  check('truncated partial content', args.content === 'export default function App() {', args.content)
}

// 3. Fenced JSON object.
const fenced =
  'Держи:\n```json\n{"name": "write_file", "arguments": {"path": "a.txt", "content": "x"}}\n```'
const p3 = parseTextToolCalls(fenced, resolveName)
check(
  'fenced json parsed',
  p3 && p3.calls[0].name === 'write_file' && JSON.parse(p3.calls[0].args).path === 'a.txt',
  p3
)
check('fenced startIndex points at the fence', p3 && p3.startIndex === fenced.indexOf('```'), p3 && p3.startIndex)

// 4. Anthropic-style invoke blocks.
const invoke =
  'Ок.\n<function_calls><invoke name="write_content"><parameter name="path">b/c.ts</parameter><parameter name="content">let a = 1</parameter></invoke></function_calls>'
const p4 = parseTextToolCalls(invoke, resolveName)
check(
  'invoke parsed',
  p4 && p4.calls[0].name === 'write_file' && JSON.parse(p4.calls[0].args).content === 'let a = 1',
  p4
)

// 5. <tool_name> + <parameters> form.
const xmlTool =
  '<tool_call><tool_name>todo_write</tool_name><parameters>{"todos":[{"content":"x","status":"pending"}]}</parameters></tool_call>'
const p5 = parseTextToolCalls(xmlTool, resolveName)
check(
  'tool_name form parsed',
  p5 && p5.calls[0].name === 'todo_write' && JSON.parse(p5.calls[0].args).todos.length === 1,
  p5
)

// 6. Two calls in one reply.
const two =
  '<tool_call>read_file<param_key>path</param_key><param_value>a.ts</param_value></tool_call>' +
  '<tool_call>read_file<param_key>path</param_key><param_value>b.ts</param_value></tool_call>'
const p6 = parseTextToolCalls(two, resolveName)
check('two calls parsed', p6 && p6.calls.length === 2 && JSON.parse(p6.calls[1].args).path === 'b.ts', p6)

// 7. Ordinary prose must not be treated as a call.
check('prose ignored', parseTextToolCalls('Привет! Чем помочь?', resolveName) === null)
check('prose with angle brackets ignored', parseTextToolCalls('Используй <div> для блока', resolveName) === null)

// 8. A JSON answer that is not a tool call must not be hijacked.
check('plain json answer ignored', parseTextToolCalls('{"name": "Иван", "age": 30}', resolveName) === null)
check(
  'package.json sample ignored',
  parseTextToolCalls('```json\n{"name": "my-app", "version": "1.0.0"}\n```', resolveName) === null
)

// 9. Unknown tool name -> nothing to run.
check(
  'unknown tool ignored',
  parseTextToolCalls('<tool_call>frobnicate<param_key>a</param_key><param_value>1</param_value></tool_call>', resolveName) ===
    null
)

console.log(failed === 0 ? '\nALL PARSER TESTS PASSED' : `\n${failed} PARSER TEST(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
