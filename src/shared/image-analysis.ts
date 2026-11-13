/* ------------------------------------------------------------------------- *
 * Pixel-level picture analysis.
 *
 * A text-only model cannot look at a picture, but it can read numbers. This
 * module turns RGBA pixels into the facts a designer would state out loud:
 * size and aspect, transparency and the content box, dominant colours by
 * share, brightness/contrast/saturation, edge density, sharpness, flat areas,
 * a coarse luminance map and a transparency silhouette. Everything here is
 * pure arithmetic on a typed array, so it runs in a worker-less main process
 * and in tests without Electron or a DOM.
 *
 * It deliberately does NOT pretend to know what the picture shows. Subject
 * identity and visible text need a vision model; the report says so and the
 * caller can append a caption from one.
 * ------------------------------------------------------------------------- */

export interface RgbaImage {
  width: number
  height: number
  /** RGBA, four bytes per pixel, row-major. */
  data: Uint8Array
  /** Original width when these pixels are a downscaled preview. */
  sourceWidth?: number
  /** Original height when these pixels are a downscaled preview. */
  sourceHeight?: number
}

export interface DominantColor {
  hex: string
  r: number
  g: number
  b: number
  /** Share of the visible (non-transparent) pixels, 0…1. */
  share: number
}

export interface ContentBox {
  x: number
  y: number
  width: number
  height: number
  /** Empty margins around the content, in percent of the picture. */
  margins: { left: number; right: number; top: number; bottom: number }
}

export interface ImageZone {
  /** "top-left" … "bottom-right". */
  id: string
  hex: string
  /** 0…255. */
  luminance: number
  /** Mean edge strength in the zone, 0…1. */
  detail: number
  transparent: number
}

export interface ImageAnalysis {
  width: number
  height: number
  aspect: number
  orientation: 'square' | 'portrait' | 'landscape'
  megapixels: number
  /** Share of fully transparent pixels, 0…1. */
  transparentShare: number
  /** Any meaningful transparency at all. */
  hasAlpha: boolean
  /** Box that contains every pixel with alpha ≥ 16; null for a fully transparent picture. */
  content: ContentBox | null
  average: DominantColor
  luminance: { mean: number; median: number; p10: number; p90: number; min: number; max: number }
  /** Standard deviation of luminance, 0…255. */
  contrast: number
  /** Mean HSV saturation of visible pixels, 0…1. */
  saturation: number
  dominant: DominantColor[]
  /** Distinct colours after 5-bit-per-channel quantisation (sampled). */
  uniqueColors: number
  /** Share of 8×8 blocks with almost no local variation, 0…1. */
  flatShare: number
  /** Share of sampled pixels on a strong edge, 0…1. */
  edgeDensity: number
  /** Variance of the Laplacian, normalised by 255². Bigger is crisper. */
  sharpness: number
  /** Most likely broad category, with the evidence behind it. */
  classification: { kind: ImageKind; confidence: 'low' | 'medium' | 'high'; evidence: string[] }
  palette: DominantColor[]
  zones: ImageZone[]
  /** Alpha silhouette, '#' opaque, '+' partial, ' ' transparent. */
  alphaMap: string[]
  /** Luminance map, '@' darkest … ' ' lightest. */
  lumaMap: string[]
  warnings: string[]
}

export type ImageKind = 'photo' | 'flat illustration' | 'icon or logo' | 'screenshot or UI' | 'line art' | 'mixed image'

export interface ImageExpectation {
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  orientation?: 'square' | 'portrait' | 'landscape'
  transparent?: boolean
  brightness?: 'light' | 'dark'
  /** Minimum standard deviation of luminance (0…255). */
  minContrast?: number
  /** Minimum edge density (0…1) — guards against a flat placeholder. */
  minDetail?: number
  /** Expected broad category; "photo" also accepts "mixed image". */
  kind?: 'photo' | 'illustration' | 'icon' | 'screenshot' | 'line-art'
}

export interface ImageCheck {
  label: string
  ok: boolean
  expected: string
  actual: string
}

export interface ImageVerdict {
  fits: boolean
  checks: ImageCheck[]
  /** Things pixels cannot verify, so the model does not overclaim. */
  unverifiable: string[]
}

/* ------------------------------- utilities ------------------------------- */

const clamp255 = (value: number): number => (value < 0 ? 0 : value > 255 ? 255 : value)

function hex(r: number, g: number, b: number): string {
  const part = (value: number): string => Math.round(clamp255(value)).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase()
}

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** "violet", "light blue", "warm grey" — enough for a blind reader to picture it. */
export function colorName(r: number, g: number, b: number, a = 255): string {
  if (a < 16) return 'transparent'
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const lightness = (max + min) / 510
  if (delta < 12) {
    if (lightness > 0.94) return 'white'
    if (lightness < 0.08) return 'black'
    if (lightness > 0.7) return 'light grey'
    if (lightness < 0.28) return 'dark grey'
    return 'grey'
  }
  const saturation = delta / max
  let hue = 0
  if (max === r) hue = ((g - b) / delta) % 6
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4
  hue = Math.round(hue * 60)
  if (hue < 0) hue += 360
  const base =
    hue < 15 || hue >= 345
      ? 'red'
      : hue < 40
        ? 'orange'
        : hue < 65
          ? 'amber'
          : hue < 90
            ? 'yellow'
            : hue < 150
              ? 'green'
              : hue < 185
                ? 'teal'
                : hue < 210
                  ? 'cyan'
                  : hue < 250
                    ? 'blue'
                    : hue < 280
                      ? 'indigo'
                      : hue < 320
                        ? 'violet'
                        : 'pink'
  const muted = saturation < 0.2 ? 'muted ' : ''
  const tone = lightness > 0.78 ? 'light ' : lightness < 0.22 ? 'dark ' : ''
  return `${tone}${muted}${base}`.trim()
}

/** Coarse 3×3 layout: what sits where, how busy and how bright it is. */
function zoneName(x: number, y: number): string {
  const row = y === 0 ? 'top' : y === 1 ? 'middle' : 'bottom'
  const col = x === 0 ? 'left' : x === 1 ? 'centre' : 'right'
  return `${row}-${col}`
}

/* ------------------------------- sampling -------------------------------- */

interface Sample {
  width: number
  height: number
  r: Float32Array
  g: Float32Array
  b: Float32Array
  a: Float32Array
  luma: Float32Array
}

/**
 * Box-averaged copy of the picture, at most `maxDim` on its longer side.
 * Sampling instead of decoding twice keeps analysis fast even for a 6000-pixel
 * photo, and averaging avoids inventing edges that the full image does not have.
 */
function sampleImage(image: RgbaImage, maxDim = 320): Sample {
  const { width, height, data } = image
  const scale = Math.max(1, Math.ceil(Math.max(width, height) / maxDim))
  const sw = Math.max(1, Math.floor(width / scale))
  const sh = Math.max(1, Math.floor(height / scale))
  const r = new Float32Array(sw * sh)
  const g = new Float32Array(sw * sh)
  const b = new Float32Array(sw * sh)
  const a = new Float32Array(sw * sh)
  const lum = new Float32Array(sw * sh)

  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      // Up to 4×4 samples per output cell: enough to average away pixel noise.
      const steps = Math.min(scale, 4)
      const stepX = Math.max(1, Math.floor(scale / steps))
      const stepY = stepX
      let ar = 0
      let ag = 0
      let ab = 0
      let aa = 0
      let count = 0
      for (let dy = 0; dy < steps; dy += 1) {
        const sy = Math.min(height - 1, y * scale + dy * stepY)
        for (let dx = 0; dx < steps; dx += 1) {
          const sx = Math.min(width - 1, x * scale + dx * stepX)
          const offset = (sy * width + sx) * 4
          const alpha = data[offset + 3]
          ar += data[offset] * alpha
          ag += data[offset + 1] * alpha
          ab += data[offset + 2] * alpha
          aa += alpha
          count += 1
        }
      }
      const index = y * sw + x
      if (aa > 0) {
        r[index] = ar / aa
        g[index] = ag / aa
        b[index] = ab / aa
      }
      a[index] = aa / count
      lum[index] = luma(r[index], g[index], b[index])
    }
  }
  return { width: sw, height: sh, r, g, b, a, luma: lum }
}

/** Percentile from a 256-bin histogram. */
function percentile(histogram: Uint32Array, total: number, fraction: number): number {
  if (total === 0) return 0
  const wanted = Math.floor(total * fraction)
  let seen = 0
  for (let value = 0; value < histogram.length; value += 1) {
    seen += histogram[value]
    if (seen >= wanted) return value
  }
  return 255
}

/* -------------------------------- palette -------------------------------- */

function buildPalette(sample: Sample, limit: number): DominantColor[] {
  const buckets = new Map<number, { r: number; g: number; b: number; count: number }>()
  let visible = 0
  for (let index = 0; index < sample.luma.length; index += 1) {
    if (sample.a[index] < 16) continue
    visible += 1
    const r = sample.r[index]
    const g = sample.g[index]
    const b = sample.b[index]
    // 5 bits per channel: 32×32×32 buckets — small enough to count, fine
    // enough to keep two neighbouring brand colours apart.
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.r += r
      bucket.g += g
      bucket.b += b
      bucket.count += 1
    } else {
      buckets.set(key, { r, g, b, count: 1 })
    }
  }
  const sorted = [...buckets.values()].sort((left, right) => right.count - left.count)
  const clusters: Array<{ r: number; g: number; b: number; count: number }> = []
  for (const bucket of sorted) {
    const r = bucket.r / bucket.count
    const g = bucket.g / bucket.count
    const b = bucket.b / bucket.count
    // Gradients and anti-aliased edges split one perceived colour across
    // neighbouring buckets; merge those so the palette stays readable.
    const near = clusters.find(
      (cluster) =>
        Math.abs(cluster.r / cluster.count - r) < 20 &&
        Math.abs(cluster.g / cluster.count - g) < 20 &&
        Math.abs(cluster.b / cluster.count - b) < 20
    )
    if (near) {
      near.r += r * bucket.count
      near.g += g * bucket.count
      near.b += b * bucket.count
      near.count += bucket.count
    } else {
      clusters.push({ r: r * bucket.count, g: g * bucket.count, b: b * bucket.count, count: bucket.count })
    }
    if (clusters.length > 48 && bucket.count < visible * 0.002) break
  }
  return clusters
    .map((cluster) => {
      const r = cluster.r / cluster.count
      const g = cluster.g / cluster.count
      const b = cluster.b / cluster.count
      return { hex: hex(r, g, b), r, g, b, share: visible > 0 ? cluster.count / visible : 0 }
    })
    .sort((left, right) => right.share - left.share)
    .slice(0, limit)
}

/* --------------------------------- maps ---------------------------------- */

const LUMA_RAMP = ['@', '#', '*', '+', '=', '-', ':', '.', ' ']

function buildMaps(sample: Sample, columns: number): { alphaMap: string[]; lumaMap: string[] } {
  const rows = Math.max(6, Math.min(20, Math.round((columns * sample.height) / sample.width)))
  // Combine both dimensions, otherwise a 1:5 picture gets unreadably tall.
  const cols = columns
  const cellWidth = sample.width / cols
  const cellHeight = sample.height / rows
  const alphaMap: string[] = []
  const lumaMap: string[] = []

  for (let row = 0; row < rows; row += 1) {
    let alphaLine = ''
    let lumaLine = ''
    for (let col = 0; col < cols; col += 1) {
      const x0 = Math.floor(col * cellWidth)
      const x1 = Math.max(x0 + 1, Math.floor((col + 1) * cellWidth))
      const y0 = Math.floor(row * cellHeight)
      const y1 = Math.max(y0 + 1, Math.floor((row + 1) * cellHeight))
      let alpha = 0
      let value = 0
      let count = 0
      for (let y = y0; y < y1 && y < sample.height; y += 1) {
        for (let x = x0; x < x1 && x < sample.width; x += 1) {
          const index = y * sample.width + x
          alpha += sample.a[index]
          value += sample.luma[index]
          count += 1
        }
      }
      const averageAlpha = count > 0 ? alpha / count : 0
      const averageLuma = count > 0 ? value / count : 0
      alphaLine += averageAlpha < 24 ? ' ' : averageAlpha < 200 ? '+' : '#'
      const step = Math.min(LUMA_RAMP.length - 1, Math.floor((averageLuma / 256) * LUMA_RAMP.length))
      lumaLine += averageAlpha < 24 ? ' ' : LUMA_RAMP[step]
    }
    alphaMap.push(alphaLine)
    lumaMap.push(lumaLine)
  }
  return { alphaMap, lumaMap }
}

/* ------------------------------- the engine ------------------------------ */

export function analysePixels(image: RgbaImage): ImageAnalysis {
  const { width, height, data } = image
  if (width < 1 || height < 1 || data.length < width * height * 4) {
    throw new Error('image pixels are incomplete')
  }
  // A large picture is analysed on a downscaled preview, but every size the
  // caller sees must be the size of the real file: a 4000px photo is not a
  // 1600px photo just because decoding was capped.
  const sourceWidth = image.sourceWidth && image.sourceWidth >= width ? image.sourceWidth : width
  const sourceHeight = image.sourceHeight && image.sourceHeight >= height ? image.sourceHeight : height
  const scaleX = sourceWidth / width
  const scaleY = sourceHeight / height
  const sample = sampleImage(image)

  // Alpha statistics and the content box use the real pixels: resizing
  // smooths transparency, and a 1-pixel transparent margin must stay visible.
  let transparent = 0
  let visible = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4
    for (let x = 0; x < width; x += 1) {
      const alpha = data[row + x * 4 + 3]
      if (alpha < 16) {
        transparent += 1
        continue
      }
      visible += 1
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  const total = width * height
  const transparentShare = total > 0 ? transparent / total : 0
  const hasAlpha = transparentShare > 0.002
  const content: ContentBox | null =
    maxX >= minX && maxY >= minY
      ? {
          x: Math.round(minX * scaleX),
          y: Math.round(minY * scaleY),
          width: Math.max(1, Math.round((maxX - minX + 1) * scaleX)),
          height: Math.max(1, Math.round((maxY - minY + 1) * scaleY)),
          margins: {
            left: (minX / width) * 100,
            right: ((width - 1 - maxX) / width) * 100,
            top: (minY / height) * 100,
            bottom: ((height - 1 - maxY) / height) * 100
          }
        }
      : null

  // Luminance histogram over visible pixels.
  const histogram = new Uint32Array(256)
  let lumaSum = 0
  let lumaSquared = 0
  let saturationSum = 0
  let counted = 0
  for (let index = 0; index < sample.luma.length; index += 1) {
    if (sample.a[index] < 16) continue
    const value = sample.luma[index]
    histogram[Math.min(255, Math.round(value))] += 1
    lumaSum += value
    lumaSquared += value * value
    const r = sample.r[index]
    const g = sample.g[index]
    const b = sample.b[index]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    saturationSum += max > 0 ? (max - min) / max : 0
    counted += 1
  }
  const mean = counted > 0 ? lumaSum / counted : 0
  const variance = counted > 0 ? Math.max(0, lumaSquared / counted - mean * mean) : 0
  const contrast = Math.sqrt(variance)
  const saturation = counted > 0 ? saturationSum / counted : 0
  const palette = buildPalette(sample, 12)
  const average: DominantColor = {
    hex: hex(
      counted > 0 ? sample.r.reduce((sum, value, index) => (sample.a[index] >= 16 ? sum + value : sum), 0) / Math.max(1, counted) : 0,
      counted > 0 ? sample.g.reduce((sum, value, index) => (sample.a[index] >= 16 ? sum + value : sum), 0) / Math.max(1, counted) : 0,
      counted > 0 ? sample.b.reduce((sum, value, index) => (sample.a[index] >= 16 ? sum + value : sum), 0) / Math.max(1, counted) : 0
    ),
    r: 0,
    g: 0,
    b: 0,
    share: 1
  }
  average.r = Number.parseInt(average.hex.slice(1, 3), 16)
  average.g = Number.parseInt(average.hex.slice(3, 5), 16)
  average.b = Number.parseInt(average.hex.slice(5, 7), 16)

  // Edges and local flatness on the sampled grid.
  let edgeHits = 0
  let edgeCells = 0
  let laplacianSum = 0
  let laplacianSquared = 0
  let laplacianCount = 0
  const { width: sw, height: sh, luma: lum } = sample
  const gradients = new Float32Array(sw * sh)
  for (let y = 1; y < sh - 1; y += 1) {
    for (let x = 1; x < sw - 1; x += 1) {
      const index = y * sw + x
      const gx =
        -lum[index - sw - 1] + lum[index - sw + 1] -
        2 * lum[index - 1] + 2 * lum[index + 1] -
        lum[index + sw - 1] + lum[index + sw + 1]
      const gy =
        -lum[index - sw - 1] - 2 * lum[index - sw] - lum[index - sw + 1] +
        lum[index + sw - 1] + 2 * lum[index + sw] + lum[index + sw + 1]
      const magnitude = Math.sqrt(gx * gx + gy * gy) / 4
      gradients[index] = magnitude
      edgeCells += 1
      if (magnitude > 18) edgeHits += 1
      const laplacian = lum[index - 1] + lum[index + 1] + lum[index - sw] + lum[index + sw] - 4 * lum[index]
      laplacianSum += laplacian
      laplacianSquared += laplacian * laplacian
      laplacianCount += 1
    }
  }
  const edgeDensity = edgeCells > 0 ? edgeHits / edgeCells : 0
  const laplacianMean = laplacianCount > 0 ? laplacianSum / laplacianCount : 0
  const laplacianVariance =
    laplacianCount > 0 ? Math.max(0, laplacianSquared / laplacianCount - laplacianMean * laplacianMean) : 0
  const sharpness = laplacianVariance / (255 * 255)

  // Flat blocks: a large share means panels, fills and vector art rather than
  // photographic texture.
  let flatBlocks = 0
  let blocks = 0
  const block = 8
  for (let y = 0; y + block <= sh; y += block) {
    for (let x = 0; x + block <= sw; x += block) {
      let sum = 0
      let squared = 0
      let count = 0
      for (let dy = 0; dy < block; dy += 1) {
        for (let dx = 0; dx < block; dx += 1) {
          const value = lum[(y + dy) * sw + x + dx]
          sum += value
          squared += value * value
          count += 1
        }
      }
      const sqrt = Math.sqrt(Math.max(0, squared / count - (sum / count) ** 2))
      if (sqrt < 3.2) flatBlocks += 1
      blocks += 1
    }
  }
  const flatShare = blocks > 0 ? flatBlocks / blocks : 0

  // Distinct colours (5 bits/channel) on the sample.
  const unique = new Set<number>()
  for (let index = 0; index < sample.luma.length; index += 1) {
    if (sample.a[index] < 16) continue
    unique.add(((sample.r[index] >> 3) << 10) | ((sample.g[index] >> 3) << 5) | (sample.b[index] >> 3))
  }

  const { alphaMap, lumaMap } = buildMaps(sample, 32)

  // 3×3 zones: a blind reader needs "where", not only "what".
  const zones: ImageZone[] = []
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const x0 = Math.floor((col * sw) / 3)
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * sw) / 3))
      const y0 = Math.floor((row * sh) / 3)
      const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * sh) / 3))
      let r = 0
      let g = 0
      let b = 0
      let alpha = 0
      let value = 0
      let detail = 0
      let count = 0
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const index = y * sw + x
          r += sample.r[index]
          g += sample.g[index]
          b += sample.b[index]
          alpha += sample.a[index]
          value += lum[index]
          detail += gradients[index]
          count += 1
        }
      }
      const n = Math.max(1, count)
      const zoneR = r / n
      const zoneG = g / n
      const zoneB = b / n
      zones.push({
        id: zoneName(col, row),
        hex: hex(zoneR, zoneG, zoneB),
        luminance: value / n,
        detail: Math.min(1, detail / n / 80),
        transparent: 1 - alpha / n / 255
      })
    }
  }

  const orientation =
    Math.abs(sourceWidth / sourceHeight - 1) <= 0.05
      ? 'square'
      : sourceWidth > sourceHeight
        ? 'landscape'
        : 'portrait'
  const analysis: ImageAnalysis = {
    width: sourceWidth,
    height: sourceHeight,
    aspect: sourceWidth / sourceHeight,
    orientation,
    megapixels: (sourceWidth * sourceHeight) / 1_000_000,
    transparentShare,
    hasAlpha,
    content,
    average,
    luminance: {
      mean,
      median: percentile(histogram, counted, 0.5),
      p10: percentile(histogram, counted, 0.1),
      p90: percentile(histogram, counted, 0.9),
      min: percentile(histogram, counted, 0.01),
      max: percentile(histogram, counted, 0.99)
    },
    contrast,
    saturation,
    dominant: palette.slice(0, 6),
    uniqueColors: unique.size,
    flatShare,
    edgeDensity,
    sharpness,
    classification: { kind: 'mixed image' as ImageKind, confidence: 'low' as const, evidence: [] },
    palette,
    zones,
    alphaMap,
    lumaMap,
    warnings: [] as string[]
  }

  analysis.classification = classify(analysis)
  analysis.warnings = qualityWarnings(analysis)
  return analysis
}

/* ----------------------------- interpretation ---------------------------- */

function classify(analysis: ImageAnalysis): ImageAnalysis['classification'] {
  const colours = analysis.uniqueColors
  const flat = analysis.flatShare
  const edges = analysis.edgeDensity
  const sat = analysis.saturation
  const transparent = analysis.transparentShare > 0.03
  const evidence: string[] = []
  let kind: ImageKind = 'mixed image'
  let confidence: 'low' | 'medium' | 'high' = 'low'

  if (transparent && colours < 900 && flat > 0.35) {
    kind = 'icon or logo'
    confidence = colours < 220 && edges > 0.02 ? 'high' : 'medium'
    evidence.push('transparent background', `${colours} distinct colours`, `${Math.round(flat * 100)}% flat blocks`)
  } else if (colours < 90 && edges > 0.04 && sat > 0.12) {
    kind = 'line art'
    confidence = 'medium'
    evidence.push(`${colours} distinct colours`, `${Math.round(edges * 100)}% edge pixels`)
  } else if (edges > 0.1 && flat > 0.42 && sat < 0.3) {
    kind = 'screenshot or UI'
    confidence = flat > 0.55 ? 'high' : 'medium'
    evidence.push(`${Math.round(edges * 100)}% edge pixels`, `${Math.round(flat * 100)}% flat blocks`, 'limited saturation')
  } else if (colours > 2400 && flat < 0.5 && sat > 0.08) {
    kind = 'photo'
    confidence = colours > 5000 && flat < 0.3 ? 'high' : 'medium'
    evidence.push(`${colours} distinct colours`, `${Math.round(flat * 100)}% flat blocks`, 'continuous tones')
  } else if (colours < 1200 && flat > 0.3) {
    kind = 'flat illustration'
    confidence = colours < 500 ? 'medium' : 'low'
    evidence.push(`${colours} distinct colours`, `${Math.round(flat * 100)}% flat blocks`)
  } else {
    evidence.push(`${colours} distinct colours`, `${Math.round(flat * 100)}% flat blocks`, `${Math.round(edges * 100)}% edge pixels`)
    confidence = 'low'
  }
  return { kind, confidence, evidence }
}

function qualityWarnings(analysis: ImageAnalysis): string[] {
  const warnings: string[] = []
  if (analysis.width < 64 || analysis.height < 64) {
    warnings.push('very small: scaling it up will look pixelated')
  } else if (analysis.width < 256 || analysis.height < 256) {
    warnings.push('small: check that the final placement will not need more pixels')
  }
  if (analysis.megapixels > 24) {
    warnings.push('very large: scale it down before shipping it to a web page')
  }
  if (analysis.classification.kind === 'photo' && analysis.sharpness < 0.0006 && analysis.edgeDensity < 0.07) {
    warnings.push('soft or blurred: low high-frequency detail')
  }
  if (analysis.contrast < 10) {
    warnings.push('very low contrast: it may disappear into a background')
  }
  if (analysis.hasAlpha && analysis.content) {
    const box = analysis.content
    const coverage = (box.width * box.height) / (analysis.width * analysis.height)
    if (analysis.transparentShare < 0.01 && coverage > 0.98) {
      warnings.push('an alpha channel exists, but the picture is effectively fully opaque')
    }
    if (
      analysis.transparentShare > 0.5 &&
      (box.margins.left < 1 || box.margins.right < 1 || box.margins.top < 1 || box.margins.bottom < 1)
    ) {
      warnings.push('the subject touches an edge: cropping or padding may clip it')
    }
  }
  if (analysis.orientation === 'portrait' && analysis.aspect < 0.4) {
    warnings.push('extremely tall and narrow')
  }
  if (analysis.orientation === 'landscape' && analysis.aspect > 2.6) {
    warnings.push('extremely wide and short')
  }
  return warnings
}

/* ------------------------------ expectations ----------------------------- */

const KIND_ALIASES: Record<NonNullable<ImageExpectation['kind']>, ImageKind[]> = {
  photo: ['photo', 'mixed image'],
  illustration: ['flat illustration', 'line art', 'mixed image'],
  icon: ['icon or logo', 'line art'],
  screenshot: ['screenshot or UI', 'mixed image'],
  'line-art': ['line art']
}

function orientationOf(width: number, height: number): 'square' | 'portrait' | 'landscape' {
  const ratio = width / height
  if (Math.abs(ratio - 1) <= 0.08) return 'square'
  return ratio > 1 ? 'landscape' : 'portrait'
}

export function checkExpectations(analysis: ImageAnalysis, expect: ImageExpectation): ImageVerdict {
  const checks: ImageCheck[] = []
  const add = (label: string, ok: boolean, expected: string, actual: string): void => {
    checks.push({ label, ok, expected, actual })
  }
  if (expect.minWidth !== undefined) {
    add('width', analysis.width >= expect.minWidth, `at least ${expect.minWidth}px`, `${analysis.width}px`)
  }
  if (expect.minHeight !== undefined) {
    add('height', analysis.height >= expect.minHeight, `at least ${expect.minHeight}px`, `${analysis.height}px`)
  }
  if (expect.maxWidth !== undefined) {
    add('width', analysis.width <= expect.maxWidth, `at most ${expect.maxWidth}px`, `${analysis.width}px`)
  }
  if (expect.maxHeight !== undefined) {
    add('height', analysis.height <= expect.maxHeight, `at most ${expect.maxHeight}px`, `${analysis.height}px`)
  }
  if (expect.orientation) {
    const actual = orientationOf(analysis.width, analysis.height)
    add('orientation', actual === expect.orientation, expect.orientation, actual)
  }
  if (expect.transparent === true) {
    add('transparency', analysis.transparentShare > 0.03, 'transparent background', `${Math.round(analysis.transparentShare * 100)}% transparent`)
  } else if (expect.transparent === false) {
    add('transparency', analysis.transparentShare <= 0.03, 'opaque background', `${Math.round(analysis.transparentShare * 100)}% transparent`)
  }
  if (expect.brightness) {
    const actual = analysis.luminance.mean >= 150 ? 'light' : analysis.luminance.mean <= 105 ? 'dark' : 'mid'
    add('brightness', actual === expect.brightness, expect.brightness, `${actual} (${Math.round(analysis.luminance.mean)}/255)`)
  }
  if (expect.minContrast !== undefined) {
    add('contrast', analysis.contrast >= expect.minContrast, `at least ${expect.minContrast}`, analysis.contrast.toFixed(1))
  }
  if (expect.minDetail !== undefined) {
    add('detail', analysis.edgeDensity >= expect.minDetail, `at least ${expect.minDetail}`, analysis.edgeDensity.toFixed(3))
  }
  if (expect.kind) {
    const accepted = KIND_ALIASES[expect.kind]
    add('type', accepted.includes(analysis.classification.kind), expect.kind, analysis.classification.kind)
  }
  return {
    fits: checks.every((check) => check.ok),
    checks,
    unverifiable: [
      'what the picture actually shows (needs a vision model, not pixels)',
      'any text written in it (needs OCR or a vision model)',
      'where it came from and whether its licence allows this use'
    ]
  }
}

/* --------------------------------- report -------------------------------- */

const lumaWord = (value: number): string => (value >= 200 ? 'very light' : value >= 150 ? 'light' : value >= 105 ? 'mid' : value >= 55 ? 'dark' : 'very dark')
const contrastWord = (value: number): string => (value >= 55 ? 'high' : value >= 28 ? 'moderate' : value >= 14 ? 'low' : 'very low')

function percent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`
}

function mapBlock(title: string, lines: string[], legend: string): string[] {
  if (lines.length === 0) return []
  return [title, '```', ...lines, '```', legend]
}

export interface ReportOptions {
  /** Path or URL shown in the heading. */
  source?: string
  /** Bytes on disk, when known. */
  bytes?: number
  /** File type as the file system sees it (PNG, JPEG, SVG…). */
  format?: string
  /** `brief` keeps the maps and the palette; `full` adds zones and percentiles. */
  detail?: 'brief' | 'full'
  /** Optional check list produced by checkExpectations. */
  verdict?: ImageVerdict
  /** Caption from a vision helper, when one is configured. */
  caption?: string
  /** Why the caption is missing, when it was requested but failed. */
  captionNote?: string
}

export function formatBytesShort(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/** The text a model can actually reason about. */
export function formatImageReport(analysis: ImageAnalysis, options: ReportOptions = {}): string {
  const detail = options.detail ?? 'full'
  const lines: string[] = []
  const size = `${analysis.width}×${analysis.height} (${analysis.orientation}, ${analysis.aspect.toFixed(2)}:1)`
  const bytes = options.bytes !== undefined ? `, ${formatBytesShort(options.bytes)}` : ''
  lines.push(`Picture: ${options.source ? `${options.source} — ` : ''}${options.format ?? 'image'}, ${size}${bytes}`)
  lines.push(
    `Likely type: ${analysis.classification.kind} (${analysis.classification.confidence} confidence) — ${analysis.classification.evidence.join(', ')}`
  )
  const background = analysis.hasAlpha
    ? `${percent(analysis.transparentShare)} fully transparent`
    : 'fully opaque, no transparent background'
  lines.push(`Background: ${background}.`)
  if (analysis.content) {
    const box = analysis.content
    const margins = box.margins
    lines.push(
      `Content box: ${box.width}×${box.height} at x=${box.x}, y=${box.y}; margins L${margins.left.toFixed(0)}% R${margins.right.toFixed(0)}% T${margins.top.toFixed(0)}% B${margins.bottom.toFixed(0)}%.`
    )
  }
  const palette = analysis.dominant
    .map((colour) => `${colour.hex} ${colorName(colour.r, colour.g, colour.b)} ${percent(colour.share)}`)
    .join(', ')
  if (palette.length > 0) lines.push(`Palette: ${palette}.`)
  lines.push(
    `Tone: ${lumaWord(analysis.luminance.mean)} (mean luma ${Math.round(analysis.luminance.mean)}/255), ${contrastWord(analysis.contrast)} contrast (${analysis.contrast.toFixed(1)}), saturation ${percent(analysis.saturation)}.`
  )
  const sharp =
    analysis.classification.kind === 'photo'
      ? `, sharpness ${analysis.sharpness.toFixed(4)}${analysis.warnings.some((warning) => warning.startsWith('soft')) ? ' — soft' : ''}`
      : ''
  lines.push(`Detail: ${percent(analysis.edgeDensity, 1)} of pixels on edges, ${percent(analysis.flatShare)} flat areas${sharp}.`)

  if (analysis.hasAlpha) {
    lines.push('')
    lines.push(
      ...mapBlock(
        'Transparency silhouette (# opaque, + partial, space transparent):',
        analysis.alphaMap,
        'Each character is one cell; rows are top to bottom.'
      )
    )
  }
  lines.push('')
  lines.push(
    ...mapBlock(
      'Lightness map (@ darkest, space lightest):',
      analysis.lumaMap,
      'Use it for composition: where the subject sits, which side is heavy, whether the frame is balanced.'
    )
  )

  if (detail === 'full') {
    lines.push('')
    lines.push('Zones (3×3):')
    for (const zone of analysis.zones) {
      lines.push(
        `- ${zone.id}: ${zone.hex} ${colorName(Number.parseInt(zone.hex.slice(1, 3), 16), Number.parseInt(zone.hex.slice(3, 5), 16), Number.parseInt(zone.hex.slice(5, 7), 16))}, ${lumaWord(zone.luminance)}, detail ${percent(zone.detail)}, transparent ${percent(zone.transparent)}`
      )
    }
    lines.push(
      `Luminance spread: p10 ${analysis.luminance.p10}, median ${analysis.luminance.median}, p90 ${analysis.luminance.p90}; ${analysis.uniqueColors} distinct colours in the sample.`
    )
  }

  if (analysis.warnings.length > 0) {
    lines.push('')
    lines.push('Quality notes:')
    for (const warning of analysis.warnings) lines.push(`- ${warning}`)
  }

  if (options.verdict) {
    lines.push('')
    lines.push(`Fit check: ${options.verdict.fits ? 'PASS' : 'FAIL'}`)
    for (const check of options.verdict.checks) {
      lines.push(`- ${check.ok ? 'ok' : 'NO'} ${check.label}: expected ${check.expected}, got ${check.actual}`)
    }
  }

  if (options.caption) {
    lines.push('')
    lines.push('What a vision model sees:')
    lines.push(options.caption.trim())
  } else if (options.captionNote) {
    lines.push('')
    lines.push(`Vision caption: ${options.captionNote}`)
  }

  lines.push('')
  lines.push(
    'Limits of this report: pixels show size, transparency, palette, composition, tone and sharpness — not the subject’s identity or any text. It cannot confirm that the picture shows what you asked for; use a vision caption for that, and check the licence.'
  )
  return lines.join('\n')
}

/** A compact version for automatic attachment analysis: no maps unless useful. */
export function formatImageSummary(analysis: ImageAnalysis, options: ReportOptions = {}): string {
  const palette = analysis.dominant
    .slice(0, 4)
    .map((colour) => `${colour.hex} ${colorName(colour.r, colour.g, colour.b)} ${percent(colour.share)}`)
    .join(', ')
  const lines = [
    `Picture${options.source ? ` ${options.source}` : ''}: ${analysis.width}×${analysis.height} (${analysis.orientation}), ${options.format ?? 'image'}${options.bytes !== undefined ? `, ${formatBytesShort(options.bytes)}` : ''}.`,
    `Likely ${analysis.classification.kind} (${analysis.classification.confidence}). ${analysis.hasAlpha ? `${percent(analysis.transparentShare)} transparent background.` : 'Opaque background.'} Palette: ${palette || 'none'}.`,
    `Tone: ${lumaWord(analysis.luminance.mean)}, ${contrastWord(analysis.contrast)} contrast, ${percent(analysis.saturation)} saturation; edges ${percent(analysis.edgeDensity, 1)}, flat areas ${percent(analysis.flatShare)}.`,
    analysis.warnings.length > 0 ? `Quality: ${analysis.warnings.join('; ')}.` : 'Quality: no obvious pixel-level problems.'
  ]
  if (options.caption) lines.push(`Vision caption: ${options.caption}`)
  else if (options.captionNote) lines.push(`Vision caption: ${options.captionNote}`)
  lines.push('Pixel facts cannot confirm the subject identity or text.')
  return lines.join('\n')
}
