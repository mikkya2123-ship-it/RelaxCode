const list = await (await fetch('http://127.0.0.1:9222/json')).json()
console.log('targets', list.map(t => [t.type, t.url]))
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
ws.onopen = () => { console.log('open'); ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: '2+2', returnByValue: true } })) }
ws.onmessage = (e) => { console.log('msg', e.data.slice(0, 200)); process.exit(0) }
ws.onerror = (e) => { console.log('ws error', e.message) }
setTimeout(() => { console.log('no reply in 10s'); process.exit(1) }, 10000)
