import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const PORT = process.env.RELAXCODE_DEBUG_PORT || process.env.EASYCODE_DEBUG_PORT || '9222'
const WORKSPACE = process.env.SMOKE_WORKSPACE || 'D:\\Project\\EasyCode'
const FILE_NAME = process.env.SMOKE_FILE || 'package.json'
const EXPAND_FOLDER = process.env.SMOKE_EXPAND || ''
const SMOKE_CHAT = process.env.SMOKE_CHAT === '1'
const MOCK_PORT = Number(process.env.SMOKE_MOCK_PORT || '9199')
/**
 * The mock answers under a fresh sub-path on every run. The app remembers, for
 * its whole lifetime, which connection refused a parameter (so the same 400 is
 * never paid twice) — a unique path keeps repeated runs honest, and proves a
 * Base URL with a sub-path works at the same time.
 */
const MOCK_BASE = `http://127.0.0.1:${MOCK_PORT}/v1/${Math.random().toString(36).slice(2, 8)}`
const stepResults = []
let retryCrashSent = false
let toolCallCount = 0
/** Every request body the mock received — the harness reads what really went out. */
const requestLog = []

// The profile folder is named after the app: `relaxcode` now, `easycode` before
// the rename. Whichever one holds the file is the one the app is using.
const SETTINGS_FILE = (() => {
  const appData = process.env.APPDATA || ''
  const current = path.join(appData, 'relaxcode', 'settings.json')
  const legacy = path.join(appData, 'easycode', 'settings.json')
  if (fs.existsSync(current) || !fs.existsSync(legacy)) return current
  return legacy
})()

function backupSettingsFile() {
  try {
    return fs.readFileSync(SETTINGS_FILE, 'utf8')
  } catch {
    return null
  }
}

function restoreSettingsFile(snapshot) {
  if (!snapshot) return false
  try {
    fs.writeFileSync(SETTINGS_FILE, snapshot)
    return true
  } catch {
    return false
  }
}

function sseChunk(delta, finishReason = null) {
  return JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 1700000000,
    model: 'test-model-a',
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  })
}

function streamText(res, text) {
  const words = [...text]
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  let index = 0
  const push = () => {
    if (res.destroyed || res.writableEnded) return
    if (index < words.length) {
      res.write(`data: ${sseChunk({ content: words[index] })}\n\n`)
      index += 1
      setTimeout(push, 40)
    } else {
      res.write(`data: ${sseChunk({}, 'stop')}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    }
  }
  push()
}

/**
 * Reasoning in its own field (`reasoning_content`), then the answer, then a
 * usage chunk that counts the thoughts — the shape DeepSeek, Qwen and GLM send.
 */
function streamReasoningThenText(res, reasoning, text) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  res.write(`data: ${sseChunk({ role: 'assistant' })}\n\n`)
  for (const part of reasoning.match(/[\s\S]{1,6}/g) ?? []) {
    res.write(`data: ${sseChunk({ reasoning_content: part })}\n\n`)
  }
  for (const char of text) {
    res.write(`data: ${sseChunk({ content: char })}\n\n`)
  }
  res.write(`data: ${sseChunk({}, 'stop')}\n\n`)
  res.write(
    `data: ${JSON.stringify({
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1700000000,
      model: 'test-model-a',
      choices: [],
      usage: {
        prompt_tokens: 11,
        completion_tokens: 22,
        completion_tokens_details: { reasoning_tokens: 7 }
      }
    })}\n\n`
  )
  res.write('data: [DONE]\n\n')
  res.end()
}

/**
 * The same shape as above, but spread over ~half a second. The composer's
 * "thinking" animation only exists while a request is in flight, so the harness
 * needs a stream slow enough to look at it.
 */
function streamReasoningSlow(res, reasoning, text) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  res.write(`data: ${sseChunk({ role: 'assistant' })}\n\n`)
  const parts = reasoning.match(/[\s\S]{1,6}/g) ?? []
  let index = 0
  const push = () => {
    if (index < parts.length) {
      res.write(`data: ${sseChunk({ reasoning_content: parts[index] })}\n\n`)
      index += 1
      setTimeout(push, 70)
      return
    }
    for (const char of text) res.write(`data: ${sseChunk({ content: char })}\n\n`)
    res.write(`data: ${sseChunk({}, 'stop')}\n\n`)
    res.write(
      `data: ${JSON.stringify({
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: 1700000000,
        model: 'test-model-a',
        choices: [],
        usage: {
          prompt_tokens: 11,
          completion_tokens: 22,
          completion_tokens_details: { reasoning_tokens: 7 }
        }
      })}\n\n`
    )
    res.write('data: [DONE]\n\n')
    res.end()
  }
  setTimeout(push, 70)
}

function streamToolCall(res, name, args) {
  toolCallCount += 1
  const callId = `call_smoke_${toolCallCount}`
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  res.write(`data: ${sseChunk({ role: 'assistant' })}\n\n`)
  res.write(
    `data: ${sseChunk({
      tool_calls: [{ index: 0, id: callId, type: 'function', function: { name, arguments: '' } }]
    })}\n\n`
  )
  for (const part of args.match(/[\s\S]{1,12}/g) ?? []) {
    res.write(
      `data: ${sseChunk({ tool_calls: [{ index: 0, function: { arguments: part } }] })}\n\n`
    )
  }
  res.write(`data: ${sseChunk({}, 'tool_calls')}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
}

function streamEmptyStep(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  res.write(`data: ${sseChunk({ role: 'assistant' })}\n\n`)
  res.write(`data: ${sseChunk({}, 'stop')}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
}

function streamTextThenError(res, text, message) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  for (const char of text) res.write(`data: ${sseChunk({ content: char })}\n\n`)
  res.write(`data: ${JSON.stringify({ error: { message, code: 502 } })}\n\n`)
  res.end()
}

function planMockReply(messages, body = {}) {
  const toolMessages = messages
    .filter((message) => message.role === 'tool')
    .map((message) => String(message.content ?? ''))
  const userMessages = messages
    .filter((message) => message.role === 'user')
    .map((message) => String(message.content ?? ''))
  const lastUser = [...messages].reverse().find((message) => message.role === 'user')
  const text = String(lastUser?.content ?? '')

  // EMPTYTEST / EMPTYALWAYS: the model runs one tool and then ends its turn with
  // a completely empty step — the shape a proxy returned for "изучи проект и
  // скажи вердикт". The agent must ask once more (with tools off) and still
  // deliver an answer; if that also comes back empty, it must explain why.
  const nudgeRe = /не написал ответ|wrote no answer/
  const lastRealUser = [...userMessages].reverse().find((content) => !nudgeRe.test(content)) ?? ''
  if (nudgeRe.test(text)) {
    return lastRealUser.includes('EMPTYTEST') ? { text: 'EMPTYTEST-RECOVERED' } : { empty: true }
  }
  if (lastRealUser.includes('EMPTYTEST') || lastRealUser.includes('EMPTYALWAYS')) {
    if (toolMessages.length === 0) {
      return { tool: { name: 'list_dir', args: JSON.stringify({ depth: 1 }) } }
    }
    return { empty: true }
  }

  // A provider that refuses the request because its balance ran out. The app
  // must spell out what 402 means instead of dumping raw JSON.
  if (text.includes('BALANCETEST')) {
    return {
      httpStatus: 402,
      body: JSON.stringify({
        error:
          'Insufficient balance. Balance: 4.876500\u20bd, estimated max request cost: 5.659800\u20bd'
      })
    }
  }

  // THINKTEST: the model's reasoning arrives in its own field. The answer spells
  // out which reasoning parameter actually reached the server, so the harness
  // can prove the level was not just drawn in the UI.
  if (text.includes('THINKTEST')) {
    const sent = body.reasoning_effort ?? (body.reasoning ? JSON.stringify(body.reasoning) : 'none')
    return {
      reasoning: 'THINKTEST-THOUGHT сначала посмотрю на файл',
      text: `THINKTEST-DONE sent=${sent}`
    }
  }

  // SAVINGTEST: the harness reads the body this mock received, so the answer
  // only has to be a single plain text so the run ends in one request.
  if (text.includes('SAVINGTEST')) {
    return { text: 'SAVINGTEST-DONE' }
  }

  // THINKLIVETEST: the same reasoning stream, spread out in time so the harness
  // can watch the composer while the model is still thinking.
  if (text.includes('THINKLIVETEST')) {
    return {
      slow: true,
      reasoning: 'THINKLIVE-THOUGHT-ABOUT-THE-FILE',
      text: 'THINKLIVE-DONE'
    }
  }

  // THINKTAGTEST: a gateway that leaves the thoughts inside the answer text as
  // ` thinking…</think>`. streamText sends one character per chunk, so the tags
  // straddle chunk boundaries — exactly the case the splitter exists for.
  if (text.includes('THINKTAGTEST')) {
    return { text: '<thinking>THINKTAG-THOUGHT</thinking>THINKTAG-DONE' }
  }

  // THINKREJECTTEST: a provider that does not know the reasoning parameter. The
  // app must drop it, say so, and still answer.
  if (text.includes('THINKREJECTTEST')) {
    if (body.reasoning_effort || body.reasoning) {
      return {
        httpStatus: 400,
        body: JSON.stringify({
          error: {
            message: "Unsupported parameter: 'reasoning_effort' is not supported with this model.",
            type: 'invalid_request_error',
            param: 'reasoning_effort',
            code: 'unsupported_parameter'
          }
        })
      }
    }
    return { text: 'THINKREJECT-DONE' }
  }

  if (text.includes('TOOLTEST')) {
    if (toolMessages.some((content) => content.includes('denied by user'))) {
      return { text: 'TOOLTEST-DENIED' }
    }
    if (toolMessages.some((content) => content.includes('smoke-agent.txt'))) {
      return { text: 'TOOLTEST-WRITTEN' }
    }
    return {
      tool: {
        name: 'write_file',
        args: JSON.stringify({ path: 'smoke-agent.txt', content: 'hello from agent\n' })
      }
    }
  }

  if (text.includes('RETRYTEST')) {
    if (toolMessages.some((content) => content.includes('smoke-retry.txt'))) {
      return { text: 'RETRYTEST-WRITTEN' }
    }
    // First attempt: write half a sentence, then the provider dies mid-stream.
    // The agent must retry, hide the half-written text and finish the job.
    if (!retryCrashSent) {
      retryCrashSent = true
      return {
        text: 'Сейчас начну. ',
        textError: 'Upstream error from Phala: The upstream provider returned an error'
      }
    }
    return {
      tool: {
        name: 'write_file',
        args: JSON.stringify({ path: 'smoke-retry.txt', content: 'retry ok\n' })
      }
    }
  }

  if (text.includes('RUNTEST')) {
    if (toolMessages.some((content) => content.includes('timed out'))) {
      return { text: 'RUNTEST-TIMEOUT' }
    }
    // A command that hangs forever; the tool must time out and kill the whole
    // process tree instead of leaving a server running in the background.
    return {
      tool: {
        name: 'run_command',
        args: JSON.stringify({
          command:
            'node -e "require(\'fs\').writeFileSync(\'run-child.pid\', String(process.pid)); setTimeout(() => {}, 60000)"',
          timeout_ms: 1500
        })
      }
    }
  }

  if (text.includes('TEXTTEST')) {
    if (toolMessages.some((content) => content.includes('smoke-text.txt'))) {
      return { text: 'TEXTTEST-WRITTEN' }
    }
    // A model that cannot do native function calling "calls" the tool as text,
    // with a wrong tool name on top. The agent must recover from this.
    return {
      text:
        'Создаю файл.\n' +
        '<tool_call>write_content' +
        '<param_key>path</param_key><param_value>smoke-text.txt</param_value>' +
        '<param_key>content</param_key><param_value>hi\\n</param_value>' +
        '</tool_call>'
    }
  }

  if (text.includes('TODOTEST')) {
    if (toolMessages.length > 0) return { text: 'TODOTEST-DONE' }
    return {
      tool: {
        name: 'todo_write',
        args: JSON.stringify({
          todos: [
            { content: 'Осмотреть дерево', status: 'in_progress' },
            { content: 'Дописать тест', status: 'pending' }
          ]
        })
      }
    }
  }

  if (text.includes('ASKTEST')) {
    if (toolMessages.length > 0) return { text: 'ASKTEST-DONE' }
    return {
      tool: {
        name: 'ask_user',
        args: JSON.stringify({ question: 'Какой вариант выбрать?', options: ['A', 'B'] })
      }
    }
  }

  if (text.includes('SERVERTEST')) {
    if (toolMessages.some((content) => content.includes('listening on'))) {
      return { text: 'SERVERTEST-UP' }
    }
    return {
      tool: {
        name: 'start_server',
        args: JSON.stringify({
          command:
            'node -e "require(\'http\').createServer((q,s)=>{s.end(\'served\')}).listen(4599,()=>console.log(\'UP\'))"',
          port: 4599
        })
      }
    }
  }

  if (text.includes('LIARTEST')) {
    if (toolMessages.length > 0) {
      // The tool above failed, but the model reports success anyway. The agent
      // must warn the user that the result is unverified.
      return { text: '✅ LIARTEST-LIE — файл прочитан, всё работает' }
    }
    return {
      tool: { name: 'read_file', args: JSON.stringify({ path: 'no-such-file-smoke.txt' }) }
    }
  }

  if (text.includes('GUESSPORT')) {
    if (toolMessages.some((content) => content.includes('BODY-OK'))) {
      return { text: 'GUESSPORT-FETCHED' }
    }
    if (toolMessages.some((content) => content.includes('listening on'))) {
      // The port was detected: now verify the server really serves a page.
      return { tool: { name: 'fetch_url', args: JSON.stringify({ url: 'http://localhost:3096/' }) } }
    }
    // The model guesses the wrong port; the tool must find the real one.
    return {
      tool: {
        name: 'start_server',
        args: JSON.stringify({
          command:
            'node -e "require(\'http\').createServer((q,s)=>{s.end(\'BODY-OK\')}).listen(3096,()=>console.log(\'Server running on http://localhost:3096\'))"',
          port: 3099
        })
      }
    }
  }

  if (text.includes('IPV6TEST')) {
    const results = toolMessages.join('\n')
    if (results.length > 0) {
      // On a machine where the IPv6 loopback is blocked this must fail with the
      // hint about binding IPv4; where ::1 works it is a normal success.
      return { text: results.includes('ERROR') ? 'IPV6TEST-FAILED-AS-EXPECTED' : 'IPV6TEST-UP' }
    }
    return {
      tool: {
        name: 'start_server',
        args: JSON.stringify({
          command:
            'node -e "require(\'http\').createServer((q,s)=>{s.end(\'v6\')}).listen(3097,\'::1\',()=>console.log(\'serving http://localhost:3097\'))"',
          port: 3097
        })
      }
    }
  }

  return { text: text || 'пусто' }
}

function startMockServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.on('error', () => {})
      if (req.headers.authorization !== 'Bearer test-key') {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'invalid api key' } }))
        return
      }
      if (req.method === 'GET' && req.url.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            data: [
              { id: 'test-model-b' },
              // A window size, so the context meter has something to divide by.
              { id: 'test-model-a', context_length: 128000 }
            ]
          })
        )
        return
      }
      if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
        let body = ''
        req.on('data', (part) => {
          body += part
        })
        req.on('end', () => {
          let plan = { text: 'пусто' }
          try {
            const parsed = JSON.parse(body)
            requestLog.push(parsed)
            plan = planMockReply(parsed.messages ?? [], parsed)
          } catch {
            plan = { text: 'пусто' }
          }
          if (plan.httpStatus) {
            res.writeHead(plan.httpStatus, { 'content-type': 'application/json' })
            res.end(plan.body ?? '{}')
          } else if (plan.reasoning) {
            if (plan.slow) streamReasoningSlow(res, plan.reasoning, plan.text)
            else streamReasoningThenText(res, plan.reasoning, plan.text)
          } else if (plan.tool) streamToolCall(res, plan.tool.name, plan.tool.args)
          else if (plan.empty) streamEmptyStep(res)
          else if (plan.textError) streamTextThenError(res, plan.text || '', plan.textError)
          else streamText(res, plan.text)
        })
        return
      }
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{}')
    })
    server.listen(MOCK_PORT, '127.0.0.1', () => resolve(server))
  })
}

function log(step, value) {
  console.log(`[smoke] ${step}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
}

async function getPageTarget() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // port not ready yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('CDP page target not found')
}

async function main() {
  const page = await getPageTarget()
  log('target', page.url)

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })

  let messageId = 0
  const pending = new Map()
  const consoleErrors = []

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      consoleErrors.push(msg.params.args?.map((a) => a.value ?? a.description ?? '').join(' '))
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params?.exceptionDetails?.exception?.description ?? 'unknown exception')
    }
  }

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++messageId
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })

  await send('Runtime.enable')
  // A minimised or hidden window pauses CSS animations, and Radix keeps a layer
  // mounted until its exit animation ends — popups would then stay in the DOM
  // and swallow every later click. Emulated focus makes the page behave as if it
  // were on screen; it changes nothing about the application itself.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (result.result?.exceptionDetails) {
      throw new Error(JSON.stringify(result.result.exceptionDetails))
    }
    return result.result?.result?.value
  }

  // An interrupted run can leave a chat mid-stream, and `send` answers false
  // while any chat is streaming — so start from a quiet state. A run that was
  // killed before its cleanup can also leave its throwaway chat behind; report
  // it (the harness never deletes chats it does not own).
  const preflight = await evaluate(`(async () => {
    const store = window.__relaxcode?.chat
    if (!store) return 'no chat store'
    const before = store.getState().chats.filter((chat) => chat.streaming).length
    for (const chat of store.getState().chats) {
      if (!chat.streaming) continue
      store.getState().selectChat(chat.id)
      store.getState().stop()
      await new Promise((r) => setTimeout(r, 250))
    }
    const after = store.getState().chats.filter((chat) => chat.streaming).length
    const leftovers = store.getState().chats.filter((chat) =>
      /SMOKE|SERVERTEST|LIARTEST|TOOLTEST/.test(chat.title)
    ).length
    return 'streaming chats: ' + before + ' took part -> ' + after + ' still streaming' +
      (leftovers > 0 ? '; leftover test chats: ' + leftovers + ' (delete them by hand)' : '')
  })()`)
  log('preflight', preflight)

  const workspaceJs = JSON.stringify(WORKSPACE)
  const fileJs = JSON.stringify(FILE_NAME)

  const openResult = await evaluate(`(async () => {
    const s = window.__relaxcode
    if (!s) return 'ERROR: stores not exposed (not dev build?)'
    const ok = await s.ui.getState().openRecent(${workspaceJs})
    return 'openRecent -> ' + ok
  })()`)
  log('open workspace', openResult)

  const treeResult = await evaluate(`(async () => {
    await new Promise((r) => setTimeout(r, 1200))
    const buttons = [...document.querySelectorAll('aside button')]
    const names = buttons.map((b) => b.textContent.trim()).filter(Boolean)
    return names.slice(0, 25)
  })()`)
  log('tree entries', treeResult)

  if (EXPAND_FOLDER) {
    for (const folder of EXPAND_FOLDER.split(',')) {
      const expandJs = JSON.stringify(folder.trim())
      const expandResult = await evaluate(`(async () => {
        const buttons = [...document.querySelectorAll('aside button')]
        const target = [...buttons].reverse().find((b) => b.textContent.trim() === ${expandJs})
        if (!target) return 'ERROR: folder not found: ' + ${expandJs}
        target.click()
        await new Promise((r) => setTimeout(r, 1000))
        return 'expanded ' + ${expandJs}
      })()`)
      log('expand folder', expandResult)
      stepResults.push(expandResult)
    }
  }

  const clickResult = await evaluate(`(async () => {
    const buttons = [...document.querySelectorAll('aside button')]
    const target = buttons.find((b) => b.textContent && b.textContent.includes(${fileJs}))
    if (!target) return 'ERROR: file not found in tree'
    target.click()
    return 'clicked ' + ${fileJs}
  })()`)
  log('click file', clickResult)
  stepResults.push(clickResult)

  const editorResult = await evaluate(`(async () => {
    await new Promise((r) => setTimeout(r, 6000))
    const ed = window.__relaxcode.editor.getState()
    const monacoEl = document.querySelector('.monaco-editor')
    const lineEl = document.querySelector('.view-line')
    const paneEl = monacoEl?.parentElement
    return {
      openFiles: ed.files.map((f) => f.name),
      active: ed.activePath,
      monacoMounted: !!monacoEl,
      monacoRendered: !!lineEl,
      monacoHeight: monacoEl?.clientHeight ?? 0,
      paneHeight: paneEl?.clientHeight ?? 0
    }
  })()`)
  log('editor state', editorResult)
  stepResults.push(editorResult)

  const editResult = await evaluate(`(async () => {
    const ed = window.__relaxcode.editor
    const active = ed.getState().activePath
    if (!active) return 'ERROR: no active file'
    const original = ed.getState().files.find((f) => f.path === active).content
    ed.getState().updateContent(active, original + '\\n// smoke-test')
    await new Promise((r) => setTimeout(r, 300))
    const after = ed.getState().files.find((f) => f.path === active)
    const dirty = after.content !== after.savedContent
    await ed.getState().saveFile(active)
    await new Promise((r) => setTimeout(r, 500))
    const saved = ed.getState().files.find((f) => f.path === active)
    const cleanNow = saved.content === saved.savedContent
    ed.getState().updateContent(active, original)
    await ed.getState().saveFile(active)
    await new Promise((r) => setTimeout(r, 500))
    const restored = ed.getState().files.find((f) => f.path === active)
    const fullyRestored = restored.content === original && restored.savedContent === original
    return { dirtyAfterEdit: dirty, cleanAfterSave: cleanNow, fullyRestored }
  })()`)
  log('edit+save roundtrip', editResult)
  stepResults.push(editResult)

  const versionResult = await evaluate('window.__relaxcode.ui.getState().workspace?.path')
  log('workspace in store', versionResult)

  if (SMOKE_CHAT) {
    const settingsSnapshot = backupSettingsFile()
    const server = await startMockServer()
    // Id of the throwaway chat the whole run happens in (see the finally block).
    let smokeChatId = null
    let smokeChatPrevious = null
    // The thinking level is remembered per chat in localStorage; the harness puts
    // the user's own value back when it is done.
    let previousThinking = null
    try {
      const setupResult = await evaluate(`(async () => {
        const res = await window.relaxcode.settings.set({
          baseUrl: '${MOCK_BASE}',
          apiKey: 'test-key',
          model: 'test-model-a',
          approvalMode: 'ask'
        })
        await window.__relaxcode.settings.getState().load()
        return res.ok ? 'settings saved' : 'ERROR: settings ' + res.error
      })()`)
      log('chat: settings', setupResult)
      stepResults.push(setupResult)

      const modelsResult = await evaluate(`(async () => {
        const r = await window.relaxcode.models.list()
        return r.ok ? 'models: ' + r.models.map((m) => m.id).join(', ') : 'ERROR: models ' + r.error
      })()`)
      log('chat: models', modelsResult)
      stepResults.push(modelsResult)

      // Every chat step below must run in its own chat: the harness may never
      // write test messages into whatever conversation the user had open.
      const smokeChatInfo = await evaluate(`(() => {
        const store = window.__relaxcode.chat
        const previous = store.getState().activeChatId
        const previousCount = store.getState().chats.length
        const id = store.getState().newChat()
        return { previous, id, previousCount, activeIsNew: store.getState().activeChatId === id }
      })()`)
      smokeChatId = smokeChatInfo?.id ?? null
      smokeChatPrevious = smokeChatInfo?.previous ?? null
      log('chat: isolated smoke chat', smokeChatInfo)
      if (smokeChatInfo?.activeIsNew) {
        stepResults.push('chat: smoke runs in its own chat')
      } else {
        stepResults.push('ERROR: could not open a dedicated smoke chat: ' + JSON.stringify(smokeChatInfo))
      }

      // The switcher of chats lives in the header; the model chip and the mode
      // switcher live inside the input row, and the model is framed.
      const layoutResult = await evaluate(`(async () => {
        const rect = (selector) => {
          const el = document.querySelector(selector)
          if (!el) return null
          const r = el.getBoundingClientRect()
          return {
            top: Math.round(r.top),
            left: Math.round(r.left),
            right: Math.round(r.right),
            border: getComputedStyle(el).borderTopWidth
          }
        }
        const textarea = document.querySelector('aside textarea')
        const taRect = textarea ? textarea.getBoundingClientRect() : null
        return {
          list: rect('[data-testid="chat-list"]'),
          model: rect('[data-testid="chat-model"]'),
          modes: rect('[data-testid="chat-modes"]'),
          thinking: rect('[data-testid="chat-thinking"]'),
          send: rect('[data-testid="chat-send"]'),
          textareaTop: taRect ? Math.round(taRect.top) : null
        }
      })()`)
      log('chat: layout', layoutResult)
      if (
        layoutResult?.list &&
        layoutResult?.model &&
        layoutResult?.modes &&
        layoutResult?.thinking &&
        layoutResult?.send &&
        layoutResult.textareaTop !== null &&
        layoutResult.list.top < layoutResult.textareaTop &&
        layoutResult.model.top > layoutResult.textareaTop &&
        layoutResult.modes.top > layoutResult.textareaTop &&
        layoutResult.thinking.top > layoutResult.textareaTop &&
        layoutResult.model.right <= layoutResult.modes.left &&
        layoutResult.modes.right <= layoutResult.thinking.left &&
        layoutResult.thinking.right <= layoutResult.send.left &&
        layoutResult.send.left - layoutResult.thinking.right >= 4 &&
        layoutResult.model.border !== '0px'
      ) {
        stepResults.push('chat: chats in the header, model + modes + thinking in the input row')
      } else {
        stepResults.push('ERROR: chat panel layout unexpected: ' + JSON.stringify(layoutResult))
      }

      const pickerResult = await evaluate(`(async () => {
        const modelOf = () => window.__relaxcode.settings.getState().settings?.model
        // Radix opens a menu and selects an item on pointerdown, not on click.
        const press = (el) => {
          const opts = { bubbles: true, cancelable: true, button: 0, ctrlKey: false, pointerType: 'mouse' }
          el.dispatchEvent(new PointerEvent('pointerdown', opts))
          el.dispatchEvent(new PointerEvent('pointerup', opts))
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
        }
        const trigger = () => document.querySelector('[data-testid="chat-model"]')
        const waitFor = async (name) => {
          const deadline = Date.now() + 5000
          while (Date.now() < deadline) {
            const hit = [...document.querySelectorAll('[role="menuitem"]')].find((el) =>
              el.textContent.includes(name)
            )
            if (hit) return hit
            await new Promise((r) => setTimeout(r, 100))
          }
          return null
        }
        if (!trigger()) return 'ERROR: model button missing'
        const before = modelOf()
        press(trigger())
        const target = await waitFor('test-model-b')
        if (!target) {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          return (
            'ERROR: model list did not open (' +
            document.querySelectorAll('[role="menu"]').length + ' menus, ' +
            document.querySelectorAll('[role="menuitem"]').length + ' items)'
          )
        }
        // The list must be as wide as the chip and touch it (one sheet). The panel
        // is remounted once the fresh model list arrives, so the seam is polled
        // until the sheet is in place — a fixed delay is not enough when a list of
        // a different size is still being swapped in.
        let seam = null
        const seamDeadline = Date.now() + 5000
        while (Date.now() < seamDeadline) {
          const panel = document.querySelector('[role="menu"]')
          if (panel) {
            const chipRect = trigger().getBoundingClientRect()
            const menuRect = panel.getBoundingClientRect()
            seam = {
              chipWidth: Math.round(chipRect.width),
              menuWidth: Math.round(menuRect.width),
              gap: Math.round(chipRect.top - menuRect.bottom),
              transform: getComputedStyle(panel).transform
            }
            if (
              seam.transform === 'none' &&
              Math.abs(seam.menuWidth - seam.chipWidth) <= 2 &&
              Math.abs(seam.gap) <= 2
            ) {
              break
            }
          }
          await new Promise((r) => setTimeout(r, 120))
        }
        // The panel is remounted when the list changes, so the item is looked up
        // again right before it is pressed — a stale node would swallow the click.
        const liveTarget =
          [...document.querySelectorAll('[role="menuitem"]')].find((el) =>
            el.textContent.includes('test-model-b')
          ) ?? target
        press(liveTarget)
        await new Promise((r) => setTimeout(r, 900))
        const after = modelOf()
        const buttonText = trigger().textContent
        // Restore the original model through the same picker.
        press(trigger())
        const back = await waitFor(before)
        if (back) press(back)
        await new Promise((r) => setTimeout(r, 900))
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        return { before, after, buttonText, restored: modelOf(), seam }
      })()`)
      log('chat: model picker', pickerResult)
      if (
        pickerResult &&
        typeof pickerResult === 'object' &&
        pickerResult.after === 'test-model-b' &&
        pickerResult.buttonText.includes('test-model-b') &&
        pickerResult.restored === pickerResult.before &&
        pickerResult.seam &&
        pickerResult.seam.transform === 'none' &&
        Math.abs(pickerResult.seam.menuWidth - pickerResult.seam.chipWidth) <= 2 &&
        Math.abs(pickerResult.seam.gap) <= 2
      ) {
        stepResults.push('chat: model picker is a sheet joined to the chip and saves the model')
      } else {
        stepResults.push('ERROR: model picker unexpected: ' + JSON.stringify(pickerResult))
      }

      const chatsResult = await evaluate(`(async () => {
        const store = window.__relaxcode.chat
        const state = () => store.getState()
        const totalBefore = state().chats.length
        const first = state().activeChatId
        const firstCount = state().messages.length
        state().selectChat(first)
        state().setMode('agent')
        const second = state().newChat()
        const afterNew = {
          total: state().chats.length,
          activeIsNew: state().activeChatId === second,
          empty: state().messages.length === 0,
          inheritedMode: state().chats.find((c) => c.id === second).mode
        }
        state().setMode('plan')
        const perChatMode = {
          second: state().chats.find((c) => c.id === second).mode,
          first: state().chats.find((c) => c.id === first).mode
        }
        state().selectChat(first)
        const back = {
          messages: state().messages.length,
          activeIsFirst: state().activeChatId === first,
          mode: state().mode,
          discarded: state().chats.some((c) => c.id === second)
        }
        state().selectChat(second)
        state().deleteChat(second)
        const afterDelete = {
          total: state().chats.length,
          activeIsFirst: state().activeChatId === first,
          messages: state().messages.length
        }
        await new Promise((r) => setTimeout(r, 900))
        const stored = JSON.parse(localStorage.getItem('relaxcode.chats.v1') || localStorage.getItem('easycode.chats.v1') || 'null')
        const storedFirst = stored?.chats?.find((c) => c.id === first)
        return {
          totalBefore,
          firstCount,
          afterNew,
          perChatMode,
          back,
          afterDelete,
          persistedChats: stored?.chats?.length ?? null,
          persistedActive: stored?.activeChatId === first,
          persistedMessages: storedFirst?.messages?.length ?? null
        }
      })()`)
      log('chat: multiple chats', chatsResult)
      const chatsOk =
        chatsResult &&
        typeof chatsResult === 'object' &&
        chatsResult.afterNew.total === chatsResult.totalBefore + 1 &&
        chatsResult.afterNew.activeIsNew &&
        chatsResult.afterNew.empty &&
        chatsResult.afterNew.inheritedMode === 'agent' &&
        chatsResult.perChatMode.second === 'plan' &&
        chatsResult.perChatMode.first === 'agent' &&
        chatsResult.back.messages === chatsResult.firstCount &&
        chatsResult.back.activeIsFirst &&
        chatsResult.back.mode === 'agent' &&
        chatsResult.afterDelete.total === chatsResult.totalBefore &&
        chatsResult.afterDelete.activeIsFirst &&
        chatsResult.afterDelete.messages === chatsResult.firstCount &&
        chatsResult.persistedChats === chatsResult.totalBefore &&
        chatsResult.persistedActive &&
        chatsResult.persistedMessages === chatsResult.firstCount
      if (chatsOk) {
        stepResults.push('chat: new chat is independent, per-chat mode, deletable, persisted')
      } else {
        stepResults.push('ERROR: multiple chats unexpected: ' + JSON.stringify(chatsResult))
      }

      const listMenuResult = await evaluate(`(async () => {
        const opts = { bubbles: true, cancelable: true, button: 0, ctrlKey: false, pointerType: 'mouse' }
        const trigger = document.querySelector('[data-testid="chat-list"]')
        if (!trigger) return 'ERROR: chat list button missing'
        trigger.dispatchEvent(new PointerEvent('pointerdown', opts))
        const deadline = Date.now() + 4000
        let items = []
        while (Date.now() < deadline) {
          items = [...document.querySelectorAll('[role="menuitem"]')]
          if (items.length >= 2) break
          await new Promise((r) => setTimeout(r, 100))
        }
        const texts = items.map((el) => el.textContent.trim())
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        // The exit animation keeps the element around for a moment.
        let closed = false
        const closeDeadline = Date.now() + 2000
        while (Date.now() < closeDeadline && !closed) {
          closed = document.querySelectorAll('[role="menuitem"]').length === 0
          if (!closed) await new Promise((r) => setTimeout(r, 100))
        }
        return { count: items.length, texts, closed }
      })()`)
      log('chat: list menu', listMenuResult)
      if (
        listMenuResult &&
        typeof listMenuResult === 'object' &&
        listMenuResult.count >= 2 &&
        listMenuResult.texts.some((text) => text.includes('Новый чат')) &&
        listMenuResult.closed
      ) {
        stepResults.push('chat: the chat list opens, offers a new chat, closes on Escape')
      } else {
        stepResults.push('ERROR: chat list menu unexpected: ' + JSON.stringify(listMenuResult))
      }

      const badKeyResult = await evaluate(`(async () => {
        const r = await window.relaxcode.models.list({ baseUrl: '${MOCK_BASE}', apiKey: 'wrong-key' })
        return r.ok ? 'ERROR: bad key accepted' : 'rejected as expected (' + r.error.slice(0, 40) + ')'
      })()`)
      log('chat: bad key', badKeyResult)
      stepResults.push(badKeyResult)

      const PING_TEXT = 'Привет, мир! 😀 Ёё «тест»'
      const streamResult = await evaluate(`(async () => {
        const store = window.__relaxcode.chat
        const ok = await store.getState().send(${JSON.stringify(PING_TEXT)})
        if (!ok) return 'ERROR: send returned false'
        const deadline = Date.now() + 15000
        while (Date.now() < deadline) {
          const state = store.getState()
          if (!state.streaming) {
            const last = state.messages[state.messages.length - 1]
            const content = last.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('')
            return { status: last.status, content }
          }
          await new Promise((r) => setTimeout(r, 100))
        }
        return 'ERROR: streaming timeout'
      })()`)
      log('chat: stream (utf-8 echo)', streamResult)
      if (streamResult && typeof streamResult === 'object' && streamResult.content !== PING_TEXT) {
        stepResults.push(
          'ERROR: utf-8 mismatch. sent=' + JSON.stringify(PING_TEXT) + ' got=' + JSON.stringify(streamResult)
        )
      } else {
        stepResults.push(streamResult)
      }

      const abortResult = await evaluate(`(async () => {
        const store = window.__relaxcode.chat
        const LONG_TEXT = 'второе сообщение '.repeat(8)
        const contentAt = () => {
          const state = store.getState()
          const last = state.messages[state.messages.length - 1]
          if (!last || last.role !== 'assistant') return ''
          return last.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('')
        }
        const ok = await store.getState().send(LONG_TEXT)
        if (!ok) return 'ERROR: abort send returned false'
        const deadline = Date.now() + 10000
        while (Date.now() < deadline && contentAt().length === 0) {
          await new Promise((r) => setTimeout(r, 20))
        }
        store.getState().stop()
        while (Date.now() < deadline && store.getState().streaming) {
          await new Promise((r) => setTimeout(r, 50))
        }
        return { length: contentAt().length, full: LONG_TEXT.length, streaming: store.getState().streaming }
      })()`)
      log('chat: abort', abortResult)
      if (
        abortResult &&
        typeof abortResult === 'object' &&
        abortResult.streaming === false &&
        abortResult.length < abortResult.full
      ) {
        stepResults.push(abortResult)
      } else {
        stepResults.push('ERROR: abort did not stop the stream: ' + JSON.stringify(abortResult))
      }

      const denyResult = await evaluate(`(async () => {
        const store = window.__relaxcode.chat
        const ok = await store.getState().send('TOOLTEST deny')
        if (!ok) return 'ERROR: deny send returned false'
        const deadline = Date.now() + 15000
        let approved = false
        while (Date.now() < deadline) {
          const state = store.getState()
          if (state.pendingApproval) {
            approved = true
            state.respondApproval('deny')
            break
          }
          if (!state.streaming) break
          await new Promise((r) => setTimeout(r, 100))
        }
        if (!approved) return 'ERROR: no approval request shown'
        while (Date.now() < deadline) {
          const state = store.getState()
          if (!state.streaming) {
            const last = state.messages[state.messages.length - 1]
            const text = last.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('')
            const tools = last.parts
              .filter((p) => p.kind === 'tool')
              .map((p) => ({ name: p.name, status: p.status }))
            return { text, tools }
          }
          await new Promise((r) => setTimeout(r, 100))
        }
        return 'ERROR: deny flow timeout'
      })()`)
      log('agent: deny approval', denyResult)
      if (
        denyResult &&
        typeof denyResult === 'object' &&
        denyResult.text === 'TOOLTEST-DENIED' &&
        denyResult.tools?.[0]?.name === 'write_file'
      ) {
        stepResults.push('agent deny ok')
      } else {
        stepResults.push('ERROR: deny flow unexpected: ' + JSON.stringify(denyResult))
      }

      const allowResult = await evaluate(`(async () => {
        const store = window.__relaxcode.chat
        const ok = await store.getState().send('TOOLTEST allow')
        if (!ok) return 'ERROR: allow send returned false'
        const deadline = Date.now() + 15000
        let approved = false
        while (Date.now() < deadline) {
          const state = store.getState()
          if (state.pendingApproval) {
            approved = true
            state.respondApproval('allow')
            break
          }
          if (!state.streaming) break
          await new Promise((r) => setTimeout(r, 100))
        }
        if (!approved) return 'ERROR: no approval request shown'
        while (Date.now() < deadline) {
          const state = store.getState()
          if (!state.streaming) {
            const last = state.messages[state.messages.length - 1]
            const text = last.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('')
            const toolStatus = last.parts.find((p) => p.kind === 'tool')?.status
            return { text, toolStatus }
          }
          await new Promise((r) => setTimeout(r, 100))
        }
        return 'ERROR: allow flow timeout'
      })()`)
      log('agent: allow approval', allowResult)
      const agentFile = path.join(WORKSPACE, 'smoke-agent.txt')
      const agentFileExists = fs.existsSync(agentFile)
      if (
        allowResult &&
        typeof allowResult === 'object' &&
        allowResult.text === 'TOOLTEST-WRITTEN' &&
        allowResult.toolStatus === 'ok' &&
        agentFileExists
      ) {
        stepResults.push('agent allow ok + file created')
      } else {
        stepResults.push(
          'ERROR: allow flow unexpected: ' +
            JSON.stringify({ allowResult, agentFileExists }) 
        )
      }
      try {
        fs.rmSync(agentFile, { force: true })
      } catch {
        // ignore
      }

      const todoResult = await evaluate(`(async () => {
        const store = window.__relaxcode.chat
        const ok = await store.getState().send('TODOTEST')
        if (!ok) return 'ERROR: todo send returned false'
        const deadline = Date.now() + 15000
        while (Date.now() < deadline) {
          const state = store.getState()
          if (!state.streaming) {
            const last = state.messages[state.messages.length - 1]
            const text = last.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('')
            return { text, todos: state.todos.map((t) => t.status) }
          }
          await new Promise((r) => setTimeout(r, 100))
        }
        return 'ERROR: todo flow timeout'
      })()`)
      log('agent: todos', todoResult)
      if (
        todoResult &&
        typeof todoResult === 'object' &&
        todoResult.text === 'TODOTEST-DONE' &&
        todoResult.todos?.length === 2 &&
        todoResult.todos.includes('in_progress')
      ) {
        stepResults.push('agent todos ok')
      } else {
        stepResults.push('ERROR: todo flow unexpected: ' + JSON.stringify(todoResult))
      }

      const textCallResult = await evaluate(`(async () => {
        const store = window.__relaxcode.chat
        const ok = await store.getState().send('TEXTTEST')
        if (!ok) return 'ERROR: text-call send returned false'
        let deadline = Date.now() + 30000
        let approved = false
        while (Date.now() < deadline) {
          const state = store.getState()
          if (state.pendingApproval) {
            approved = true
            state.respondApproval('allow')
            break
          }
          if (!state.streaming) break
          await new Promise((r) => setTimeout(r, 100))
        }
        if (!approved) return 'ERROR: no approval for text tool call'
        deadline = Date.now() + 30000
        while (Date.now() < deadline) {
          const state = store.getState()
          if (!state.streaming) {
            const last = state.messages[state.messages.length - 1]
            const text = last.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('')
            const tool = last.parts.find((p) => p.kind === 'tool')
            return { text, toolName: tool?.name, toolStatus: tool?.status }
          }
          await new Promise((r) => setTimeout(r, 100))
        }
        return 'ERROR: text-call flow timeout'
      })()`)
      log('agent: text tool call', textCallResult)
      const textFile = path.join(WORKSPACE, 'smoke-text.txt')
      const textFileExists = fs.existsSync(textFile)
      if (
        textCallResult &&
        typeof textCallResult === 'object' &&
        textCallResult.text.includes('TEXTTEST-WRITTEN') &&
        !textCallResult.text.includes('tool_call') &&
        textCallResult.toolName === 'write_file' &&
        textCallResult.toolStatus === 'ok' &&
        textFileExists
      ) {
        stepResults.push('agent text tool call ok + file created')
      } else {
        stepResults.push(
          'ERROR: text tool call unexpected: ' +
            JSON.stringify({ textCallResult, textFileExists })
        )
      }
      try {
        fs.rmSync(textFile, { force: true })
      } catch {
        // ignore
      }

      const retryResult = await evaluate(`(async () => {
        const store = window.__relaxcode.chat
        const ok = await store.getState().send('RETRYTEST')
        if (!ok) return 'ERROR: retry send returned false'
        let deadline = Date.now() + 60000
        let approved = false
        while (Date.now() < deadline) {
          const state = store.getState()
          if (state.pendingApproval) {
            approved = true
            state.respondApproval('allow')
            break
          }
          if (!state.streaming) break
          await new Promise((r) => setTimeout(r, 100))
        }
        if (!approved) {
          const last = store.getState().messages[store.getState().messages.length - 1]
          const text = last?.parts?.filter((p) => p.kind === 'text').map((p) => p.text).join('')
          return (
            'ERROR: no approval after retry: ' +
            JSON.stringify({ status: last?.status, error: last?.error, text })
          )
        }
        deadline = Date.now() + 60000
        while (Date.now() < deadline) {
          const state = store.getState()
          if (!state.streaming) {
            const last = state.messages[state.messages.length - 1]
            const text = last.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('')
            const tool = last.parts.find((p) => p.kind === 'tool')
            return { status: last.status, text, toolName: tool?.name, toolStatus: tool?.status }
          }
          await new Promise((r) => setTimeout(r, 100))
        }
        return 'ERROR: retry flow timeout'
      })()`)
      log('agent: in-stream provider error -> retry', retryResult)
      const retryFile = path.join(WORKSPACE, 'smoke-retry.txt')
      const retryFileExists = fs.existsSync(retryFile)
      if (
        retryResult &&
        typeof retryResult === 'object' &&
        retryResult.status === 'done' &&
        retryResult.text === 'RETRYTEST-WRITTEN' &&
        retryResult.toolName === 'write_file' &&
        retryResult.toolStatus === 'ok' &&
        retryFileExists
      ) {
        stepResults.push('agent in-stream retry ok + file created')
      } else {
        stepResults.push(
          'ERROR: in-stream retry unexpected: ' + JSON.stringify({ retryResult, retryFileExists })
        )
      }
      try {
        fs.rmSync(retryFile, { force: true })
      } catch {
        // ignore
      }

      const runResult = await evaluate(`(async () => {
        const store = window.__relaxcode.chat
        const ok = await store.getState().send('RUNTEST')
        if (!ok) return 'ERROR: run send returned false'
        let deadline = Date.now() + 40000
        let approved = false
        while (Date.now() < deadline) {
          const state = store.getState()
          if (state.pendingApproval) {
            approved = true
            state.respondApproval('allow')
            break
          }
          if (!state.streaming) break
          await new Promise((r) => setTimeout(r, 100))
        }
        if (!approved) return 'ERROR: no approval for run_command'
        deadline = Date.now() + 40000
        while (Date.now() < deadline) {
          const state = store.getState()
          if (!state.streaming) {
            const last = state.messages[state.messages.length - 1]
            const text = last.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('')
            const tool = last.parts.find((p) => p.kind === 'tool')
            return {
              text,
              status: tool?.status,
              summary: tool?.summary ?? '',
              detail: tool?.detail ?? ''
            }
          }
          await new Promise((r) => setTimeout(r, 100))
        }
        return 'ERROR: run_command flow timeout'
      })()`)
      log('agent: run_command timeout', runResult)
      const pidFile = path.join(WORKSPACE, 'run-child.pid')
      const alive = (pid) => {
        try {
          process.kill(pid, 0)
          return true
        } catch {
          return false
        }
      }
      let orphanPid = 0
      try {
        orphanPid = Number(fs.readFileSync(pidFile, 'utf8').trim())
      } catch {
        orphanPid = 0
      }
      if (
        runResult &&
        typeof runResult === 'object' &&
        runResult.text === 'RUNTEST-TIMEOUT' &&
        runResult.status === 'error' &&
        /timed out/.test(runResult.summary) &&
        orphanPid > 0 &&
        !alive(orphanPid)
      ) {
        stepResults.push('agent run_command timeout ok + child tree killed')
      } else {
        stepResults.push(
          'ERROR: run_command timeout unexpected: ' +
            JSON.stringify({
              runResult,
              orphanPid,
              orphanAlive: orphanPid > 0 ? alive(orphanPid) : null
            })
        )
      }
      if (orphanPid > 0 && alive(orphanPid)) {
        try {
          process.kill(orphanPid, 'SIGKILL')
        } catch {
          // ignore
        }
      }
      try {
        fs.rmSync(pidFile, { force: true })
      } catch {
        // ignore
      }

      const askResult = await evaluate(`(async () => {
        const store = window.__relaxcode.chat
        const ok = await store.getState().send('ASKTEST')
        if (!ok) return 'ERROR: ask send returned false'
        const deadline = Date.now() + 15000
        let asked = false
        while (Date.now() < deadline) {
          const state = store.getState()
          if (state.pendingQuestion) {
            asked = true
            state.replyQuestion('B')
            break
          }
          if (!state.streaming) break
          await new Promise((r) => setTimeout(r, 100))
        }
        if (!asked) return 'ERROR: no question shown'
        while (Date.now() < deadline) {
          const state = store.getState()
          if (!state.streaming) {
            const last = state.messages[state.messages.length - 1]
            const text = last.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('')
            const tool = last.parts.find((p) => p.kind === 'tool')
            return { text, toolDetail: tool?.detail }
          }
          await new Promise((r) => setTimeout(r, 100))
        }
        return 'ERROR: ask flow timeout'
      })()`)
      log('agent: ask_user', askResult)
      if (
        askResult &&
        typeof askResult === 'object' &&
        askResult.text === 'ASKTEST-DONE' &&
        askResult.toolDetail === 'B'
      ) {
        stepResults.push('agent ask_user ok')
      } else {
        stepResults.push('ERROR: ask flow unexpected: ' + JSON.stringify(askResult))
      }

      const serverResult = await evaluate(`(async () => {
        const store = window.__relaxcode.chat
        const ok = await store.getState().send('SERVERTEST')
        if (!ok) return 'ERROR: server send returned false'
        let deadline = Date.now() + 60000
        let approved = false
        while (Date.now() < deadline) {
          const state = store.getState()
          if (state.pendingApproval) {
            approved = true
            state.respondApproval('allow')
            break
          }
          if (!state.streaming) break
          await new Promise((r) => setTimeout(r, 100))
        }
        if (!approved) return 'ERROR: no approval for start_server'
        deadline = Date.now() + 60000
        while (Date.now() < deadline) {
          const state = store.getState()
          if (!state.streaming) {
            const last = state.messages[state.messages.length - 1]
            const text = last.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('')
            const tool = last.parts.find((p) => p.kind === 'tool')
            return {
              text,
              toolName: tool?.name,
              status: tool?.status,
              summary: tool?.summary ?? '',
              processes: state.processes.map((p) => ({
                port: p.port,
                running: p.running,
                pid: p.pid,
                id: p.id
              }))
            }
          }
          await new Promise((r) => setTimeout(r, 100))
        }
        return 'ERROR: start_server flow timeout'
      })()`)
      log('agent: start_server', serverResult)
      let served = ''
      try {
        served = await (await fetch('http://127.0.0.1:4599/')).text()
      } catch (error) {
        served = 'ERROR: ' + error.message
      }
      log('agent: server responds', served)
      if (
        serverResult &&
        typeof serverResult === 'object' &&
        serverResult.text === 'SERVERTEST-UP' &&
        serverResult.toolName === 'start_server' &&
        serverResult.status === 'ok' &&
        /listening on http:\/\/localhost:4599/.test(serverResult.summary) &&
        served === 'served' &&
        serverResult.processes?.some((p) => p.port === 4599 && p.running)
      ) {
        stepResults.push('agent start_server ok + port answers + shown in ui')
      } else {
        stepResults.push('ERROR: start_server unexpected: ' + JSON.stringify({ serverResult, served }))
      }

      const stopResult = await evaluate(`(async () => {
        const store = window.__relaxcode.chat
        const target = store.getState().processes.find((p) => p.port === 4599)
        if (!target) return 'ERROR: process not in store'
        store.getState().stopProcess(target.id)
        await new Promise((r) => setTimeout(r, 2500))
        return {
          processes: store.getState().processes.map((p) => ({ port: p.port, running: p.running }))
        }
      })()`)
      log('agent: stop server from ui', stopResult)
      let portFree = false
      try {
        await fetch('http://127.0.0.1:4599/', { signal: AbortSignal.timeout(1500) })
        portFree = false
      } catch {
        portFree = true
      }
      if (
        stopResult &&
        typeof stopResult === 'object' &&
        portFree &&
        !stopResult.processes?.some((p) => p.port === 4599 && p.running)
      ) {
        stepResults.push('agent stop server from ui ok + port closed')
      } else {
        stepResults.push('ERROR: stop server unexpected: ' + JSON.stringify({ stopResult, portFree }))
      }

      // The servers panel is a collapsed strip until you open it.
      const panelResult = await evaluate(`(async () => {
        const panel = document.querySelector('[data-testid="servers-panel"]')
        if (!panel) return 'ERROR: servers panel missing while a server is listed'
        const header = panel.querySelector('button')
        const state = () => ({
          expanded: header.getAttribute('aria-expanded'),
          list: panel.querySelector('[data-testid="servers-list"]') !== null,
          items: panel.querySelectorAll('[data-testid="servers-list"] li').length
        })
        const click = () => header.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        if (state().expanded === 'true') click()
        await new Promise((r) => setTimeout(r, 200))
        const collapsed = state()
        click()
        await new Promise((r) => setTimeout(r, 250))
        const opened = state()
        click()
        await new Promise((r) => setTimeout(r, 250))
        const closed = state()
        return { collapsed, opened, closed }
      })()`)
      log('agent: servers panel collapse', panelResult)
      if (
        panelResult &&
        typeof panelResult === 'object' &&
        panelResult.collapsed.expanded === 'false' &&
        panelResult.collapsed.list === false &&
        panelResult.opened.expanded === 'true' &&
        panelResult.opened.list === true &&
        panelResult.opened.items >= 1 &&
        panelResult.closed.expanded === 'false' &&
        panelResult.closed.list === false
      ) {
        stepResults.push('servers panel collapses and expands')
      } else {
        stepResults.push('ERROR: servers panel unexpected: ' + JSON.stringify(panelResult))
      }

      const lieResult = await evaluate(`(async () => {
        const store = window.__relaxcode.chat
        const ok = await store.getState().send('LIARTEST')
        if (!ok) return 'ERROR: lie send returned false'
        const deadline = Date.now() + 30000
        while (Date.now() < deadline) {
          const state = store.getState()
          if (!state.streaming) {
            const last = state.messages[state.messages.length - 1]
            return {
              text: last.parts.filter((p) => p.kind === 'text').map((p) => p.text).join(''),
              toolStatus: last.parts.find((p) => p.kind === 'tool')?.status,
              notice: state.notice?.kind ?? null
            }
          }
          await new Promise((r) => setTimeout(r, 100))
        }
        return 'ERROR: lie flow timeout'
      })()`)
      log('agent: false success claim', lieResult)
      if (
        lieResult &&
        typeof lieResult === 'object' &&
        lieResult.text.includes('LIARTEST-LIE') &&
        lieResult.toolStatus === 'error' &&
        lieResult.notice === 'unverified-result'
      ) {
        stepResults.push('agent warns about unverified success claim')
      } else {
        stepResults.push('ERROR: unverified notice missing: ' + JSON.stringify(lieResult))
      }

      const stopByPort = async (port) => {
        await evaluate(`(async () => {
          const store = window.__relaxcode.chat
          const target = store.getState().processes.find((p) => p.port === ${port})
          if (target) store.getState().stopProcess(target.id)
          await new Promise((r) => setTimeout(r, 1500))
          return 'cleanup'
        })()`)
      }

      const guessResult = await evaluate(`(async () => {
        const store = window.__relaxcode.chat
        const ok = await store.getState().send('GUESSPORT')
        if (!ok) return 'ERROR: guess send returned false'
        const deadline = Date.now() + 90000
        while (Date.now() < deadline) {
          const state = store.getState()
          if (state.pendingApproval) {
            state.respondApproval('allow')
          } else if (!state.streaming) {
            const last = state.messages[state.messages.length - 1]
            return {
              text: last.parts.filter((p) => p.kind === 'text').map((p) => p.text).join(''),
              parts: last.parts.filter((p) => p.kind === 'tool').map((p) => ({
                name: p.name,
                status: p.status,
                summary: p.summary ?? '',
                detail: p.detail ?? ''
              })),
              processes: state.processes.map((p) => ({ port: p.port, running: p.running }))
            }
          }
          await new Promise((r) => setTimeout(r, 100))
        }
        return 'ERROR: guess flow timeout'
      })()`)
      log('agent: wrong guessed port', guessResult)
      const startPart = guessResult?.parts?.find((p) => p.name === 'start_server')
      const fetchPart = guessResult?.parts?.find((p) => p.name === 'fetch_url')
      let guessedReachable = false
      try {
        guessedReachable = (await (await fetch('http://127.0.0.1:3096/')).text()) === 'BODY-OK'
      } catch {
        guessedReachable = false
      }
      if (
        guessResult &&
        typeof guessResult === 'object' &&
        guessResult.text === 'GUESSPORT-FETCHED' &&
        startPart?.status === 'ok' &&
        /listening on http:\/\/localhost:3096/.test(startPart.summary) &&
        /asked for port 3099/.test(startPart.summary) &&
        fetchPart?.status === 'ok' &&
        /BODY-OK/.test(fetchPart.detail) &&
        guessResult.processes?.some((p) => p.port === 3096 && p.running) &&
        guessedReachable
      ) {
        stepResults.push('agent finds the real port, verifies it with fetch_url')
      } else {
        stepResults.push('ERROR: guessed port unexpected: ' + JSON.stringify({ guessResult, guessedReachable }))
      }
      await stopByPort(3096)

      const ipv6Result = await evaluate(`(async () => {
        const store = window.__relaxcode.chat
        const ok = await store.getState().send('IPV6TEST')
        if (!ok) return 'ERROR: ipv6 send returned false'
        const deadline = Date.now() + 60000
        while (Date.now() < deadline) {
          const state = store.getState()
          if (state.pendingApproval) {
            state.respondApproval('allow')
          } else if (!state.streaming) {
            const last = state.messages[state.messages.length - 1]
            const tool = last.parts.find((p) => p.kind === 'tool')
            return {
              text: last.parts.filter((p) => p.kind === 'text').map((p) => p.text).join(''),
              status: tool?.status,
              summary: tool?.summary ?? '',
              detail: tool?.detail ?? ''
            }
          }
          await new Promise((r) => setTimeout(r, 100))
        }
        return 'ERROR: ipv6 flow timeout'
      })()`)
      log('agent: ipv6-only listener', ipv6Result)
      const ipv6Diagnosed =
        ipv6Result &&
        typeof ipv6Result === 'object' &&
        ((ipv6Result.text === 'IPV6TEST-UP' && ipv6Result.status === 'ok') ||
          (ipv6Result.text === 'IPV6TEST-FAILED-AS-EXPECTED' &&
            ipv6Result.status === 'error' &&
            /0\.0\.0\.0/.test(ipv6Result.detail) &&
            !/✅/.test(ipv6Result.text)))
      if (ipv6Diagnosed) {
        stepResults.push('agent handles an unreachable ipv6-only listener honestly')
      } else {
        stepResults.push('ERROR: ipv6-only listener unexpected: ' + JSON.stringify(ipv6Result))
      }
      await stopByPort(3097)

      // A model that runs a tool and then returns an empty step must not leave
      // the user with a bare tool card: the agent asks once more for the answer.
      const emptyOnceResult = await evaluate(`(async () => {
        const store = window.__relaxcode.chat
        const ok = await store.getState().send('EMPTYTEST')
        if (!ok) return 'ERROR: empty send returned false'
        const deadline = Date.now() + 30000
        while (Date.now() < deadline) {
          const state = store.getState()
          if (state.pendingApproval) state.respondApproval('allow')
          else if (!state.streaming) {
            const last = state.messages[state.messages.length - 1]
            return {
              text: last.parts.filter((p) => p.kind === 'text').map((p) => p.text).join(''),
              tools: last.parts.filter((p) => p.kind === 'tool').length,
              notice: state.notice?.kind ?? null
            }
          }
          await new Promise((r) => setTimeout(r, 100))
        }
        return 'ERROR: empty flow timeout'
      })()`)
      log('agent: empty step after tools', emptyOnceResult)
      if (
        emptyOnceResult &&
        typeof emptyOnceResult === 'object' &&
        emptyOnceResult.text.includes('EMPTYTEST-RECOVERED') &&
        emptyOnceResult.tools === 1 &&
        emptyOnceResult.notice === null
      ) {
        stepResults.push('agent recovers the answer after an empty model step')
      } else {
        stepResults.push('ERROR: empty step not recovered: ' + JSON.stringify(emptyOnceResult))
      }

      // A model that never writes anything: the run has to say so instead of
      // ending in silence.
      const emptyAlwaysResult = await evaluate(`(async () => {
        const store = window.__relaxcode.chat
        const ok = await store.getState().send('EMPTYALWAYS')
        if (!ok) return 'ERROR: always-empty send returned false'
        const deadline = Date.now() + 30000
        while (Date.now() < deadline) {
          const state = store.getState()
          if (state.pendingApproval) state.respondApproval('allow')
          else if (!state.streaming) {
            const last = state.messages[state.messages.length - 1]
            const noticeEl = document.querySelector('[data-testid="chat-notice"]')
            return {
              text: last.parts.filter((p) => p.kind === 'text').map((p) => p.text).join(''),
              tools: last.parts.filter((p) => p.kind === 'tool').length,
              notice: state.notice?.kind ?? null,
              noticeText: noticeEl ? noticeEl.textContent.trim().slice(0, 120) : null
            }
          }
          await new Promise((r) => setTimeout(r, 100))
        }
        return 'ERROR: always-empty flow timeout'
      })()`)
      log('agent: no answer at all', emptyAlwaysResult)
      if (
        emptyAlwaysResult &&
        typeof emptyAlwaysResult === 'object' &&
        emptyAlwaysResult.text === '' &&
        emptyAlwaysResult.tools === 1 &&
        emptyAlwaysResult.notice === 'no-answer' &&
        /не написала ответ|wrote no answer|не написал ответ/.test(emptyAlwaysResult.noticeText ?? '')
      ) {
        stepResults.push('agent explains a run that produced no answer')
      } else {
        stepResults.push('ERROR: empty answer notice missing: ' + JSON.stringify(emptyAlwaysResult))
      }

      // HTTP 402 from the provider: the raw JSON must be replaced by a sentence
      // that names the real cause (this is what a real GenAPI run returned).
      const balanceResult = await evaluate(`(async () => {
        const store = window.__relaxcode.chat
        const ok = await store.getState().send('BALANCETEST')
        if (!ok) return 'ERROR: balance send returned false'
        const deadline = Date.now() + 30000
        while (Date.now() < deadline) {
          const state = store.getState()
          if (state.pendingApproval) state.respondApproval('allow')
          else if (!state.streaming) {
            const last = state.messages[state.messages.length - 1]
            const el = document.querySelector('[data-testid="chat-error"]')
            return {
              status: last.status,
              error: last.error ?? '',
              shown: el ? el.textContent.trim() : null
            }
          }
          await new Promise((r) => setTimeout(r, 100))
        }
        return 'ERROR: balance flow timeout'
      })()`)
      log('chat: provider 402', balanceResult)
      if (
        balanceResult &&
        typeof balanceResult === 'object' &&
        balanceResult.status === 'error' &&
        balanceResult.error.startsWith('HTTP 402') &&
        /недостаточно средств|insufficient funds/i.test(balanceResult.shown ?? '') &&
        /4\.8765/.test(balanceResult.shown ?? '')
      ) {
        stepResults.push('chat: 402 is explained in words, provider details kept')
      } else {
        stepResults.push('ERROR: 402 explanation missing: ' + JSON.stringify(balanceResult))
      }

      // "Thinking": the level picked in the composer must reach the wire, the
      // reasoning must land in its own block (never in the answer), and a
      // provider that refuses the parameter must be reported honestly.
      previousThinking = await evaluate(`window.localStorage.getItem('relaxcode.chatThinking')`)
      const thinkingResult = await evaluate(`(async () => {
        const store = window.__relaxcode.chat
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const chip = () => document.querySelector('[data-testid="chat-thinking"]')
        const sheet = () => document.querySelector('[data-testid="thinking-slider"]')
        const text = (selector) => {
          const el = document.querySelector(selector)
          return el ? el.textContent.trim() : null
        }
        // Radix opens the sheet on click; every button here reacts to a click.
        const press = (el) => {
          const opts = { bubbles: true, cancelable: true, button: 0, ctrlKey: false, pointerType: 'mouse' }
          el.dispatchEvent(new PointerEvent('pointerdown', opts))
          el.dispatchEvent(new PointerEvent('pointerup', opts))
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
        }
        const closeSheet = async () => {
          for (let attempt = 0; attempt < 20 && sheet(); attempt += 1) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
            await wait(100)
          }
          return !sheet()
        }
        const openSheet = async () => {
          if (!chip()) return false
          press(chip())
          const deadline = Date.now() + 5000
          while (Date.now() < deadline) {
            if (sheet()) return true
            await wait(50)
          }
          return false
        }
        const pick = async (level) => {
          if (!(await openSheet())) return false
          const hit = document.querySelector('[data-testid="thinking-stop"][data-level="' + level + '"]')
          if (!hit) {
            await closeSheet()
            return false
          }
          press(hit)
          await wait(250)
          await closeSheet()
          return true
        }
        const answer = async (marker) => {
          const ok = await store.getState().send(marker)
          if (!ok) return null
          const deadline = Date.now() + 30000
          while (Date.now() < deadline) {
            if (!store.getState().streaming) {
              const state = store.getState()
              const last = state.messages[state.messages.length - 1]
              return {
                parts: last.parts.map((part) => part.kind).join('>'),
                reasoning: last.parts
                  .filter((part) => part.kind === 'reasoning')
                  .map((part) => part.text)
                  .join(''),
                text: last.parts
                  .filter((part) => part.kind === 'text')
                  .map((part) => part.text)
                  .join(''),
                notice: state.notice ? state.notice.kind : null,
                noticeParam: state.notice ? state.notice.param : null,
                reasoningTokens: last.reasoningTokens === undefined ? null : last.reasoningTokens,
                level: state.thinking
              }
            }
            await wait(100)
          }
          return null
        }

        const picked = await pick('high')
        const chipLevel = chip() ? chip().getAttribute('data-level') : null
        const field = await answer('THINKTEST')
        // The block folds away once the answer starts; opening it must show the
        // thoughts the model actually had.
        const card = document.querySelector('[data-testid="chat-reasoning"]')
        const toggle = card ? card.querySelector('button') : null
        if (toggle) press(toggle)
        await wait(300)
        const cardText = card ? card.textContent : null
        const tag = await answer('THINKTAGTEST')

        // While a request runs, the chip and the rail carry the flowing gradient;
        // once it is over the animation must stop.
        const seen = { live: false, rail: false, glow: false, flow: false }
        const sample = () => {
          const el = chip()
          if (!el || el.getAttribute('data-live') !== 'true') return
          seen.live = true
          const gradient = el.querySelector('.think-live')
          if (gradient) {
            seen.rail = true
            // A live request keeps the light coming without the idle rest; the
            // animation on the band is what tells the two states apart.
            const sweep = getComputedStyle(gradient, '::before')
            const drift = getComputedStyle(gradient, '::after')
            if (
              sweep.animationName === 'ec-think-sweep-live' &&
              sweep.animationDuration === '2.4s' &&
              drift.animationDuration === '3.6s'
            ) {
              seen.flow = true
            }
          }
          if (el.className.includes('think-glow')) seen.glow = true
        }
        const sampler = setInterval(sample, 25)
        const liveRun = await answer('THINKLIVETEST')
        clearInterval(sampler)
        await wait(300)
        sample()
        const liveStopped = chip()
          ? chip().getAttribute('data-live') === null && !chip().querySelector('.think-live')
          : false

        // The context meter: the ring counts what the provider counted on the
        // last request (the mock says 11 prompt + 22 completion), sits left of
        // the delete button and is read from the model list's window size.
        const meter = (() => {
          const el = document.querySelector('[data-testid="context-meter"]')
          const del = document.querySelector('[data-testid="chat-delete"]')
          if (!el || !del) return null
          const ring = el.getBoundingClientRect()
          const trash = del.getBoundingClientRect()
          return {
            used: el.getAttribute('data-used'),
            limit: el.getAttribute('data-limit'),
            percent: el.getAttribute('data-percent'),
            label: el.getAttribute('aria-label'),
            visible: ring.width > 0 && ring.height > 0 && ring.top > 0,
            beforeDelete: Math.round(ring.right) <= Math.round(trash.left),
            sameRow: Math.abs(ring.top + ring.height / 2 - (trash.top + trash.height / 2)) < 4
          }
        })()

        // The sheet itself: a slider with a value, four stops, the warm gradient
        // and the measured cost of the previous thought.
        let sheetInfo = null
        if (await openSheet()) {
          const rail = sheet()
          const stops = [...document.querySelectorAll('[data-testid="thinking-stop"]')]
          const railGradient = rail ? rail.querySelector('.think-rail-gradient') : null
          const fill = document.querySelector('[data-testid="thinking-fill"]')
          const thumb = document.querySelector('.think-thumb')
          // The two themes must paint the scale differently. Both are read with
          // the class set explicitly: the app follows the system theme, so the
          // page may already be dark before this check runs.
          const root = document.documentElement
          const wasDark = root.classList.contains('dark')
          root.classList.remove('dark')
          const lightHot = getComputedStyle(root).getPropertyValue('--think-5').trim()
          root.classList.add('dark')
          const darkHot = getComputedStyle(root).getPropertyValue('--think-5').trim()
          root.classList.toggle('dark', wasDark)
          const pop = rail ? rail.closest('[data-slot="popover-content"]') : null
          const popRect = pop ? pop.getBoundingClientRect() : null
          const chipRect = chip() ? chip().getBoundingClientRect() : null
          const box = popRect
            ? {
                top: Math.round(popRect.top),
                left: Math.round(popRect.left),
                right: Math.round(popRect.right),
                bottom: Math.round(popRect.bottom)
              }
            : null
          sheetInfo = {
            role: rail ? rail.getAttribute('role') : null,
            now: rail ? rail.getAttribute('aria-valuenow') : null,
            value: rail ? rail.getAttribute('aria-valuetext') : null,
            level: rail ? rail.getAttribute('data-level') : null,
            stops: stops
              .map(
                (el) =>
                  el.getAttribute('data-level') +
                  (el.getAttribute('data-current') === 'true' ? '*' : '')
              )
              .join(','),
            gradient: !!railGradient,
            fill: !!fill,
            // Proof that the stylesheet is behind the markup, not just the classes.
            railImage: railGradient ? getComputedStyle(railGradient).backgroundImage : '',
            // The colour stays put; the life is one soft band of light gliding
            // over it, with a rest between passes — the Codex "thinking" trick.
            idleFlow: railGradient ? getComputedStyle(railGradient).animationName : '',
            idleSweep: railGradient
              ? getComputedStyle(railGradient, '::before').animationName
              : '',
            idleSweepSpeed: railGradient
              ? getComputedStyle(railGradient, '::before').animationDuration
              : '',
            idleDrift: railGradient
              ? getComputedStyle(railGradient, '::after').animationName
              : '',
            thumbBlur: thumb ? getComputedStyle(thumb).backdropFilter : '',
            fillClip: fill ? getComputedStyle(fill).clipPath : '',
            hotLight: lightHot,
            hotDark: darkHot,
            box,
            chipTop: chipRect ? Math.round(chipRect.top) : null,
            viewport: { w: window.innerWidth, h: window.innerHeight },
            eta: text('[data-testid="thinking-eta"]')
          }
          // Keyboard: one stop down and back up.
          if (rail) {
            rail.focus()
            rail.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
            await wait(200)
            sheetInfo.afterLeft = store.getState().thinking
            rail.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
            await wait(200)
            sheetInfo.afterRight = store.getState().thinking

            // Dragging must follow the pointer, not hop between stops: hold it
            // at 62% — a place where no stop sits — and look at the handle, the
            // level it already picked, and where it settles after letting go.
            const box2 = rail.getBoundingClientRect()
            const point = (ratio) => ({
              clientX: box2.left + box2.width * ratio,
              clientY: box2.top + box2.height / 2
            })
            const pointer = (type, ratio) => {
              const place = point(ratio)
              rail.dispatchEvent(
                new PointerEvent(type, {
                  bubbles: true,
                  cancelable: true,
                  button: 0,
                  buttons: type === 'pointerup' ? 0 : 1,
                  pointerId: 1,
                  pointerType: 'mouse',
                  isPrimary: true,
                  clientX: place.clientX,
                  clientY: place.clientY
                })
              )
            }
            const holder = rail.parentElement
            const heldAt = () => Number(holder.style.getPropertyValue('--think-at'))
            pointer('pointerdown', 0.9)
            await wait(120)
            pointer('pointermove', 0.62)
            await wait(150)
            sheetInfo.dragFollow = heldAt()
            sheetInfo.dragLevel = store.getState().thinking
            pointer('pointerup', 0.62)
            await wait(250)
            sheetInfo.settledAt = heldAt()
            // Back to the top stop for the refusal test below.
            pointer('pointerdown', 0.95)
            pointer('pointerup', 0.95)
            await wait(250)
            sheetInfo.afterDrag = store.getState().thinking
          }
          await closeSheet()
        }

        const rejected = await answer('THINKREJECTTEST')
        return { picked, chipLevel, field, cardText, tag, liveRun, seen, liveStopped, meter, sheetInfo, rejected }
      })()`)
      log('chat: thinking', thinkingResult)
      if (
        thinkingResult &&
        typeof thinkingResult === 'object' &&
        thinkingResult.picked === true &&
        thinkingResult.chipLevel === 'high' &&
        thinkingResult.field &&
        thinkingResult.field.level === 'high' &&
        thinkingResult.field.parts === 'reasoning>text' &&
        thinkingResult.field.reasoning.includes('THINKTEST-THOUGHT') &&
        thinkingResult.field.text.includes('THINKTEST-DONE sent=high') &&
        !thinkingResult.field.text.includes('THINKTEST-THOUGHT') &&
        thinkingResult.field.reasoningTokens === 7 &&
        (thinkingResult.cardText ?? '').includes('THINKTEST-THOUGHT')
      ) {
        stepResults.push('thinking: the level reaches the wire and reasoning has its own block')
      } else {
        stepResults.push('ERROR: thinking flow unexpected: ' + JSON.stringify(thinkingResult))
      }
      if (
        thinkingResult &&
        typeof thinkingResult === 'object' &&
        thinkingResult.tag &&
        thinkingResult.tag.parts === 'reasoning>text' &&
        thinkingResult.tag.reasoning.includes('THINKTAG-THOUGHT') &&
        thinkingResult.tag.text === 'THINKTAG-DONE'
      ) {
        stepResults.push('thinking: inline think tags are split out of the answer')
      } else {
        stepResults.push(
          'ERROR: inline thinking tags unexpected: ' + JSON.stringify(thinkingResult?.tag ?? null)
        )
      }
      // The context ring: the provider's own count (11 + 22), the window from
      // the model list, sitting just left of the delete button.
      const meter = thinkingResult?.meter ?? null
      if (
        meter &&
        meter.used === '33' &&
        meter.limit === '128000' &&
        meter.percent === '0' &&
        meter.visible === true &&
        meter.beforeDelete === true &&
        meter.sameRow === true &&
        typeof meter.label === 'string' &&
        meter.label.includes('128')
      ) {
        stepResults.push('chat: context meter shows the measured usage against the window')
      } else {
        stepResults.push('ERROR: context meter unexpected: ' + JSON.stringify(meter))
      }
      if (
        thinkingResult &&
        typeof thinkingResult === 'object' &&
        thinkingResult.rejected &&
        thinkingResult.rejected.text.includes('THINKREJECT-DONE') &&
        thinkingResult.rejected.notice === 'param-dropped' &&
        thinkingResult.rejected.noticeParam === 'reasoning' &&
        thinkingResult.rejected.level === 'high'
      ) {
        stepResults.push('thinking: a refused parameter is dropped with an honest notice')
      } else {
        stepResults.push(
          'ERROR: refused reasoning parameter unexpected: ' +
            JSON.stringify(thinkingResult?.rejected ?? null)
        )
      }

      // The slider sheet: a real slider with four stops, the warm gradient and
      // the rough estimate on the header.
      const sheet = thinkingResult?.sheetInfo ?? null
      if (
        sheet &&
        sheet.role === 'slider' &&
        sheet.now === '3' &&
        sheet.level === 'high' &&
        typeof sheet.value === 'string' &&
        sheet.value.length > 0 &&
        sheet.stops === 'off,low,medium,high*' &&
        sheet.gradient === true &&
        sheet.fill === true &&
        /linear-gradient/.test(sheet.railImage ?? '') &&
        sheet.idleFlow === 'none' &&
        sheet.idleSweep === 'ec-think-sweep' &&
        sheet.idleSweepSpeed === '5.6s' &&
        sheet.idleDrift === 'ec-think-drift' &&
        /blur/.test(sheet.thumbBlur ?? '') &&
        /^inset\(/.test(sheet.fillClip ?? '') &&
        !!sheet.hotLight &&
        !!sheet.hotDark &&
        sheet.hotLight !== sheet.hotDark &&
        sheet.box &&
        sheet.box.left >= 0 &&
        sheet.box.top >= 0 &&
        sheet.box.right <= sheet.viewport.w &&
        sheet.box.bottom <= sheet.viewport.h &&
        sheet.box.right - sheet.box.left >= 278 &&
        sheet.box.right - sheet.box.left <= 280 &&
        sheet.chipTop !== null &&
        sheet.box.bottom <= sheet.chipTop &&
        /≈/.test(sheet.eta ?? '') &&
        sheet.afterLeft === 'medium' &&
        sheet.afterRight === 'high' &&
        Math.abs(sheet.dragFollow - 0.62) < 0.03 &&
        sheet.dragLevel === 'medium' &&
        Math.abs(sheet.settledAt - 2 / 3) < 0.01 &&
        sheet.afterDrag === 'high'
      ) {
        stepResults.push(
          'thinking: the level is a slider — smooth drag, four stops, living gradient'
        )
      } else {
        stepResults.push('ERROR: thinking slider unexpected: ' + JSON.stringify(sheet))
      }

      // The flowing gradient belongs to a live request: it must appear while the
      // model thinks and go away when the answer is in.
      if (
        thinkingResult?.liveRun &&
        thinkingResult.liveRun.text === 'THINKLIVE-DONE' &&
        thinkingResult.liveRun.parts === 'reasoning>text' &&
        thinkingResult.seen?.live === true &&
        thinkingResult.seen?.rail === true &&
        thinkingResult.seen?.glow === true &&
        thinkingResult.seen?.flow === true &&
        thinkingResult.liveStopped === true
      ) {
        stepResults.push('thinking: the composer animates only while the model is thinking')
      } else {
        stepResults.push(
          'ERROR: live thinking animation unexpected: ' +
            JSON.stringify({
              liveRun: thinkingResult?.liveRun ?? null,
              seen: thinkingResult?.seen ?? null,
              liveStopped: thinkingResult?.liveStopped ?? null
            })
        )
      }

      // Token saving: the three modes change what really goes out, and the mode
      // with the tightest window must still keep the goal and the step in flight.
      const savingResult = await evaluate(`(async () => {
        const store = window.__relaxcode.chat
        const settings = window.__relaxcode.settings
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const agent = settings.getState().settings.agent
        const beforeSaving = agent.tokenSaving
        const beforeHistory = agent.historyMessages

        // A long conversation is seeded into the smoke's own chat, so the window
        // has something to trim. Nothing of this leaves the throwaway chat.
        const seeded = []
        for (let index = 0; index < 20; index += 1) {
          seeded.push({
            id: 'seed-user-' + index,
            role: 'user',
            parts: [{ kind: 'text', text: 'вопрос ' + index + ' ' + 'п'.repeat(400) }],
            status: 'done',
            at: Date.now()
          })
          seeded.push({
            id: 'seed-answer-' + index,
            role: 'assistant',
            parts: [{ kind: 'text', text: 'ответ ' + index + ' ' + 'о'.repeat(400) }],
            status: 'done',
            at: Date.now()
          })
        }
        store.setState((state) => {
          const chats = state.chats.map((chat) =>
            chat.id === state.activeChatId ? { ...chat, messages: seeded, saved: undefined } : chat
          )
          const active = chats.find((chat) => chat.id === state.activeChatId) ?? chats[0]
          return { chats, messages: active.messages, saved: active.saved }
        })

        const setMode = async (mode, history, model) => {
          const current = settings.getState().settings.agent
          await window.relaxcode.settings.set({
            agent: { ...current, tokenSaving: mode, historyMessages: history },
            model: model
          })
          await settings.getState().load()
        }
        const meter = () => {
          const el = document.querySelector('[data-testid="context-meter"]')
          return el
            ? {
                savedMessages: Number(el.getAttribute('data-saved-messages') || 0),
                savedChars: Number(el.getAttribute('data-saved-chars') || 0)
              }
            : null
        }
        const chip = () => {
          const el = document.querySelector('[data-testid="chat-thinking"]')
          return el
            ? { level: el.getAttribute('data-level'), effective: el.getAttribute('data-effective') }
            : null
        }
        const run = async (marker) => {
          const ok = await store.getState().send(marker)
          if (!ok) return null
          const deadline = Date.now() + 30000
          while (Date.now() < deadline) {
            if (!store.getState().streaming) {
              const state = store.getState()
              const last = state.messages[state.messages.length - 1]
              return {
                text: last.parts
                  .filter((part) => part.kind === 'text')
                  .map((part) => part.text)
                  .join(''),
                saved: state.saved ?? null,
                messages: state.messages.length
              }
            }
            await wait(100)
          }
          return null
        }

        // A different model than the thinking tests used: that connection has
        // already learned this provider refuses the reasoning parameter, and this
        // step has to see the real parameter on the wire.
        const beforeModel = settings.getState().settings.model

        await setMode('super', 40, 'test-model-b')
        const chipSuper = chip()
        const superRun = await run('SAVINGTEST-SUPER')
        const superMeter = meter()

        // The sheet must explain the cap in words, not only apply it.
        let capNote = null
        const trigger = document.querySelector('[data-testid="chat-thinking"]')
        if (trigger) {
          const opts = { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }
          trigger.dispatchEvent(new PointerEvent('pointerdown', opts))
          trigger.dispatchEvent(new PointerEvent('pointerup', opts))
          trigger.dispatchEvent(new MouseEvent('click', opts))
          const deadline = Date.now() + 3000
          while (Date.now() < deadline) {
            const note = document.querySelector('[data-testid="thinking-saving-cap"]')
            if (note) {
              capNote = note.textContent
              break
            }
            await wait(100)
          }
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          await wait(250)
        }

        await setMode('off', 40, 'test-model-b')
        const offRun = await run('SAVINGTEST-OFF')
        const offMeter = meter()
        const chipOff = chip()

        await setMode(beforeSaving === undefined ? 'off' : beforeSaving, beforeHistory, beforeModel)
        const restored = settings.getState().settings.agent

        return {
          chipSuper,
          chipOff,
          capNote,
          superRun,
          offRun,
          superMeter,
          offMeter,
          restoredSaving: restored.tokenSaving,
          restoredHistory: restored.historyMessages,
          restoredModel: settings.getState().settings.model,
          beforeModel,
          beforeSaving: beforeSaving ?? 'off'
        }
      })()`)
      // The mock keeps every body it received, so each phase is read back by the
      // message that caused it: no guessing which request came first.
      const lastUserOf = (body) =>
        String(
          [...(body?.messages ?? [])].reverse().find((message) => message.role === 'user')?.content ?? ''
        )
      const superBody = requestLog.filter((body) => lastUserOf(body).includes('SAVINGTEST-SUPER')).pop()
      const offBody = requestLog.filter((body) => lastUserOf(body).includes('SAVINGTEST-OFF')).pop()
      log('chat: token saving', {
        superMeter: savingResult?.superMeter ?? null,
        superSaved: savingResult?.superRun?.saved ?? null,
        offSaved: savingResult?.offRun?.saved ?? null,
        chipSuper: savingResult?.chipSuper ?? null,
        capNote: savingResult?.capNote ?? null,
        superMessages: superBody?.messages?.length ?? null,
        offMessages: offBody?.messages?.length ?? null,
        superReasoning: superBody?.reasoning_effort ?? null,
        offReasoning: offBody?.reasoning_effort ?? null
      })
      if (
        savingResult?.superRun?.text === 'SAVINGTEST-DONE' &&
        savingResult?.superMeter &&
        savingResult.superMeter.savedMessages > 0 &&
        savingResult.superRun.saved &&
        savingResult.superRun.saved.messages > 0 &&
        savingResult.chipSuper?.level === 'high' &&
        savingResult.chipSuper?.effective === 'low' &&
        /супер|super/i.test(savingResult.capNote ?? '') &&
        superBody &&
        Array.isArray(superBody.messages) &&
        superBody.messages.length <= 9 &&
        String(superBody.messages[0].content ?? '').includes('Token saving') &&
        String(superBody.messages[0].content ?? '').includes('Left out:') &&
        superBody.reasoning_effort === 'low' &&
        savingResult.offRun?.text === 'SAVINGTEST-DONE' &&
        savingResult.offRun.saved === null &&
        savingResult.offMeter?.savedMessages === 0 &&
        savingResult.chipOff?.effective === 'high' &&
        offBody &&
        offBody.messages.length >= 40 &&
        offBody.reasoning_effort === 'high' &&
        !String(offBody.messages[0].content ?? '').includes('Token saving') &&
        savingResult.restoredSaving === savingResult.beforeSaving &&
        savingResult.restoredModel === savingResult.beforeModel
      ) {
        stepResults.push(
          'token saving: super keeps a small window with a digest and lowers thinking, off sends everything back'
        )
      } else {
        stepResults.push(
          'ERROR: token saving unexpected: ' +
            JSON.stringify({
              saved: savingResult?.superRun?.saved ?? null,
              meter: savingResult?.superMeter ?? null,
              chipSuper: savingResult?.chipSuper ?? null,
              capNote: savingResult?.capNote ?? null,
              offSaved: savingResult?.offRun?.saved ?? null,
              offMeter: savingResult?.offMeter ?? null,
              restored: savingResult?.restoredSaving ?? null,
              superMessages: superBody?.messages?.length ?? null,
              offMessages: offBody?.messages?.length ?? null,
              superReasoning: superBody?.reasoning_effort ?? null,
              offReasoning: offBody?.reasoning_effort ?? null
            })
        )
      }

      // The settings screen: rendered from the catalogue, searchable, and every
      // change lands in the live store and in the interface right away.
      const settingsUiResult = await evaluate(`(async () => {
        const store = window.__relaxcode.settings
        const ui = window.__relaxcode.ui
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        ui.getState().openSettings()
        let screen = null
        const deadline = Date.now() + 5000
        while (Date.now() < deadline) {
          screen = document.querySelector('[data-testid="settings-screen"]')
          if (screen) break
          await wait(100)
        }
        if (!screen) return { error: 'settings screen did not open' }

        const nav = [...screen.querySelectorAll('[data-testid^="settings-nav-"]')].map((el) =>
          el.getAttribute('data-testid')
        )
        // An untranslated key shows up verbatim as "settings.something".
        const missing = [
          ...new Set(
            document.body.innerText
              .split('\\n')
              .filter((line) => line.includes('settings.') && !line.includes('settings.json'))
              .map((line) => line.trim().slice(0, 60))
          )
        ]

        const click = (el) =>
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        const setValue = (el, value) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
          setter.call(el, value)
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }

        click(screen.querySelector('[data-testid="settings-nav-ui"]'))
        await wait(200)
        const uiRows = screen.querySelectorAll('[data-setting]').length

        const search = screen.querySelector('[data-testid="settings-search"]')
        setValue(search, 'миникарта')
        await wait(250)
        const matchedRows = screen.querySelectorAll('[data-setting]').length
        setValue(search, 'zzz-no-such-setting')
        await wait(250)
        const emptyRows = screen.querySelectorAll('[data-setting]').length
        setValue(search, '')
        await wait(200)

        // The bundled provider catalogue: presets, a custom entry, and search.
        click(screen.querySelector('[data-testid="settings-nav-connection"]'))
        await wait(250)
        click(screen.querySelector('[data-testid="provider-catalog-open"]'))
        await wait(700)
        const catalog = document.querySelector('[data-testid="provider-catalog"]')
        const catalogRows = catalog
          ? catalog.querySelectorAll('[data-testid^="provider-row-"]').length
          : 0
        // Every entry carries its real mark, drawn inline so it follows the theme.
        const catalogIcons = catalog
          ? [...catalog.querySelectorAll('[data-testid^="provider-row-"]')].filter((row) =>
              row.querySelector('svg')
            ).length
          : 0
        const novitaLogo = catalog?.querySelector(
          '[data-testid="provider-row-novita-ai"] > span[aria-hidden]'
        )
        const catalogFlip = novitaLogo ? novitaLogo.classList.contains('dark:invert') : null
        const catalogCustom = !!catalog?.querySelector('[data-testid="provider-catalog-custom"]')
        const catalogSearch = catalog?.querySelector('[data-testid="provider-catalog-search"]')
        if (catalogSearch) setValue(catalogSearch, 'genapi')
        await wait(350)
        const catalogFound = catalog
          ? catalog.querySelectorAll('[data-testid^="provider-row-"]').length
          : -1
        const catalogHasGenapi = !!catalog?.querySelector('[data-testid="provider-row-genapi"]')
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        // Radix keeps the layer mounted until its exit animation ends.
        let catalogClosed = false
        const catalogDeadline = Date.now() + 3000
        while (Date.now() < catalogDeadline && !catalogClosed) {
          catalogClosed = !document.querySelector('[data-testid="provider-catalog"]')
          if (!catalogClosed) await wait(100)
        }

        // A Base URL is typed by hand: the field repairs what it can, refuses what
        // it cannot read, and never leaves the check button pointing at nothing.
        const profileId = store.getState().settings.providers[0].id
        const urlField = screen.querySelector('[data-testid="provider-url-' + profileId + '"]')
        const originalUrl = store.getState().settings.providers[0].baseUrl
        const checkButton = [...screen.querySelectorAll('[data-provider="' + profileId + '"] button')].find(
          (button) => /^Проверить|^Check/.test(button.textContent.trim())
        )
        const leaveUrlField = async (value) => {
          urlField.focus()
          setValue(urlField, value)
          await wait(250)
          urlField.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
          urlField.blur()
          await wait(700)
        }
        await leaveUrlField('http:/https://example.com/v1')
        const urlRepaired =
          store.getState().settings.providers[0].baseUrl === 'https://example.com/v1'
        const urlNotice = screen.textContent.includes('Адрес исправлен')
        await leaveUrlField('это не адрес')
        const urlRefused = !!screen.querySelector('[data-testid="provider-url-error-' + profileId + '"]')
        const urlNotSaved = store.getState().settings.providers[0].baseUrl === 'https://example.com/v1'
        const urlCheckDisabled = checkButton ? checkButton.disabled : null
        await leaveUrlField(originalUrl)
        const urlRestored = store.getState().settings.providers[0].baseUrl === originalUrl
        click(screen.querySelector('[data-testid="settings-nav-ui"]'))
        await wait(200)

        // Theme, accent and language are applied to the document immediately.
        await store.getState().apply({ ui: { theme: 'dark' } })
        await wait(200)
        const dark = document.documentElement.classList.contains('dark')
        await store.getState().apply({ ui: { theme: 'light', accent: 'violet' } })
        await wait(200)
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
        const light = !document.documentElement.classList.contains('dark')

        // An editor patch has to reach the live Monaco instance.
        await store.getState().apply({ editor: { fontSize: 17 } })
        await wait(300)
        const viewLines = document.querySelector('.view-lines')
        const appliedFontSize = viewLines ? viewLines.style.fontSize : null

        // Tools and servers sections keep their own markup.
        await store.getState().apply({ tools: { disabled: ['delete_path'] } })
        await wait(150)
        const disabledTool = store.getState().settings?.tools.disabled.join(',')
        const deniedServer = store.getState().settings?.servers.allowBackground

        // Token saving sits in the settings like every other choice: one plain
        // select in the same row layout, no special block (a real click opens and
        // commits it; this checks the markup, the options and the binding).
        click(screen.querySelector('[data-testid="settings-nav-agent"]'))
        await wait(300)
        const press2 = (el) => {
          const opts = { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }
          el.dispatchEvent(new PointerEvent('pointerdown', opts))
          el.dispatchEvent(new PointerEvent('pointerup', opts))
          el.dispatchEvent(new MouseEvent('click', opts))
        }
        const savingRow = screen.querySelector('[data-setting="agent.tokenSaving"]')
        const savingTrigger = savingRow ? savingRow.querySelector('[role="combobox"]') : null
        const savingInitial = store.getState().settings?.agent.tokenSaving
        const savingInitialText = savingTrigger ? savingTrigger.textContent.trim() : null
        const savingPlain = !!savingTrigger && !document.querySelector('[data-testid="saving-mode"]')
        let savingOptions = []
        if (savingTrigger) {
          press2(savingTrigger)
          const optionsDeadline = Date.now() + 3000
          while (Date.now() < optionsDeadline) {
            const items = [...document.querySelectorAll('[role="option"]')]
            if (items.length > 0) {
              savingOptions = items.map((el) => el.textContent.trim())
              break
            }
            await wait(80)
          }
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          await wait(250)
        }
        // The row follows the setting it is bound to, in both directions.
        await store.getState().apply({ agent: { tokenSaving: 'super' } })
        await wait(350)
        const savingPicked = store.getState().settings?.agent.tokenSaving
        const savingShown = savingTrigger ? savingTrigger.textContent.trim() : null
        await store.getState().apply({ agent: { tokenSaving: savingInitial } })
        await wait(300)
        const savingRestored = store.getState().settings?.agent.tokenSaving === savingInitial
        const savingShowsRestored = savingTrigger
          ? savingTrigger.textContent.trim() === savingInitialText
          : false

        // Reset everything the test touched; the file is restored at the end.
        await store.getState().apply({
          editor: { fontSize: 13 },
          tools: { disabled: [] },
          ui: { theme: 'light', accent: 'default' }
        })
        await wait(150)

        click(screen.querySelector('[data-testid="settings-close"]'))
        await wait(250)
        const closed = !ui.getState().settingsOpen

        return {
          nav: nav.length,
          missing,
          uiRows,
          matchedRows,
          emptyRows,
          catalogRows,
          catalogIcons,
          catalogFlip,
          catalogCustom,
          catalogFound,
          catalogHasGenapi,
          catalogClosed,
          urlRepaired,
          urlNotice,
          urlRefused,
          urlNotSaved,
          urlCheckDisabled,
          urlRestored,
          dark,
          light,
          accent,
          appliedFontSize,
          disabledTool,
          deniedServer,
          savingPlain,
          savingOptions,
          savingPicked,
          savingShown,
          savingRestored,
          savingShowsRestored,
          closed
        }
      })()`)
      log('settings: screen', settingsUiResult)
      const settingsScreenOk =
        !!settingsUiResult &&
        !settingsUiResult.error &&
        settingsUiResult.nav === 12 &&
        settingsUiResult.missing.length === 0 &&
        settingsUiResult.uiRows >= 10 &&
        settingsUiResult.matchedRows === 1 &&
        settingsUiResult.emptyRows === 0 &&
        settingsUiResult.catalogRows >= 150 &&
        settingsUiResult.catalogIcons === settingsUiResult.catalogRows &&
        settingsUiResult.catalogFlip === true &&
        settingsUiResult.catalogCustom === true &&
        settingsUiResult.catalogFound === 1 &&
        settingsUiResult.catalogHasGenapi === true &&
        settingsUiResult.catalogClosed === true &&
        settingsUiResult.urlRepaired === true &&
        settingsUiResult.urlNotice === true &&
        settingsUiResult.urlRefused === true &&
        settingsUiResult.urlNotSaved === true &&
        settingsUiResult.urlCheckDisabled === true &&
        settingsUiResult.urlRestored === true &&
        settingsUiResult.dark === true &&
        settingsUiResult.light === true &&
        settingsUiResult.accent !== '' &&
        settingsUiResult.disabledTool === 'delete_path' &&
        settingsUiResult.savingPlain === true &&
        Array.isArray(settingsUiResult.savingOptions) &&
        settingsUiResult.savingOptions.length === 3 &&
        /Супер|Super/.test(settingsUiResult.savingOptions[2] ?? '') &&
        settingsUiResult.savingPicked === 'super' &&
        typeof settingsUiResult.savingShown === 'string' &&
        settingsUiResult.savingShown.length > 0 &&
        settingsUiResult.savingRestored === true &&
        settingsUiResult.savingShowsRestored === true &&
        settingsUiResult.closed === true
      // The font size only exists when an editor tab is mounted.
      const editorApplied =
        settingsUiResult && (settingsUiResult.appliedFontSize === null || settingsUiResult.appliedFontSize === '17px')
      if (settingsScreenOk && editorApplied) {
        stepResults.push('settings: screen renders, searches, applies and closes')
      } else {
        stepResults.push('ERROR: settings screen unexpected: ' + JSON.stringify(settingsUiResult))
      }

      if (process.env.SMOKE_SCREENSHOT) {
        const fs = await import('node:fs')
        const base = process.env.SMOKE_SCREENSHOT.replace(/\.png$/, '')
        const chatShot = await send('Page.captureScreenshot', { format: 'png' })
        if (chatShot.result?.data) {
          fs.writeFileSync(`${base}-chat.png`, Buffer.from(chatShot.result.data, 'base64'))
          log('screenshot saved', `${base}-chat.png`)
        }
        await evaluate(`window.__relaxcode.ui.getState().openSettings()`)
        await new Promise((r) => setTimeout(r, 1200))
        const settingsShot = await send('Page.captureScreenshot', { format: 'png' })
        if (settingsShot.result?.data) {
          fs.writeFileSync(`${base}-settings.png`, Buffer.from(settingsShot.result.data, 'base64'))
          log('screenshot saved', `${base}-settings.png`)
        }
        await evaluate(`window.__relaxcode.ui.getState().closeSettings()`)
      }
    } finally {
      // Throw the smoke chat away and give the user back the chat they had open.
      const chatCleanup = await evaluate(`(() => {
        const store = window.__relaxcode.chat
        const id = ${JSON.stringify(smokeChatId)}
        const previous = ${JSON.stringify(smokeChatPrevious)}
        if (id) store.getState().deleteChat(id)
        const deleted = !id || !store.getState().chats.some((c) => c.id === id)
        if (previous && store.getState().chats.some((c) => c.id === previous)) {
          store.getState().selectChat(previous)
        }
        return { deleted, active: store.getState().activeChatId === previous }
      })()`).catch((error) => 'ERROR: chat cleanup failed: ' + error.message)
      log('chat: cleanup', chatCleanup)
      if (chatCleanup && typeof chatCleanup === 'object' && chatCleanup.deleted) {
        stepResults.push('chat: smoke chat removed, user chat restored')
      } else {
        stepResults.push('ERROR: smoke chat not cleaned up: ' + JSON.stringify(chatCleanup))
      }
      const fileRestored = restoreSettingsFile(settingsSnapshot)
      let fileVerified = false
      if (settingsSnapshot) {
        try {
          fileVerified = fs.readFileSync(SETTINGS_FILE, 'utf8') === settingsSnapshot
        } catch {
          fileVerified = false
        }
      }
      log(
        'chat: settings file',
        fileRestored && fileVerified ? 'restored and verified' : 'RESTORE FAILED'
      )
      if (!fileRestored || !fileVerified) {
        stepResults.push('ERROR: settings file not restored from backup')
      }
      const restoreResult = await evaluate(`(async () => {
        await window.__relaxcode.settings.getState().load()
        return 'settings store reloaded'
      })()`)
      log('chat: restore', restoreResult)
      stepResults.push(restoreResult)
      const thinkingRestored = await evaluate(`(() => {
        const value = ${JSON.stringify(previousThinking)}
        try {
          if (value === null) window.localStorage.removeItem('relaxcode.chatThinking')
          else window.localStorage.setItem('relaxcode.chatThinking', value)
          return 'thinking level restored'
        } catch (error) {
          return 'ERROR: thinking level not restored: ' + error.message
        }
      })()`)
      log('chat: thinking level', thinkingRestored)
      stepResults.push(thinkingRestored)
      server.close()
    }
  }

  if (process.env.SMOKE_SCREENSHOT) {
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    const data = shot.result?.data
    if (data) {
      const fs = await import('node:fs')
      fs.writeFileSync(process.env.SMOKE_SCREENSHOT, Buffer.from(data, 'base64'))
      log('screenshot saved', process.env.SMOKE_SCREENSHOT)
    } else {
      log('screenshot', 'FAILED to capture')
    }
  }

  await new Promise((r) => setTimeout(r, 500))
  log('renderer console errors', consoleErrors.length ? consoleErrors : 'none')

  ws.close()

  const failedSteps = stepResults.filter((r) =>
    (typeof r === 'string' && r.includes('ERROR')) ||
    (r && typeof r === 'object' && JSON.stringify(r).includes('"ERROR'))
  )
  if (failedSteps.length) log('failed steps', failedSteps)
  const failed = consoleErrors.length > 0 || failedSteps.length > 0
  console.log(failed ? '[smoke] RESULT: FAIL' : '[smoke] RESULT: PASS')
  process.exit(failed ? 1 : 0)
}

main().catch((error) => {
  console.error('[smoke] fatal:', error.message)
  process.exit(1)
})
