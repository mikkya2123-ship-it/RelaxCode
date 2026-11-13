// usage: node eval.mjs "<expression>"
const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
const reply = new Promise((resolve) => { ws.onmessage = (e) => resolve(JSON.parse(e.data)) })
await new Promise((r) => (ws.onopen = r))
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: process.argv[2], awaitPromise: true, returnByValue: true } }))
const res = await reply
console.log(JSON.stringify(res.result?.result?.value ?? res, null, 2))
process.exit(0)
