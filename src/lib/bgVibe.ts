/**
 * Background "vibe" — a blurred mesh of color blobs with optional grain.
 *
 * Technique mirrors blur-self-gamma.vercel.app:
 *  - Each color point is a soft, irregular polygon blob (9 vertices jittered
 *    by seeded noise) painted with a multi-stop radial gradient.
 *  - `ctx.filter = 'blur(...)'` is applied per blob, scaled relative to a
 *    640 px reference width so the look is consistent across slide sizes.
 *  - Grain is per-pixel ImageData generated fresh each render → no tiling
 *    artifacts, looks like real film grain.
 *
 * Output is an HTMLCanvasElement that Konva paints directly, so live preview
 * and PNG/MP4 export are pixel-identical.
 */

export interface BgVibe {
  /** 2–8 hex colors. palette[0] is the base wash — it fills the canvas
   *  before any blobs are drawn AND is the colour of the first blob, which
   *  is always painted first (back layer). */
  palette: string[]
  /** 3–8 inclusive. */
  pointCount: number
  /** Deterministic seed for point positions. */
  seed: number
  /** 0–200. Mapped to blur(px) ∝ canvas width. */
  blur: number
  /** 0–1. Grain strength (alpha multiplier). */
  grain: number
  /** Global multiplier on point/blob radius. 1.0 = original baseR (matches
   *  BLUR's default). Composes with `randomSize` — that toggle layers a
   *  per-point variation (0.55×–1.45×) on top of this macro scale, so
   *  Size=2 with Randomize size on gives points ranging ~1.1×–2.9× of the
   *  original baseR. Optional for backwards compatibility with vibes saved
   *  before this field existed; missing = 1.0. */
  size?: number
  /** Deprecated. Kept optional so older `.vpost` files that wrote this field
   *  still parse — the renderer now derives the base wash from palette[0]. */
  bgColor?: string
  /** When true, each blob gets a per-point seeded size multiplier (0.6×–1.4×)
   *  for varied scale across the composition. Off = uniform radius. */
  randomSize?: boolean
  /** When true, blobs 1..N are painted in a seed-shuffled order. Blob 0
   *  (palette[0]) is always painted first so the base colour stays at the
   *  back of the layer stack. */
  randomLayer?: boolean
}

/** Named palettes lifted from blur-self-gamma.vercel.app — credit to that
 *  project for the curation. Each is 5–6 hex colors. */
export const NAMED_PALETTES: { name: string; colors: string[] }[] = [
  { name: 'Peach',    colors: ['#ee9e81', '#FF6B35', '#ec9db1', '#FFBE0B', '#f39468', '#ecd5cb'] },
  { name: 'Sunset',   colors: ['#FF4500', '#FF6B35', '#FF006E', '#FFBE0B', '#FB5607'] },
  { name: 'Ocean',    colors: ['#03045E', '#0077B6', '#00B4D8', '#90E0EF', '#48CAE4'] },
  { name: 'Clay',     colors: ['#C9A882', '#B8896A', '#8B6F5E', '#D4B89A', '#A0785A'] },
  { name: 'Stone',    colors: ['#9EA7A0', '#7D8C84', '#B3BCB5', '#5D6B64', '#CDD4CF'] },
  { name: 'Dusk',     colors: ['#7B6FA0', '#A08090', '#C0A0B0', '#806080', '#503060'] },
  { name: 'Sage',     colors: ['#87A47A', '#6B8C5E', '#A8C49A', '#4E7043', '#C4D8BC'] },
  { name: 'Wildfire', colors: ['#E63946', '#F4A261', '#E9C46A', '#2A9D8F', '#264653'] },
  { name: 'Midnight', colors: ['#10002B', '#3C096C', '#7B2FBE', '#C77DFF', '#E0AAFF'] },
]

/** Backwards-compatible alias for the panel's quick-pick row. */
export const DEFAULT_PALETTES: string[][] = NAMED_PALETTES.map((p) => p.colors)

/** Logical reference width used by blur/size scaling. Matches BLUR's CW so
 *  blur(90) at 1080-wide produces roughly the same softness as on their site. */
const REF_WIDTH = 640

/**
 * Performance flag — flip to `false` to revert to the original per-render
 * full-resolution grain (1.46 M pixels of fresh `Math.random()` per slide
 * per render). Keep this knob in source so you can A/B the optimised path
 * against the original for visual comparison without touching anything else.
 *
 * When true:
 *   - Grain is generated at half resolution and `drawImage`-stretched to the
 *     target. ~4× cheaper.
 *   - The grain canvas is keyed by (w, h, seed, grain) and cached, so the
 *     common slider-drag / colour-picker case is a single `drawImage` call.
 *   - PRNG is mulberry32 seeded from `vibe.seed` so the grain is deterministic
 *     given the cache key (and therefore safe to reuse).
 */
const GRAIN_OPTIMISED = false

/* Cached half-res grain canvases keyed by `${w}x${h}|${seed}|${grain}`.
 * Entries are evicted FIFO once the cap is hit — 32 is overkill for typical
 * projects (one or two slide sizes; one seed per slide) and still well under
 * 50 MB of total canvas memory at half-res. */
const grainCache = new Map<string, HTMLCanvasElement>()
const GRAIN_CACHE_MAX = 32

/** mulberry32 — tiny deterministic PRNG. Same seed → same sequence, which is
 *  what makes the grain canvas cacheable. */
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

function getCachedGrainCanvas(w: number, h: number, vibe: BgVibe): HTMLCanvasElement {
  const key = `${w}x${h}|${vibe.seed}|${vibe.grain.toFixed(3)}`
  const hit = grainCache.get(key)
  if (hit) {
    // Touch — re-insert to move to the end so FIFO eviction approximates LRU.
    grainCache.delete(key)
    grainCache.set(key, hit)
    return hit
  }

  // Half-res: each grain pixel becomes a 2×2 output footprint after the
  // drawImage stretch, which reads as slightly coarser film grain. Pure
  // throughput win because we generate ~4× fewer pixel values.
  const hw = Math.max(2, Math.floor(w / 2))
  const hh = Math.max(2, Math.floor(h / 2))
  const c = document.createElement('canvas')
  c.width = hw
  c.height = hh
  const ctx = c.getContext('2d')!
  const id = ctx.createImageData(hw, hh)
  const d = id.data
  const g2 = Math.min(1, vibe.grain)
  const alpha = Math.round(g2 * 75)
  const range = 255 * g2 * 0.55
  const rnd = mulberry32(vibe.seed * 1597 + 4099)
  for (let i = 0; i < d.length; i += 4) {
    const v = 128 + (rnd() - 0.5) * range
    d[i] = v
    d[i + 1] = v
    d[i + 2] = v
    d[i + 3] = alpha
  }
  ctx.putImageData(id, 0, 0)

  grainCache.set(key, c)
  if (grainCache.size > GRAIN_CACHE_MAX) {
    const oldest = grainCache.keys().next().value
    if (oldest) grainCache.delete(oldest)
  }
  return c
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 99999)
}

export function defaultBgVibe(): BgVibe {
  const idx = Math.floor(Math.random() * NAMED_PALETTES.length)
  const p = NAMED_PALETTES[idx]!
  return {
    palette: [...p.colors],
    pointCount: Math.min(6, p.colors.length),
    seed: randomSeed(),
    blur: 30,
    grain: 0.16,
    size: 1,
    randomSize: false,
    randomLayer: false,
  }
}

/** Seeded random — same one-liner BLUR uses. Cheap and deterministic enough
 *  for point placement. */
function sr(s: number): number {
  const x = Math.sin(s + 1) * 14159.27
  return x - Math.floor(x)
}

function hexRgb(h: string): [number, number, number] {
  const s = (h || '#888888').replace('#', '')
  if (s.length !== 6) return [136, 136, 136]
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}

/** Point positions in normalized [0,1] coords; one color per point cycling
 *  through the palette. Layout mirrors BLUR's `0.08 + sr(...)*0.84` so the
 *  blobs stay inside a small margin. */
export function bgVibePoints(vibe: BgVibe): { x: number; y: number; color: string }[] {
  const n = Math.max(2, Math.min(8, vibe.pointCount))
  const seed = vibe.seed
  const pts: { x: number; y: number; color: string }[] = []
  for (let i = 0; i < n; i++) {
    pts.push({
      x: 0.08 + sr(seed * 11 + i * 17) * 0.84,
      y: 0.08 + sr(seed * 7 + i * 23) * 0.84,
      color: vibe.palette[i % Math.max(1, vibe.palette.length)] || '#888888',
    })
  }
  return pts
}

/**
 * Render a vibe into `target`, sized to (w, h).
 *
 * Pipeline:
 *  1. Draw blobs onto an internal low-res canvas (short side ≈ 480 px) for
 *     speed — the heavy per-blob filter-blur dominates cost at full res.
 *  2. Upscale to (w, h). Bilinear interpolation softens minor low-res artifacts.
 *  3. Generate per-pixel ImageData grain at full output res — no tiling. This
 *     is the expensive pass (~30 ms at 1080×1350) but only runs when the
 *     vibe params actually change.
 */
export function renderBgVibe(
  target: HTMLCanvasElement,
  vibe: BgVibe,
  w: number,
  h: number,
  opts: { dither?: boolean } = {},
): void {
  target.width = w
  target.height = h
  const ctx = target.getContext('2d')
  if (!ctx) return

  // Internal canvas — 480 px short side keeps the blur cost low without
  // losing visual fidelity (output upscale blurs further).
  const SHORT_TARGET = 480
  const scale = SHORT_TARGET / Math.max(1, Math.min(w, h))
  const iw = Math.max(64, Math.round(w * scale))
  const ih = Math.max(64, Math.round(h * scale))
  const lo = document.createElement('canvas')
  lo.width = iw
  lo.height = ih
  const lctx = lo.getContext('2d')
  if (!lctx) return

  // Base wash — palette[0] is canonically the background colour and is also
  // painted as the first blob below. Anything not covered by a blob (or
  // revealed as blobs fade at high blur) tints toward this.
  lctx.fillStyle = vibe.palette[0] || '#888888'
  lctx.fillRect(0, 0, iw, ih)

  const points = bgVibePoints(vibe)
  const minDim = Math.min(iw, ih)
  // BLUR uses `sizeAmt*ms/450` with sizeAmt=200 → ms/2.25. Size multiplier
  // scales the macro radius; Randomize size below layers per-point jitter
  // on top of it, so they compose naturally (Size = global, RS = local).
  const sizeMul = vibe.size ?? 1
  const baseR = (minDim * 200 * sizeMul) / 450
  // Blur scales with canvas width relative to BLUR's reference (640 px).
  const blurPx = vibe.blur * (iw / REF_WIDTH)

  // Paint order — default is palette order. With randomLayer on, blobs
  // 1..N-1 are seed-shuffled via Fisher-Yates, but blob 0 (palette[0]) is
  // anchored at the start so the base colour always sits at the back of
  // the layer stack (matches the bg wash, no visual jump on toggle).
  const order = points.map((_, i) => i)
  if (vibe.randomLayer && order.length > 2) {
    const s0 = vibe.seed * 257
    for (let i = order.length - 1; i > 1; i--) {
      const j = 1 + Math.floor(sr(s0 + i * 13) * i)
      ;[order[i], order[j]] = [order[j]!, order[i]!]
    }
  }

  for (const i of order) {
    const p = points[i]!
    const px = p.x * iw
    const py = p.y * ih
    const [r, g, b] = hexRgb(p.color)

    // Per-point size multiplier when randomSize is on. 0.55..1.45 spans enough
    // for "some are small, some are large" without making any blob vanish or
    // dominate the frame.
    const sizeMul = vibe.randomSize
      ? 0.55 + sr(vibe.seed * 53 + i * 89) * 0.9
      : 1
    const r0 = baseR * sizeMul

    lctx.save()
    lctx.filter = `blur(${blurPx}px)`

    // Multi-stop falloff — inner core stays opaque to 25 % radius then fades.
    // Matches BLUR's gradient stops; the inner plateau gives stronger color
    // saturation before the soft edge.
    const grad = lctx.createRadialGradient(px, py, 0, px, py, r0 * 1.8)
    grad.addColorStop(0,    `rgba(${r},${g},${b},1)`)
    grad.addColorStop(0.25, `rgba(${r},${g},${b},1)`)
    grad.addColorStop(0.55, `rgba(${r},${g},${b},0.72)`)
    grad.addColorStop(1,    `rgba(${r},${g},${b},0)`)

    // Organic blob: 16 jittered vertices around an ellipse. Drawn as a closed
    // quadratic-Bezier curve that passes through the midpoint between each
    // pair of adjacent vertices, using the vertices themselves as control
    // points. Same cost as straight lines (one curve segment per vertex) but
    // visually smooth — no faceting even when the blur is low. The blur pass
    // softens what little ripple remains.
    const ns = vibe.seed * 31 + i * 97
    const segs = 16
    const vx = new Float32Array(segs)
    const vy = new Float32Array(segs)
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2
      const nx = (sr(ns + s * 41) - 0.5) * 0.35
      const ny = (sr(ns + s * 67) - 0.5) * 0.35
      const rr = r0 * (1.4 + nx)
      vx[s] = px + Math.cos(a) * rr * (1 + ny * 0.3)
      vy[s] = py + Math.sin(a) * rr * (1 - nx * 0.3)
    }
    lctx.beginPath()
    // Start at the midpoint between the last vertex and the first so the
    // curve closes cleanly without a visible seam.
    let mx = (vx[segs - 1]! + vx[0]!) / 2
    let my = (vy[segs - 1]! + vy[0]!) / 2
    lctx.moveTo(mx, my)
    for (let s = 0; s < segs; s++) {
      const ns2 = (s + 1) % segs
      const nmx = (vx[s]! + vx[ns2]!) / 2
      const nmy = (vy[s]! + vy[ns2]!) / 2
      lctx.quadraticCurveTo(vx[s]!, vy[s]!, nmx, nmy)
      mx = nmx; my = nmy
    }
    lctx.closePath()
    lctx.fillStyle = grad
    lctx.fill()
    lctx.restore()
  }

  // Dither — opt-in pass to break 8-bit gradient quantization on the low-res
  // blob canvas before upscaling. Smooth radial gradients posterize to a few
  // hundred distinct values per channel; bilinear upscale then magnifies each
  // flat step into a visible contour band that shifts as blur changes. Bands
  // are only visible at large upscale ratios — specifically the wide seamless
  // strip where the same SHORT_TARGET internal canvas is stretched across
  // N slides. Single-slide rendering is band-free without this pass and
  // adding noise there only makes it look subtly worse, so the caller passes
  // `dither: true` solely for the seamless-strip path.
  if (opts.dither) {
    const did = lctx.getImageData(0, 0, iw, ih)
    const dd = did.data
    for (let p = 0; p < dd.length; p += 4) {
      const n = (Math.random() - 0.5) * 4
      dd[p] = dd[p]! + n
      dd[p + 1] = dd[p + 1]! + n
      dd[p + 2] = dd[p + 2]! + n
    }
    lctx.putImageData(did, 0, 0)
  }

  // Upscale — bilinear interp softens any residual low-res character.
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(lo, 0, 0, w, h)

  // Grain — overlay-composited noise. Two paths:
  //   GRAIN_OPTIMISED=true  → half-res, seeded PRNG, cached by (w,h,seed,grain)
  //   GRAIN_OPTIMISED=false → full-res, fresh Math.random() per render
  // Flip the constant to compare; behaviour is otherwise identical.
  if (vibe.grain > 0.001) {
    if (GRAIN_OPTIMISED) {
      const gc = getCachedGrainCanvas(w, h, vibe)
      ctx.save()
      ctx.globalCompositeOperation = 'overlay'
      // Stretch the half-res grain to fit. Bilinear interp softens the
      // 2× upscale into something visually equivalent to a coarse film grain.
      ctx.drawImage(gc, 0, 0, w, h)
      ctx.restore()
    } else {
      const g2 = Math.min(1, vibe.grain)
      const id = ctx.createImageData(w, h)
      const d = id.data
      const alpha = Math.round(g2 * 75)
      const range = 255 * g2 * 0.55
      for (let i = 0; i < d.length; i += 4) {
        const v = 128 + (Math.random() - 0.5) * range
        d[i] = v
        d[i + 1] = v
        d[i + 2] = v
        d[i + 3] = alpha
      }
      const gc = document.createElement('canvas')
      gc.width = w
      gc.height = h
      gc.getContext('2d')!.putImageData(id, 0, 0)
      ctx.save()
      ctx.globalCompositeOperation = 'overlay'
      ctx.drawImage(gc, 0, 0)
      ctx.restore()
    }
  }
}

/** Cache key — any change here invalidates the cached canvas. */
export function bgVibeHash(vibe: BgVibe, w: number, h: number, opts: { dither?: boolean } = {}): string {
  const rs = vibe.randomSize ? 1 : 0
  const rl = vibe.randomLayer ? 1 : 0
  const sz = (vibe.size ?? 1).toFixed(2)
  const d = opts.dither ? 1 : 0
  return `${w}x${h}|${vibe.seed}|${vibe.pointCount}|${vibe.blur.toFixed(2)}|${vibe.grain.toFixed(3)}|${sz}|${vibe.bgColor}|${rs}${rl}${d}|${vibe.palette.join(',')}`
}
