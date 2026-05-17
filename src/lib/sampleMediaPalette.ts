/**
 * Sample a colour palette from a media item (image, GIF, or video frame).
 *
 * Uses a small offscreen canvas (96×96) and a classic median-cut quantisation.
 * Median cut is the same algorithm GIMP, ImageMagick and color-thief use for
 * palette extraction — fast (no iterations), deterministic, and produces
 * visually distinct buckets without any tuning knobs.
 */

import type { PlacedMedia } from '../store/useTiovivoStore'
import { videoElements } from './videoRegistry'

type RGB = [number, number, number]

/** Range of the bucket along its widest channel. Used to pick which bucket
 *  to split next so minority-but-distinct colours (e.g. red accents on a
 *  dark blue background) survive — naïve depth-then-slice would discard
 *  those buckets in the population-weighted half. */
function bucketRange(b: RGB[]): { range: number; channel: 0 | 1 | 2 } {
  if (b.length < 2) return { range: 0, channel: 0 }
  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0
  for (const p of b) {
    if (p[0] < minR) minR = p[0]; if (p[0] > maxR) maxR = p[0]
    if (p[1] < minG) minG = p[1]; if (p[1] > maxG) maxG = p[1]
    if (p[2] < minB) minB = p[2]; if (p[2] > maxB) maxB = p[2]
  }
  const rR = maxR - minR, rG = maxG - minG, rB = maxB - minB
  if (rR >= rG && rR >= rB) return { range: rR, channel: 0 }
  if (rG >= rB) return { range: rG, channel: 1 }
  return { range: rB, channel: 2 }
}

/** Priority-queue median cut: repeatedly split the bucket with the widest
 *  remaining range until there are exactly `k` buckets.
 *
 *  Split point is the midpoint of the channel's *range* (min + max)/2, not
 *  the midpoint of the population. For bimodal distributions (a dominant
 *  population with a minority of outliers) this lands in the gap between
 *  the two clusters and isolates them in a single cut — a population
 *  median would land inside the dominant cluster, requiring many further
 *  cuts before the outliers earn their own bucket. For smooth/continuous
 *  distributions the two split points coincide, so nothing is lost on
 *  natural photos. */
function medianCut(pixels: RGB[], k: number): RGB[] {
  if (pixels.length === 0) return []
  const buckets: RGB[][] = [pixels.slice()]

  while (buckets.length < k) {
    let bestIdx = -1
    let bestRange = 0
    let bestChannel: 0 | 1 | 2 = 0
    for (let i = 0; i < buckets.length; i++) {
      const { range, channel } = bucketRange(buckets[i]!)
      if (range > bestRange) {
        bestRange = range
        bestIdx = i
        bestChannel = channel
      }
    }
    if (bestIdx < 0) break

    const bucket = buckets[bestIdx]!
    bucket.sort((a, b) => a[bestChannel] - b[bestChannel])
    const lo = bucket[0]![bestChannel]
    const hi = bucket[bucket.length - 1]![bestChannel]
    const splitVal = (lo + hi) / 2

    // Find the first pixel whose channel value crosses the split point.
    // Linear scan is fine — bucket is already sorted and we'd otherwise have
    // to allocate a binary-search closure.
    let splitAt = -1
    for (let i = 0; i < bucket.length; i++) {
      if (bucket[i]![bestChannel] >= splitVal) { splitAt = i; break }
    }
    // Degenerate cases: all pixels on one side (rare with our range math).
    // Fall back to the population midpoint so we still make progress.
    if (splitAt <= 0 || splitAt >= bucket.length) {
      splitAt = bucket.length >> 1
    }
    if (splitAt <= 0 || splitAt >= bucket.length) break
    buckets[bestIdx] = bucket.slice(0, splitAt)
    buckets.push(bucket.slice(splitAt))
  }

  return buckets.map((b) => {
    let r = 0, g = 0, bl = 0
    for (const p of b) { r += p[0]; g += p[1]; bl += p[2] }
    const n = b.length || 1
    return [r / n, g / n, bl / n] as RGB
  })
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
  // Each pixel is also given a "weight" via repetition based on its HSV
  // saturation — minority but saturated colours (e.g. red accents on a
  // dark blue background) get more votes so median-cut splits them out
  // instead of folding them into the dominant population bucket.
  const data = ctx.getImageData(0, 0, SIZE, SIZE).data
  const pixels: RGB[] = []
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!
    if (a < 180) continue
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!
    const sum = r + g + b
    if (sum < 30 || sum > 720) continue

    pixels.push([r, g, b])

    // Vibrancy boost. HSV saturation = (max - min) / max. Scales 0..1.
    // reps in [0..3], so a fully saturated pixel counts 4× vs neutral.
    // Subtle enough not to swamp natural dominance, strong enough to keep
    // accent colours alive at small k.
    const mx = r > g ? (r > b ? r : b) : (g > b ? g : b)
    const mn = r < g ? (r < b ? r : b) : (g < b ? g : b)
    const sat = mx === 0 ? 0 : (mx - mn) / mx
    const reps = Math.floor(sat * 3)
    for (let j = 0; j < reps; j++) pixels.push([r, g, b])
  }

  // If filtering left us with too few pixels (silhouette / solid bg), retry
  // with all opaque pixels — better a desaturated palette than no palette.
  if (pixels.length < 200) {
    pixels.length = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 180) continue
      pixels.push([data[i]!, data[i + 1]!, data[i + 2]!])
    }
  }
  if (pixels.length === 0) throw new Error('No usable pixels found')

  // Seeded subsample for variety across repeat clicks. Drop ~40% of pixels
  // using a deterministic PRNG so the same seed always produces the same
  // palette but successive seeds produce slightly different views of the
  // image. Skipped when seed is 0 (canonical / first-click result).
  if (seed > 0) {
    const rng = mulberry32(seed * 2654435761)
    let w = 0
    for (let i = 0; i < pixels.length; i++) {
      if (rng() < 0.6) pixels[w++] = pixels[i]!
    }
    pixels.length = w
    // Guard against losing too many pixels — rare but possible at small inputs.
    if (pixels.length < 20) {
      throw new Error('Too few pixels survived subsampling')
    }
  }

  // Priority-queue median-cut → exactly `k` buckets, no slicing afterwards.
  const buckets = medianCut(pixels, k)
  return buckets.map(([r, g, b]) => rgbToHex(r, g, b))
}
