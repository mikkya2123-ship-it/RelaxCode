/**
 * Builds build/icon.ico for the Windows installer — pure Node, no image
 * libraries. The app's light logo strokes are composited onto a slate
 * gradient tile with rounded corners (drawn at 4x and box-downsampled for
 * smooth edges), encoded back to PNGs and wrapped into an ICO container.
 *
 * Run with: node scripts/make-icon.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { decodePng, encodePng } from './lib/png-codec.mjs'

const SIZE = 1024
const RADIOS = 0.225
const ENTRIES = [16, 24, 32, 48, 64, 128, 256]

/* ------------------------------ the drawing -------------------------------- */

/** Distance to a rounded rectangle; negative inside. */
function roundedSdf(x, y, size, radius) {
  const inner = size / 2 - radius
  const dx = Math.abs(x - size / 2) - inner
  const dy = Math.abs(y - size / 2) - inner
  const ax = Math.max(dx, 0)
  const ay = Math.max(dy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - radius
}

function drawTile() {
  const logo = decodePng(readFileSync(new URL('../src/renderer/src/assets/app-logo-light.png', import.meta.url)))
  // The source drawing sits on an opaque white square: near-white becomes
  // transparent, and the dark strokes are re-drawn as white with the stroke
  // darkness as alpha — the mascot reads on the dark gradient tile.
  for (let at = 0; at < logo.pixels.length; at += 4) {
    const [r, g, b, a] = [logo.pixels[at], logo.pixels[at + 1], logo.pixels[at + 2], logo.pixels[at + 3]]
    if (a === 0) continue
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b
    if (luminance > 235) {
      logo.pixels[at + 3] = 0
    } else {
      logo.pixels[at] = 255
      logo.pixels[at + 1] = 255
      logo.pixels[at + 2] = 255
      logo.pixels[at + 3] = Math.round(Math.min(255, (255 - luminance) * 1.15))
    }
  }
  const pixels = Buffer.alloc(SIZE * SIZE * 4)
  const share = 0.66
  const logoSize = Math.round(SIZE * share)
  const logoAt = Math.round((SIZE - logoSize) / 2)
  // Bilinear sample of the logo at its new scale.
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const at = (y * SIZE + x) * 4
      const inside = roundedSdf(x + 0.5, y + 0.5, SIZE, SIZE * RADIOS) <= 0
      if (!inside) {
        pixels[at + 3] = 0
        continue
      }
      // Slate gradient, a touch lighter at the top-left corner.
      const diag = (x + y) / (2 * SIZE)
      pixels[at] = Math.round(30 - 8 * diag + 8 * (1 - diag))
      pixels[at + 1] = Math.round(41 - 6 * diag + 10 * (1 - diag))
      pixels[at + 2] = Math.round(59 - 4 * diag + 14 * (1 - diag))
      pixels[at + 3] = 255
      const lx = (x - logoAt) / logoSize
      const ly = (y - logoAt) / logoSize
      if (lx >= 0 && ly >= 0 && lx < 1 && ly < 1) {
        const fx = lx * logo.width - 0.5
        const fy = ly * logo.height - 0.5
        const x0 = Math.max(0, Math.floor(fx))
        const y0 = Math.max(0, Math.floor(fy))
        const x1 = Math.min(logo.width - 1, x0 + 1)
        const y1 = Math.min(logo.height - 1, y0 + 1)
        const tx = fx - x0
        const ty = fy - y0
        const sample = (sx, sy, channel) => logo.pixels[(sy * logo.width + sx) * 4 + channel]
        const alpha =
          (sample(x0, y0, 3) * (1 - tx) + sample(x1, y0, 3) * tx) * (1 - ty) +
          (sample(x0, y1, 3) * (1 - tx) + sample(x1, y1, 3) * tx) * ty
        if (alpha > 0) {
          const mix = alpha / 255
          for (let channel = 0; channel < 3; channel += 1) {
            const color =
              (sample(x0, y0, channel) * (1 - tx) + sample(x1, y0, channel) * tx) * (1 - ty) +
              (sample(x0, y1, channel) * (1 - tx) + sample(x1, y1, channel) * tx) * ty
            pixels[at + channel] = Math.round(color * mix + pixels[at + channel] * (1 - mix))
          }
        }
      }
    }
  }
  return pixels
}

/** Box downsample RGBA by an integer factor. */
function downsample(size, pixels, target) {
  const factor = size / target
  const out = Buffer.alloc(target * target * 4)
  for (let y = 0; y < target; y += 1) {
    for (let x = 0; x < target; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let dy = 0; dy < factor; dy += 1) {
        for (let dx = 0; dx < factor; dx += 1) {
          const at = ((y * factor + dy) * size + x * factor + dx) * 4
          const alpha = pixels[at + 3]
          r += pixels[at] * alpha
          g += pixels[at + 1] * alpha
          b += pixels[at + 2] * alpha
          a += alpha
        }
      }
      const count = factor * factor
      const at = (y * target + x) * 4
      if (a === 0) {
        out[at + 3] = 0
      } else {
        out[at] = Math.round(r / a)
        out[at + 1] = Math.round(g / a)
        out[at + 2] = Math.round(b / a)
        out[at + 3] = Math.round(a / count)
      }
    }
  }
  return out
}

/* -------------------------------- the ICO --------------------------------- */

const pixels = drawTile()
mkdirSync('build', { recursive: true })
const images = ENTRIES.map((size) => ({ size, png: encodePng(size, size, downsample(SIZE, pixels, size)) }))
writeFileSync('build/icon-256.png', images[images.length - 1].png)

let offset = 6 + 16 * images.length
const header = Buffer.alloc(6 + 16 * images.length)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(images.length, 4)
images.forEach((image, index) => {
  const entry = 6 + index * 16
  header.writeUInt8(image.size === 256 ? 0 : image.size, entry)
  header.writeUInt8(image.size === 256 ? 0 : image.size, entry + 1)
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(image.png.length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += image.png.length
})
writeFileSync('build/icon.ico', Buffer.concat([header, ...images.map((image) => image.png)]))
console.log(`build/icon.ico written (${images.length} sizes, from ${SIZE}px source)`)
