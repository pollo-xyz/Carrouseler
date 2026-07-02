import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Arc, Circle, Ellipse, Group, Layer, Line, Rect, Stage, Transformer } from 'react-konva'
import Konva from 'konva'
import { Image as KonvaImage, Text as KonvaText } from 'react-konva'
import { useTiovivoStore, type PlacedMedia, type Slide } from '../store/useTiovivoStore'
import { useThemeStore, resolveWorkspaceBg } from '../lib/theme'
import { snapPosition, snapResize, type GuideLine } from '../lib/snapping'
import { createGifAnimator, type GifAnimator } from '../lib/gifAnimator'
import { coverImageElements, videoElements } from '../lib/videoRegistry'
import { bgVibeHash, renderBgVibe, type BgVibe } from '../lib/bgVibe'
import LayerStack from './LayerStack'

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const PASTEBOARD_PAD_BASE = 1500
const PASTEBOARD_PAD_FACTOR = 2 // pasteboard extends this × max(W,H) beyond slides
const ARTBOARD_GAP = 120
const GUIDE_COLOR = '#3366ff'
const GUIDE_COLOR_CENTER = '#3399ff'
const MIN_ZOOM = 0.02
const MAX_ZOOM = 8

/* ------------------------------------------------------------------ */
/*  useHtmlMedia                                                      */
/* ------------------------------------------------------------------ */

function useHtmlMedia(
  src: string,
  type: PlacedMedia['type'],
  itemId?: string,
): HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | null {
  const [node, setNode] = useState<HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | null>(null)
  useEffect(() => {
    // Empty src — callers (e.g. MasterGhost on a text/shape item) invoke
    // this hook unconditionally to satisfy the rules-of-hooks. Bail out
    // silently rather than firing a phantom Image() load that would log
    // a misleading "image load failed" error. No state reset needed: node
    // starts null and every loading path clears it in its effect cleanup.
    if (!src) return
    if (type === 'video') {
      const v = document.createElement('video')
      v.src = src; v.muted = true; v.playsInline = true; v.loop = true; v.preload = 'auto'
      const onReady = () => {
        setNode(v)
        if (itemId) videoElements.set(itemId, v)
      }
      // Surface load errors instead of leaving the item silently invisible.
      // Stays in dev console; UI shows the existing "no image" empty state.
      const onError = () => {
        const err = v.error
        const codeName = err
          ? { 1: 'MEDIA_ERR_ABORTED', 2: 'MEDIA_ERR_NETWORK', 3: 'MEDIA_ERR_DECODE', 4: 'MEDIA_ERR_SRC_NOT_SUPPORTED' }[err.code] ?? `code ${err.code}`
          : 'unknown'
        console.error(`[useHtmlMedia] video load failed (${codeName})`, { src, itemId, err })
      }
      v.addEventListener('loadeddata', onReady)
      v.addEventListener('error', onError)
      v.play().catch(() => {})
      return () => {
        v.removeEventListener('loadeddata', onReady)
        v.removeEventListener('error', onError)
        v.pause(); setNode(null)
        if (itemId) videoElements.delete(itemId)
      }
    }
    if (type === 'gif') {
      // Decode the GIF manually with WebCodecs and feed Konva a canvas we
      // tick through ourselves. Chromium throttles browser-driven GIF
      // playback on any offscreen / occluded / clipped <img>, and we
      // exhausted every CSS-visibility workaround without success.
      // Manual decoding sidesteps the throttle entirely.
      let animator: GifAnimator | null = null
      let cancelled = false
      void (async () => {
        animator = await createGifAnimator(src)
        if (cancelled) {
          animator?.stop()
          return
        }
        if (animator) {
          setNode(animator.canvas)
        } else {
          // ImageDecoder unavailable or decode failed — fall back to a
          // plain <img>. It'll show frame 0 statically; better than a
          // missing element entirely.
          const fallback = new window.Image()
          fallback.onload = () => { if (!cancelled) setNode(fallback) }
          fallback.onerror = () => console.error('[useHtmlMedia] gif fallback load failed', { src, itemId })
          fallback.src = src
        }
      })()
      return () => {
        cancelled = true
        animator?.stop()
        setNode(null)
      }
    }
    const img = new window.Image()
    img.onload = () => setNode(img)
    img.onerror = () => {
      console.error('[useHtmlMedia] image load failed', { src, itemId })
      setNode(null)
    }
    img.src = src
    return () => { setNode(null) }
  }, [src, type, itemId])
  return node
}


/* ------------------------------------------------------------------ */
/*  SlideBackground — flat color or generative "vibe"                 */
/* ------------------------------------------------------------------ */

/* Module-level cache, keyed by slide id. We mutate the same canvas in place
 * when the vibe hash changes — keeps the HTMLCanvasElement reference stable
 * across re-renders so Konva's image binding doesn't churn, while still
 * letting us recompute pixels when params change. Konva is told to redraw
 * via an effect keyed on the hash. */
const slideBgCanvases = new Map<string, HTMLCanvasElement>()

function SlideBackground({
  slide,
  x,
  y,
  width,
  height,
  dither = false,
}: {
  slide: Slide
  x: number
  y: number
  width: number
  height: number
  dither?: boolean
}) {
  const vibe = slide.bgVibe
  const imageRef = useRef<Konva.Image>(null)
  const lastHashRef = useRef<string>('')
  // Pending params + rAF id for the throttled-render path. While the user
  // drags a slider or scrubs in the colour picker, onChange can fire dozens
  // of times per frame — collapsing them into a single rAF re-render means
  // we do the expensive renderBgVibe pass once per frame at most.
  const pendingRef = useRef<{ vibe: BgVibe; w: number; h: number; dither: boolean } | null>(null)
  const rafIdRef = useRef<number | null>(null)
  // First mount uses a synchronous render so Konva sees a non-empty canvas
  // on its first paint (avoids a one-frame flash of nothing). Subsequent
  // updates are rAF-throttled.
  const firstRef = useRef(true)

  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const hash = vibe ? bgVibeHash(vibe, w, h, { dither }) : ''

  if (vibe) {
    let c = slideBgCanvases.get(slide.id)
    if (!c) {
      c = document.createElement('canvas')
      slideBgCanvases.set(slide.id, c)
    }

    if (hash !== lastHashRef.current) {
      if (firstRef.current) {
        // First time we've seen a vibe on this slide — render synchronously
        // so the Image isn't painted blank during React's commit phase.
        renderBgVibe(c, vibe, w, h, { dither })
        lastHashRef.current = hash
        firstRef.current = false
      } else {
        // Stash the latest params; the rAF callback re-reads from the ref
        // so multiple updates within one frame coalesce to the newest state.
        pendingRef.current = { vibe, w, h, dither }
        if (rafIdRef.current === null) {
          rafIdRef.current = requestAnimationFrame(() => {
            rafIdRef.current = null
            const latest = pendingRef.current
            const cv = slideBgCanvases.get(slide.id)
            if (!latest || !cv) return
            renderBgVibe(cv, latest.vibe, latest.w, latest.h, { dither: latest.dither })
            lastHashRef.current = bgVibeHash(latest.vibe, latest.w, latest.h, { dither: latest.dither })
            imageRef.current?.getLayer()?.batchDraw()
          })
        }
      }
    }
  } else {
    // No vibe — reset the first-mount flag so a later switch back to Vibe
    // mode gets the synchronous-render treatment again.
    firstRef.current = true
  }

  // Cancel any pending rAF if the component unmounts mid-frame, otherwise we
  // mutate a canvas that's about to be discarded (no visual issue, just waste).
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [])

  // batchDraw on first sync render so Konva picks up the freshly-painted
  // pixels. Subsequent renders trigger batchDraw inside the rAF callback.
  useEffect(() => {
    if (vibe && imageRef.current) {
      imageRef.current.getLayer()?.batchDraw()
    }
    // Only runs once per "vibe became truthy" — that's exactly when the
    // synchronous first render happened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vibe ? 1 : 0])

  if (vibe) {
    const canvas = slideBgCanvases.get(slide.id)!
    return (
      <KonvaImage
        ref={imageRef}
        x={x}
        y={y}
        width={width}
        height={height}
        image={canvas}
        listening={false}
      />
    )
  }

  return (
    <Rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill={slide.bgColor || '#ffffff'}
    />
  )
}

/* ------------------------------------------------------------------ */
/*  Custom saturation filter (Konva HSL doesn't fully desaturate)     */
/* ------------------------------------------------------------------ */

function makeSaturationFilter(amount: number) {
  // amount: 0 = grayscale, 1 = normal, 2 = oversaturated
  return function saturationFilter(imageData: ImageData) {
    const d = imageData.data
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b
      d[i] = Math.min(255, Math.max(0, gray + (r - gray) * amount))
      d[i + 1] = Math.min(255, Math.max(0, gray + (g - gray) * amount))
      d[i + 2] = Math.min(255, Math.max(0, gray + (b - gray) * amount))
    }
  }
}

/* ------------------------------------------------------------------ */
/*  MediaItemView                                                     */
/* ------------------------------------------------------------------ */

function MediaItemView({
  item,
  isCropping,
  onSelect,
  onChange,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  item: PlacedMedia
  isCropping?: boolean
  onSelect: (additive: boolean) => void
  onChange: (patch: Partial<PlacedMedia>) => void
  onDragStart: (node: Konva.Image) => void
  onDragMove: (node: Konva.Image) => void
  onDragEnd: (node: Konva.Image) => void
}) {
  const img = useHtmlMedia(item.src, item.type, item.id)
  const shapeRef = useRef<Konva.Image>(null)

  // Apply Konva filters when image loads or filter values change
  const satAmount = item.saturation ?? 1
  const hasSatChange = Math.abs(satAmount - 1) > 0.001
  const blurAmount = item.blur ?? 0
  const hasBlur = blurAmount > 0.001
  const hasFilters = item.brightness !== 0 || item.contrast !== 0 || hasSatChange || hasBlur
  const satFilter = useMemo(() => makeSaturationFilter(satAmount), [satAmount])
  const filters = useMemo(() => {
    type FilterFn = (imageData: ImageData) => void
    const f: FilterFn[] = []
    if (item.brightness !== 0) f.push(Konva.Filters.Brighten as unknown as FilterFn)
    if (item.contrast !== 0) f.push(Konva.Filters.Contrast as unknown as FilterFn)
    if (hasSatChange) f.push(satFilter as FilterFn)
    if (hasBlur) f.push(Konva.Filters.Blur as unknown as FilterFn)
    return f.length > 0 ? f : undefined
  }, [item.brightness, item.contrast, hasSatChange, satFilter, hasBlur])

  useEffect(() => {
    const node = shapeRef.current
    if (!node || !img) return
    // Videos and GIFs both animate inside their HTML element — cache is
    // managed per-frame in the animation tick below so the latest frame
    // is what gets blitted onto the Konva canvas. Static images take the
    // one-shot cache/clear path on filter changes.
    if (item.type === 'video' || item.type === 'gif') return
    if (hasFilters) {
      node.cache()
      node.getLayer()?.batchDraw()
    } else {
      node.clearCache()
      node.getLayer()?.batchDraw()
    }
  }, [img, hasFilters, item.brightness, item.contrast, item.saturation, item.blur, item.width, item.height, item.type])

  useEffect(() => {
    // Per-frame redraw loop for animated source media. Without this, GIFs
    // freeze on their first frame (Konva caches the underlying image once
    // and doesn't know the browser is advancing the GIF behind the scenes).
    // Videos already needed this for the same reason. ~0.1% of one CPU
    // core per node when idle since the browser does the actual decoding
    // — we're just calling layer.draw().
    if ((item.type !== 'video' && item.type !== 'gif') || !img) return
    const node = shapeRef.current
    const layer = node?.getLayer()
    if (!node || !layer) return
    let id: number
    let ticks = 0
    const tick = () => {
      ticks++
      // Re-cache each frame so filters apply to the current frame rather
      // than a frozen snapshot taken when filters were first enabled.
      if (hasFilters) node.cache()
      else node.clearCache()
      // .draw() is synchronous and forces a paint even when no scene-graph
      // attribute changed. .batchDraw() can skip when Konva thinks the layer
      // is clean — fine for video (whose .cache() call dirties the node)
      // but bad for un-filtered GIFs.
      layer.draw()
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    if (item.type === 'gif') {
      // Debug counter the user can poll from devtools to confirm the loop
      // is actually running:  document.querySelector('canvas')  → ok
      //   __tiovivoGifTicks ← shows current tick count
      // Increments per rAF, so a value that climbs proves the loop runs.
      ;(window as unknown as { __tiovivoGifTicks?: () => number }).__tiovivoGifTicks = () => ticks
    }
    return () => cancelAnimationFrame(id)
  }, [item.type, img, hasFilters])

  // Loop preview playback within trim window
  useEffect(() => {
    if (item.type !== 'video') return
    const v = videoElements.get(item.id)
    if (!v) return
    const onTime = () => {
      const end = item.trimEnd && item.trimEnd > 0 ? item.trimEnd : v.duration
      if (v.currentTime >= end - 0.02) v.currentTime = item.trimStart || 0
      else if (v.currentTime < (item.trimStart || 0) - 0.02) v.currentTime = item.trimStart || 0
    }
    v.addEventListener('timeupdate', onTime)
    // Reset to trimStart when bounds change
    if (v.currentTime < (item.trimStart || 0) || (item.trimEnd > 0 && v.currentTime > item.trimEnd)) {
      v.currentTime = item.trimStart || 0
    }
    return () => v.removeEventListener('timeupdate', onTime)
  }, [item.id, item.type, item.trimStart, item.trimEnd, img])

  // Load custom cover image (videos only) into the registry so the export
  // pipeline can swap it in for frame 0.
  useEffect(() => {
    if (item.type !== 'video' || !item.coverImageSrc) {
      coverImageElements.delete(item.id)
      return
    }
    const im = new window.Image()
    im.crossOrigin = 'anonymous'
    im.onload = () => coverImageElements.set(item.id, im)
    im.src = item.coverImageSrc
    return () => { coverImageElements.delete(item.id) }
  }, [item.id, item.type, item.coverImageSrc])

  if (!img) return null

  // Crop rendering
  const hasCrop = item.cropW > 0 && item.cropH > 0
  let rx = item.x, ry = item.y, rw = item.width, rh = item.height
  let cropObj: { x: number; y: number; width: number; height: number } | undefined

  if (hasCrop && !isCropping) {
    cropObj = { x: item.cropX, y: item.cropY, width: item.cropW, height: item.cropH }
  } else if (hasCrop && isCropping) {
    const sc = item.width / item.cropW
    rx = item.x - item.cropX * sc
    ry = item.y - item.cropY * sc
    rw = item.naturalWidth * sc
    rh = item.naturalHeight * sc
  }

  const flipped = !!item.flipX && !isCropping
  const flippedY = !!item.flipY && !isCropping
  return (
    <KonvaImage
      ref={shapeRef}
      id={`media-${item.id}`}
      image={img}
      x={rx} y={ry}
      width={rw} height={rh}
      rotation={isCropping ? 0 : item.rotation}
      scaleX={flipped ? -1 : 1}
      scaleY={flippedY ? -1 : 1}
      offsetX={flipped ? rw : 0}
      offsetY={flippedY ? rh : 0}
      crop={cropObj}
      name="media"
      draggable={!isCropping}
      filters={filters}
      brightness={item.brightness}
      contrast={item.contrast}
      blurRadius={blurAmount}
      onClick={(e) => {
        e.cancelBubble = true
        if (isCropping) return
        const ev = e.evt as MouseEvent | undefined
        const additive = !!(ev && (ev.shiftKey || ev.metaKey || ev.ctrlKey))
        onSelect(additive)
      }}
      onTap={(e) => { e.cancelBubble = true; if (!isCropping) onSelect(false) }}
      onDragStart={(e) => onDragStart(e.target as Konva.Image)}
      onDragMove={(e) => onDragMove(e.target as Konva.Image)}
      onDragEnd={(e) => onDragEnd(e.target as Konva.Image)}
      onTransformEnd={() => {
        const n = shapeRef.current
        if (!n) return
        const sxRaw = n.scaleX(), syRaw = n.scaleY()
        const isFlipped = sxRaw < 0
        const isFlippedY = syRaw < 0
        const sx = Math.abs(sxRaw), sy = Math.abs(syRaw)
        // Apply final width/height/scale/offset imperatively so the Transformer
        // sees correct bounds in this same frame — prevents a one-frame flash
        // where anchors show at the old size while React commits.
        const newW = Math.max(8, n.width() * sx)
        const newH = Math.max(8, n.height() * sy)
        n.width(newW)
        n.height(newH)
        n.scaleX(isFlipped ? -1 : 1)
        n.scaleY(isFlippedY ? -1 : 1)
        n.offsetX(isFlipped ? newW : 0)
        n.offsetY(isFlippedY ? newH : 0)
        onChange({
          x: n.x(), y: n.y(),
          width: newW,
          height: newH,
          rotation: n.rotation(),
          flipX: isFlipped,
          flipY: isFlippedY,
        })
      }}
    />
  )
}

/* ------------------------------------------------------------------ */
/*  TextItemView                                                      */
/* ------------------------------------------------------------------ */

function fontStyleString(bold?: boolean, italic?: boolean): string {
  if (bold && italic) return 'italic bold'
  if (bold) return 'bold'
  if (italic) return 'italic'
  return 'normal'
}

/**
 * Binary-search the largest fontSize such that wrapped text fits within
 * (boxWidth, boxHeight). Uses a detached Konva.Text for measurement — no
 * layer mutation, so callable from render.
 */
function fitFontSize(opts: {
  text: string
  fontFamily: string
  fontStyle: string
  boxWidth: number
  boxHeight: number
  lineHeight: number
  letterSpacing: number
  min?: number
  max?: number
}): number {
  if (!opts.text || opts.boxWidth <= 0 || opts.boxHeight <= 0) return opts.min ?? 4
  const measure = (size: number): number => {
    const node = new Konva.Text({
      text: opts.text,
      fontFamily: opts.fontFamily,
      fontSize: size,
      fontStyle: opts.fontStyle,
      lineHeight: opts.lineHeight,
      letterSpacing: opts.letterSpacing,
      width: opts.boxWidth,
      wrap: 'word',
    })
    const h = node.height()
    node.destroy()
    return h
  }
  let lo = opts.min ?? 4
  let hi = opts.max ?? 2000
  // 14 iterations over a 4..2000 range → sub-pixel precision, well under 1ms.
  // A measured height of 0 means a single character was wider than boxWidth,
  // so Konva couldn't lay out any line — treat as "doesn't fit" and shrink
  // the search window, otherwise the binary search runs away upward.
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2
    const h = measure(mid)
    if (h <= 0 || h > opts.boxHeight) hi = mid
    else lo = mid
  }
  return Math.max(opts.min ?? 4, Math.floor(lo))
}

/**
 * Pick line breakpoints that minimise the longest line (classic min-max DP).
 * Pure: takes per-word widths and the inter-word space width, returns the
 * line boundaries [start, end) and the maxLineWidth that resulted.
 *
 * O(n²·k) for n words into k lines — negligible for headline-sized inputs
 * (typically n < 20, k < 8). For huge bodies of text we cap k earlier.
 */
function balanceLines(
  widths: number[],
  spaceW: number,
  k: number,
): { lines: { start: number; end: number }[]; maxWidth: number } {
  const n = widths.length
  if (k <= 0 || n === 0) return { lines: [], maxWidth: 0 }
  if (k >= n) {
    // More lines than words → one word per line.
    return {
      lines: widths.map((_, i) => ({ start: i, end: i + 1 })),
      maxWidth: Math.max(...widths),
    }
  }
  // dp[ki][i] = minimax line width for packing words [i..n-1] into ki lines.
  // back[ki][i] = the breakpoint (exclusive end of the first line in that pack).
  const INF = Number.POSITIVE_INFINITY
  const dp: number[][] = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(INF))
  const back: number[][] = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(-1))
  dp[0][n] = 0
  // Single-line case (ki=1): one line takes everything from i to n.
  for (let i = 0; i < n; i++) {
    let w = 0
    for (let j = i; j < n; j++) w += widths[j]! + (j > i ? spaceW : 0)
    dp[1][i] = w
    back[1][i] = n
  }
  for (let ki = 2; ki <= k; ki++) {
    for (let i = 0; i < n; i++) {
      let w = 0
      for (let j = i + 1; j <= n; j++) {
        w += widths[j - 1]! + (j - 1 > i ? spaceW : 0)
        const rest = dp[ki - 1]![j]!
        const candidate = Math.max(w, rest)
        if (candidate < dp[ki]![i]!) {
          dp[ki]![i] = candidate
          back[ki]![i] = j
        }
      }
    }
  }
  // Reconstruct breakpoints from dp[k][0].
  const lines: { start: number; end: number }[] = []
  let i = 0
  let ki = k
  while (i < n && ki > 0) {
    const j = back[ki]![i]!
    if (j <= i) break
    lines.push({ start: i, end: j })
    i = j
    ki--
  }
  // Pad with empty entries if we asked for more lines than the DP needed.
  while (lines.length < k) lines.push({ start: n, end: n })
  return { lines, maxWidth: dp[k]![0]! }
}

/**
 * For a single line of text (no explicit `\n`), find the (lineCount, fontSize)
 * pair that maximises font size given a balanced wrap, then return the text
 * rewritten with the chosen explicit `\n` breaks.
 *
 * Word widths scale linearly with font size, so once we measure each word at
 * a reference size we can compute the largest font that lets each balanced
 * line fit in `boxWidth` and the whole block fit in `boxHeight`.
 *
 * Returns `null` to signal "fall back to greedy wrap" — used when the text
 * already contains explicit line breaks (we respect those) or has only one
 * word (nothing to balance).
 */
function fitBalancedWrap(opts: {
  text: string
  fontFamily: string
  fontStyle: string
  boxWidth: number
  boxHeight: number
  lineHeight: number
  letterSpacing: number
  min?: number
  max?: number
}): { fontSize: number; text: string } | null {
  if (!opts.text || opts.boxWidth <= 0 || opts.boxHeight <= 0) return null
  // Respect user-authored line breaks — if any exist, the user is telling us
  // exactly how they want the text laid out, so don't re-flow.
  if (/\n/.test(opts.text)) return null
  const words = opts.text.split(/\s+/).filter((w) => w.length > 0)
  if (words.length < 2) return null

  const REF = 100
  // Measure every word + a single space at the reference size. Letter-spacing
  // and font-style flow through to the measurement so the prediction matches
  // what Konva will actually draw.
  const measureRef = (text: string): number => {
    const node = new Konva.Text({
      text,
      fontFamily: opts.fontFamily,
      fontSize: REF,
      fontStyle: opts.fontStyle,
      letterSpacing: opts.letterSpacing,
    })
    const w = node.getTextWidth()
    node.destroy()
    return w
  }
  const widths = words.map(measureRef)
  // Width of a single inter-word space at the reference size. Konva renders a
  // space between adjacent words in a wrapped line, so we need it in the DP.
  const spaceW = measureRef('A B') - measureRef('A') - measureRef('B')

  const min = opts.min ?? 4
  const max = opts.max ?? 4000
  // Caps to keep the DP cheap even on long inputs. The "best k" is almost
  // always small for headline-sized text; cap at 12 lines so a paste of a
  // paragraph doesn't blow the budget.
  const maxK = Math.min(12, words.length)

  let bestSize = -1
  let bestLines: string[] | null = null
  for (let k = 1; k <= maxK; k++) {
    const { lines, maxWidth } = balanceLines(widths, spaceW, k)
    if (maxWidth <= 0) continue
    // Largest font size that fits both width and height for k lines.
    const sizeByWidth = (opts.boxWidth / maxWidth) * REF
    const sizeByHeight = opts.boxHeight / (k * opts.lineHeight)
    const size = Math.min(sizeByWidth, sizeByHeight, max)
    if (size > bestSize) {
      bestSize = size
      bestLines = lines.map(({ start, end }) => words.slice(start, end).join(' '))
    }
  }
  if (!bestLines || bestSize < min) return null
  return {
    fontSize: Math.max(min, Math.floor(bestSize)),
    text: bestLines.join('\n'),
  }
}

/** Pick a foreground stroke/grid color that contrasts with a hex bg. */
function contrastStrokeFor(bgColor: string, alpha = 0.22): string {
  const hex = (bgColor || '#ffffff').replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16) || 0
  const g = parseInt(hex.slice(2, 4), 16) || 0
  const b = parseInt(hex.slice(4, 6), 16) || 0
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 140 ? `rgba(10,11,15,${alpha})` : `rgba(241,242,245,${alpha})`
}

function TextItemView({
  item,
  isEditing,
  onSelect,
  onChange,
  onRequestEdit,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  item: PlacedMedia
  isEditing: boolean
  onSelect: (additive: boolean) => void
  onChange: (patch: Partial<PlacedMedia>) => void
  onRequestEdit: () => void
  onDragStart: (node: Konva.Text) => void
  onDragMove: (node: Konva.Text) => void
  onDragEnd: (node: Konva.Text) => void
}) {
  const shapeRef = useRef<Konva.Text>(null)
  const updateItem = useTiovivoStore((s) => s.updateItem)
  const fillMode = !!item.fillMode

  const fontStyle = fontStyleString(item.bold, item.italic)
  const lineHeight = item.lineHeight ?? 1.15
  const letterSpacing = item.letterSpacing ?? 0

  // When fill mode is on, derive fontSize from the box dimensions so the text
  // grows to fit. Off mode uses the stored fontSize as-is.
  //
  // For fillMode we prefer the balanced-wrap result over Konva's greedy wrap:
  // balanced wrap finds the line-break positions that minimise the longest
  // line, which lets a larger font fit AND produces more visually-balanced
  // lines. We fall back to greedy wrap when the user has explicit \n line
  // breaks (we don't want to override their intent), when there's only one
  // word, or when the algorithm declines (degenerate input).
  const fitted = useMemo(() => {
    if (!fillMode) return null
    return fitBalancedWrap({
      text: item.text || '',
      fontFamily: item.fontFamily || 'Inter',
      fontStyle,
      boxWidth: item.width,
      boxHeight: item.height,
      lineHeight,
      letterSpacing,
      min: 4,
      max: 4000,
    })
  }, [fillMode, item.text, item.fontFamily, fontStyle, item.width, item.height,
      lineHeight, letterSpacing])

  const renderedFontSize = useMemo(() => {
    if (!fillMode) return item.fontSize || 64
    if (fitted) return fitted.fontSize
    return fitFontSize({
      text: item.text || '',
      fontFamily: item.fontFamily || 'Inter',
      fontStyle,
      boxWidth: item.width,
      boxHeight: item.height,
      lineHeight,
      letterSpacing,
      min: 4,
      max: 4000,
    })
  }, [fillMode, fitted, item.text, item.fontFamily, fontStyle, item.width, item.height,
      lineHeight, letterSpacing, item.fontSize])

  // Text the Konva node actually draws: in fillMode, prefer the balanced
  // wrap's pre-broken text so Konva renders our chosen line breaks instead
  // of its greedy ones. Outside fillMode we always pass through the original.
  const renderedText = (fillMode && fitted) ? fitted.text : (item.text || '')

  // In off mode, the rendered text's height determines the item's height —
  // sync it back so selection / snap / transformer match what's drawn.
  // In fill mode, height is user-controlled (the target), so we don't sync.
  useEffect(() => {
    if (fillMode) return
    const n = shapeRef.current
    if (!n) return
    const measured = n.height()
    if (measured > 0 && Math.abs(measured - item.height) > 1) {
      updateItem(item.id, { height: measured })
    }
  }, [fillMode, item.id, item.text, item.fontFamily, item.fontSize, item.bold,
      item.italic, item.textAlign, item.lineHeight, item.letterSpacing,
      item.width, item.height, updateItem])

  // Optional rounded-rect background ("text pill"). The Rect sits behind the
  // text and tracks the item's bounding box with configurable padding +
  // corner radius. listening={false} so clicks pass through to the text.
  const bgPadding = item.textBgPadding ?? 0
  const hasTextBg = !!item.textBgColor && bgPadding >= 0 && (item.textBgOpacity ?? 1) > 0
  // Effect props passed to KonvaText. We omit shadow props entirely when the
  // shadow is disabled so Konva doesn't allocate a shadow pass per frame.
  const shadowProps = item.shadowEnabled
    ? {
        shadowColor: item.shadowColor || '#000000',
        shadowBlur: item.shadowBlur ?? 8,
        shadowOffsetX: item.shadowOffsetX ?? 0,
        shadowOffsetY: item.shadowOffsetY ?? 4,
        shadowOpacity: item.shadowOpacity ?? 0.5,
      }
    : {}
  const strokeProps = (item.strokeWidth ?? 0) > 0
    ? { stroke: item.strokeColor || '#000000', strokeWidth: item.strokeWidth, fillAfterStrokeEnabled: true }
    : {}

  return (
    <>
      {hasTextBg && (
        <Rect
          x={item.x - bgPadding}
          y={item.y - bgPadding}
          width={item.width + bgPadding * 2}
          height={item.height + bgPadding * 2}
          fill={item.textBgColor}
          opacity={item.textBgOpacity ?? 1}
          cornerRadius={item.textBgCornerRadius ?? 8}
          rotation={item.rotation}
          // Rotate around the same origin as the text so they pivot together.
          offsetX={0}
          offsetY={0}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
      <KonvaText
      ref={shapeRef}
      id={`media-${item.id}`}
      name="media"
      x={item.x}
      y={item.y}
      width={item.width}
      // Pinning height in fill mode keeps the transformer bbox matching the
      // box rather than the (smaller, fitted) text. Konva will draw text
      // overflowing height — but the fit step guarantees it doesn't.
      height={fillMode ? item.height : undefined}
      rotation={item.rotation}
      text={renderedText}
      fontFamily={item.fontFamily || 'Inter'}
      fontSize={renderedFontSize}
      fontStyle={fontStyle}
      fill={item.textColor || '#ffffff'}
      align={item.textAlign || 'left'}
      lineHeight={lineHeight}
      letterSpacing={letterSpacing}
      {...shadowProps}
      {...strokeProps}
      // When we've pre-broken the text via balanced wrap, ask Konva to honour
      // those breaks verbatim rather than re-wrapping greedily on top of them.
      wrap={(fillMode && fitted) ? 'none' : 'word'}
      visible={!isEditing}
      draggable
      perfectDrawEnabled={false}
      onClick={(e) => {
        e.cancelBubble = true
        const ev = e.evt as MouseEvent | undefined
        const additive = !!(ev && (ev.shiftKey || ev.metaKey || ev.ctrlKey))
        onSelect(additive)
      }}
      onTap={(e) => { e.cancelBubble = true; onSelect(false) }}
      onDblClick={(e) => { e.cancelBubble = true; onRequestEdit() }}
      onDblTap={(e) => { e.cancelBubble = true; onRequestEdit() }}
      onDragStart={(e) => onDragStart(e.target as Konva.Text)}
      onDragMove={(e) => onDragMove(e.target as Konva.Text)}
      onDragEnd={(e) => onDragEnd(e.target as Konva.Text)}
      onTransformEnd={() => {
        const n = shapeRef.current
        if (!n) return
        const sx = Math.abs(n.scaleX())
        const sy = Math.abs(n.scaleY())
        const newWidth = Math.max(20, item.width * sx)
        if (fillMode) {
          // Box-driven: both dimensions are user targets. The fontSize will
          // recompute from the new (width, height) on next render.
          const newHeight = Math.max(20, item.height * sy)
          n.scaleX(1)
          n.scaleY(1)
          n.width(newWidth)
          n.height(newHeight)
          onChange({
            x: n.x(),
            y: n.y(),
            width: newWidth,
            height: newHeight,
            rotation: n.rotation(),
          })
        } else {
          // Off mode: corner = uniform scale → fontSize follows width;
          // side = wrap width only, font unchanged.
          const uniform = Math.abs(sx - sy) < 0.01
          const newFontSize = uniform
            ? Math.max(4, (item.fontSize || 64) * sx)
            : (item.fontSize || 64)
          n.scaleX(1)
          n.scaleY(1)
          n.width(newWidth)
          onChange({
            x: n.x(),
            y: n.y(),
            width: newWidth,
            fontSize: newFontSize,
            rotation: n.rotation(),
          })
        }
      }}
    />
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  ShapeItemView                                                     */
/* ------------------------------------------------------------------ */

function ShapeItemView({
  item,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  item: PlacedMedia
  onSelect: (additive: boolean) => void
  onDragStart: (node: Konva.Node) => void
  onDragMove: (node: Konva.Node) => void
  onDragEnd: (node: Konva.Node) => void
}) {
  const kind = item.shapeKind ?? 'rect'
  const fill = item.fillColor === 'transparent' ? undefined : (item.fillColor ?? '#ffffff')
  const stroke = item.strokeColor || undefined
  const strokeWidth = item.strokeWidth ?? 0
  // Common Konva node props. We attach the same handlers as MediaItemView so
  // selection / drag / snap behaviour matches every other item type.
  const common = {
    id: `media-${item.id}`,
    name: 'media',
    rotation: item.rotation,
    draggable: true,
    perfectDrawEnabled: false,
    onClick: (e: Konva.KonvaEventObject<MouseEvent>) => {
      e.cancelBubble = true
      const ev = e.evt as MouseEvent | undefined
      const additive = !!(ev && (ev.shiftKey || ev.metaKey || ev.ctrlKey))
      onSelect(additive)
    },
    onTap: (e: Konva.KonvaEventObject<TouchEvent>) => { e.cancelBubble = true; onSelect(false) },
    onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => onDragStart(e.target),
    onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => onDragMove(e.target),
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => onDragEnd(e.target),
  }

  if (kind === 'ellipse') {
    // Konva.Ellipse is centred on (x, y), but our item coordinates describe
    // the top-left corner of the bounding box like every other item type.
    // Keep node.x / node.y == item.x / item.y so the drag handler reads the
    // top-left directly (and writes it back the same way), then push the
    // visual centre into place via a negative offset.
    return (
      <Ellipse
        {...common}
        x={item.x}
        y={item.y}
        radiusX={item.width / 2}
        radiusY={item.height / 2}
        offsetX={-item.width / 2}
        offsetY={-item.height / 2}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeScaleEnabled={false}
      />
    )
  }
  if (kind === 'line') {
    // Horizontal line across the bbox at vertical centre. We keep node.x /
    // node.y aligned with the item bbox top-left and bake the vertical
    // centring into `points` so drag handlers don't need to subtract h/2.
    const yMid = item.height / 2
    return (
      <Line
        {...common}
        x={item.x}
        y={item.y}
        points={[0, yMid, item.width, yMid]}
        stroke={stroke || '#ffffff'}
        strokeWidth={Math.max(1, strokeWidth || item.height)}
        lineCap="round"
        strokeScaleEnabled={false}
      />
    )
  }
  // Rectangle (default)
  return (
    <Rect
      {...common}
      x={item.x}
      y={item.y}
      width={item.width}
      height={item.height}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeScaleEnabled={false}
      cornerRadius={item.cornerRadius ?? 0}
    />
  )
}

/* ------------------------------------------------------------------ */
/*  MasterGhost — non-interactive copy of a master item rendered on    */
/*  every non-home slide. Uses primitive Konva nodes (not the full    */
/*  ItemView components) to avoid id collisions with the interactive  */
/*  home-slide instance, and listening={false} so all input still     */
/*  goes to the home copy.                                            */
/* ------------------------------------------------------------------ */

function MasterGhost({ item, slideId }: { item: PlacedMedia; slideId: string }) {
  // Unique-per-(item, slide) id so findOne('#media-…') / Transformer hooks
  // never accidentally retarget a ghost instead of the home-slide instance.
  const ghostId = `master-${item.id}-${slideId}`
  // Hook must be called unconditionally — even shapes/text invoke it and just
  // ignore the result. The id passed in is the ghost id (not the underlying
  // item id) so the video-element registry doesn't get clobbered by ghosts.
  const media = useHtmlMedia(
    item.type === 'image' || item.type === 'gif' ? item.src : '',
    item.type === 'image' || item.type === 'gif' ? item.type : 'text',
  )
  const common = {
    id: ghostId,
    name: 'master-ghost',
    listening: false,
    perfectDrawEnabled: false,
  } as const

  if (item.type === 'text') {
    // Mirror the effect props the home-slide TextItemView would apply so
    // shadow / outline / background-pill aren't silently dropped on master
    // copies (which would visibly diverge from the home slide).
    const shadowProps = item.shadowEnabled
      ? {
          shadowColor: item.shadowColor || '#000000',
          shadowBlur: item.shadowBlur ?? 8,
          shadowOffsetX: item.shadowOffsetX ?? 0,
          shadowOffsetY: item.shadowOffsetY ?? 4,
          shadowOpacity: item.shadowOpacity ?? 0.5,
        }
      : {}
    const strokeProps = (item.strokeWidth ?? 0) > 0
      ? { stroke: item.strokeColor || '#000000', strokeWidth: item.strokeWidth, fillAfterStrokeEnabled: true }
      : {}
    const bgPadding = item.textBgPadding ?? 0
    const hasTextBg = !!item.textBgColor && bgPadding >= 0 && (item.textBgOpacity ?? 1) > 0
    return (
      <>
        {hasTextBg && (
          <Rect
            id={`${ghostId}-bg`}
            name="master-ghost"
            listening={false}
            x={item.x - bgPadding}
            y={item.y - bgPadding}
            width={item.width + bgPadding * 2}
            height={item.height + bgPadding * 2}
            fill={item.textBgColor}
            opacity={item.textBgOpacity ?? 1}
            cornerRadius={item.textBgCornerRadius ?? 8}
            rotation={item.rotation}
            perfectDrawEnabled={false}
          />
        )}
        <KonvaText
          {...common}
          x={item.x}
          y={item.y}
          width={item.width}
          rotation={item.rotation}
          text={item.text || ''}
          fontFamily={item.fontFamily || 'Inter'}
          fontSize={item.fontSize || 64}
          fontStyle={fontStyleString(item.bold, item.italic)}
          fill={item.textColor || '#ffffff'}
          align={item.textAlign || 'left'}
          lineHeight={item.lineHeight ?? 1.15}
          letterSpacing={item.letterSpacing ?? 0}
          {...shadowProps}
          {...strokeProps}
          wrap="word"
        />
      </>
    )
  }
  if (item.type === 'shape') {
    const fill = item.fillColor === 'transparent' ? undefined : (item.fillColor ?? '#ffffff')
    const stroke = item.strokeColor || undefined
    const strokeWidth = item.strokeWidth ?? 0
    const kind = item.shapeKind ?? 'rect'
    if (kind === 'ellipse') {
      return (
        <Ellipse
          {...common}
          x={item.x}
          y={item.y}
          radiusX={item.width / 2}
          radiusY={item.height / 2}
          offsetX={-item.width / 2}
          offsetY={-item.height / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeScaleEnabled={false}
        />
      )
    }
    if (kind === 'line') {
      const yMid = item.height / 2
      return (
        <Line
          {...common}
          x={item.x}
          y={item.y}
          points={[0, yMid, item.width, yMid]}
          stroke={stroke || '#ffffff'}
          strokeWidth={Math.max(1, strokeWidth || item.height)}
          lineCap="round"
          strokeScaleEnabled={false}
        />
      )
    }
    return (
      <Rect
        {...common}
        x={item.x}
        y={item.y}
        width={item.width}
        height={item.height}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeScaleEnabled={false}
        cornerRadius={item.cornerRadius ?? 0}
      />
    )
  }
  // Image / gif master — render the actual image so exports of every slide
  // include the visible logo / watermark. Videos as masters fall back to a
  // dashed-outline placeholder; multiplying live video playback across
  // every slide would burn CPU for marginal benefit.
  // GIF masters get an HTMLCanvasElement (from the manual-decode animator);
  // regular image masters get an HTMLImageElement. Konva.Image accepts both.
  if ((item.type === 'image' || item.type === 'gif')
      && (media instanceof HTMLImageElement || media instanceof HTMLCanvasElement)) {
    const hasCrop = item.cropW > 0 && item.cropH > 0
    let rx = item.x
    let ry = item.y
    let rw = item.width
    let rh = item.height
    let cropObj: { x: number; y: number; width: number; height: number } | undefined
    if (hasCrop) {
      cropObj = { x: item.cropX, y: item.cropY, width: item.cropW, height: item.cropH }
      const sc = item.width / item.cropW
      rx = item.x - item.cropX * sc
      ry = item.y - item.cropY * sc
      rw = item.naturalWidth * sc
      rh = item.naturalHeight * sc
    }
    return (
      <KonvaImage
        {...common}
        image={media}
        x={rx}
        y={ry}
        width={rw}
        height={rh}
        rotation={item.rotation}
        crop={cropObj}
        scaleX={item.flipX ? -1 : 1}
        scaleY={item.flipY ? -1 : 1}
        offsetX={item.flipX ? rw : 0}
        offsetY={item.flipY ? rh : 0}
      />
    )
  }
  // Video master or media not loaded yet — outlined placeholder so the user
  // sees the footprint.
  return (
    <Rect
      {...common}
      x={item.x}
      y={item.y}
      width={item.width}
      height={item.height}
      stroke="rgba(241,242,245,0.4)"
      dash={[6, 4]}
      strokeWidth={1.5}
      strokeScaleEnabled={false}
    />
  )
}

/* ------------------------------------------------------------------ */
/*  CropOverlay                                                       */
/* ------------------------------------------------------------------ */

function CropOverlay({
  item,
  onRegisterApply,
}: {
  item: PlacedMedia
  zoom: number
  onRegisterApply: (fn: (() => void) | null) => void
}) {
  const applyCropAction = useTiovivoStore((s) => s.applyCrop)
  const setCropMode = useTiovivoStore((s) => s.setCropMode)

  const cropRectRef = useRef<Konva.Rect>(null)
  const cropTrRef = useRef<Konva.Transformer>(null)
  const topRef = useRef<Konva.Rect>(null)
  const botRef = useRef<Konva.Rect>(null)
  const leftRef = useRef<Konva.Rect>(null)
  const rightRef = useRef<Konva.Rect>(null)
  const thirdsRefs = useRef<(Konva.Line | null)[]>([])

  // Scale from natural to display pixels
  const effCW = item.cropW || item.naturalWidth
  const s = item.width / effCW

  // Full image bounds in slide-local coords
  const fx = item.x - (item.cropW > 0 ? item.cropX : 0) * s
  const fy = item.y - (item.cropH > 0 ? item.cropY : 0) * s
  const fw = item.naturalWidth * s
  const fh = item.naturalHeight * s

  // Initial crop rect (matches current item display rect)
  const cx0 = item.x
  const cy0 = item.y
  const cw0 = item.width
  const ch0 = item.height

  const updateOverlay = useCallback(() => {
    const node = cropRectRef.current
    if (!node) return
    const nx = node.x(), ny = node.y()
    const nw = Math.abs(node.width() * node.scaleX())
    const nh = Math.abs(node.height() * node.scaleY())

    topRef.current?.setAttrs({ x: fx, y: fy, width: fw, height: Math.max(0, ny - fy) })
    botRef.current?.setAttrs({ x: fx, y: ny + nh, width: fw, height: Math.max(0, fy + fh - ny - nh) })
    leftRef.current?.setAttrs({ x: fx, y: ny, width: Math.max(0, nx - fx), height: nh })
    rightRef.current?.setAttrs({ x: nx + nw, y: ny, width: Math.max(0, fx + fw - nx - nw), height: nh })

    const lines = thirdsRefs.current
    if (lines[0]) lines[0].points([nx + nw / 3, ny, nx + nw / 3, ny + nh])
    if (lines[1]) lines[1].points([nx + (2 * nw) / 3, ny, nx + (2 * nw) / 3, ny + nh])
    if (lines[2]) lines[2].points([nx, ny + nh / 3, nx + nw, ny + nh / 3])
    if (lines[3]) lines[3].points([nx, ny + (2 * nh) / 3, nx + nw, ny + (2 * nh) / 3])

    node.getLayer()?.batchDraw()
  }, [fx, fy, fw, fh])

  // Connect Transformer + initial overlay
  useEffect(() => {
    const tr = cropTrRef.current
    const rect = cropRectRef.current
    if (tr && rect) {
      tr.nodes([rect])
      tr.getLayer()?.batchDraw()
    }
    updateOverlay()
  }, [updateOverlay])

  // Get final crop in natural coords
  const getCropNatural = useCallback(() => {
    const node = cropRectRef.current
    if (!node) return null
    const nx = (node.x() - fx) / s
    const ny = (node.y() - fy) / s
    const nw = Math.abs(node.width() * node.scaleX()) / s
    const nh = Math.abs(node.height() * node.scaleY()) / s
    return {
      x: Math.max(0, Math.round(nx)),
      y: Math.max(0, Math.round(ny)),
      w: Math.min(item.naturalWidth, Math.round(nw)),
      h: Math.min(item.naturalHeight, Math.round(nh)),
    }
  }, [fx, fy, s, item.naturalWidth, item.naturalHeight])

  const doApply = useCallback(() => {
    const c = getCropNatural()
    if (c && c.w > 0 && c.h > 0) {
      applyCropAction(item.id, c.x, c.y, c.w, c.h)
    }
  }, [getCropNatural, applyCropAction, item.id])

  // Register apply callback for external use
  useEffect(() => {
    onRegisterApply(doApply)
    return () => onRegisterApply(null)
  }, [doApply, onRegisterApply])

  // Keyboard: Enter to apply, Escape to cancel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); doApply() }
      if (e.key === 'Escape') { e.preventDefault(); setCropMode(null) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [doApply, setCropMode])

  const OVERLAY = 'rgba(10,11,15,0.55)'
  const THIRDS = 'rgba(241,242,245,0.2)'

  return (
    <>
      {/* Dark overlay bands */}
      <Rect ref={topRef} fill={OVERLAY} listening={false} />
      <Rect ref={botRef} fill={OVERLAY} listening={false} />
      <Rect ref={leftRef} fill={OVERLAY} listening={false} />
      <Rect ref={rightRef} fill={OVERLAY} listening={false} />

      {/* Rule of thirds */}
      {[0, 1, 2, 3].map((i) => (
        <Line
          key={`thirds-${i}`}
          ref={(el) => { thirdsRefs.current[i] = el }}
          stroke={THIRDS}
          strokeWidth={0.5}
          listening={false}
        />
      ))}

      {/* Crop rect */}
      <Rect
        ref={cropRectRef}
        x={cx0} y={cy0}
        width={cw0} height={ch0}
        fill="transparent"
        draggable
        dragBoundFunc={(pos) => {
          const node = cropRectRef.current
          if (!node) return pos
          const gp = node.getParent()?.absolutePosition() ?? { x: 0, y: 0 }
          const w = Math.abs(node.width() * node.scaleX())
          const h = Math.abs(node.height() * node.scaleY())
          const lx = pos.x - gp.x
          const ly = pos.y - gp.y
          return {
            x: gp.x + Math.max(fx, Math.min(fx + fw - w, lx)),
            y: gp.y + Math.max(fy, Math.min(fy + fh - h, ly)),
          }
        }}
        onDragMove={updateOverlay}
        onTransform={updateOverlay}
        onTransformEnd={() => {
          const node = cropRectRef.current
          if (!node) return
          const w = node.width() * node.scaleX()
          const h = node.height() * node.scaleY()
          node.scaleX(1)
          node.scaleY(1)
          node.width(Math.abs(w))
          node.height(Math.abs(h))
          updateOverlay()
        }}
      />

      {/* Crop Transformer */}
      <Transformer
        ref={cropTrRef}
        rotateEnabled={false}
        keepRatio={false}
        enabledAnchors={[
          'top-left', 'top-center', 'top-right',
          'middle-right', 'middle-left',
          'bottom-left', 'bottom-center', 'bottom-right',
        ]}
        boundBoxFunc={(old, nw) => (nw.width < 20 || nw.height < 20 ? old : nw)}
        anchorSize={12}
        anchorFill={GUIDE_COLOR}
        anchorStroke="#1144cc"
        anchorStrokeWidth={1.5}
        anchorCornerRadius={2}
        borderStroke={GUIDE_COLOR}
        borderStrokeWidth={1.5}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Floating item controls (corrections popover + playback bar)       */
/* ------------------------------------------------------------------ */

function sliderFill(value: number, min: number, max: number) {
  const pct = ((value - min) / (max - min)) * 100
  return { ['--fill' as string]: `${Math.min(100, Math.max(0, pct))}%` } as React.CSSProperties
}

function CorrectionsPopover({ item, left, top }: { item: PlacedMedia; left: number; top: number }) {
  const updateItem = useTiovivoStore((s) => s.updateItem)
  const b = item.brightness ?? 0
  const c = item.contrast ?? 0
  const sat = item.saturation ?? 1
  const blur = item.blur ?? 0
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left, top,
        // Popover anchors its BOTTOM to the given top coordinate,
        // so it always sits above the corrections button regardless of height.
        transform: 'translate(-50%, -100%)',
        pointerEvents: 'auto',
        zIndex: 3,
        width: 240,
        padding: '8px 10px',
        background: 'rgba(30,30,40,0.97)',
        borderRadius: 8,
        border: '1px solid rgba(241,242,245,0.1)',
        boxShadow: '0 4px 16px rgba(10,11,15,0.5)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <label className="slider-field" style={{ margin: 0, gap: 2 }}>
        <span className="slider-field__label">
          Exposure<span className="slider-field__value">{b.toFixed(2)}</span>
        </span>
        <input type="range" min={-1} max={1} step={0.01} value={b}
          style={sliderFill(b, -1, 1)}
          onChange={(e) => updateItem(item.id, { brightness: Number(e.target.value) })}
          onDoubleClick={() => updateItem(item.id, { brightness: 0 })} />
      </label>
      <label className="slider-field" style={{ margin: 0, gap: 2 }}>
        <span className="slider-field__label">
          Contrast<span className="slider-field__value">{Math.round(c)}</span>
        </span>
        <input type="range" min={-100} max={100} step={1} value={c}
          style={sliderFill(c, -100, 100)}
          onChange={(e) => updateItem(item.id, { contrast: Number(e.target.value) })}
          onDoubleClick={() => updateItem(item.id, { contrast: 0 })} />
      </label>
      <label className="slider-field" style={{ margin: 0, gap: 2 }}>
        <span className="slider-field__label">
          Saturation<span className="slider-field__value">{sat.toFixed(2)}</span>
        </span>
        <input type="range" min={0} max={2} step={0.01} value={sat}
          style={sliderFill(sat, 0, 2)}
          onChange={(e) => updateItem(item.id, { saturation: Number(e.target.value) })}
          onDoubleClick={() => updateItem(item.id, { saturation: 1 })} />
      </label>
      <label className="slider-field" style={{ margin: 0, gap: 2 }}>
        <span className="slider-field__label">
          Blur<span className="slider-field__value">{Math.round(blur)}</span>
        </span>
        <input type="range" min={0} max={200} step={1} value={blur}
          style={sliderFill(blur, 0, 200)}
          onChange={(e) => updateItem(item.id, { blur: Number(e.target.value) })}
          onDoubleClick={() => updateItem(item.id, { blur: 0 })} />
      </label>
      <button
        type="button"
        className="btn btn--outline btn--sm"
        style={{ alignSelf: 'flex-start', gap: 6, flexDirection: 'row', marginTop: 4 }}
        onClick={() => updateItem(item.id, { brightness: 0, contrast: 0, saturation: 1, blur: 0 })}
      >
        Reset
      </button>
    </div>
  )
}

function PlaybackBar({ itemId, left, top, width }: { itemId: string; left: number; top: number; width: number }) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState(true)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let raf: number
    const tick = () => {
      const v = videoElements.get(itemId)
      if (v) {
        setReady(true)
        setCurrentTime(v.currentTime)
        setIsPlaying(!v.paused)
        setMuted(v.muted)
        if (isFinite(v.duration)) setDuration(v.duration)
      } else {
        setReady(false)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [itemId])

  const togglePlay = () => {
    const v = videoElements.get(itemId); if (!v) return
    if (v.paused) v.play().catch(() => {}); else v.pause()
  }
  const toggleMute = () => {
    const v = videoElements.get(itemId); if (!v) return
    v.muted = !v.muted; setMuted(v.muted)
  }
  const onScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value)
    const v = videoElements.get(itemId); if (v) v.currentTime = t
    setCurrentTime(t)
  }
  const fmt = (t: number) => {
    if (!isFinite(t)) return '0:00'
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }

  const btn: React.CSSProperties = {
    width: 26, height: 26, padding: 0, border: 'none', borderRadius: 5,
    background: 'transparent', color: 'rgba(241,242,245,0.85)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left, top,
        width: Math.max(240, width),
        transform: 'translateX(-50%)',
        pointerEvents: 'auto',
        zIndex: 2,
        padding: '4px 8px',
        background: 'rgba(30,30,40,0.95)',
        borderRadius: 8,
        border: '1px solid rgba(241,242,245,0.1)',
        boxShadow: '0 2px 12px rgba(10,11,15,0.4)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <button type="button" onClick={togglePlay} disabled={!ready} title={isPlaying ? 'Pause' : 'Play'} style={btn}>
        {isPlaying ? (
          <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
            <rect x="2" y="1.5" width="2.8" height="9" rx="0.5" />
            <rect x="7.2" y="1.5" width="2.8" height="9" rx="0.5" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
            <path d="M2.5 1.5v9l8-4.5z" />
          </svg>
        )}
      </button>
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.033}
        value={currentTime}
        onChange={onScrub}
        disabled={!ready || !duration}
        style={{ flex: 1, minWidth: 60 }}
      />
      <span style={{ fontSize: 10, color: 'rgba(241,242,245,0.55)', fontFamily: 'var(--mono)', minWidth: 68, textAlign: 'right' }}>
        {fmt(currentTime)} / {fmt(duration)}
      </span>
      <button type="button" onClick={toggleMute} disabled={!ready} title={muted ? 'Unmute' : 'Mute'} style={btn}>
        {muted ? (
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3L4.5 6H2v4h2.5L8 13V3z" />
            <line x1="11" y1="6" x2="14" y2="9" />
            <line x1="14" y1="6" x2="11" y2="9" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3L4.5 6H2v4h2.5L8 13V3z" />
            <path d="M11 5.5a3 3 0 0 1 0 5" />
          </svg>
        )}
      </button>
    </div>
  )
}

function CoverFramePopover({ item, left, top }: { item: PlacedMedia; left: number; top: number }) {
  const updateItem = useTiovivoStore((s) => s.updateItem)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(item.coverTime || 0)
  const usingImage = !!item.coverImageSrc

  useEffect(() => {
    if (usingImage) return
    const v = document.createElement('video')
    v.src = item.src
    v.muted = true
    v.preload = 'auto'
    videoRef.current = v

    const onMeta = () => {
      setDuration(v.duration)
      v.currentTime = item.coverTime || 0
    }
    v.addEventListener('loadedmetadata', onMeta)

    const onSeeked = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const aspect = v.videoWidth / v.videoHeight
      canvas.width = 200
      canvas.height = Math.round(200 / aspect)
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
    }
    v.addEventListener('seeked', onSeeked)
    v.addEventListener('loadeddata', onSeeked)

    return () => {
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('seeked', onSeeked)
      v.removeEventListener('loadeddata', onSeeked)
      v.pause()
      v.src = ''
      videoRef.current = null
    }
  }, [item.src, item.coverTime, usingImage])

  const handlePickImage = () => fileInputRef.current?.click()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    // Revoke any previous custom cover URL so we don't leak blob references.
    if (item.coverImageSrc) URL.revokeObjectURL(item.coverImageSrc)
    const url = URL.createObjectURL(f)
    updateItem(item.id, { coverImageSrc: url })
    e.target.value = ''
  }

  const handleClearImage = () => {
    if (item.coverImageSrc) URL.revokeObjectURL(item.coverImageSrc)
    updateItem(item.id, { coverImageSrc: undefined })
  }

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value)
    setCurrentTime(t)
    if (videoRef.current) videoRef.current.currentTime = t
  }, [])

  const handleScrubEnd = useCallback(() => {
    updateItem(item.id, { coverTime: currentTime })
  }, [item.id, currentTime, updateItem])

  const fmt = (t: number) => {
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    const ms = Math.floor((t % 1) * 10)
    return `${m}:${String(s).padStart(2, '0')}.${ms}`
  }

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left, top,
        transform: 'translate(-50%, -100%)',
        pointerEvents: 'auto',
        zIndex: 3,
        width: 220,
        padding: 12,
        background: 'rgba(30,30,40,0.97)',
        borderRadius: 8,
        border: '1px solid rgba(241,242,245,0.1)',
        boxShadow: '0 4px 16px rgba(10,11,15,0.5)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(241,242,245,0.7)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cover</span>
      {usingImage ? (
        <img
          src={item.coverImageSrc}
          style={{ width: '100%', borderRadius: 4, background: '#0d0d11', aspectRatio: '16/9', objectFit: 'contain' }}
          alt=""
        />
      ) : (
        <canvas
          ref={canvasRef}
          style={{ width: '100%', borderRadius: 4, background: '#0d0d11', aspectRatio: '16/9', objectFit: 'contain' }}
        />
      )}
      {!usingImage && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.033}
            value={currentTime}
            onChange={handleScrub}
            onMouseUp={handleScrubEnd}
            onTouchEnd={handleScrubEnd}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 10, color: 'rgba(241,242,245,0.4)', fontFamily: 'var(--mono)', minWidth: 52, textAlign: 'right' }}>
            {fmt(currentTime)}
          </span>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <button
        type="button"
        onClick={usingImage ? handleClearImage : handlePickImage}
        style={{
          fontSize: 11,
          padding: '6px 8px',
          borderRadius: 4,
          border: '1px solid rgba(241,242,245,0.15)',
          background: 'rgba(241,242,245,0.05)',
          color: 'rgba(241,242,245,0.85)',
          cursor: 'pointer',
        }}
      >
        {usingImage ? 'Use video frame' : 'Use image…'}
      </button>
    </div>
  )
}

const TRIM_STRIP_WIDTH = 720
const TRIM_STRIP_HEIGHT = 72
const TRIM_THUMB_COUNT = 14
const TRIM_HANDLE_W = 14

function TrimPopover({ item, left, top }: { item: PlacedMedia; left: number; top: number }) {
  const updateItem = useTiovivoStore((s) => s.updateItem)
  const [duration, setDuration] = useState(0)
  const [start, setStart] = useState(item.trimStart || 0)
  const [end, setEnd] = useState(item.trimEnd || 0)
  const [thumbs, setThumbs] = useState<string[]>([])
  const stripRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<'start' | 'end' | null>(null)
  const liveRef = useRef({ start: item.trimStart || 0, end: item.trimEnd || 0, duration: 0 })
  const [dragPreview, setDragPreview] = useState<{ x: number; t: number } | null>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)

  // Generate filmstrip thumbnails
  useEffect(() => {
    let cancelled = false
    const v = document.createElement('video')
    v.src = item.src
    v.muted = true
    v.preload = 'auto'
    v.crossOrigin = 'anonymous'

    const onMeta = async () => {
      const dur = v.duration
      if (!isFinite(dur) || dur <= 0) return
      setDuration(dur)
      liveRef.current.duration = dur
      if (!item.trimEnd || item.trimEnd <= 0) {
        setEnd(dur)
        liveRef.current.end = dur
      }
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
      const cellCssW = TRIM_STRIP_WIDTH / TRIM_THUMB_COUNT
      const cellW = Math.round(cellCssW * dpr)
      const cellH = Math.round(TRIM_STRIP_HEIGHT * dpr)
      const vw = v.videoWidth || 16
      const vh = v.videoHeight || 9
      // Cover crop: pick src rect that matches cell aspect
      const cellAspect = cellW / cellH
      const vidAspect = vw / vh
      let sx = 0, sy = 0, sW = vw, sH = vh
      if (vidAspect > cellAspect) {
        sW = vh * cellAspect
        sx = (vw - sW) / 2
      } else {
        sH = vw / cellAspect
        sy = (vh - sH) / 2
      }
      const canvas = document.createElement('canvas')
      canvas.width = cellW
      canvas.height = cellH
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      const out: string[] = []
      for (let i = 0; i < TRIM_THUMB_COUNT; i++) {
        if (cancelled) return
        const t = (i + 0.5) * (dur / TRIM_THUMB_COUNT)
        await new Promise<void>((resolve) => {
          const onSeeked = () => { v.removeEventListener('seeked', onSeeked); resolve() }
          v.addEventListener('seeked', onSeeked)
          v.currentTime = Math.min(Math.max(0, t), dur - 0.01)
        })
        ctx.clearRect(0, 0, cellW, cellH)
        ctx.drawImage(v, sx, sy, sW, sH, 0, 0, cellW, cellH)
        out.push(canvas.toDataURL('image/jpeg', 0.88))
        if (cancelled) return
        setThumbs(out.slice())
      }
    }

    v.addEventListener('loadedmetadata', onMeta)
    return () => {
      cancelled = true
      v.removeEventListener('loadedmetadata', onMeta)
      v.pause()
      v.src = ''
    }
  }, [item.src, item.trimEnd])

  useEffect(() => { liveRef.current.start = start }, [start])
  useEffect(() => { liveRef.current.end = end }, [end])

  const timeToX = (t: number) => {
    if (!duration) return 0
    return (t / duration) * TRIM_STRIP_WIDTH
  }

  const preview = (t: number) => {
    const v = videoElements.get(item.id)
    if (v) v.currentTime = Math.min(Math.max(0, t), (v.duration || t) - 0.001)
  }

  const commit = () => {
    const { start: s, end: e, duration: dur } = liveRef.current
    if (!dur) return
    const clampedStart = Math.max(0, Math.min(s, dur - 0.05))
    const clampedEnd = Math.max(clampedStart + 0.05, Math.min(e, dur))
    updateItem(item.id, {
      trimStart: clampedStart,
      trimEnd: clampedEnd >= dur - 1e-3 ? 0 : clampedEnd,
    })
  }

  const onPointerDown = (kind: 'start' | 'end') => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    dragRef.current = kind
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !stripRef.current || !duration) return
    const rect = stripRef.current.getBoundingClientRect()
    const x = Math.min(Math.max(0, e.clientX - rect.left), rect.width)
    const t = (x / rect.width) * duration
    if (dragRef.current === 'start') {
      const clamped = Math.min(t, liveRef.current.end - 0.05)
      setStart(clamped)
      liveRef.current.start = clamped
      preview(clamped)
      setDragPreview({ x: (clamped / duration) * TRIM_STRIP_WIDTH, t: clamped })
    } else {
      const clamped = Math.max(t, liveRef.current.start + 0.05)
      setEnd(clamped)
      liveRef.current.end = clamped
      preview(clamped)
      setDragPreview({ x: (clamped / duration) * TRIM_STRIP_WIDTH, t: clamped })
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    dragRef.current = null
    setDragPreview(null)
    commit()
  }

  // Draw current frame from the stage's video element into the drag-preview canvas
  useEffect(() => {
    if (!dragPreview) return
    const v = videoElements.get(item.id)
    const canvas = previewCanvasRef.current
    if (!v || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const draw = () => {
      const cw = canvas.width
      const ch = canvas.height
      const vw = v.videoWidth || 16
      const vh = v.videoHeight || 9
      const cAsp = cw / ch
      const vAsp = vw / vh
      let sx = 0, sy = 0, sW = vw, sH = vh
      if (vAsp > cAsp) { sW = vh * cAsp; sx = (vw - sW) / 2 }
      else { sH = vw / cAsp; sy = (vh - sH) / 2 }
      ctx.clearRect(0, 0, cw, ch)
      try { ctx.drawImage(v, sx, sy, sW, sH, 0, 0, cw, ch) } catch { /* video not decodable yet — next seeked redraws */ }
    }
    draw()
    const onSeeked = () => draw()
    v.addEventListener('seeked', onSeeked)
    return () => v.removeEventListener('seeked', onSeeked)
  }, [dragPreview, item.id])

  const onReset = () => {
    setStart(0); setEnd(duration)
    liveRef.current.start = 0
    liveRef.current.end = duration
    updateItem(item.id, { trimStart: 0, trimEnd: 0 })
  }

  const fmt = (t: number) => {
    if (!isFinite(t)) return '0:00.0'
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    const ms = Math.floor((t % 1) * 10)
    return `${m}:${String(s).padStart(2, '0')}.${ms}`
  }

  const startX = timeToX(start)
  const endX = timeToX(end || duration)

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left, top,
        transform: 'translate(-50%, -100%)',
        pointerEvents: 'auto',
        zIndex: 3,
        width: TRIM_STRIP_WIDTH + 24,
        padding: 12,
        background: 'rgba(30,30,40,0.97)',
        borderRadius: 8,
        border: '1px solid rgba(241,242,245,0.1)',
        boxShadow: '0 4px 16px rgba(10,11,15,0.5)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(241,242,245,0.7)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Trim</span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'rgba(241,242,245,0.55)', fontFamily: 'var(--mono)' }}>
            {fmt(start)} → {fmt(end)} · {fmt(Math.max(0, (end || duration) - start))}
          </span>
          <button
            type="button"
            onClick={onReset}
            style={{ padding: '2px 6px', border: 'none', borderRadius: 4, background: 'transparent', color: 'rgba(241,242,245,0.5)', cursor: 'pointer', fontSize: 10 }}
          >Reset</button>
        </div>
      </div>
      <div
        ref={stripRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: 'relative',
          width: TRIM_STRIP_WIDTH,
          height: TRIM_STRIP_HEIGHT,
          background: '#0d0d11',
          borderRadius: 4,
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        {/* Drag-preview thumbnail */}
        {dragPreview && (() => {
          const pW = 160
          const pH = 90
          const centered = Math.min(TRIM_STRIP_WIDTH - pW / 2, Math.max(pW / 2, dragPreview.x))
          return (
            <div style={{
              position: 'absolute',
              left: centered,
              bottom: TRIM_STRIP_HEIGHT + 8,
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
              zIndex: 5,
              display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}>
              <canvas
                ref={previewCanvasRef}
                width={pW * 2}
                height={pH * 2}
                style={{
                  width: pW, height: pH,
                  borderRadius: 4,
                  background: '#0d0d11',
                  border: '2px solid #3b82f6',
                  boxShadow: '0 4px 12px rgba(10,11,15,0.6)',
                  display: 'block',
                }}
              />
              <div style={{
                marginTop: 4,
                padding: '2px 6px',
                fontSize: 10,
                fontFamily: 'var(--mono)',
                color: '#f1f2f5',
                background: 'rgba(10,11,15,0.75)',
                borderRadius: 3,
              }}>{fmt(dragPreview.t)}</div>
            </div>
          )
        })()}
        {/* Filmstrip */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          {Array.from({ length: TRIM_THUMB_COUNT }).map((_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: '100%',
                backgroundImage: thumbs[i] ? `url(${thumbs[i]})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundColor: thumbs[i] ? undefined : 'rgba(241,242,245,0.04)',
                borderRight: i < TRIM_THUMB_COUNT - 1 ? '1px solid rgba(10,11,15,0.2)' : undefined,
              }}
            />
          ))}
        </div>
        {/* Left dimmer (before IN) */}
        <div style={{
          position: 'absolute', top: 0, left: 0, height: '100%',
          width: startX,
          background: 'rgba(10,11,15,0.65)',
          pointerEvents: 'none',
        }} />
        {/* Right dimmer (after OUT) */}
        <div style={{
          position: 'absolute', top: 0, left: endX, height: '100%',
          width: Math.max(0, TRIM_STRIP_WIDTH - endX),
          background: 'rgba(10,11,15,0.65)',
          pointerEvents: 'none',
        }} />
        {/* Selection frame */}
        <div style={{
          position: 'absolute', top: 0, left: startX, height: '100%',
          width: Math.max(0, endX - startX),
          border: '2px solid #3b82f6',
          borderLeft: 'none',
          borderRight: 'none',
          pointerEvents: 'none',
          boxSizing: 'border-box',
        }} />
        {/* IN handle */}
        <div
          onPointerDown={onPointerDown('start')}
          style={{
            position: 'absolute',
            top: 0, height: '100%',
            left: Math.max(0, Math.min(TRIM_STRIP_WIDTH - TRIM_HANDLE_W, startX - TRIM_HANDLE_W)),
            width: TRIM_HANDLE_W,
            background: '#3b82f6',
            cursor: 'ew-resize',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '4px 0 0 4px',
          }}
        >
          <svg width="6" height="24" viewBox="0 0 6 24" fill="none" stroke="rgba(241,242,245,0.85)" strokeWidth="1.5" strokeLinecap="round">
            <line x1="2" y1="5" x2="2" y2="19" />
            <line x1="4" y1="5" x2="4" y2="19" />
          </svg>
        </div>
        {/* OUT handle */}
        <div
          onPointerDown={onPointerDown('end')}
          style={{
            position: 'absolute',
            top: 0, height: '100%',
            left: Math.max(0, Math.min(TRIM_STRIP_WIDTH - TRIM_HANDLE_W, endX)),
            width: TRIM_HANDLE_W,
            background: '#3b82f6',
            cursor: 'ew-resize',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '0 4px 4px 0',
          }}
        >
          <svg width="6" height="24" viewBox="0 0 6 24" fill="none" stroke="rgba(241,242,245,0.85)" strokeWidth="1.5" strokeLinecap="round">
            <line x1="2" y1="5" x2="2" y2="19" />
            <line x1="4" y1="5" x2="4" y2="19" />
          </svg>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  EditorStage                                                       */
/* ------------------------------------------------------------------ */

export interface EditorStageHandle {
  exportSlidePng: (slideId: string) => Promise<Blob | null>
  exportSlideVideo: (
    slideId: string,
    outputPath: string,
    fps?: number,
    onProgress?: (pct: number) => void,
    /** Called with a downscaled JPEG data URL of the current capture
     *  frame, roughly every 500 ms. Used to show a live preview during
     *  export without sending every frame back to the renderer. */
    onPreviewFrame?: (dataUrl: string) => void,
  ) => Promise<string | null>
  fitToScreen: () => void
  applyCrop: () => void
}

const EditorStage = forwardRef<
  EditorStageHandle,
  { maxViewWidth: number; maxViewHeight: number; onExportSingleSlide?: (slideId: string) => void }
>(function EditorStage({ maxViewWidth, maxViewHeight, onExportSingleSlide }, ref) {
  const stageRef = useRef<Konva.Stage>(null)
  const bgLayerRef = useRef<Konva.Layer>(null)
  const guidesLayerRef = useRef<Konva.Layer>(null)
  const snapGuidesLayerRef = useRef<Konva.Layer>(null)
  const veilLayerRef = useRef<Konva.Layer>(null)
  const overlayLayerRef = useRef<Konva.Layer>(null)
  const igSafeAreaLayerRef = useRef<Konva.Layer>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const cropApplyRef = useRef<(() => void) | null>(null)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)

  /* ---- store ---- */
  const dimensions = useTiovivoStore((s) => s.dimensions)
  const slides = useTiovivoStore((s) => s.slides)
  const items = useTiovivoStore((s) => s.items)
  const selectedIds = useTiovivoStore((s) => s.selectedIds)
  const selectedId = selectedIds.length > 0 ? selectedIds[selectedIds.length - 1]! : null
  const isMultiSelect = selectedIds.length > 1
  const setSelected = useTiovivoStore((s) => s.setSelected)
  const setSelectedIds = useTiovivoStore((s) => s.setSelectedIds)
  const toggleSelected = useTiovivoStore((s) => s.toggleSelected)
  const updateItem = useTiovivoStore((s) => s.updateItem)
  const updateItems = useTiovivoStore((s) => s.updateItems)
  const moveItemToSlide = useTiovivoStore((s) => s.moveItemToSlide)
  const addSlide = useTiovivoStore((s) => s.addSlide)
  const duplicateSlide = useTiovivoStore((s) => s.duplicateSlide)
  const removeSlide = useTiovivoStore((s) => s.removeSlide)
  const reorderSlides = useTiovivoStore((s) => s.reorderSlides)
  const setSlideBgColor = useTiovivoStore((s) => s.setSlideBgColor)
  const setSlideName = useTiovivoStore((s) => s.setSlideName)
  const toggleSlideExport = useTiovivoStore((s) => s.toggleSlideExport)
  const activeSlideId = useTiovivoStore((s) => s.activeSlideId)
  const thumbnails = useTiovivoStore((s) => s.thumbnails)
  const workspaceBgColorRaw = useTiovivoStore((s) => s.workspaceBgColor)
  const theme = useThemeStore((s) => s.theme)
  // Resolved against the theme — the "auto" sentinel follows Onyx/Cream.
  // Everything below (pasteboard fill, chrome luminance, seam veil) uses
  // the resolved hex.
  const workspaceBgColor = resolveWorkspaceBg(workspaceBgColorRaw, theme)
  const fitItemToSlide = useTiovivoStore((s) => s.fitItemToSlide)
  const fillItemToSlide = useTiovivoStore((s) => s.fillItemToSlide)
  const resetItemScale = useTiovivoStore((s) => s.resetItemScale)
  const cropItemId = useTiovivoStore((s) => s.cropItemId)
  const setCropMode = useTiovivoStore((s) => s.setCropMode)
  const resetCropAction = useTiovivoStore((s) => s.resetCrop)

  const showGrid = useTiovivoStore((s) => s.showGrid)
  const gridSize = useTiovivoStore((s) => s.gridSize)
  const gridOpacity = useTiovivoStore((s) => s.gridOpacity)
  const marginPct = useTiovivoStore((s) => s.marginPct)
  const showCenterGuides = useTiovivoStore((s) => s.showCenterGuides)
  const seamlessSlides = useTiovivoStore((s) => s.seamlessSlides)
  const showHiddenZone = useTiovivoStore((s) => s.showHiddenZone)
  const showIgSafeArea = useTiovivoStore((s) => s.showIgSafeArea)
  const previewMode = useTiovivoStore((s) => s.previewMode)
  const snapGrid = useTiovivoStore((s) => s.snapGrid)
  const snapCenter = useTiovivoStore((s) => s.snapCenter)
  const snapItems = useTiovivoStore((s) => s.snapItems)
  const snapMargins = useTiovivoStore((s) => s.snapMargins)

  const W = dimensions.width
  const H = dimensions.height
  const marginPx = (Math.min(W, H) * marginPct) / 100
  const artboardGap = seamlessSlides ? 0 : ARTBOARD_GAP
  // Pasteboard pad scales with slide size so there's generous outer workspace.
  // The Stage is viewport-sized (camera pattern), so this is a pure world-coord
  // offset and no longer bounded by canvas memory.
  const pasteboardPad = Math.max(PASTEBOARD_PAD_BASE, Math.max(W, H) * PASTEBOARD_PAD_FACTOR)

  /* ---- artboard layout ---- */
  const artboardPositions = useMemo(() => {
    return slides.map((_, i) => ({
      x: pasteboardPad + i * (W + artboardGap),
      y: pasteboardPad,
    }))
  }, [slides, W, artboardGap, pasteboardPad])

  const slideAbsoluteXBySlideId = useMemo(() => {
    const m = new Map<string, number>()
    slides.forEach((s, j) => m.set(s.id, artboardPositions[j]!.x))
    return m
  }, [slides, artboardPositions])

  /* ---- "hidden" zone around slides: media inside here is clipped by slide masks ---- */
  const hiddenZone = useMemo(() => {
    if (!artboardPositions.length) return null
    const first = artboardPositions[0]!
    const last = artboardPositions[artboardPositions.length - 1]!
    const pad = Math.min(W, H) * 0.8
    return {
      x: first.x - pad,
      y: first.y - pad,
      width: (last.x + W) - first.x + pad * 2,
      height: H + pad * 2,
    }
  }, [artboardPositions, W, H])

  /* ---- zoom & pan (single state to prevent tearing) ---- */
  const [camera, setCamera] = useState({ zoom: 1, x: 0, y: 0 })
  const zoom = camera.zoom
  const panOffset = { x: camera.x, y: camera.y }
  const setPanOffset = useCallback((v: { x: number; y: number } | ((p: { x: number; y: number }) => { x: number; y: number })) => {
    setCamera((c) => {
      const nv = typeof v === 'function' ? v({ x: c.x, y: c.y }) : v
      return { ...c, x: nv.x, y: nv.y }
    })
  }, [])
  const isPanningRef = useRef(false)
  const spaceDownRef = useRef(false)
  const lastPointerRef = useRef({ x: 0, y: 0 })

  /* ---- resize: keep the active slide visually centred ----
   * Without this, changing W/H makes the slides grow outwards from their
   * top-left anchor and the user perceives them "running away" from the
   * viewport centre. We compensate panOffset by the world-space delta of
   * the active slide's centre across the resize so the centre stays put on
   * screen. useLayoutEffect runs after the dimension commit but before the
   * browser paints, avoiding a one-frame jump. */
  const prevDimsRef = useRef({ W, H })
  useEffect(() => {
    const prevW = prevDimsRef.current.W
    const prevH = prevDimsRef.current.H
    if (prevW === W && prevH === H) return
    const idx = Math.max(0, slides.findIndex((s) => s.id === activeSlideId))

    // Pasteboard padding (recomputed for both old and new dims because it
    // scales with max(W, H) and shifts every slide's absolute X/Y).
    const prevPad = Math.max(PASTEBOARD_PAD_BASE, Math.max(prevW, prevH) * PASTEBOARD_PAD_FACTOR)
    const newPad = Math.max(PASTEBOARD_PAD_BASE, Math.max(W, H) * PASTEBOARD_PAD_FACTOR)
    const oldCx = prevPad + idx * (prevW + artboardGap) + prevW / 2
    const oldCy = prevPad + prevH / 2
    const newCx = newPad + idx * (W + artboardGap) + W / 2
    const newCy = newPad + H / 2

    setPanOffset((p) => ({
      x: p.x + (oldCx - newCx) * zoom,
      y: p.y + (oldCy - newCy) * zoom,
    }))
    prevDimsRef.current = { W, H }
    // Deliberately tied to W/H only — other deps are read at effect-time and
    // shouldn't re-trigger the centre-on-resize logic.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, H])

  /* ---- snap guides ---- */
  const [activeGuides, setActiveGuides] = useState<{ slideIdx: number; guides: GuideLine[] } | null>(null)

  /* ---- box selection (drag on empty pasteboard/artboard) ---- */
  const [boxSel, setBoxSel] = useState<{ x1: number; y1: number; x2: number; y2: number; additive: boolean } | null>(null)
  const boxSelActiveRef = useRef(false)

  /* ---- slide label drag-to-reorder (mouse-based) ---- */
  const reorderDragRef = useRef<string | null>(null)
  const [isReordering, setIsReordering] = useState(false)
  const [reorderDropTarget, setReorderDropTarget] = useState<string | null>(null)

  /* ---- slide inline rename (double-click on the label) ---- */
  const [renamingSlideId, setRenamingSlideId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  /* ---- floating corrections / cover frame popover toggle ---- */
  const [showCorrections, setShowCorrections] = useState(false)
  const [showCoverFrame, setShowCoverFrame] = useState(false)
  const [rotateMode, setRotateMode] = useState(false)
  const [showTrim, setShowTrim] = useState(false)
  useEffect(() => { setShowCorrections(false); setShowCoverFrame(false); setShowTrim(false); setRotateMode(false) }, [selectedId, cropItemId])

  /* ---- live drag position (so floating controls track the dragged item) ---- */
  const [dragLive, setDragLive] = useState<{
    itemId: string; slideIdx: number; x: number; y: number; width: number; height: number
  } | null>(null)

  /* ---- fit to screen ---- */
  const fitToScreen = useCallback(() => {
    if (W <= 0 || H <= 0 || maxViewWidth <= 0 || maxViewHeight <= 0) return
    const CHROME_TOP = 34  // screen-space: label above artboard
    const CHROME_BOT = 36  // screen-space: color picker below artboard
    const pad = 30
    const totalW = slides.length * W + (slides.length - 1) * artboardGap
    const availW = maxViewWidth - pad * 2
    const availH = maxViewHeight - pad * 2 - CHROME_TOP - CHROME_BOT
    const fitZoom = Math.min(availW / totalW, availH / H, 2)
    const contentCx = pasteboardPad + totalW / 2
    const contentCy = pasteboardPad + H / 2
    // Offset Y so label+artboard+picker are centered in available area
    const yShift = (CHROME_TOP - CHROME_BOT) / 2
    setCamera({
      zoom: fitZoom,
      x: maxViewWidth / 2 - contentCx * fitZoom,
      y: maxViewHeight / 2 + yShift - contentCy * fitZoom,
    })
  }, [W, H, maxViewWidth, maxViewHeight, slides.length, artboardGap, pasteboardPad])

  /**
   * Snap zoom to exactly 100% and recentre on the current content centroid.
   * Bound to a click on the `%` readout at the bottom-right of the canvas.
   * Useful when you want to inspect pixels at their export-sized resolution
   * without doing several scroll-wheel ticks.
   */
  const zoomTo100 = useCallback(() => {
    if (W <= 0 || H <= 0 || maxViewWidth <= 0 || maxViewHeight <= 0) return
    const totalW = slides.length * W + (slides.length - 1) * artboardGap
    const contentCx = pasteboardPad + totalW / 2
    const contentCy = pasteboardPad + H / 2
    setCamera({
      zoom: 1,
      x: maxViewWidth / 2 - contentCx,
      y: maxViewHeight / 2 - contentCy,
    })
  }, [W, H, maxViewWidth, maxViewHeight, slides.length, artboardGap, pasteboardPad])

  // Only fit on first mount, not every time slides change
  const hasFitRef = useRef(false)
  useEffect(() => {
    if (!hasFitRef.current) {
      fitToScreen()
      hasFitRef.current = true
    }
  }, [fitToScreen])

  /* ---- space key ---- */
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault(); spaceDownRef.current = true; document.body.style.cursor = 'grab'
      }
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDownRef.current = false; isPanningRef.current = false; document.body.style.cursor = ''
      }
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); document.body.style.cursor = '' }
  }, [])

  /* ---- wheel zoom (native listener, single atomic camera update) ---- */
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const rect = wrap.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      setCamera((cam) => {
        const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
        const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor))
        const wx = (mx - cam.x) / cam.zoom
        const wy = (my - cam.y) / cam.zoom
        return { zoom: nz, x: mx - wx * nz, y: my - wy * nz }
      })
    }
    wrap.addEventListener('wheel', handler, { passive: false })
    return () => wrap.removeEventListener('wheel', handler)
  }, [])

  /* ---- pointer pan ---- */
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (spaceDownRef.current || e.button === 1) {
      e.preventDefault(); isPanningRef.current = true
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
      document.body.style.cursor = 'grabbing'
      ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    }
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current) return
    const dx = e.clientX - lastPointerRef.current.x
    const dy = e.clientY - lastPointerRef.current.y
    lastPointerRef.current = { x: e.clientX, y: e.clientY }
    setPanOffset((p) => ({ x: p.x + dx, y: p.y + dy }))
  }, [])
  const onPointerUp = useCallback(() => {
    if (isPanningRef.current) {
      isPanningRef.current = false
      document.body.style.cursor = spaceDownRef.current ? 'grab' : ''
    }
  }, [])

  /* ---- which artboard is at a workspace point ---- */
  const getSlideAtPoint = useCallback(
    (wsX: number, wsY: number): { slideId: string; slideIdx: number } | null => {
      for (let i = 0; i < slides.length; i++) {
        const ap = artboardPositions[i]!
        const margin = artboardGap / 2
        if (wsX >= ap.x - margin && wsX <= ap.x + W + margin && wsY >= ap.y - margin && wsY <= ap.y + H + margin) {
          return { slideId: slides[i]!.id, slideIdx: i }
        }
      }
      let bestIdx = 0, bestDist = Infinity
      for (let i = 0; i < slides.length; i++) {
        const ap = artboardPositions[i]!
        const d = Math.hypot(wsX - (ap.x + W / 2), wsY - (ap.y + H / 2))
        if (d < bestDist) { bestDist = d; bestIdx = i }
      }
      return { slideId: slides[bestIdx]!.id, slideIdx: bestIdx }
    },
    [slides, artboardPositions, W, H],
  )

  /* ---- multi-drag state: captured at drag start for co-movement ---- */
  const dragMultiRef = useRef<{
    primary: string
    items: { id: string; slideId: string; initialLocalX: number; initialLocalY: number }[]
  } | null>(null)

  const handleDragStart = useCallback(
    (_node: Konva.Image, item: PlacedMedia) => {
      if (!selectedIds.includes(item.id)) {
        dragMultiRef.current = null
        setSelected(item.id)
        return
      }
      if (selectedIds.length <= 1) {
        dragMultiRef.current = null
        return
      }
      const snap = useTiovivoStore.getState()
      const all = snap.items
      const captured: { id: string; slideId: string; initialLocalX: number; initialLocalY: number }[] = []
      for (const id of selectedIds) {
        const it = all.find((x) => x.id === id)
        if (!it) continue
        captured.push({
          id,
          slideId: it.slideId,
          initialLocalX: it.x,
          initialLocalY: it.y,
        })
      }
      dragMultiRef.current = { primary: item.id, items: captured }
    },
    [selectedIds, setSelected],
  )

  /* ---- snapping during drag ---- */
  const handleDragMove = useCallback(
    (node: Konva.Image, item: PlacedMedia) => {
      const group = node.getParent()
      if (!group) return
      const groupX = group.x(), groupY = group.y()
      const itemWsX = groupX + node.x(), itemWsY = groupY + node.y()
      const bw = node.width() * node.scaleX(), bh = node.height() * node.scaleY()
      const itemWsCx = itemWsX + bw / 2, itemWsCy = itemWsY + bh / 2

      const target = getSlideAtPoint(itemWsCx, itemWsCy)
      if (!target) return

      const ap = artboardPositions[target.slideIdx]!
      const localX = itemWsX - ap.x, localY = itemWsY - ap.y

      // In multi-drag, exclude sibling selected items from snap targets.
      const multi = dragMultiRef.current
      const excludeIds = new Set<string>([item.id])
      if (multi) for (const s of multi.items) excludeIds.add(s.id)
      const otherBoxes = items
        .filter((i) => i.slideId === target.slideId && !excludeIds.has(i.id))
        .map((i) => ({ x: i.x, y: i.y, width: i.width, height: i.height, rotation: i.rotation }))

      const result = snapPosition({
        stage: { width: W, height: H },
        self: { x: localX, y: localY, width: bw, height: bh, rotation: node.rotation() },
        others: otherBoxes,
        gridSize: snapGrid ? gridSize : null,
        marginPx, snapGrid, snapCenter, snapItems, snapMargins,
      })

      node.x(ap.x + result.x - groupX)
      node.y(ap.y + result.y - groupY)

      // Move sibling selected items by the same slide-local delta. Computing
      // the delta in slide-local coords (not world-space) means cross-slide
      // selections stay put in their own slides instead of being shoved by
      // the inter-artboard gap each drag — which used to compound visibly.
      if (multi && multi.primary === item.id) {
        const primaryInit = multi.items.find((x) => x.id === item.id)
        if (primaryInit) {
          const dXLocal = result.x - primaryInit.initialLocalX
          const dYLocal = result.y - primaryInit.initialLocalY
          const stage = stageRef.current
          if (stage) {
            for (const sib of multi.items) {
              if (sib.id === item.id) continue
              const sibNode = stage.findOne(`#media-${sib.id}`) as Konva.Image | null
              if (!sibNode) continue
              sibNode.x(sib.initialLocalX + dXLocal)
              sibNode.y(sib.initialLocalY + dYLocal)
            }
            stage.batchDraw()
          }
        }
      }

      setDragLive({
        itemId: item.id,
        slideIdx: target.slideIdx,
        x: result.x, y: result.y,
        width: bw, height: bh,
      })

      if (result.guides.length > 0) setActiveGuides({ slideIdx: target.slideIdx, guides: result.guides })
      else setActiveGuides(null)
    },
    [artboardPositions, getSlideAtPoint, items, W, H, gridSize, marginPx, snapGrid, snapCenter, snapItems, snapMargins],
  )

  const handleDragEnd = useCallback(
    (node: Konva.Image, item: PlacedMedia) => {
      setActiveGuides(null)
      setDragLive(null)
      const group = node.getParent()
      if (!group) return
      const groupX = group.x(), groupY = group.y()
      const bw = node.width() * Math.abs(node.scaleX()), bh = node.height() * Math.abs(node.scaleY())
      const itemWsCx = groupX + node.x() + bw / 2
      const itemWsCy = groupY + node.y() + bh / 2
      const target = getSlideAtPoint(itemWsCx, itemWsCy)
      if (!target) return
      const ap = artboardPositions[target.slideIdx]!
      const localX = groupX + node.x() - ap.x
      const localY = groupY + node.y() - ap.y
      const crossSlide = target.slideId !== item.slideId

      // Commit sibling positions for multi-drag, then clear state. Use the
      // primary's slide-local delta — same correction as in handleDragMove.
      const multi = dragMultiRef.current
      if (multi && multi.primary === item.id) {
        const primaryInit = multi.items.find((x) => x.id === item.id)
        if (primaryInit) {
          const dXLocal = localX - primaryInit.initialLocalX
          const dYLocal = localY - primaryInit.initialLocalY
          const patches = multi.items
            .filter((s) => s.id !== item.id)
            .map((s) => ({ id: s.id, patch: { x: s.initialLocalX + dXLocal, y: s.initialLocalY + dYLocal } }))
          if (patches.length) updateItems(patches)
        }
        dragMultiRef.current = null
      }
      // Same-slide: node.x is already correct (in this group's coords). No imperative
      // update needed. Cross-slide: we MUST NOT write new-slide-local coords while
      // the node is still parented to the old slide's Group — that would place it
      // at old_ap + localX for one frame (the sideways flash). Let React reparent
      // + reposition atomically in its next commit instead.
      if (crossSlide) moveItemToSlide(item.id, target.slideId)
      updateItem(item.id, { x: localX, y: localY, width: bw, height: bh })
    },
    [artboardPositions, getSlideAtPoint, moveItemToSlide, updateItem, updateItems],
  )

  // Force the Transformer to redraw when rotate mode or camera changes so the
  // anchor layout (which uses absolute/screen-space sizing) stays aligned with
  // the attached node's new absolute bounds.
  useEffect(() => {
    const tr = trRef.current
    if (!tr) return
    tr.forceUpdate()
    tr.getLayer()?.batchDraw()
  }, [rotateMode, zoom, panOffset.x, panOffset.y])

  /* ---- transformer sync ---- */
  useEffect(() => {
    const tr = trRef.current, stage = stageRef.current
    if (!tr || !stage) return
    if (selectedIds.length === 0 || cropItemId) { tr.nodes([]); tr.getLayer()?.batchDraw(); return }
    const findNodes = () => selectedIds
      .map((id) => stage.findOne(`#media-${id}`))
      .filter((n): n is Konva.Node => !!n)
    const nodes = findNodes()
    if (nodes.length === selectedIds.length) {
      tr.nodes(nodes)
      tr.getLayer()?.batchDraw()
      return
    }
    const interval = setInterval(() => {
      const ns = findNodes()
      if (ns.length === selectedIds.length) {
        tr.nodes(ns)
        tr.getLayer()?.batchDraw()
        clearInterval(interval)
      }
    }, 100)
    return () => clearInterval(interval)
  }, [selectedIds, items, cropItemId])

  /* ---- pixel inspector ---- */
  const LOUPE_SRC = 11 // pixels sampled from artboard
  const LOUPE_PX = 8   // rendered size per pixel
  const LOUPE_SIZE = LOUPE_SRC * LOUPE_PX
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null)
  const [pixelInfo, setPixelInfo] = useState<{ x: number; y: number; color: string; screenX: number; screenY: number } | null>(null)
  const altDownRef = useRef(false)

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') { e.preventDefault(); altDownRef.current = true }
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') { altDownRef.current = false; setPixelInfo(null) }
    }
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    return () => { window.removeEventListener('keydown', onDown, true); window.removeEventListener('keyup', onUp, true) }
  }, [])

  const handlePixelInspect = useCallback((e: React.MouseEvent) => {
    if (!altDownRef.current || !stageRef.current || !wrapRef.current) {
      if (pixelInfo) setPixelInfo(null)
      return
    }
    const rect = wrapRef.current.getBoundingClientRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top
    const wsX = (screenX - panOffset.x) / zoom
    const wsY = (screenY - panOffset.y) / zoom
    for (let i = 0; i < slides.length; i++) {
      const ap = artboardPositions[i]!
      if (wsX >= ap.x && wsX <= ap.x + W && wsY >= ap.y && wsY <= ap.y + H) {
        const half = Math.floor(LOUPE_SRC / 2)
        const sx = Math.floor(wsX) - half
        const sy = Math.floor(wsY) - half
        // Hide overlay layers so we sample artboard content only — the
        // hidden-zone veil uses destination-out hole-punching that doesn't
        // composite cleanly through Stage.toCanvas, leaving black over slides.
        // Also temporarily reset the stage transform so toCanvas's x/y/width/height
        // are interpreted in artboard (world) coords at 1:1, independent of zoom.
        const stage = stageRef.current
        const overlays = [veilLayerRef.current, guidesLayerRef.current, snapGuidesLayerRef.current, overlayLayerRef.current, igSafeAreaLayerRef.current]
        const wasVisible = overlays.map((l) => l?.visible() ?? true)
        const prevX = stage.x(), prevY = stage.y()
        const prevSX = stage.scaleX(), prevSY = stage.scaleY()
        overlays.forEach((l) => l?.visible(false))
        stage.position({ x: 0, y: 0 })
        stage.scale({ x: 1, y: 1 })
        let srcCanvas: HTMLCanvasElement
        try {
          srcCanvas = stage.toCanvas({ x: sx, y: sy, width: LOUPE_SRC, height: LOUPE_SRC, pixelRatio: 1 })
        } finally {
          stage.position({ x: prevX, y: prevY })
          stage.scale({ x: prevSX, y: prevSY })
          overlays.forEach((l, k) => l?.visible(wasVisible[k]!))
        }
        const srcCtx = srcCanvas.getContext('2d')
        if (srcCtx) {
          // Center pixel color
          const cp = srcCtx.getImageData(half, half, 1, 1).data
          const hex = '#' + [cp[0], cp[1], cp[2]].map((c) => (c ?? 0).toString(16).padStart(2, '0')).join('')
          // Draw magnified pixels onto loupe canvas
          const lc = loupeCanvasRef.current
          if (lc) {
            const lctx = lc.getContext('2d')
            if (lctx) {
              lctx.imageSmoothingEnabled = false
              lctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE)
              lctx.drawImage(srcCanvas, 0, 0, LOUPE_SRC, LOUPE_SRC, 0, 0, LOUPE_SIZE, LOUPE_SIZE)
              // Draw grid
              lctx.strokeStyle = 'rgba(241,242,245,0.12)'
              lctx.lineWidth = 0.5
              for (let gx = 0; gx <= LOUPE_SRC; gx++) {
                lctx.beginPath(); lctx.moveTo(gx * LOUPE_PX, 0); lctx.lineTo(gx * LOUPE_PX, LOUPE_SIZE); lctx.stroke()
              }
              for (let gy = 0; gy <= LOUPE_SRC; gy++) {
                lctx.beginPath(); lctx.moveTo(0, gy * LOUPE_PX); lctx.lineTo(LOUPE_SIZE, gy * LOUPE_PX); lctx.stroke()
              }
              // Highlight center pixel
              lctx.strokeStyle = '#f1f2f5'
              lctx.lineWidth = 1.5
              lctx.strokeRect(half * LOUPE_PX + 0.5, half * LOUPE_PX + 0.5, LOUPE_PX - 1, LOUPE_PX - 1)
            }
          }
          setPixelInfo({ x: Math.floor(wsX - ap.x), y: Math.floor(wsY - ap.y), color: hex, screenX, screenY })
        }
        return
      }
    }
    setPixelInfo(null)
  }, [zoom, panOffset, slides, artboardPositions, W, H, pixelInfo, LOUPE_SRC, LOUPE_PX, LOUPE_SIZE])

  /* ---- grid lines ---- */
  const gridLines = useMemo(() => {
    if (!showGrid || gridSize <= 0) return []
    const lines: [number, number, number, number][] = []
    for (let x = gridSize; x < W; x += gridSize) lines.push([x, 0, x, H])
    for (let y = gridSize; y < H; y += gridSize) lines.push([0, y, W, y])
    return lines
  }, [showGrid, gridSize, W, H])

  /* ---- export ---- */
  const exportSlidePng = useCallback(
    async (slideId: string) => {
      const stage = stageRef.current, gl = guidesLayerRef.current, sgl = snapGuidesLayerRef.current, vl = veilLayerRef.current, ol = overlayLayerRef.current, igl = igSafeAreaLayerRef.current
      if (!stage) return null
      const idx = slides.findIndex((s) => s.id === slideId)
      if (idx < 0) return null
      const ap = artboardPositions[idx]!
      const ps = stage.scaleX(), pp = stage.position()
      stage.scale({ x: 1, y: 1 }); stage.position({ x: 0, y: 0 })
      if (gl) gl.hide(); if (sgl) sgl.hide(); if (vl) vl.hide(); if (ol) ol.hide(); if (igl) igl.hide()
      stage.draw()
      const blob = (await stage.toBlob({ x: ap.x, y: ap.y, width: W, height: H, pixelRatio: 1, mimeType: 'image/png', quality: 1 })) as Blob | null
      if (gl) gl.show(); if (sgl) sgl.show(); if (vl) vl.show(); if (ol) ol.show(); if (igl) igl.show()
      stage.scale({ x: ps, y: ps }); stage.position(pp); stage.draw()
      return blob
    },
    [slides, artboardPositions, W, H],
  )

  /* ---- drag-out export ---- */
  // Per-slide refs that survive renders so the mousedown→dragstart timing
  // window has somewhere to park its in-flight prepare promise + the
  // resolved temp path. We keep them as Maps keyed by slide id so it's safe
  // to drag-prep multiple slides in quick succession.
  const dragInFlightRef = useRef<Map<string, Promise<string>>>(new Map())
  const dragPreparedPathRef = useRef<Map<string, string>>(new Map())

  const prepareDragForSlide = useCallback(async (slideId: string) => {
    if (!window.electronAPI?.prepareSlideDrag) return
    // If a prepare for this slide is already in-flight, reuse it. mousedown
    // can fire repeatedly without a drag actually starting.
    const existing = dragInFlightRef.current.get(slideId)
    if (existing) return existing
    const idx = slides.findIndex((s) => s.id === slideId)
    if (idx < 0) return
    const slide = slides[idx]!
    const trimmed = slide.name?.trim()
    const baseName = trimmed && trimmed.length > 0
      ? trimmed
      : `slide-${String(idx + 1).padStart(2, '0')}`
    const filename = `${baseName}.png`
    const promise = (async () => {
      const blob = await exportSlidePng(slideId)
      if (!blob) throw new Error('export-slide-png returned null')
      const buf = new Uint8Array(await blob.arrayBuffer())
      const fp = await window.electronAPI!.prepareSlideDrag({ filename, buffer: buf })
      dragPreparedPathRef.current.set(slideId, fp)
      dragInFlightRef.current.delete(slideId)
      return fp
    })().catch((err) => {
      dragInFlightRef.current.delete(slideId)
      console.warn('[slide-drag] prepare failed:', err)
      throw err
    })
    dragInFlightRef.current.set(slideId, promise)
    return promise
  }, [exportSlidePng, slides])

  const onSlideDragStart = useCallback((e: React.DragEvent, slideId: string) => {
    if (!window.electronAPI?.startSlideDrag) {
      // Running in browser (no Electron) — let the browser do its own
      // HTML5 drag of the underlying element. Nothing to do here.
      return
    }
    const fp = dragPreparedPathRef.current.get(slideId)
    if (!fp) {
      // Path isn't on disk yet. Abort this drag and kick off a prepare so
      // a near-immediate retry succeeds. The mousedown handler should
      // already have started one, but a missed-prepare retry shouldn't
      // require a full second mousedown.
      e.preventDefault()
      void prepareDragForSlide(slideId)
      return
    }
    const iconDataUrl = thumbnails[slideId] || ''
    window.electronAPI.startSlideDrag({ filePath: fp, iconDataUrl })
    // Subsequent drags need a fresh prepare in case the slide changed.
    dragPreparedPathRef.current.delete(slideId)
  }, [thumbnails, prepareDragForSlide])

  /* ---- export slide as video (frame-by-frame seek → ffmpeg) ---- */
  const exportSlideVideo = useCallback(
    async (
      slideId: string,
      outputPath: string,
      fps = 30,
      onProgress?: (pct: number) => void,
      onPreviewFrame?: (dataUrl: string) => void,
    ): Promise<string | null> => {
      if (!window.electronAPI) return null
      const stage = stageRef.current, gl = guidesLayerRef.current, sgl = snapGuidesLayerRef.current, vl = veilLayerRef.current, ol = overlayLayerRef.current, igl = igSafeAreaLayerRef.current
      if (!stage) return null
      const st = useTiovivoStore.getState()
      const idx = st.slides.findIndex((s) => s.id === slideId)
      if (idx < 0) return null
      const ap = artboardPositions[idx]!

      // Find all animated items visible on this slide. GIF masters are rendered
      // as real animated ghosts on every slide, so any slide showing one must
      // export as MP4 even though the source item's home slideId differs.
      const slideVideoItems = st.items.filter((i) => i.slideId === slideId && i.type === 'video')
      const slideGifItems = st.items.filter((i) =>
        i.type === 'gif' && (i.slideId === slideId || (i.appearsOnAllSlides && i.slideId !== slideId)),
      )
      if (!slideVideoItems.length && !slideGifItems.length) return null

      // Get the video elements and determine max duration (respecting trim)
      type VEntry = {
        item: PlacedMedia
        el: HTMLVideoElement
        coverTime: number
        trimStart: number
        trimEnd: number
        effDur: number
      }
      const videoEls: VEntry[] = []
      let maxDuration = 0
      for (const vi of slideVideoItems) {
        const el = videoElements.get(vi.id)
        if (!el) continue
        const trimStart = vi.trimStart || 0
        const trimEnd = vi.trimEnd && vi.trimEnd > 0 ? Math.min(vi.trimEnd, el.duration) : el.duration
        const effDur = Math.max(0, trimEnd - trimStart)
        videoEls.push({ item: vi, el, coverTime: vi.coverTime || 0, trimStart, trimEnd, effDur })
        if (effDur > maxDuration) maxDuration = effDur
      }
      // Pull in GIF loop durations too — a slide with both a video and a GIF
      // exports for whichever is longer.
      for (const gi of slideGifItems) {
        const dur = gi.gifDuration ?? 5
        if (dur > maxDuration) maxDuration = dur
      }
      if (maxDuration <= 0 || !isFinite(maxDuration)) return null

      // GIF-only path. Browsers animate GIFs autonomously inside their
      // HTMLImageElement, so there's nothing to seek — we just let wall-
      // clock time march and capture Konva's layer at each tick. The
      // resulting MP4 loops the GIF as many times as fits in gifDuration.
      if (videoEls.length === 0) {
        const sessionId = crypto.randomUUID()
        const totalFrames = Math.max(1, Math.ceil(maxDuration * fps))
        try {
          await window.electronAPI.startVideoEncode({
            sessionId,
            width: W,
            height: H,
            fps,
            duration: maxDuration,
            outputPath,
          })
          const ps = stage.scaleX(), pp = stage.position()
          stage.scale({ x: 1, y: 1 }); stage.position({ x: 0, y: 0 })
          if (gl) gl.hide(); if (sgl) sgl.hide(); if (vl) vl.hide(); if (ol) ol.hide(); if (igl) igl.hide()
          try {
            const startMs = performance.now()
            let pendingWrite: Promise<void> = Promise.resolve()
            let lastPreviewAt = -Infinity
            for (let i = 0; i < totalFrames; i++) {
              const targetMs = (i / fps) * 1000
              const waitMs = startMs + targetMs - performance.now()
              if (waitMs > 0) await new Promise<void>((r) => setTimeout(r, waitMs))
              stage.draw()
              const canvas = stage.toCanvas({ x: ap.x, y: ap.y, width: W, height: H, pixelRatio: 1 })
              const ctx = canvas.getContext('2d')!
              const frameData = new Uint8Array(ctx.getImageData(0, 0, W, H).data.buffer)
              await pendingWrite
              pendingWrite = window.electronAPI.videoFrame({ sessionId, frameData })
              onProgress?.(((i + 1) / totalFrames) * 100)
              // Throttle preview to ~2 fps.
              const now = performance.now()
              if (onPreviewFrame && now - lastPreviewAt > 500) {
                lastPreviewAt = now
                try { onPreviewFrame(canvas.toDataURL('image/jpeg', 0.92)) } catch { /* ignore */ }
              }
            }
            await pendingWrite
            const result = await window.electronAPI.endVideoEncode({ sessionId })
            return result
          } finally {
            if (gl) gl.show(); if (sgl) sgl.show(); if (vl) vl.show(); if (ol) ol.show(); if (igl) igl.show()
            stage.scale({ x: ps, y: ps }); stage.position(pp); stage.draw()
          }
        } catch (err) {
          console.error('[export] gif-only slide failed:', err)
          return null
        }
      }

      // The "master" video drives capture timing: the rest play freely and
      // get captured along with it at each tick. We pick the longest one so
      // the export covers the full slide duration.
      let master: VEntry = videoEls[0]!
      for (const v of videoEls) if (v.effDur > master.effDur) master = v

      // Pause all videos and remember their state
      for (const { el } of videoEls) {
        el.pause()
        el.loop = false
      }

      const sessionId = crypto.randomUUID()
      // frame 0 = cover frame; frames 1..N = full video from start
      const videoFrames = Math.ceil(maxDuration * fps)
      const totalFrames = 1 + videoFrames

      try {
        // Start ffmpeg session. The response includes which encoder ffmpeg
        // is actually using — log it to the renderer console so the user
        // can confirm GPU vs CPU via View → Toggle Developer Tools.
        const startResult = await window.electronAPI.startVideoEncode({
          sessionId,
          width: W,
          height: H,
          fps,
          duration: maxDuration,
          outputPath,
        })
        console.log(
          `[export] slide ${idx + 1}: ${W}×${H} ${fps}fps, ${totalFrames} frames, ` +
          `encoder=${(startResult as { encoder?: string }).encoder ?? 'unknown'}`,
        )

        // Save & reset stage transform
        const ps = stage.scaleX(), pp = stage.position()
        stage.scale({ x: 1, y: 1 }); stage.position({ x: 0, y: 0 })
        if (gl) gl.hide(); if (sgl) sgl.hide(); if (vl) vl.hide(); if (ol) ol.hide(); if (igl) igl.hide()

        // ---- Playback-driven capture ----
        // Old approach seeked every video every frame (~80-150 ms per seek
        // on healthy h264). New approach plays the videos at native rate
        // and samples frames in real time. Cuts per-frame overhead down to
        // just draw + readPixels + IPC (~30-50 ms), typically 2-3× faster
        // overall.
        //
        // Assumption: source video fps ≥ target output fps. For 30 fps
        // sources at 30 fps target this is exact. For 60 fps source the
        // sampler skips half the callbacks. For source fps < target (e.g.
        // 24 fps), the output will be slightly shorter than the source —
        // acceptable for the carousel use case; could fall back to the
        // seek loop later if needed.

        let pendingWrite: Promise<void> = Promise.resolve()
        let framesSent = 0

        const captureFrame = (): { frameData: Uint8Array; canvas: HTMLCanvasElement } => {
          stage.draw()
          const canvas = stage.toCanvas({
            x: ap.x, y: ap.y,
            width: W, height: H,
            pixelRatio: 1,
          })
          const ctx = canvas.getContext('2d')!
          const imageData = ctx.getImageData(0, 0, W, H)
          return { frameData: new Uint8Array(imageData.data.buffer), canvas }
        }

        // Throttled preview emitter — produces a JPEG data URL from the
        // just-captured canvas, ~2x/second. Uses the canvas at its native
        // export resolution so the user sees the real output quality,
        // not a thumbnail that might be mistaken for a low-quality
        // setting. JPEG quality 0.92 is visually near-identical to the
        // h264 output we're producing and keeps each preview under
        // ~300 KB at 1080×1350. Encode cost is ~15-30 ms; firing at 2 Hz
        // costs ~5% of one CPU core, well within budget vs ffmpeg.
        const PREVIEW_INTERVAL_MS = 500
        let lastPreviewAt = -Infinity
        const maybeEmitPreview = (sourceCanvas: HTMLCanvasElement) => {
          if (!onPreviewFrame) return
          const now = performance.now()
          if (now - lastPreviewAt < PREVIEW_INTERVAL_MS) return
          lastPreviewAt = now
          try {
            onPreviewFrame(sourceCanvas.toDataURL('image/jpeg', 0.92))
          } catch (err) {
            console.warn('[export] preview encode failed:', err)
          }
        }

        const sendFrame = async (frameData: Uint8Array) => {
          // Pipeline backpressure: wait for the previous frame's ack before
          // dispatching the next. Frame 0 gets a longer timeout for HW
          // encoder warmup.
          const ackTimeoutMs = framesSent === 0 ? 30000 : 10000
          let timeoutTimer: ReturnType<typeof setTimeout> | undefined
          try {
            await Promise.race([
              pendingWrite,
              new Promise<void>((_resolve, reject) => {
                timeoutTimer = setTimeout(() => {
                  reject(new Error(
                    `Frame ${framesSent} timed out after ${ackTimeoutMs}ms — ffmpeg likely hung. ` +
                    `Open View → Toggle Developer Tools to see ffmpeg stderr for details.`,
                  ))
                }, ackTimeoutMs)
              }),
            ])
          } finally {
            if (timeoutTimer) clearTimeout(timeoutTimer)
          }
          // electronAPI was non-null-checked at the start of exportSlideVideo;
          // re-asserting here because the closure has lost the narrowing.
          pendingWrite = window.electronAPI!.videoFrame({ sessionId, frameData })
          framesSent++
          onProgress?.((framesSent / totalFrames) * 100)
        }

        // Common helper for the one-shot seeks (cover-time + trim-start).
        // Resolves on 'seeked' or after a hard timeout so a misbehaving
        // video can't wedge the export.
        const seekToWithTimeout = (el: HTMLVideoElement, target: number, label: string) =>
          new Promise<void>((resolve) => {
            if (Math.abs(el.currentTime - target) < 1e-4) { resolve(); return }
            let done = false
            const finish = () => {
              if (done) return
              done = true
              el.removeEventListener('seeked', onSeeked)
              clearTimeout(timer)
              resolve()
            }
            const onSeeked = () => finish()
            const timer = setTimeout(() => {
              console.warn(`[export] ${label} seek timed out target=${target.toFixed(3)}s — continuing`)
              finish()
            }, 5000)
            el.addEventListener('seeked', onSeeked)
            el.currentTime = target
          })

        // ---- Cover frame (frame 0) ----
        // Swap in user-picked cover images, seek each video to its
        // coverTime, capture once, then restore the live video sources
        // so subsequent playback frames render the stream.
        const coverSwaps: { node: Konva.Image; original: CanvasImageSource }[] = []
        for (const { item } of videoEls) {
          if (!item.coverImageSrc) continue
          const coverImg = coverImageElements.get(item.id)
          if (!coverImg) continue
          const node = stage.findOne(`#media-${item.id}`) as Konva.Image | undefined
          if (!node) continue
          coverSwaps.push({ node, original: node.image() as CanvasImageSource })
          node.image(coverImg)
        }
        await Promise.all(videoEls.map(({ item, el, coverTime, trimEnd }) => {
          if (item.coverImageSrc && coverImageElements.has(item.id)) return Promise.resolve()
          const cap = Math.min(trimEnd, el.duration || 0) - 0.001
          if (!isFinite(cap) || cap <= 0) return Promise.resolve()
          const target = Math.max(0, Math.min(coverTime, cap))
          return seekToWithTimeout(el, target, `cover ${item.id.slice(0, 6)}`)
        }))
        await new Promise<void>((r) => requestAnimationFrame(() => r()))
        {
          const captured = captureFrame()
          await sendFrame(captured.frameData)
          // Emit the cover frame as the first preview so the user
          // immediately sees content rather than the frozen pre-export
          // snapshot lingering for a beat.
          maybeEmitPreview(captured.canvas)
        }
        for (const { node, original } of coverSwaps) {
          node.image(original as unknown as Parameters<Konva.Image['image']>[0])
        }

        // ---- Playback frames ----
        // Position every video at its trimStart, then play() all of them
        // in parallel. We poll master.currentTime via rAF; when it crosses
        // each 1/fps boundary we capture and forward a frame.
        await Promise.all(videoEls.map(({ el, trimStart, trimEnd }) => {
          const cap = Math.min(trimEnd, el.duration || 0) - 0.001
          if (!isFinite(cap) || cap <= 0) return Promise.resolve()
          const target = Math.max(0, Math.min(trimStart, cap))
          return seekToWithTimeout(el, target, 'trimStart')
        }))
        // One rAF after seeks so the canvas reflects the freshly-positioned
        // frame before playback advances.
        await new Promise<void>((r) => requestAnimationFrame(() => r()))

        for (const { el } of videoEls) {
          el.playbackRate = 1
          el.muted = true
          try {
            const p = el.play()
            if (p) p.catch((err) => console.warn('[export] play() rejected', err))
          } catch (err) {
            console.warn('[export] play() threw', err)
          }
        }

        // Main playback loop. We sample at evenly-spaced video-time
        // intervals (1 / fps), backpressure-gated on the IPC pipeline:
        // if a send is still in flight when the next interval comes due,
        // skip the capture and let the master move on. The output is
        // slightly fewer frames than expected in that pathological case,
        // but the wall-clock pacing stays correct.
        const frameInterval = 1 / fps
        await new Promise<void>((resolve, reject) => {
          let stopping = false
          let inFlight = false
          // First playback frame is emitted at videoTime == trimStart, so
          // arm the next-emit threshold to fire immediately on the first
          // tick by setting it one interval below the start.
          let nextEmitVideoTime = master.trimStart - 1e-4
          const stop = (err?: Error) => {
            if (stopping) return
            stopping = true
            for (const { el } of videoEls) {
              try { el.pause() } catch { /* ignore */ }
            }
            if (err) reject(err); else resolve()
          }
          const tick = () => {
            if (stopping) return
            const videoTime = master.el.currentTime
            if (videoTime >= master.trimEnd - 1e-3 || framesSent >= totalFrames) {
              stop()
              return
            }
            // Master crossed the next emission slot? Capture, send, advance.
            // The inFlight gate prevents queue buildup if IPC is slow.
            if (!inFlight && videoTime >= nextEmitVideoTime + frameInterval) {
              nextEmitVideoTime += frameInterval
              inFlight = true
              const captured = captureFrame()
              sendFrame(captured.frameData)
                .then(() => { inFlight = false })
                .catch((err) => stop(err))
              maybeEmitPreview(captured.canvas)
            }
            requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        })

        await pendingWrite

        // Restore stage
        if (gl) gl.show(); if (sgl) sgl.show(); if (vl) vl.show(); if (ol) ol.show(); if (igl) igl.show()
        stage.scale({ x: ps, y: ps }); stage.position(pp); stage.draw()

        // Finish encoding
        const result = await window.electronAPI.endVideoEncode({ sessionId })
        return result
      } catch (err) {
        console.error('Video export failed:', err)
        return null
      } finally {
        // Restore video playback
        for (const { el } of videoEls) {
          el.loop = true
          el.play().catch(() => {})
        }
      }
    },
    [artboardPositions, W, H],
  )

  useImperativeHandle(ref, () => ({
    exportSlidePng,
    exportSlideVideo,
    fitToScreen,
    applyCrop: () => { cropApplyRef.current?.() },
  }), [exportSlidePng, exportSlideVideo, fitToScreen])

  /* ---- render ---- */
  // Chrome (slide labels, action buttons, zoom indicator) sits over the
  // workspace pasteboard. Switch its tint from white→black when the workspace
  // is too light for white text to read. CSS custom properties scoped to this
  // wrapper let every descendant pick the right opacity without each having
  // to compute luminance.
  const chromeStyleVars = (() => {
    const hex = (workspaceBgColor || '#0a0a0e').replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16) || 0
    const g = parseInt(hex.slice(2, 4), 16) || 0
    const b = parseInt(hex.slice(4, 6), 16) || 0
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const dark = lum > 140
    const fg = dark ? '17, 18, 22' : '241, 242, 245'
    return {
      ['--chrome-fg' as string]: `rgba(${fg}, 0.85)`,
      ['--chrome-fg-med' as string]: `rgba(${fg}, 0.6)`,
      ['--chrome-fg-dim' as string]: `rgba(${fg}, 0.45)`,
      ['--chrome-fg-faint' as string]: `rgba(${fg}, 0.3)`,
    } as React.CSSProperties
  })()

  return (
    <div
      ref={wrapRef}
      className="editor-stage-wrap"
      style={{
        width: maxViewWidth,
        height: maxViewHeight,
        overflow: 'hidden',
        position: 'relative',
        ...chromeStyleVars,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => { onPointerMove(e); handlePixelInspect(e) }}
      onPointerUp={onPointerUp}
    >
      {/* Pixel inspector tooltip with magnifier */}
      <canvas
        ref={loupeCanvasRef}
        width={LOUPE_SIZE}
        height={LOUPE_SIZE}
        style={{ display: 'none' }}
      />
      {pixelInfo && (
        <div style={{
          position: 'absolute',
          left: pixelInfo.screenX + 20,
          top: pixelInfo.screenY + 20,
          zIndex: 20,
          pointerEvents: 'none',
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(18,18,24,0.95)',
          border: '1px solid rgba(241,242,245,0.15)',
          borderRadius: 8,
          overflow: 'hidden',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 4px 20px rgba(10,11,15,0.5)',
        }}>
          <canvas
            width={LOUPE_SIZE}
            height={LOUPE_SIZE}
            style={{ width: LOUPE_SIZE, height: LOUPE_SIZE, display: 'block' }}
            ref={(el) => {
              if (!el || !loupeCanvasRef.current) return
              const ctx = el.getContext('2d')
              if (ctx) {
                ctx.imageSmoothingEnabled = false
                ctx.drawImage(loupeCanvasRef.current, 0, 0)
              }
            }}
          />
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 8px',
          }}>
            <div style={{
              width: 14, height: 14, borderRadius: 3,
              background: pixelInfo.color,
              border: '1px solid rgba(241,242,245,0.25)',
              flexShrink: 0,
            }} />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#f1f2f5' }}>
              {pixelInfo.color}
            </span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'rgba(241,242,245,0.4)', marginLeft: 'auto' }}>
              {pixelInfo.x},{pixelInfo.y}
            </span>
          </div>
        </div>
      )}

      {/* Zoom controls — wrapped in a translucent dark pill so they stay
          legible when the user zooms in and a bright slide ends up behind
          them. Otherwise --chrome-fg (white-on-dark) would disappear
          against a white slide bg. The pill plus z-index sits above all
          Konva canvases via standard stacking-context rules. */}
      <div
        className="zoom-pill"
        style={{
          position: 'absolute',
          bottom: 10,
          right: 12,
          zIndex: 10,
          display: 'flex',
          gap: 2,
          alignItems: 'center',
          padding: 2,
        }}
      >
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={fitToScreen}
          title="Fit to screen"
          style={{ fontSize: '0.76rem', padding: '5px 10px', color: 'rgba(241,242,245,0.78)' }}
        >
          Fit
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={zoomTo100}
          title="Reset zoom to 100%"
          style={{
            fontSize: '0.76rem',
            padding: '5px 6px',
            color: 'rgba(241,242,245,0.58)',
            fontFamily: 'var(--mono)',
            minWidth: 48,
            textAlign: 'right',
            justifyContent: 'flex-end',
          }}
        >
          {Math.round(zoom * 100)}%
        </button>
      </div>

      {/* HTML overlay: slide labels, color pickers, + buttons — SCREEN space.
          Chrome colours adapt to workspace luminance via --chrome-fg-* CSS
          custom properties set on the outer .editor-stage-wrap. Children
          reference them with var(--chrome-fg-...) instead of hard-coded
          rgba(241,242,245,...) so white workspaces don't hide the chrome. */}
      <div
        style={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: isReordering ? 'auto' : 'none' }}
        onMouseMove={(e) => {
          if (!reorderDragRef.current) return
          const rect = wrapRef.current?.getBoundingClientRect()
          if (!rect) return
          const mx = e.clientX - rect.left
          // Find which gap (or end) the mouse is closest to for insertion
          let bestTarget: string | null = null
          let bestDist = Infinity
          for (let j = 0; j < slides.length; j++) {
            if (slides[j]!.id === reorderDragRef.current) continue
            const ap = artboardPositions[j]!
            const sx = ap.x * zoom + panOffset.x
            const cx = sx + (W * zoom) / 2
            const dist = Math.abs(mx - cx)
            if (dist < bestDist) { bestDist = dist; bestTarget = slides[j]!.id }
          }
          setReorderDropTarget(bestTarget)
        }}
        onMouseUp={() => {
          if (reorderDragRef.current && reorderDropTarget) {
            reorderSlides(reorderDragRef.current, reorderDropTarget)
          }
          reorderDragRef.current = null
          setIsReordering(false)
          setReorderDropTarget(null)
          document.body.style.cursor = ''
        }}
      >
        {slides.map((slide, i) => {
          const ap = artboardPositions[i]!
          const screenX = ap.x * zoom + panOffset.x
          const screenY = ap.y * zoom + panOffset.y
          const screenW = W * zoom
          const screenH = H * zoom
          const isDropTarget = reorderDropTarget === slide.id
          const isDragged = isReordering && reorderDragRef.current === slide.id
          const isActive = slide.id === activeSlideId

          return (
            <div key={slide.id}>
              {/* Slide label — mousedown to start reorder. The currently-
                  active slide gets a subtle accent pill so it's visible at
                  a glance even when the artboards are far apart or zoomed
                  out. */}
              <div
                className={[
                  'artboard-label',
                  isActive ? 'artboard-label--active' : '',
                  isDropTarget ? 'artboard-label--drop-target' : '',
                  isDragged ? 'artboard-label--dragged' : '',
                ].filter(Boolean).join(' ')}
                onMouseDown={(e) => {
                  if (e.button !== 0) return
                  e.stopPropagation()
                  // Clicking the label activates the slide. Fires on the
                  // first mousedown so a click-without-drag still selects;
                  // if the user proceeds to drag, the reorder logic below
                  // takes over without losing the activation side-effect.
                  useTiovivoStore.getState().setActiveSlide(slide.id)
                  reorderDragRef.current = slide.id
                  setIsReordering(true)
                  document.body.style.cursor = 'grabbing'
                }}
                style={{
                  position: 'absolute',
                  left: screenX,
                  top: screenY - 26,
                  cursor: isReordering ? 'grabbing' : 'grab',
                  pointerEvents: 'auto',
                  opacity: isDragged ? 0.7 : 1,
                }}
              >
                {(() => {
                  const fallbackName = `Slide ${i + 1}`
                  const displayName = slide.name?.trim() || fallbackName
                  const isRenaming = renamingSlideId === slide.id

                  const commit = () => {
                    const trimmed = renameDraft.trim()
                    // Treat "Slide N" as a clear of the custom name so users
                    // can reset by typing the default back in.
                    if (trimmed === '' || trimmed === fallbackName) {
                      setSlideName(slide.id, '')
                    } else if (trimmed !== displayName) {
                      setSlideName(slide.id, trimmed)
                    }
                    setRenamingSlideId(null)
                  }
                  const cancel = () => setRenamingSlideId(null)

                  if (isRenaming) {
                    return (
                      <input
                        autoFocus
                        type="text"
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); commit() }
                          else if (e.key === 'Escape') { e.preventDefault(); cancel() }
                          e.stopPropagation()
                        }}
                        onBlur={commit}
                        // Block the parent label's mousedown so we don't start
                        // a reorder drag when clicking inside the input.
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onFocus={(e) => e.currentTarget.select()}
                        spellCheck={false}
                        maxLength={80}
                        style={{
                          background: 'rgba(10, 11, 15, 0.4)',
                          border: '1px solid color-mix(in srgb, var(--hot) 45%, transparent)',
                          borderRadius: 3,
                          color: 'inherit',
                          font: 'inherit',
                          padding: '0 4px',
                          outline: 'none',
                          minWidth: 60,
                          width: `${Math.max(60, renameDraft.length * 8 + 16)}px`,
                          opacity: slide.exportEnabled ? 1 : 0.45,
                        }}
                      />
                    )
                  }
                  return (
                    <span
                      className="artboard-label__name"
                      title="Double-click to rename"
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        // Cancel any in-progress reorder triggered by the
                        // first half of the double-click — see the parent
                        // onMouseDown above.
                        reorderDragRef.current = null
                        setIsReordering(false)
                        document.body.style.cursor = ''
                        setRenameDraft(displayName)
                        setRenamingSlideId(slide.id)
                      }}
                      style={{ opacity: slide.exportEnabled ? 1 : 0.45 }}
                    >
                      {displayName}
                    </span>
                  )
                })()}
                <button
                  type="button"
                  className={`artboard-label__export ${slide.exportEnabled ? 'artboard-label__export--on' : ''}`}
                  title={slide.exportEnabled ? 'Included in export — click to skip' : 'Skipped in export — click to include'}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); toggleSlideExport(slide.id) }}
                >
                  {slide.exportEnabled ? '✓ export' : '⌀ skip'}
                </button>
                {onExportSingleSlide && (
                  <button
                    type="button"
                    className="artboard-label__icon"
                    title="Export only this slide"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onExportSingleSlide(slide.id) }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 4v12" />
                      <path d="M7 11l5 5 5-5" />
                      <path d="M5 20h14" />
                    </svg>
                  </button>
                )}
                {window.electronAPI?.prepareSlideDrag && (
                  <div
                    className="artboard-label__icon"
                    draggable
                    title="Drag to Finder / Slack / a browser tab to export this slide as a PNG"
                    onMouseDown={(e) => {
                      e.stopPropagation()
                      void prepareDragForSlide(slide.id)
                    }}
                    onDragStart={(e) => {
                      e.stopPropagation()
                      onSlideDragStart(e, slide.id)
                    }}
                    style={{ cursor: 'grab' }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none" />
                      <circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none" />
                      <circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" />
                      <circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" />
                      <circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none" />
                      <circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none" />
                    </svg>
                  </div>
                )}
                <button
                  type="button"
                  className="artboard-label__icon"
                  title="Duplicate slide"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); duplicateSlide(slide.id) }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="8" y="8" width="13" height="13" rx="2" />
                    <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
                  </svg>
                </button>
                {slides.length > 1 && (
                  <button
                    type="button"
                    className="artboard-label__icon artboard-label__icon--danger"
                    title="Remove slide"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); removeSlide(slide.id) }}
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Drop indicator line — left edge of drop target */}
              {isDropTarget && (
                <div style={{
                  position: 'absolute',
                  left: screenX - 3,
                  top: screenY - 30,
                  width: 3,
                  height: screenH + 38,
                  background: 'var(--accent)',
                  borderRadius: 2,
                  pointerEvents: 'none',
                  boxShadow: '0 0 8px rgba(124,108,240,0.5)',
                }} />
              )}

              {/* Dragged slide outline overlay */}
              {isDragged && (
                <div style={{
                  position: 'absolute',
                  left: screenX,
                  top: screenY,
                  width: screenW,
                  height: screenH,
                  border: '2px dashed var(--accent)',
                  borderRadius: 4,
                  pointerEvents: 'none',
                  opacity: 0.5,
                }} />
              )}

              {/* Background colour picker — below artboard. Hidden when the
                  slide is in Vibe mode, since bgColor is unused and the
                  picker would be misleading clutter; the Background panel's
                  palette is the source of truth in that case. */}
              {!slide.bgVibe && (
                <div
                  className="artboard-bg-chip"
                  style={{
                    position: 'absolute',
                    left: screenX,
                    top: screenY + screenH + 8,
                    pointerEvents: 'auto',
                  }}
                >
                  <input
                    type="color"
                    value={slide.bgColor || '#ffffff'}
                    onChange={(e) => setSlideBgColor(slide.id, e.target.value)}
                    title="Slide background color"
                  />
                  <span className="artboard-bg-chip__value">
                    {slide.bgColor || '#ffffff'}
                  </span>
                </div>
              )}

              {/* Upscale warning badges — one per upscaled item, anchored to the
                  item's top-right corner. HTML overlay so it never lands in exports.
                  Suppressed entirely in preview mode (treat the canvas as final). */}
              {!previewMode && items
                .filter((it) => it.slideId === slide.id)
                .map((it) => {
                  const live = dragLive && dragLive.itemId === it.id && dragLive.slideIdx === i ? dragLive : null
                  const ix = live ? live.x : it.x
                  const iy = live ? live.y : it.y
                  const iw = live ? live.width : it.width
                  const ih = live ? live.height : it.height
                  const isUp = it.naturalWidth > 0 && it.naturalHeight > 0 &&
                    (iw > it.naturalWidth * 1.01 || ih > it.naturalHeight * 1.01)
                  if (!isUp) return null
                  const bx = (ap.x + ix + iw) * zoom + panOffset.x
                  const by = (ap.y + iy) * zoom + panOffset.y
                  const targetW = Math.round(iw)
                  const targetH = Math.round(ih)
                  return (
                    <div
                      key={`warn-${it.id}`}
                      title={`Upscaled past native size (${it.naturalWidth}×${it.naturalHeight}px → ${targetW}×${targetH}px). Quality will degrade in export.`}
                      style={{
                        position: 'absolute',
                        left: bx,
                        top: by,
                        transform: 'translate(-50%, -50%)',
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        background: '#ffb020',
                        color: '#1a1100',
                        border: '2px solid rgba(10,11,15,0.55)',
                        boxShadow: '0 2px 6px rgba(10,11,15,0.5)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 14,
                        fontWeight: 800,
                        fontFamily: 'system-ui, sans-serif',
                        cursor: 'help',
                        pointerEvents: 'auto',
                        userSelect: 'none',
                      }}
                    >
                      !
                    </div>
                  )
                })}

              {/* Layer stack — below color picker */}
              <div
                style={{
                  position: 'absolute',
                  left: screenX,
                  top: screenY + screenH + 38,
                  width: Math.max(200, screenW),
                  pointerEvents: 'auto',
                }}
              >
                <LayerStack
                  slideId={slide.id}
                  slideIndex={i}
                  slideAbsoluteX={ap.x}
                  slideWidth={W}
                  slideHeight={H}
                  slideAbsoluteXBySlideId={slideAbsoluteXBySlideId}
                />
              </div>

              {/* + button AFTER this artboard — hidden in seamless mode */}
              {/* "+" button between slides. Hidden in seamless mode for
                  inner slides (those dividers would visually break the
                  flush layout), but ALWAYS shown after the last slide so
                  there's still a way to append a new one. */}
              {(!seamlessSlides || i === slides.length - 1) && <button
                type="button"
                className="artboard-add-btn"
                title="Add slide"
                onClick={(e) => { e.stopPropagation(); addSlide(i) }}
                style={{
                  position: 'absolute',
                  // In seamless mode artboardGap is 0, so the natural button
                  // position sits exactly on the slide's right edge with half
                  // of itself overlapping the slide content. Add a fixed
                  // screen-space offset (button radius + breathing room) so
                  // the button is clearly OUTSIDE the slide in that case.
                  left: screenX + screenW + (seamlessSlides ? 24 : (artboardGap * zoom) / 2),
                  top: screenY + screenH / 2,
                  transform: 'translate(-50%, -50%)',
                  pointerEvents: 'auto',
                  width: 28, height: 28, borderRadius: '50%',
                  border: '1.5px solid rgba(241,242,245,0.2)',
                  background: 'rgba(30,30,40,0.85)',
                  color: 'rgba(241,242,245,0.5)',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'border-color 0.15s, color 0.15s, background 0.15s',
                }}
                onMouseEnter={(e) => {
                  const b = e.currentTarget
                  b.style.borderColor = '#3b82f6'
                  b.style.color = '#f1f2f5'
                  b.style.background = '#3b82f6'
                }}
                onMouseLeave={(e) => {
                  const b = e.currentTarget
                  b.style.borderColor = 'rgba(241,242,245,0.2)'
                  b.style.color = 'rgba(241,242,245,0.5)'
                  b.style.background = 'rgba(30,30,40,0.85)'
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                  <rect x="4.5" y="0" width="1" height="10" />
                  <rect x="0" y="4.5" width="10" height="1" />
                </svg>
              </button>}
            </div>
          )
        })}

        {/* Contextual toolbar for selected item (hidden in multi-select) */}
        {selectedId && !isMultiSelect && (() => {
          const sel = items.find((i) => i.id === selectedId)
          if (!sel) return null
          // While dragging, use the live position so floating controls follow the item.
          const live = dragLive?.itemId === sel.id ? dragLive : null
          const effSlideIdx = live ? live.slideIdx : slides.findIndex((sv) => sv.id === sel.slideId)
          if (effSlideIdx < 0) return null
          const sap = artboardPositions[effSlideIdx]!
          const effX = live ? live.x : sel.x
          const effY = live ? live.y : sel.y
          const effW = live ? live.width : sel.width
          const effH = live ? live.height : sel.height
          let topY = effY, cx = effX + effW / 2
          if (sel.id === cropItemId && sel.cropW > 0) {
            const sc = sel.width / sel.cropW
            topY = Math.min(sel.y, sel.y - sel.cropY * sc)
            cx = sel.x - sel.cropX * sc + (sel.naturalWidth * sc) / 2
          }
          const stx = (sap.x + cx) * zoom + panOffset.x
          const sty = (sap.y + topY) * zoom + panOffset.y

          const btnBase: React.CSSProperties = {
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 28, border: 'none', borderRadius: 5,
            background: 'transparent', color: 'rgba(241,242,245,0.7)',
            cursor: 'pointer', transition: 'background 0.12s, color 0.12s',
          }

          const itemCenterX = (sap.x + effX + effW / 2) * zoom + panOffset.x
          const itemScreenW = effW * zoom
          const itemBottomY = (sap.y + effY + effH) * zoom + panOffset.y
          const playbackBarTop = itemBottomY + 8
          // Corrections/cover frame popover sits just above the toolbar (which is at sty - 42).
          // Component uses translateY(-100%), so this is its bottom edge.
          const correctionsTop = sty - 42 - 6

          return (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <div
              className="floating-toolbar"
              style={{
                position: 'absolute',
                left: stx,
                top: sty - 42,
                transform: 'translateX(-50%)',
                pointerEvents: 'auto',
                zIndex: 2,
              }}
            >
              {!cropItemId ? (
                <>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setCropMode(selectedId) }}
                    title="Crop image"
                    style={btnBase}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(241,242,245,0.1)'; e.currentTarget.style.color = '#f1f2f5' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(241,242,245,0.7)' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M4.5 1v10.5H15" />
                      <path d="M11.5 15V4.5H1" />
                    </svg>
                  </button>
                  {sel.cropW > 0 && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); resetCropAction(selectedId) }}
                      title="Reset crop"
                      style={btnBase}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(241,242,245,0.1)'; e.currentTarget.style.color = '#f1f2f5' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(241,242,245,0.7)' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="1 4 1 10 7 10" />
                        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                      </svg>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); fitItemToSlide(selectedId!) }}
                    title="Fit to slide"
                    style={btnBase}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(241,242,245,0.1)'; e.currentTarget.style.color = '#f1f2f5' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(241,242,245,0.7)' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="1.5" />
                      <rect x="8" y="9" width="8" height="6" rx="0.5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); fillItemToSlide(selectedId!) }}
                    title="Fill slide"
                    style={btnBase}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(241,242,245,0.1)'; e.currentTarget.style.color = '#f1f2f5' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(241,242,245,0.7)' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="1.5" />
                      <path d="M2 8 L8 8 L8 2" />
                      <path d="M22 8 L16 8 L16 2" />
                      <path d="M2 16 L8 16 L8 22" />
                      <path d="M22 16 L16 16 L16 22" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); resetItemScale(selectedId!) }}
                    title="Reset to 100%"
                    style={btnBase}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(241,242,245,0.1)'; e.currentTarget.style.color = '#f1f2f5' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(241,242,245,0.7)' }}
                  >
                    <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 11, fontWeight: 700, letterSpacing: -0.3 }}>1:1</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setRotateMode((v) => !v) }}
                    title="Enable rotation"
                    style={{
                      ...btnBase,
                      background: rotateMode ? 'rgba(241,242,245,0.1)' : 'transparent',
                      color: rotateMode ? '#f1f2f5' : 'rgba(241,242,245,0.7)',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(241,242,245,0.1)'; e.currentTarget.style.color = '#f1f2f5' }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = rotateMode ? 'rgba(241,242,245,0.1)' : 'transparent'
                      e.currentTarget.style.color = rotateMode ? '#f1f2f5' : 'rgba(241,242,245,0.7)'
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); updateItem(selectedId!, { flipX: !sel.flipX }) }}
                    title="Mirror horizontal"
                    style={{
                      ...btnBase,
                      background: sel.flipX ? 'rgba(241,242,245,0.1)' : 'transparent',
                      color: sel.flipX ? '#f1f2f5' : 'rgba(241,242,245,0.7)',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(241,242,245,0.1)'; e.currentTarget.style.color = '#f1f2f5' }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = sel.flipX ? 'rgba(241,242,245,0.1)' : 'transparent'
                      e.currentTarget.style.color = sel.flipX ? '#f1f2f5' : 'rgba(241,242,245,0.7)'
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3v18" />
                      <path d="M8 7l-5 5 5 5V7z" fill="currentColor" />
                      <path d="M16 7l5 5-5 5V7z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); updateItem(selectedId!, { flipY: !sel.flipY }) }}
                    title="Mirror vertical"
                    style={{
                      ...btnBase,
                      background: sel.flipY ? 'rgba(241,242,245,0.1)' : 'transparent',
                      color: sel.flipY ? '#f1f2f5' : 'rgba(241,242,245,0.7)',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(241,242,245,0.1)'; e.currentTarget.style.color = '#f1f2f5' }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = sel.flipY ? 'rgba(241,242,245,0.1)' : 'transparent'
                      e.currentTarget.style.color = sel.flipY ? '#f1f2f5' : 'rgba(241,242,245,0.7)'
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 12h18" />
                      <path d="M7 8l5-5 5 5H7z" fill="currentColor" />
                      <path d="M7 16l5 5 5-5H7z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setShowCorrections((v) => !v); setShowCoverFrame(false); setShowTrim(false); setRotateMode(false) }}
                    title="Color corrections"
                    style={{
                      ...btnBase,
                      background: showCorrections ? 'rgba(241,242,245,0.1)' : 'transparent',
                      color: showCorrections ? '#f1f2f5' : 'rgba(241,242,245,0.7)',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(241,242,245,0.1)'; e.currentTarget.style.color = '#f1f2f5' }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = showCorrections ? 'rgba(241,242,245,0.1)' : 'transparent'
                      e.currentTarget.style.color = showCorrections ? '#f1f2f5' : 'rgba(241,242,245,0.7)'
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <line x1="4" y1="7" x2="20" y2="7" />
                      <line x1="4" y1="12" x2="20" y2="12" />
                      <line x1="4" y1="17" x2="20" y2="17" />
                      <circle cx="9" cy="7" r="2" fill="currentColor" />
                      <circle cx="15" cy="12" r="2" fill="currentColor" />
                      <circle cx="7" cy="17" r="2" fill="currentColor" />
                    </svg>
                  </button>
                  {sel.type === 'video' && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setShowCoverFrame((v) => !v); setShowCorrections(false); setShowTrim(false); setRotateMode(false) }}
                      title="Cover frame"
                      style={{
                        ...btnBase,
                        background: showCoverFrame ? 'rgba(241,242,245,0.1)' : 'transparent',
                        color: showCoverFrame ? '#f1f2f5' : 'rgba(241,242,245,0.7)',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(241,242,245,0.1)'; e.currentTarget.style.color = '#f1f2f5' }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = showCoverFrame ? 'rgba(241,242,245,0.1)' : 'transparent'
                        e.currentTarget.style.color = showCoverFrame ? '#f1f2f5' : 'rgba(241,242,245,0.7)'
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <rect x="1" y="3" width="14" height="10" rx="1.5" />
                        <line x1="4" y1="3" x2="4" y2="13" />
                        <line x1="12" y1="3" x2="12" y2="13" />
                        <line x1="1" y1="6" x2="4" y2="6" />
                        <line x1="1" y1="10" x2="4" y2="10" />
                        <line x1="12" y1="6" x2="15" y2="6" />
                        <line x1="12" y1="10" x2="15" y2="10" />
                      </svg>
                    </button>
                  )}
                  {sel.type === 'video' && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setShowTrim((v) => !v); setShowCorrections(false); setShowCoverFrame(false); setRotateMode(false) }}
                      title="Trim video"
                      style={{
                        ...btnBase,
                        background: showTrim ? 'rgba(241,242,245,0.1)' : 'transparent',
                        color: showTrim ? '#f1f2f5' : 'rgba(241,242,245,0.7)',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(241,242,245,0.1)'; e.currentTarget.style.color = '#f1f2f5' }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = showTrim ? 'rgba(241,242,245,0.1)' : 'transparent'
                        e.currentTarget.style.color = showTrim ? '#f1f2f5' : 'rgba(241,242,245,0.7)'
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="6" cy="6" r="3" />
                        <circle cx="6" cy="18" r="3" />
                        <line x1="20" y1="4" x2="8.12" y2="15.88" />
                        <line x1="14.47" y1="14.48" x2="20" y2="20" />
                        <line x1="8.12" y1="8.12" x2="12" y2="12" />
                      </svg>
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); cropApplyRef.current?.() }}
                    title="Apply crop (Enter)"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '4px 10px', border: 'none', borderRadius: 5,
                      background: 'var(--accent)', color: 'var(--on-accent)',
                      cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      transition: 'filter 0.12s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.15)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.filter = '' }}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 6l3 3 5-5" />
                    </svg>
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setCropMode(null) }}
                    title="Cancel (Esc)"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '4px 10px', border: 'none', borderRadius: 5,
                      background: 'transparent', color: 'rgba(241,242,245,0.6)',
                      cursor: 'pointer', fontSize: 12, fontWeight: 500,
                      transition: 'background 0.12s, color 0.12s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(241,242,245,0.08)'; e.currentTarget.style.color = '#f1f2f5' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(241,242,245,0.6)' }}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
            {/* Floating playback bar for selected video */}
            {sel.type === 'video' && !cropItemId && (
              <PlaybackBar
                itemId={sel.id}
                left={itemCenterX}
                top={playbackBarTop}
                width={itemScreenW}
              />
            )}
            {/* Floating corrections popover */}
            {showCorrections && !cropItemId && (
              <CorrectionsPopover
                item={sel}
                left={itemCenterX}
                top={correctionsTop}
              />
            )}
            {/* Floating cover frame popover */}
            {showCoverFrame && sel.type === 'video' && !cropItemId && (
              <CoverFramePopover
                item={sel}
                left={itemCenterX}
                top={correctionsTop}
              />
            )}
            {/* Floating trim popover */}
            {showTrim && sel.type === 'video' && !cropItemId && (
              <TrimPopover
                item={sel}
                left={itemCenterX}
                top={correctionsTop}
              />
            )}
            </div>
          )
        })()}

        {/* If no slides, show a single + button */}
        {slides.length === 0 && (
          <button
            type="button"
            onClick={() => addSlide()}
            style={{
              position: 'absolute',
              left: (pasteboardPad + W / 2) * zoom + panOffset.x,
              top: (pasteboardPad + H / 2) * zoom + panOffset.y,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'auto',
              width: 40, height: 40, borderRadius: '50%',
              border: '2px solid var(--accent)', background: 'var(--accent-dim)',
              color: '#f1f2f5', fontSize: 24, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            +
          </button>
        )}
      </div>

      {/* Konva canvas — viewport-sized; camera (pan/zoom) applied via Stage props.
          This keeps per-layer canvas memory O(viewport) regardless of workspace extent. */}
      <div
        style={{
          position: 'absolute', top: 0, left: 0,
          width: maxViewWidth, height: maxViewHeight,
          background: workspaceBgColor,
          overflow: 'hidden',
        }}
      >
        <Stage
          ref={stageRef}
          width={maxViewWidth} height={maxViewHeight}
          x={panOffset.x} y={panOffset.y}
          scaleX={zoom} scaleY={zoom}
          onMouseDown={(e) => {
            if (spaceDownRef.current || cropItemId) return
            if (e.target !== e.target.getStage()) return
            const stage = stageRef.current
            if (!stage) return
            const ptr = stage.getPointerPosition()
            if (!ptr) return
            const wsX = (ptr.x - panOffset.x) / zoom
            const wsY = (ptr.y - panOffset.y) / zoom
            const ev = e.evt as MouseEvent | undefined
            const additive = !!(ev && (ev.shiftKey || ev.metaKey || ev.ctrlKey))
            boxSelActiveRef.current = true
            setBoxSel({ x1: wsX, y1: wsY, x2: wsX, y2: wsY, additive })
          }}
          onMouseMove={() => {
            if (!boxSelActiveRef.current) return
            const stage = stageRef.current
            if (!stage) return
            const ptr = stage.getPointerPosition()
            if (!ptr) return
            const wsX = (ptr.x - panOffset.x) / zoom
            const wsY = (ptr.y - panOffset.y) / zoom
            setBoxSel((prev) => (prev ? { ...prev, x2: wsX, y2: wsY } : prev))
          }}
          onMouseUp={(e) => {
            if (!boxSelActiveRef.current) return
            boxSelActiveRef.current = false
            const b = boxSel
            setBoxSel(null)
            const ev = e.evt as MouseEvent | undefined
            const additive = !!(ev && (ev.shiftKey || ev.metaKey || ev.ctrlKey))
            if (!b) { if (!additive) setSelected(null); return }
            const dx = Math.abs(b.x2 - b.x1), dy = Math.abs(b.y2 - b.y1)
            if (dx < 3 && dy < 3) {
              // Treated as a plain click on empty area.
              if (!additive) setSelected(null)
              return
            }
            const minX = Math.min(b.x1, b.x2), maxX = Math.max(b.x1, b.x2)
            const minY = Math.min(b.y1, b.y2), maxY = Math.max(b.y1, b.y2)
            const picked: string[] = []
            for (const it of items) {
              const slideIdx = slides.findIndex((s) => s.id === it.slideId)
              const ap = artboardPositions[slideIdx]
              if (!ap) continue
              const ix1 = ap.x + it.x, iy1 = ap.y + it.y
              const ix2 = ix1 + it.width, iy2 = iy1 + it.height
              if (ix2 > minX && ix1 < maxX && iy2 > minY && iy1 < maxY) picked.push(it.id)
            }
            if (additive) {
              const merged = Array.from(new Set([...selectedIds, ...picked]))
              setSelectedIds(merged)
            } else {
              setSelectedIds(picked)
            }
          }}
          onTouchStart={(e) => { if (e.target === e.target.getStage()) setSelected(null) }}
        >
          {/* Background layer (kept visible during export). In seamless
              mode we extend non-last slide bg width so each rect overlaps
              the next slide's left edge by at least ~2 device pixels — the
              overlap is rasterised at full alpha and overwrites the
              sub-pixel anti-aliasing falloff that otherwise paints a faint
              gray seam between flush slides at non-integer zooms. The
              overlap is computed in slide-space (= screen-space / zoom /
              dpr) so it stays effective at every zoom level. */}
          <Layer ref={bgLayerRef} listening={false}>
            {(() => {
              // When seamless AND every slide shares the same vibe *params*
              // (palette / blur / size / grain / pointCount — anything but
              // each slide's individual seed), render the whole strip as ONE
              // wide vibe so the points distribute continuously across the
              // slides instead of repeating per-slide. The strip uses slide
              // 0's seed for the whole canvas. setAllSlidesBgVibe preserves
              // per-slide seeds so this is the common case after "All slides".
              if (seamlessSlides && slides.length > 1) {
                const first = slides[0]?.bgVibe
                if (first) {
                  // Compare vibe params *without* the seed.
                  const stripSig = (v: typeof first) => {
                    const { seed: _s, ...rest } = v
                    void _s
                    return JSON.stringify(rest)
                  }
                  const firstSig = stripSig(first)
                  const allSame = slides.every((s) => s.bgVibe && stripSig(s.bgVibe) === firstSig)
                  if (allSame) {
                    const ap0 = artboardPositions[0]!
                    return (
                      <SlideBackground
                        key="seamless-strip"
                        slide={slides[0]!}
                        x={ap0.x}
                        y={ap0.y}
                        width={W * slides.length}
                        height={H}
                        dither
                      />
                    )
                  }
                }
              }
              const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1
              return slides.map((slide, i) => {
                const ap = artboardPositions[i]!
                const seamOverlap = (seamlessSlides && i < slides.length - 1)
                  ? Math.max(1, Math.ceil(2 / (zoom * dpr)))
                  : 0
                return (
                  <SlideBackground
                    key={slide.id}
                    slide={slide}
                    x={ap.x} y={ap.y}
                    width={W + seamOverlap}
                    height={H}
                  />
                )
              })
            })()}
          </Layer>

          {/* Guides layer (hidden during export) */}
          <Layer ref={guidesLayerRef} listening={false}>
            {slides.map((slide, i) => {
              const ap = artboardPositions[i]!
              const slideItems = items.filter((it) => it.slideId === slide.id)
              return (
                <Group key={slide.id} x={ap.x} y={ap.y}>
                  {/* Per-slide outline. Skip in seamless mode so the strokes
                      from adjacent slides don't double up at the seam and
                      paint a thin darker line. We draw a single perimeter
                      stroke around the whole strip below instead. */}
                  {!previewMode && !seamlessSlides && (
                    <Rect x={0} y={0} width={W} height={H} stroke="rgba(241,242,245,0.12)" strokeWidth={1.5} />
                  )}
                  {/* Grid and center guides used to live here, but now they
                      render in an overlay layer above the content so they sit
                      on top of media — treated as a visual tool rather than a
                      backing texture. See <Layer> below the content layer. */}
                  {/* Upscale outline — thicker dashed ring on items being scaled past natural size.
                      Lives in the guides layer so it's hidden during export. Uses dragLive when
                      the item is currently being dragged so the ring follows in real time.
                      Suppressed in preview mode (it's a warning, not part of the design). */}
                  {!previewMode && slideItems.map((item) => {
                    const live = dragLive && dragLive.itemId === item.id && dragLive.slideIdx === i ? dragLive : null
                    const ix = live ? live.x : item.x
                    const iy = live ? live.y : item.y
                    const iw = live ? live.width : item.width
                    const ih = live ? live.height : item.height
                    const up = item.naturalWidth > 0 && item.naturalHeight > 0 &&
                      (iw > item.naturalWidth * 1.01 || ih > item.naturalHeight * 1.01)
                    if (!up) return null
                    return (
                      <Rect
                        key={`upscale-${item.id}`}
                        x={ix} y={iy}
                        width={iw} height={ih}
                        rotation={item.rotation}
                        stroke="#ffb020" strokeWidth={3} dash={[12, 7]}
                        strokeScaleEnabled={false}
                        listening={false}
                      />
                    )
                  })}
                </Group>
              )
            })}
            {/* Single perimeter outline around the entire seamless strip —
                replaces the per-slide outlines we skipped above so there's
                no overlapping-stroke seam between adjacent slides. */}
            {seamlessSlides && !previewMode && slides.length > 0 && artboardPositions.length === slides.length && (() => {
              const first = artboardPositions[0]!
              const last = artboardPositions[artboardPositions.length - 1]!
              return (
                <Rect
                  x={first.x}
                  y={first.y}
                  width={(last.x + W) - first.x}
                  height={H}
                  stroke="rgba(241,242,245,0.12)"
                  strokeWidth={1.5}
                  listening={false}
                />
              )
            })()}
          </Layer>

          {/* Content layer */}
          <Layer>
            {slides.map((slide, i) => {
              const ap = artboardPositions[i]!
              const slideItems = items.filter((it) => it.slideId === slide.id)
              // Master items whose home slide is NOT this one — drawn as
              // non-interactive ghosts so the user sees repeated content
              // (logos, page numbers, watermarks) on every slide.
              const masterGhosts = items.filter((it) => it.appearsOnAllSlides && it.slideId !== slide.id)
              return (
                <Group key={slide.id} x={ap.x} y={ap.y}>
                  <Rect
                    x={0} y={0} width={W} height={H} fill="transparent"
                    onClick={(e) => { e.cancelBubble = true; setSelected(null); useTiovivoStore.getState().setActiveSlide(slide.id) }}
                  />
                  {masterGhosts.map((g) => (
                    <MasterGhost key={`ghost-${g.id}`} item={g} slideId={slide.id} />
                  ))}
                  {slideItems.map((item) => (
                    item.type === 'text' ? (
                      <TextItemView
                        key={item.id} item={item}
                        isEditing={editingTextId === item.id}
                        onSelect={(additive) => {
                          useTiovivoStore.getState().setActiveSlide(slide.id)
                          if (additive) toggleSelected(item.id)
                          else setSelected(item.id)
                        }}
                        onChange={(patch) => updateItem(item.id, patch)}
                        onRequestEdit={() => {
                          useTiovivoStore.getState().setActiveSlide(slide.id)
                          setSelected(item.id)
                          setEditingTextId(item.id)
                        }}
                        onDragStart={(node) => handleDragStart(node as unknown as Konva.Image, item)}
                        onDragMove={(node) => handleDragMove(node as unknown as Konva.Image, item)}
                        onDragEnd={(node) => handleDragEnd(node as unknown as Konva.Image, item)}
                      />
                    ) : item.type === 'shape' ? (
                      <ShapeItemView
                        key={item.id} item={item}
                        onSelect={(additive) => {
                          useTiovivoStore.getState().setActiveSlide(slide.id)
                          if (additive) toggleSelected(item.id)
                          else setSelected(item.id)
                        }}
                        onDragStart={(node) => handleDragStart(node as unknown as Konva.Image, item)}
                        onDragMove={(node) => handleDragMove(node as unknown as Konva.Image, item)}
                        onDragEnd={(node) => handleDragEnd(node as unknown as Konva.Image, item)}
                      />
                    ) : (
                      <MediaItemView
                        key={item.id} item={item}
                        isCropping={item.id === cropItemId}
                        onSelect={(additive) => {
                          useTiovivoStore.getState().setActiveSlide(slide.id)
                          if (additive) toggleSelected(item.id)
                          else setSelected(item.id)
                        }}
                        onChange={(patch) => updateItem(item.id, patch)}
                        onDragStart={(node) => handleDragStart(node, item)}
                        onDragMove={(node) => handleDragMove(node, item)}
                        onDragEnd={(node) => handleDragEnd(node, item)}
                      />
                    )
                  ))}
                  {cropItemId && slideItems.find((it) => it.id === cropItemId) && (
                    <CropOverlay
                      item={slideItems.find((it) => it.id === cropItemId)!}
                      zoom={zoom}
                      onRegisterApply={(fn) => { cropApplyRef.current = fn }}
                    />
                  )}
                  {/* Multi-select borders — only when 2+ items selected.
                      Konva's Transformer wraps the union bbox; a per-item border
                      makes individual selection visible. strokeScaleEnabled=false
                      keeps stroke at constant viewport pixels regardless of zoom. */}
                  {isMultiSelect && slideItems.map((item) => {
                    if (!selectedIds.includes(item.id)) return null
                    return (
                      <Rect
                        key={`msel-${item.id}`}
                        x={item.x} y={item.y}
                        width={item.width} height={item.height}
                        rotation={item.rotation}
                        stroke="#3b82f6" strokeWidth={2}
                        strokeScaleEnabled={false}
                        listening={false}
                      />
                    )
                  })}
                </Group>
              )
            })}
          </Layer>

          {/* Editor guide overlay — drawn on top of media so guides behave as
              visual references rather than backing texture. Hidden in preview
              and export; listening={false} so it never absorbs pointer events. */}
          {(showGrid || showCenterGuides || (seamlessSlides && slides.length > 1)) && !previewMode && (
            <Layer ref={overlayLayerRef} listening={false}>
              {slides.map((slide, i) => {
                const ap = artboardPositions[i]!
                const alpha = Math.max(0, Math.min(1, gridOpacity))
                return (
                  <Group key={slide.id} x={ap.x} y={ap.y}>
                    {showGrid && gridLines.map((pts, j) => (
                      <Line
                        key={j}
                        points={pts}
                        stroke={contrastStrokeFor(slide.bgColor, alpha)}
                        strokeWidth={1}
                        strokeScaleEnabled={false}
                      />
                    ))}
                    {showCenterGuides && (
                      <>
                        <Line points={[W / 2, 0, W / 2, H]} stroke={`rgba(120,180,255,${0.55 * alpha + 0.15})`} strokeWidth={1} strokeScaleEnabled={false} />
                        <Line points={[0, H / 2, W, H / 2]} stroke={`rgba(120,180,255,${0.55 * alpha + 0.15})`} strokeWidth={1} strokeScaleEnabled={false} />
                      </>
                    )}
                  </Group>
                )
              })}
              {seamlessSlides && slides.slice(1).map((slide, i) => {
                const ap = artboardPositions[i + 1]!
                // Values are divided by zoom so the marker reads as fixed
                // screen pixels while the stage zoom changes.
                const dash = [8 / zoom, 6 / zoom]
                const overhang = 32 / zoom
                const points = [ap.x, ap.y - overhang, ap.x, ap.y + H + overhang]
                return (
                  <Line
                    key={`seam-guide-${slide.id}`}
                    points={points}
                    stroke="rgba(10,11,15,0.2)"
                    strokeWidth={1.5}
                    strokeScaleEnabled={false}
                    dash={dash}
                    lineCap="round"
                    listening={false}
                  />
                )
              })}
            </Layer>
          )}

          {/* IG safe-area overlay — dim the regions where IG paints its
              own chrome on top of the image so critical text doesn't end
              up under the heart button / page dots / username strip.
              The exact zones differ wildly between feed-carousel posts
              (square / 4:5 / 3:4) and full-screen Story / Reel posts
              (9:16), so we branch on aspect ratio. listening={false} so
              the overlay never absorbs pointer events. */}
          {showIgSafeArea && !previewMode && (
            <Layer ref={igSafeAreaLayerRef} listening={false}>
              {slides.map((slide, i) => {
                const ap = artboardPositions[i]!
                const aspect = W / H
                // 9:16-ish = tall portrait → treat as Story / Reel. Anything
                // taller-than-square but less extreme = feed carousel post.
                const isStory = aspect < 0.6
                return (
                  <Group key={`ig-${slide.id}`} x={ap.x} y={ap.y}>
                    {isStory ? (
                      <>
                        {/* Top header (profile pic, name, timestamp, close X) */}
                        <Rect
                          x={0}
                          y={0}
                          width={W}
                          height={H * 0.13}
                          fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                          fillLinearGradientEndPoint={{ x: 0, y: H * 0.13 }}
                          fillLinearGradientColorStops={[0, 'rgba(10,11,15,0.42)', 1, 'rgba(10,11,15,0)']}
                        />
                        <Rect
                          x={W * 0.04}
                          y={H * 0.04}
                          width={W * 0.55}
                          height={H * 0.035}
                          cornerRadius={H * 0.018}
                          fill="rgba(241,242,245,0.14)"
                          stroke="rgba(241,242,245,0.45)"
                          strokeWidth={1}
                          strokeScaleEnabled={false}
                        />
                        {/* Right-side action stack — heart / comment / share /
                            options stacked vertically, anchored bottom-right. */}
                        <Rect
                          x={W * 0.84}
                          y={H * 0.42}
                          width={W * 0.12}
                          height={H * 0.36}
                          cornerRadius={W * 0.06}
                          fill="rgba(10,11,15,0.32)"
                          stroke="rgba(241,242,245,0.32)"
                          strokeWidth={1}
                          strokeScaleEnabled={false}
                        />
                        {/* Bottom reply / caption strip */}
                        <Rect
                          x={0}
                          y={H * 0.84}
                          width={W}
                          height={H * 0.16}
                          fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                          fillLinearGradientEndPoint={{ x: 0, y: H * 0.16 }}
                          fillLinearGradientColorStops={[0, 'rgba(10,11,15,0)', 1, 'rgba(10,11,15,0.46)']}
                        />
                        <Rect
                          x={W * 0.05}
                          y={H * 0.91}
                          width={W * 0.7}
                          height={H * 0.05}
                          cornerRadius={H * 0.025}
                          fill="rgba(241,242,245,0.12)"
                          stroke="rgba(241,242,245,0.4)"
                          strokeWidth={1}
                          strokeScaleEnabled={false}
                        />
                      </>
                    ) : (
                      <>
                        {/* Feed carousel — bottom strip with page-dot indicator. */}
                        {(() => {
                          const stripH = H * 0.07
                          const pillW = Math.min(W * 0.34, 360)
                          const pillH = Math.max(H * 0.018, 14)
                          const pillX = (W - pillW) / 2
                          const pillY = H - stripH * 0.55 - pillH / 2
                          return (
                            <>
                              <Rect
                                x={0}
                                y={H - stripH}
                                width={W}
                                height={stripH}
                                fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                                fillLinearGradientEndPoint={{ x: 0, y: stripH }}
                                fillLinearGradientColorStops={[0, 'rgba(10,11,15,0)', 1, 'rgba(10,11,15,0.42)']}
                              />
                              <Rect
                                x={pillX}
                                y={pillY}
                                width={pillW}
                                height={pillH}
                                cornerRadius={pillH / 2}
                                fill="rgba(241,242,245,0.18)"
                                stroke="rgba(241,242,245,0.55)"
                                strokeWidth={1}
                                strokeScaleEnabled={false}
                              />
                            </>
                          )
                        })()}
                      </>
                    )}
                  </Group>
                )
              })}
            </Layer>
          )}

          {/* Hidden-zone veil: opaque core around slides, gradient fade to transparent at outer edge */}
          {showHiddenZone && hiddenZone && artboardPositions.length > 0 && (() => {
            const first = artboardPositions[0]!
            const last = artboardPositions[artboardPositions.length - 1]!
            const P = Math.min(W, H) * 0.8
            const P2 = P * 0.5
            const sx0 = first.x, sy0 = first.y
            const sx1 = last.x + W, sy1 = first.y + H
            const cx0 = sx0 - P2, cy0 = sy0 - P2
            const cx1 = sx1 + P2, cy1 = sy1 + P2
            const ox0 = sx0 - P, oy0 = sy0 - P
            // Match veil to the user-chosen workspace color so the seamless
            // illusion holds regardless of the picked color.
            const hex = (workspaceBgColor || '#0a0a0e').replace('#', '')
            const hr = parseInt(hex.slice(0, 2), 16) || 0
            const hg = parseInt(hex.slice(2, 4), 16) || 0
            const hb = parseInt(hex.slice(4, 6), 16) || 0
            const OPAQUE = `rgba(${hr},${hg},${hb},1)`
            const CLEAR = `rgba(${hr},${hg},${hb},0)`
            const stops = [0, OPAQUE, 1, CLEAR]
            return (
              <Layer ref={veilLayerRef} listening={false}>
                {/* Opaque core */}
                <Rect x={cx0} y={cy0} width={cx1 - cx0} height={cy1 - cy0} fill={OPAQUE} />
                {/* Top edge */}
                <Rect
                  x={cx0} y={oy0} width={cx1 - cx0} height={P2}
                  fillLinearGradientStartPoint={{ x: 0, y: P2 }}
                  fillLinearGradientEndPoint={{ x: 0, y: 0 }}
                  fillLinearGradientColorStops={stops}
                />
                {/* Bottom edge */}
                <Rect
                  x={cx0} y={cy1} width={cx1 - cx0} height={P2}
                  fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                  fillLinearGradientEndPoint={{ x: 0, y: P2 }}
                  fillLinearGradientColorStops={stops}
                />
                {/* Left edge */}
                <Rect
                  x={ox0} y={cy0} width={P2} height={cy1 - cy0}
                  fillLinearGradientStartPoint={{ x: P2, y: 0 }}
                  fillLinearGradientEndPoint={{ x: 0, y: 0 }}
                  fillLinearGradientColorStops={stops}
                />
                {/* Right edge */}
                <Rect
                  x={cx1} y={cy0} width={P2} height={cy1 - cy0}
                  fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                  fillLinearGradientEndPoint={{ x: P2, y: 0 }}
                  fillLinearGradientColorStops={stops}
                />
                {/* Top-left corner: radial from inner corner out */}
                <Rect
                  x={ox0} y={oy0} width={P2} height={P2}
                  fillRadialGradientStartPoint={{ x: P2, y: P2 }}
                  fillRadialGradientEndPoint={{ x: P2, y: P2 }}
                  fillRadialGradientStartRadius={0}
                  fillRadialGradientEndRadius={P2}
                  fillRadialGradientColorStops={stops}
                />
                {/* Top-right corner */}
                <Rect
                  x={cx1} y={oy0} width={P2} height={P2}
                  fillRadialGradientStartPoint={{ x: 0, y: P2 }}
                  fillRadialGradientEndPoint={{ x: 0, y: P2 }}
                  fillRadialGradientStartRadius={0}
                  fillRadialGradientEndRadius={P2}
                  fillRadialGradientColorStops={stops}
                />
                {/* Bottom-left corner */}
                <Rect
                  x={ox0} y={cy1} width={P2} height={P2}
                  fillRadialGradientStartPoint={{ x: P2, y: 0 }}
                  fillRadialGradientEndPoint={{ x: P2, y: 0 }}
                  fillRadialGradientStartRadius={0}
                  fillRadialGradientEndRadius={P2}
                  fillRadialGradientColorStops={stops}
                />
                {/* Bottom-right corner */}
                <Rect
                  x={cx1} y={cy1} width={P2} height={P2}
                  fillRadialGradientStartPoint={{ x: 0, y: 0 }}
                  fillRadialGradientEndPoint={{ x: 0, y: 0 }}
                  fillRadialGradientStartRadius={0}
                  fillRadialGradientEndRadius={P2}
                  fillRadialGradientColorStops={stops}
                />
                {/* Slide-shaped holes. In seamless mode, punch one continuous
                    strip-shaped hole so adjacent destination-out edges don't
                    anti-alias separately and leave a faint pasteboard seam. */}
                {seamlessSlides ? (
                  <Rect
                    x={sx0} y={sy0}
                    width={sx1 - sx0} height={H}
                    fill="#000"
                    globalCompositeOperation="destination-out"
                  />
                ) : slides.map((slide, i) => {
                  const ap = artboardPositions[i]!
                  return (
                    <Rect
                      key={`veil-hole-${slide.id}`}
                      x={ap.x} y={ap.y}
                      width={W} height={H}
                      fill="#000"
                      globalCompositeOperation="destination-out"
                    />
                  )
                })}
              </Layer>
            )
          })()}

          {/* Selection handles layer — sits ABOVE the hidden-zone veil so the
              Transformer anchors and rotation ruler stay visible regardless of
              whether the selected item is inside or outside an artboard. */}
          <Layer>
            <Transformer
              ref={trRef}
              boundBoxFunc={(oldBox, newBox) => {
                if (newBox.width < 12 || newBox.height < 12) return oldBox
                // Snap only for a single, unrotated selection.
                if (isMultiSelect || !selectedId) { setActiveGuides(null); return newBox }
                const sel = items.find((i) => i.id === selectedId)
                if (!sel || sel.rotation !== 0) { setActiveGuides(null); return newBox }
                if (!snapItems && !snapCenter && !snapMargins) { setActiveGuides(null); return newBox }
                const slideIdx = slides.findIndex((s) => s.id === sel.slideId)
                const ap = artboardPositions[slideIdx]
                if (!ap) { setActiveGuides(null); return newBox }
                const wx = (newBox.x - panOffset.x) / zoom
                const wy = (newBox.y - panOffset.y) / zoom
                const ww = newBox.width / zoom
                const wh = newBox.height / zoom
                const owx = (oldBox.x - panOffset.x) / zoom
                const owy = (oldBox.y - panOffset.y) / zoom
                const oww = oldBox.width / zoom
                const owh = oldBox.height / zoom
                const others = items
                  .filter((i) => i.slideId === sel.slideId && i.id !== sel.id)
                  .map((i) => ({ x: i.x, y: i.y, width: i.width, height: i.height }))
                const r = snapResize({
                  stage: { width: W, height: H },
                  oldBox: { x: owx - ap.x, y: owy - ap.y, width: oww, height: owh },
                  newBox: { x: wx - ap.x, y: wy - ap.y, width: ww, height: wh },
                  others,
                  marginPx,
                  snapItems, snapCenter, snapMargins,
                })
                if (r.guides.length) setActiveGuides({ slideIdx, guides: r.guides })
                else setActiveGuides(null)
                return {
                  x: (r.x + ap.x) * zoom + panOffset.x,
                  y: (r.y + ap.y) * zoom + panOffset.y,
                  width: r.width * zoom,
                  height: r.height * zoom,
                  rotation: newBox.rotation,
                }
              }}
              rotateEnabled={false}
              resizeEnabled={!rotateMode}
              anchorSize={10}
              borderStroke={rotateMode ? '#3b82f6' : undefined}
              anchorStrokeWidth={1.5}
              borderStrokeWidth={1.5}
              anchorCornerRadius={2}
              enabledAnchors={['top-left','top-center','top-right','middle-right','middle-left','bottom-left','bottom-center','bottom-right']}
              onTransformEnd={() => setActiveGuides(null)}
            />
            {rotateMode && selectedId && !isMultiSelect && !cropItemId && (() => {
              const sel = items.find((i) => i.id === selectedId)
              if (!sel) return null
              const slideIdx = slides.findIndex((s) => s.id === sel.slideId)
              const ap = artboardPositions[slideIdx]
              if (!ap) return null
              const rad = (sel.rotation * Math.PI) / 180
              const hw = sel.width / 2
              const hh = sel.height / 2
              // Visual bbox center in world coords (stage space).
              const cx = ap.x + sel.x + hw * Math.cos(rad) - hh * Math.sin(rad)
              const cy = ap.y + sel.y + hw * Math.sin(rad) + hh * Math.cos(rad)
              // Axis-aligned bbox extent for placing the ruler below the media.
              const bboxH = Math.abs(sel.width * Math.sin(rad)) + Math.abs(sel.height * Math.cos(rad))
              const rulerR = bboxH / 2 + 40 / zoom
              // Current rotation handle direction: local "down" of the item.
              const handleAng = rad + Math.PI / 2
              const hx = cx + rulerR * Math.cos(handleAng)
              const hy = cy + rulerR * Math.sin(handleAng)
              const stroke = '#3b82f6'
              const sw = Math.max(1.5, 2 / zoom)
              return (
                <Group listening>
                  {/* Semicircle ruler sitting on the bottom half (screen-down). */}
                  <Arc
                    x={cx} y={cy}
                    innerRadius={rulerR}
                    outerRadius={rulerR}
                    angle={180}
                    rotation={0}
                    stroke={stroke} strokeWidth={sw}
                    listening={false}
                    dash={[6 / zoom, 4 / zoom]}
                  />
                  {/* Tick marks every 15°. */}
                  {Array.from({ length: 13 }).map((_, i) => {
                    const a = (i * 15) * Math.PI / 180
                    const r1 = rulerR - 4 / zoom
                    const r2 = rulerR + (i % 3 === 0 ? 8 : 4) / zoom
                    return (
                      <Line
                        key={i}
                        points={[
                          cx + r1 * Math.cos(a), cy + r1 * Math.sin(a),
                          cx + r2 * Math.cos(a), cy + r2 * Math.sin(a),
                        ]}
                        stroke={stroke} strokeWidth={sw}
                        listening={false}
                      />
                    )
                  })}
                  {/* Pointer from center to handle. */}
                  <Line
                    points={[cx, cy, hx, hy]}
                    stroke={stroke} strokeWidth={sw}
                    listening={false}
                  />
                  {/* Draggable handle. */}
                  <Circle
                    x={hx} y={hy}
                    radius={Math.max(7, 9 / zoom)}
                    fill={stroke}
                    stroke="#fff"
                    strokeWidth={Math.max(1, 1.5 / zoom)}
                    draggable
                    onDragMove={(e) => {
                      const p = e.target.position()
                      const dx = p.x - cx, dy = p.y - cy
                      if (dx === 0 && dy === 0) return
                      // Handle lies on the item's local +Y axis, whose world angle is rot + 90°.
                      let newRad = Math.atan2(dy, dx) - Math.PI / 2
                      let newDeg = newRad * 180 / Math.PI
                      // Hold Shift to snap rotation. 22.5° step gives 16
                      // equally-spaced stops around the circle, which lands
                      // exactly on 0/45/90/135/180/225/270/315 plus three
                      // intermediate angles between each pair.
                      const evt = e.evt as MouseEvent | undefined
                      if (evt && evt.shiftKey) {
                        const step = 22.5
                        newDeg = Math.round(newDeg / step) * step
                        newRad = (newDeg * Math.PI) / 180
                      }
                      // Preserve the visual bbox center while rotating.
                      const nx = (cx - ap.x) - (hw * Math.cos(newRad) - hh * Math.sin(newRad))
                      const ny = (cy - ap.y) - (hw * Math.sin(newRad) + hh * Math.cos(newRad))
                      updateItem(sel.id, { rotation: newDeg, x: nx, y: ny })
                    }}
                  />
                </Group>
              )
            })()}
          </Layer>

          {/* Snap guides + box selection */}
          <Layer ref={snapGuidesLayerRef} listening={false}>
            {boxSel && (() => {
              const x = Math.min(boxSel.x1, boxSel.x2)
              const y = Math.min(boxSel.y1, boxSel.y2)
              const w = Math.abs(boxSel.x2 - boxSel.x1)
              const h = Math.abs(boxSel.y2 - boxSel.y1)
              return (
                <Rect
                  x={x} y={y} width={w} height={h}
                  fill="rgba(59,130,246,0.15)"
                  stroke={GUIDE_COLOR}
                  strokeWidth={Math.max(1, 1 / zoom)}
                  dash={[Math.max(4, 6 / zoom), Math.max(3, 4 / zoom)]}
                  listening={false}
                />
              )
            })()}
            {activeGuides?.guides.map((g, i) => {
              const ap = artboardPositions[activeGuides.slideIdx]
              if (!ap) return null
              const isCenter =
                (g.orientation === 'vertical' && Math.abs(g.pos - W / 2) < 1) ||
                (g.orientation === 'horizontal' && Math.abs(g.pos - H / 2) < 1)
              const color = isCenter ? GUIDE_COLOR_CENTER : GUIDE_COLOR
              return g.orientation === 'vertical' ? (
                <Line key={`sg-${i}`} points={[ap.x + g.pos, ap.y + g.from, ap.x + g.pos, ap.y + g.to]} stroke={color} strokeWidth={Math.max(1.5, 2 / zoom)} dash={[Math.max(6, 8 / zoom), Math.max(4, 5 / zoom)]} />
              ) : (
                <Line key={`sg-${i}`} points={[ap.x + g.from, ap.y + g.pos, ap.x + g.to, ap.y + g.pos]} stroke={color} strokeWidth={Math.max(1.5, 2 / zoom)} dash={[Math.max(6, 8 / zoom), Math.max(4, 5 / zoom)]} />
              )
            })}
          </Layer>
        </Stage>
      </div>

      {/* Inline text editor — positioned over the Konva.Text node, sized
          to match what the user was seeing before they double-clicked. */}
      {editingTextId && (() => {
        const it = items.find((x) => x.id === editingTextId)
        if (!it || it.type !== 'text') return null
        const slideIdx = slides.findIndex((s) => s.id === it.slideId)
        const ap = artboardPositions[slideIdx]
        if (!ap) return null
        const left = (ap.x + it.x) * zoom + panOffset.x
        const top = (ap.y + it.y) * zoom + panOffset.y
        const width = Math.max(8, it.width * zoom)
        const lh = it.lineHeight ?? 1.15
        const ls = it.letterSpacing ?? 0
        const fontStyle = fontStyleString(it.bold, it.italic)
        // Match the rendered font size pre-edit. In fill mode, that's the
        // binary-search-derived size, not item.fontSize.
        const baseFontSize = it.fillMode
          ? fitFontSize({
              text: it.text || '',
              fontFamily: it.fontFamily || 'Inter',
              fontStyle,
              boxWidth: it.width,
              boxHeight: it.height,
              lineHeight: lh,
              letterSpacing: ls,
              min: 4,
              max: 4000,
            })
          : (it.fontSize || 64)
        const fontPx = Math.max(2, baseFontSize * zoom)
        // Size the textarea to the rendered box so multi-line text is fully
        // visible — previously a one-line minHeight forced scrolling.
        const minPx = fontPx * lh
        const height = Math.max(minPx, it.height * zoom)
        const commit = (value: string) => {
          updateItem(editingTextId, { text: value })
          setEditingTextId(null)
        }
        return (
          <textarea
            autoFocus
            defaultValue={it.text || ''}
            spellCheck={false}
            onBlur={(e) => commit(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setEditingTextId(null)
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                commit(e.currentTarget.value)
              }
              e.stopPropagation()
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              left,
              top,
              width,
              height,
              transform: it.rotation ? `rotate(${it.rotation}deg)` : undefined,
              transformOrigin: 'top left',
              zIndex: 30,
              margin: 0,
              padding: 0,
              border: '1px dashed rgba(59,130,246,0.9)',
              outline: 'none',
              background: 'rgba(241,242,245,0.06)',
              backdropFilter: 'blur(2px)',
              color: it.textColor || '#ffffff',
              fontFamily: it.fontFamily || 'Inter',
              fontSize: fontPx,
              fontWeight: it.bold ? 700 : 400,
              fontStyle: it.italic ? 'italic' : 'normal',
              textAlign: (it.textAlign as React.CSSProperties['textAlign']) || 'left',
              lineHeight: lh,
              letterSpacing: ls * zoom,
              resize: 'none',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'normal',
              overflowWrap: 'break-word',
              boxSizing: 'border-box',
            }}
          />
        )
      })()}
    </div>
  )
})

export default EditorStage
