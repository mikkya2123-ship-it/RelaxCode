/**
 * Pure-Node PNG codec shared by the asset builders (app icon, installer
 * art). 8-bit non-interlaced PNGs, color types 0/2/3/6, RGBA8 output.
 */
import { deflateSync, inflateSync } from 'node:zlib'

export function decodePng(buffer) {
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

export function encodePng(width, height, pixels) {
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

/** Box-filter downscale of RGBA8 pixels by an integer factor. */
export function boxDownsample(width, height, pixels, factor) {
  const outWidth = Math.floor(width / factor)
  const outHeight = Math.floor(height / factor)
  const out = Buffer.alloc(outWidth * outHeight * 4)
  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let dy = 0; dy < factor; dy += 1) {
        for (let dx = 0; dx < factor; dx += 1) {
          const at = ((y * factor + dy) * width + x * factor + dx) * 4
          const alpha = pixels[at + 3]
          r += pixels[at] * alpha
          g += pixels[at + 1] * alpha
          b += pixels[at + 2] * alpha
          a += alpha
        }
      }
      const at = (y * outWidth + x) * 4
      if (a > 0) {
        out[at] = Math.round(r / a)
        out[at + 1] = Math.round(g / a)
        out[at + 2] = Math.round(b / a)
        out[at + 3] = Math.round(a / (factor * factor))
      }
    }
  }
  return { width: outWidth, height: outHeight, pixels: out }
}
