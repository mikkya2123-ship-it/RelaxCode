const { evaluate } = await import('./cdp.mjs')
const script = `(async () => {
  const out = {}
  const timeIt = async (id) => {
    let maxGap = 0; let last = performance.now()
    const tick = () => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; if (running) requestAnimationFrame(tick) }
    let running = true
    requestAnimationFrame(tick)
    const t0 = performance.now()
    let res, err = null
    try { res = await window.relaxcode.mcp.detect(id) } catch (e) { err = String(e) }
    const ms = performance.now() - t0
    running = false
    return { ms: Math.round(ms), maxFrameGapMs: Math.round(maxGap), count: res?.length ?? null, err }
  }
  out.blender = await timeIt('blender')
  out.godot = await timeIt('godot')
  out.artcraft = await timeIt('artcraft')
  out.blender2 = await timeIt('blender')
  out.godot2 = await timeIt('godot')
  return out
})()`
console.log(JSON.stringify(await evaluate(script), null, 2))
process.exit(0)
