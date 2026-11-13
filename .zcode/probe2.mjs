const { evaluate } = await import('./cdp.mjs')
const script = `(async () => {
  const out = []
  for (const id of ['blender','godot','artcraft']) {
    const t0 = performance.now()
    const res = await Promise.race([
      window.relaxcode.mcp.detect(id).then(r => ({ ok: true, n: r.length })),
      new Promise(r => setTimeout(() => r({ ok: false, timeout: true }), 8000))
    ])
    out.push({ id, ms: Math.round(performance.now() - t0), ...res })
  }
  return out
})()`
const r = await evaluate(script)
console.log(JSON.stringify(r, null, 2))
process.exit(0)
