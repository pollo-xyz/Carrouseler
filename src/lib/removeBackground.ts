/**
 * Thin wrapper over @imgly/background-removal so the rest of the codebase
 * doesn't have to know about the package's specifics.
 *
 * On first call the package downloads ONNX model weights (~30 MB for the
 * default `isnet_fp16` model) from a CDN and caches them in IndexedDB —
 * subsequent calls run fully offline. All inference happens locally via
 * onnxruntime-web (WASM today, WebGPU on supported machines). No bytes
 * leave the user's machine.
 */
import {
  removeBackground as imglyRemoveBackground,
  type Config,
} from '@imgly/background-removal'

export interface RemoveBgProgress {
  /** Identifier of the current phase ("fetch:model", "compute:inference", …). */
  phase: string
  /** Bytes-or-units processed for this phase. */
  loaded: number
  /** Total bytes-or-units for this phase. */
  total: number
}

export type RemoveBgMode = 'photo' | 'illustration'

export interface RemoveBgOptions {
  /** Optional progress callback fired several times during a single removal. */
  onProgress?: (p: RemoveBgProgress) => void
  /** Quality / size trade-off. fp16 is a good default (smaller download than
   *  `isnet`, much better quality than `isnet_quint8`). */
  model?: 'isnet' | 'isnet_fp16' | 'isnet_quint8'
  /**
   * Tuning preset.
   *   • `'photo'` — leaves the model output as-is (smooth soft edges).
   *     Right for photographs where hair / fur / soft borders matter.
   *   • `'illustration'` — uses the full-precision `isnet` model and applies
   *     a hard alpha threshold + 1-pixel erode to the result, so flat-art
   *     edges come back crisp instead of the slightly-feathered look you
   *     get from the soft mask.
   */
  mode?: RemoveBgMode
  /** Alpha threshold for illustration mode, 0-255. Pixels with alpha below
   *  this become fully transparent; pixels at or above become fully opaque.
   *  Default 128 (half-bright). Lower values keep more semi-transparent
   *  pixels; higher values cut more aggressively. */
  alphaThreshold?: number
}

/**
 * Returns a new PNG-encoded Blob with the background removed. The image
 * dimensions are preserved; only the background pixels become transparent.
 *
 * In `illustration` mode we run the larger `isnet` model and then post-
 * process the alpha channel to make edges hard — a much better fit for
 * flat-art / vector-style images where the model's soft mask looks fuzzy.
 */
export async function removeBackground(
  source: Blob | string,
  options: RemoveBgOptions = {},
): Promise<Blob> {
  const mode = options.mode ?? 'photo'
  const config: Config = {
    model: options.model ?? (mode === 'illustration' ? 'isnet' : 'isnet_fp16'),
    output: { format: 'image/png' },
  }
  if (options.onProgress) {
    config.progress = (phase, loaded, total) => {
      options.onProgress!({ phase, loaded, total })
    }
  }
  const raw = await imglyRemoveBackground(source, config)
  if (mode !== 'illustration') return raw
  return hardenAlpha(raw, options.alphaThreshold ?? 128)
}

/**
 * Threshold the alpha channel of a PNG blob to hard 0 / 255 and erode the
 * remaining mask by 1 pixel (4-connected). The erode pass kills the typical
 * 1-pixel halo that's left over when a soft model mask gets binarised, so
 * edges look like cut-out illustrations instead of feathered photos.
 */
async function hardenAlpha(input: Blob, threshold: number): Promise<Blob> {
  // Decode → canvas
  const bitmap = await createImageBitmap(input)
  const w = bitmap.width
  const h = bitmap.height
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h })
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return input
  }
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  const img = ctx.getImageData(0, 0, w, h)
  const px = img.data
  // Pass 1: threshold every alpha byte.
  for (let i = 3; i < px.length; i += 4) {
    px[i] = px[i]! >= threshold ? 255 : 0
  }
  // Pass 2: 1-pixel erode. A pixel stays opaque only if all four of its
  // direct neighbours were already opaque after the threshold; otherwise it
  // becomes transparent. Skips the image border (rows 0/h-1, cols 0/w-1) so
  // we don't read out of bounds.
  const out = new Uint8ClampedArray(px.length)
  out.set(px)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4 + 3
      if (px[i] === 0) continue
      const up = px[i - w * 4]!
      const dn = px[i + w * 4]!
      const lt = px[i - 4]!
      const rt = px[i + 4]!
      if (up === 0 || dn === 0 || lt === 0 || rt === 0) out[i] = 0
    }
  }
  ctx.putImageData(new ImageData(out, w, h), 0, 0)

  // Re-encode → blob
  if ('convertToBlob' in canvas) {
    return (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' })
  }
  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('canvas.toBlob returned null'))
    }, 'image/png')
  })
}
