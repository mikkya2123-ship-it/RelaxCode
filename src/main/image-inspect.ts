import { nativeImage } from 'electron'
import type { RgbaImage } from '../shared/image-analysis.ts'

/**
 * Turns encoded picture bytes into the RGBA pixels the analysis module reads.
 *
 * Electron already ships a decoder, so no image library is added. Very large
 * pictures are downscaled first: the analysis samples at most 320 px anyway,
 * and a 6000×4000 bitmap would cost 96 MB of memory for no extra detail.
 */

const MAX_ANALYSIS_DIM = 1600

export function decodeImageBuffer(buffer: Buffer): RgbaImage | null {
  try {
    let image = nativeImage.createFromBuffer(buffer)
    if (image.isEmpty()) return null

    const size = image.getSize()
    if (size.width <= 0 || size.height <= 0) return null
    const longest = Math.max(size.width, size.height)
    if (longest > MAX_ANALYSIS_DIM) {
      const scale = MAX_ANALYSIS_DIM / longest
      image = image.resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
        quality: 'good'
      })
    }

    const final = image.getSize()
    const bgra = image.toBitmap()
    if (bgra.length < final.width * final.height * 4) return null

    // nativeImage hands back BGRA on every platform.
    const data = new Uint8Array(final.width * final.height * 4)
    for (let index = 0; index < data.length; index += 4) {
      data[index] = bgra[index + 2]!
      data[index + 1] = bgra[index + 1]!
      data[index + 2] = bgra[index]!
      data[index + 3] = bgra[index + 3]!
    }
    return {
      width: final.width,
      height: final.height,
      data,
      sourceWidth: size.width,
      sourceHeight: size.height
    }
  } catch {
    return null
  }
}
