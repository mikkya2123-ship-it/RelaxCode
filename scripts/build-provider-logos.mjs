/**
 * Downloads the provider logos bundled with the app.
 *
 * models.dev publishes one SVG per provider at /logos/<id>.svg and they are
 * drawn with `currentColor`, so they pick up the theme colour of the row they
 * sit in. Providers without a published logo simply get no file — the UI falls
 * back to a neutral icon.
 *
 *   node scripts/build-provider-logos.mjs
 *
 * Run it after scripts/build-provider-catalog.mjs (it reads the ids from the
 * generated catalogue).
 */
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CATALOG = path.join(ROOT, 'src/shared/provider-catalog.ts')
const OUT_DIR = path.join(ROOT, 'src/renderer/src/assets/provider-logos')
const SOURCE = (id) => `https://models.dev/logos/${encodeURIComponent(id)}.svg`
const CONCURRENCY = 8

const catalog = await readFile(CATALOG, 'utf8')
const ids = [...catalog.matchAll(/\{ id: '([^']+)'/g)].map((match) => match[1]).filter(Boolean)
if (ids.length === 0) throw new Error('no provider ids found in ' + CATALOG)

/** Keep only the drawing, so an <svg> can be inlined into the page. */
function clean(svg) {
  return svg
    .replace(/<\?xml[^>]*\?>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
}

/**
 * A handful of logos carry a <style> block whose class names are global once
 * the drawing is inlined, so they are moved under the provider's own name.
 */
function namespaceStyles(svg, id) {
  const styles = [...svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
  if (styles.length === 0) return svg

  const prefix = id.replace(/[^a-z0-9]/gi, '-')
  const rename = (text) => text.replace(/\.(-?[_a-zA-Z][\w-]*)/g, `.${prefix}-$1`)

  let out = svg.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (_, attrs, body) => `<style${attrs}>${rename(body)}</style>`)
  out = out.replace(/class="([^"]*)"/g, (_, value) =>
    `class="${value
      .split(/\s+/)
      .filter(Boolean)
      .map((name) => `${prefix}-${name}`)
      .join(' ')}"`
  )
  return out
}

await mkdir(OUT_DIR, { recursive: true })
for (const file of await readdir(OUT_DIR)) {
  if (file.endsWith('.svg')) await rm(path.join(OUT_DIR, file))
}

const saved = []
const missing = []
const failed = []

async function download(id) {
  try {
    const response = await fetch(SOURCE(id))
    if (response.status === 404) {
      missing.push(id)
      return
    }
    if (!response.ok) {
      failed.push(`${id} (HTTP ${response.status})`)
      return
    }
    const svg = namespaceStyles(clean(await response.text()), id)
    if (!svg.startsWith('<svg')) {
      failed.push(`${id} (not an svg)`)
      return
    }
    await writeFile(path.join(OUT_DIR, `${id}.svg`), svg + '\n', 'utf8')
    saved.push({ id, svg })
  } catch (error) {
    failed.push(`${id} (${error instanceof Error ? error.message : String(error)})`)
  }
}

let cursor = 0
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++]
      await download(id)
    }
  })
)

const themed = saved.filter((entry) => entry.svg.includes('currentColor')).length
const hardcoded = saved.filter((entry) => !entry.svg.includes('currentColor'))

console.log(`logos: ${saved.length}/${ids.length} saved to src/renderer/src/assets/provider-logos`)
console.log(`  drawn with currentColor (theme aware): ${themed}`)
console.log(`  with hardcoded colours: ${hardcoded.length}`)
if (hardcoded.length > 0) {
  console.log('   ', hardcoded.map((entry) => entry.id).join(', '))
}
if (missing.length > 0) console.log(`  no logo published: ${missing.length} — ${missing.join(', ')}`)
if (failed.length > 0) console.log(`  failed: ${failed.join(', ')}`)
