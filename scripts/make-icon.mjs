/**
 * Builds build/icon.ico for the Windows installer — pure Node, no image
 * libraries. The app's light logo strokes are composited onto a slate
 * gradient tile with rounded corners (drawn at 4x and box-downsampled for
 * smooth edges), encoded back to PNGs and wrapped into an ICO container.
 *
 * Run with: node scripts/make-icon.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'

const SIZE = 1024
const RADIOS = 0.225
const ENTRIES = [16, 24, 32, 48, 64, 128, 256]

/* ------------------------------- PNG codec -------------------------------- */

function decodePng(buffer) {
  const view = DataView.prototype
  void view
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat = []
  const palette = []
  const transparent = []
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos)
    const type = buffer.toString('ascii', pos + 4, pos + 8)
    const data = buffer.subarray(pos + 8, pos + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'PLTE') {
      for (let index = 0; index < data.length; index += 3) {
        palette.push([data[index], data[index + 1], data[index + 2], 255])
      }
    } else if (type === 'tRNS') {
      for (let index = 0; index < data.length; index += 1) {
        transparent.push(data[index])
      }
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') break
    pos += length + 12
  }
  if (interlace !== 0) throw new Error('interlaced PNG is not supported')
  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} is not supported`)

  const raw = inflateSync(Buffer.concat(idat))
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 0 ? 1 : 2
  const stride = width * channels
  const pixels = Buffer.alloc(width * height * 4)
  const bpp = channels
  let prior = Buffer.alloc(stride)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? line[x - bpp] : 0
      const up = prior[x]
      const upLeft = x >= bpp ? prior[x - bpp] : 0
      let value = line[x]
      if (filter === 1) value = (value + left) & 0xff
      else if (filter === 2) value = (value + up) & 0xff
      else if (filter === 3) value = (value + ((left + up) >> 1)) & 0xff
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        value = (value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 0xff
      }
      line[x] = value
    }
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4
      const source = x * channels
      if (colorType === 6) {
        pixels[at] = line[source]
        pixels[at + 1] = line[source + 1]
        pixels[at + 2] = line[source + 2]
        pixels[at + 3] = line[source + 3]
      } else if (colorType === 2) {
        pixels[at] = line[source]
        pixels[at + 1] = line[source + 1]
        pixels[at + 2] = line[source + 2]
        pixels[at + 3] = 255
      } else if (colorType === 3) {
        const entry = palette[line[source]] ?? [0, 0, 0, 0]
        pixels[at] = entry[0]
        pixels[at + 1] = entry[1]
        pixels[at + 2] = entry[2]
        pixels[at + 3] = transparent[line[source]] ?? entry[3]
      } else if (colorType === 0) {
        pixels[at] = pixels[at + 1] = pixels[at + 2] = line[source]
        pixels[at + 3] = 255
      }
    }
    prior = Buffer.from(line)
  }
  return { width, height, pixels }
}

function crc32(buffer) {
  let crc = -1
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]
  }
  return (crc ^ -1) >>> 0
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function chunk(type, body) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'ascii')
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), body])), 0)
  return Buffer.concat([head, body, tail])
}

function encodePng(width, height, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

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
