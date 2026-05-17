/**
 * Sample a colour palette from a media item (image, GIF, or video frame).
 *
 * Uses a small offscreen canvas (96×96), quantises pixels into 5-bit colour
 * bins, then runs weighted median-cut over those bins. The important bit is
 * "weighted": common colours keep more votes, so the palette reflects how much
 * of each colour is actually present in the selected media.
 */

import type { PlacedMedia } from '../store/useTiovivoStore'
import { videoElements } from './videoRegistry'

type RGB = [number, number, number]
type Swatch = { r: number; g: number; b: number; count: number }

/** Range and population stats for a weighted bucket. */
function bucketStats(b: Swatch[]): { range: number; channel: 'r' | 'g' | 'b'; count: number } {
  if (b.length < 2) return { range: 0, channel: 'r', count: b[0]?.count ?? 0 }
  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0
  let count = 0
  for (const p of b) {
    if (p.r < minR) minR = p.r; if (p.r > maxR) maxR = p.r
    if (p.g < minG) minG = p.g; if (p.g > maxG) maxG = p.g
    if (p.b < minB) minB = p.b; if (p.b > maxB) maxB = p.b
    count += p.count
  }
  const rR = maxR - minR, rG = maxG - minG, rB = maxB - minB
  if (rR >= rG && rR >= rB) return { range: rR, channel: 'r', count }
  if (rG >= rB) return { range: rG, channel: 'g', count }
  return { range: rB, channel: 'b', count }
}

/** Weighted priority-queue median cut.
 *
 *  The old sampler boosted saturation and split at the colour-range midpoint,
 *  which was great for preserving tiny accents but bad when the user expects
 *  "sample from media" to reflect colour amounts. This version chooses buckets
 *  by both spread and population, then splits at the weighted median so common
 *  colours occupy proportionally more of the final palette. */
function medianCut(swatches: Swatch[], k: number): { color: RGB; count: number }[] {
  if (swatches.length === 0) return []
  const buckets: Swatch[][] = [swatches.slice()]

  while (buckets.length < k) {
    let bestIdx = -1
    let bestScore = 0
    let bestChannel: 'r' | 'g' | 'b' = 'r'
    for (let i = 0; i < buckets.length; i++) {
      const { range, channel, count } = bucketStats(buckets[i]!)
      const score = range * Math.sqrt(count)
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
        bestChannel = channel
      }
    }
    if (bestIdx < 0) break

    const bucket = buckets[bestIdx]!
    bucket.sort((a, b) => a[bestChannel] - b[bestChannel])
    const total = bucket.reduce((sum, p) => sum + p.count, 0)
    const half = total / 2
    let seen = 0
    let splitAt = bucket.length >> 1
    for (let i = 0; i < bucket.length; i++) {
      seen += bucket[i]!.count
      if (seen >= half) {
        splitAt = i + 1
        break
      }
    }
    if (splitAt <= 0 || splitAt >= bucket.length) {
      splitAt = bucket.length >> 1
    }
    if (splitAt <= 0 || splitAt >= bucket.length) break
    buckets[bestIdx] = bucket.slice(0, splitAt)
    buckets.push(bucket.slice(splitAt))
  }

  return buckets.map((b) => {
    let r = 0, g = 0, bl = 0
    let count = 0
    for (const p of b) {
      r += p.r * p.count
      g += p.g * p.count
      bl += p.b * p.count
      count += p.count
    }
    const n = count || 1
    return { color: [r / n, g / n, bl / n] as RGB, count }
  }).sort((a, b) => b.count - a.count)
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/**
 * Resolve a placed media item to a drawable source. Images / GIFs are loaded
 * from their blob URL; videos are pulled from the global registry and
 * captured at their current playhead.
 */
async function getMediaSource(item: PlacedMedia): Promise<HTMLImageElement | HTMLVideoElement> {
  if (item.type === 'video') {
    const v = videoElements.get(item.id)
    if (!v) throw new Error('Video element not found for item')
    // If the video hasn't loaded enough to draw, wait briefly.
    if (v.readyState < 2) {
      await new Promise<void>((resolve, reject) => {
        const onReady = () => { v.removeEventListener('loadeddata', onReady); v.removeEventListener('error', onError); resolve() }
        const onError = () => { v.removeEventListener('loadeddata', onReady); v.removeEventListener('error', onError); reject(new Error('Video failed to load')) }
        v.addEventListener('loadeddata', onReady)
        v.addEventListener('error', onError)
      })
    }
    return v
  }
  // Image or GIF — load fresh from the blob URL. Cheap; the blob is already
  // in memory, so this is essentially a sync decode.
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image failed to load'))
    img.src = item.src
  })
}

/** mulberry32 — tiny deterministic PRNG used to subsample pixels when the
 *  caller passes a non-zero seed. Same seed → same subset → same palette. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Returns a palette of `k` hex colours sampled from the item's pixels.
 *
 * `seed` controls variation across repeat calls on the same image:
 *   - 0 (default)  → use every collected pixel; result is canonical.
 *   - >0           → seeded PRNG drops ~40% of pixels before clustering,
 *                    producing a slightly different but still principled
 *                    palette. Repeat clicks on the panel button pass an
 *                    incrementing seed so each gives a fresh attempt.
 *
 * Throws if the media can't be drawn (asset gone, permissions).
 */
export async function sampleMediaPalette(
  item: PlacedMedia,
  k: number,
  seed: number = 0,
): Promise<string[]> {
  if (item.type === 'text') throw new Error('Text items have no pixels to sample')
  const source = await getMediaSource(item)
  // 96×96 is plenty for palette extraction — the median-cut algorithm operates
  // on pixel counts in the thousands, not millions.
  const SIZE = 96
  const c = document.createElement('canvas')
  c.width = SIZE
  c.height = SIZE
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Could not create sampling canvas')
  // Draw scaled to fit so portrait/landscape are sampled uniformly.
  const srcW = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth
  const srcH = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight
  if (srcW <= 0 || srcH <= 0) throw new Error('Source has no intrinsic size')
  ctx.drawImage(source, 0, 0, SIZE, SIZE)

  // Collect non-transparent, non-near-black, non-near-white pixels so we
  // don't end up with a palette of grays from letterboxed / faded edges.
  // Pixels are quantised into 5-bit bins with counts; that keeps the sampler
  // population-weighted without ballooning memory or over-promoting accents.
  const data = ctx.getImageData(0, 0, SIZE, SIZE).data
  const bins = new Map<number, { r: number; g: number; b: number; count: number }>()
  const addPixel = (r: number, g: number, b: number) => {
    const key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3)
    const cur = bins.get(key)
    if (cur) {
      cur.r += r
      cur.g += g
      cur.b += b
      cur.count += 1
    } else {
      bins.set(key, { r, g, b, count: 1 })
    }
  }
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!
    if (a < 180) continue
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!
    const sum = r + g + b
    if (sum < 30 || sum > 720) continue

    addPixel(r, g, b)
  }

  // If filtering left us with too few pixels (silhouette / solid bg), retry
  // with all opaque pixels — better a desaturated palette than no palette.
  const usableCount = Array.from(bins.values()).reduce((sum, b) => sum + b.count, 0)
  if (usableCount < 200) {
    bins.clear()
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 180) continue
      addPixel(data[i]!, data[i + 1]!, data[i + 2]!)
    }
  }

  let swatches: Swatch[] = Array.from(bins.values()).map((b) => ({
    r: b.r / b.count,
    g: b.g / b.count,
    b: b.b / b.count,
    count: b.count,
  }))
  if (swatches.length === 0) throw new Error('No usable pixels found')

  // Seeded subsample for variety across repeat clicks. Drop ~40% of pixels
  // by reducing bin counts with a deterministic PRNG so the same seed always
  // produces the same
  // palette but successive seeds produce slightly different views of the
  // image. Skipped when seed is 0 (canonical / first-click result).
  if (seed > 0) {
    const rng = mulberry32(seed * 2654435761)
    swatches = swatches
      .map((s) => ({ ...s, count: Math.round(s.count * (0.45 + rng() * 0.35)) }))
      .filter((s) => s.count > 0)
    const kept = swatches.reduce((sum, s) => sum + s.count, 0)
    if (kept < 20) {
      throw new Error('Too few pixels survived subsampling')
    }
  }

  // Priority-queue weighted median-cut → most common colour bucket first.
  const buckets = medianCut(swatches, k)
  return buckets.map(({ color: [r, g, b] }) => rgbToHex(r, g, b))
}
