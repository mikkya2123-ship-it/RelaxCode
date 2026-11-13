// usage: node measure.mjs "<js expression returning a promise>"
const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const send = (method, params) =>
  new Promise((resolve) => {
    const myId = ++id
    const onMsg = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.id !== myId) return
      ws.removeEventListener('message', onMsg)
      resolve(msg)
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id: myId, method, params }))
  })
const expr = process.argv[2]
const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
console.log(JSON.stringify(res.result?.result?.value ?? res.result ?? res, null, 2))
ws.close()
process.exit(0)
