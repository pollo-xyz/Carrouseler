/* The canvas side of effects: drawing accent-coloured text, the pointer
 * glyph, the light band, and putting a slide's nodes into the pose
 * lib/effects computes for an instant. */
import Konva from 'konva'
import type { PlacedMedia } from '../store/useTiovivoStore'
import {
  accentsOf, effectOf, hasEntrance, hasMotion, isRest, mixColor, poseAt, withAlpha,
} from './effects'

/* ------------------------------------------------------------------ */
/*  Pointer glyph                                                     */
/* ------------------------------------------------------------------ */

const CURSOR_POINTS: [number, number][] = [
  [0, 0], [0, 17], [4.4, 13], [7.4, 20], [10.6, 18.6], [7.7, 12], [13.6, 12],
]

/** The arrow pointer, tip at the box's top-left, sized to the box. */
export function cursorPath(ctx: { beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; closePath(): void }, w: number, h: number) {
  const k = Math.min(w / 14, h / 20)
  ctx.beginPath()
  CURSOR_POINTS.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * k, y * k) : ctx.lineTo(x * k, y * k)))
  ctx.closePath()
}

/* ------------------------------------------------------------------ */
/*  Live state the draw functions read                                */
/* ------------------------------------------------------------------ */

/** Per text item while a pose is applied: how lit each accent run is and
 *  how opaque each paragraph. Absent = at rest (accents lit, all shown). */
export const richLive = new Map<string, { accents: number[] | null; lines: number[] | null }>()

interface FxLive {
  shimmer?: { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number }
  ripple?: { x: number; y: number; r: number; alpha: number; color: string; width: number }
}
/** Per item while a pose is applied: what its overlay node draws. */
export const fxLive = new Map<string, FxLive>()

/** Does this item need an overlay node above it? */
export function needsFxOverlay(item: PlacedMedia): boolean {
  return !!effectOf(item, 'shimmer') || !!effectOf(item, 'travel')
}

/** sceneFunc of an item's overlay node. */
export function drawFx(context: Konva.Context, itemId: string) {
  const live = fxLive.get(itemId)
  if (!live) return
  const ctx = context._context
  if (live.shimmer) {
    const s = live.shimmer
    ctx.drawImage(s.canvas, s.x, s.y, s.w, s.h)
  }
  if (live.ripple) {
    const r = live.ripple
    const alpha = ctx.globalAlpha
    ctx.globalAlpha = alpha * r.alpha
    ctx.beginPath()
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2)
    ctx.lineWidth = r.width
    ctx.strokeStyle = r.color
    ctx.stroke()
    ctx.globalAlpha = alpha
  }
}

/* ------------------------------------------------------------------ */
/*  Accent text                                                       */
/* ------------------------------------------------------------------ */

export interface RichSpec {
  clean: string
  accentColor: string
  /** For each character of `clean`: its accent run, or -1. */
  accentOf: Int16Array
  /** For each character of `clean`: its paragraph. */
  paraOf: Int16Array
  accents: number
  paragraphs: number
}

const richCache = new WeakMap<PlacedMedia, RichSpec | null>()

/** How a text item's characters are styled, or null when it draws as plain
 *  text (no accents and no text effect). */
export function richSpecOf(item: PlacedMedia): RichSpec | null {
  if (item.type !== 'text') return null
  const hit = richCache.get(item)
  if (hit !== undefined) return hit
  const { clean, ranges } = accentsOf(item)
  const wanted = ranges.length > 0 || !!effectOf(item, 'reveal')
  let spec: RichSpec | null = null
  if (wanted) {
    const accentOf = new Int16Array(clean.length).fill(-1)
    ranges.forEach(([a, b], i) => accentOf.fill(i, a, b))
    const paraOf = new Int16Array(clean.length)
    let p = 0
    for (let i = 0; i < clean.length; i++) { paraOf[i] = p; if (clean[i] === '\n') p++ }
    spec = {
      clean, accentColor: item.accentColor || item.textColor || '#ffffff',
      accentOf, paraOf, accents: ranges.length, paragraphs: p + 1,
    }
  }
  richCache.set(item, spec)
  return spec
}

/** Draws a Konva.Text's laid-out lines with per-run colour and per-paragraph
 *  opacity. Same geometry as Konva's own text drawing (top-aligned, middle
 *  baseline), so switching between the two never moves a glyph. */
export function drawRichText(context: Konva.Context, shape: Konva.Text, spec: RichSpec, itemId: string) {
  const lines = shape.textArr
  if (!lines?.length) return
  const ctx = context._context
  const live = richLive.get(itemId)
  const fontSize = shape.fontSize()
  const lineHeightPx = shape.lineHeight() * fontSize
  const pad = shape.padding()
  const align = shape.align()
  const totalW = shape.getWidth()
  const spacing = shape.letterSpacing() || 0
  const base = shape.fill() as string
  const strokeW = shape.strokeEnabled() ? (shape.strokeWidth() || 0) : 0
  const stroke = shape.stroke() as string | undefined

  ctx.font = (shape as unknown as { _getContextFont(): string })._getContextFont()
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  if (strokeW > 0 && stroke) { ctx.lineWidth = strokeW; ctx.strokeStyle = stroke }
  const alpha0 = ctx.globalAlpha

  const paint = (text: string, x: number, y: number, accent: number) => {
    if (!text) return
    const k = accent < 0 ? 0 : (live?.accents ? (live.accents[accent] ?? 0) : 1)
    ctx.fillStyle = k > 0 ? mixColor(base, spec.accentColor, k) : base
    if (strokeW > 0 && stroke) ctx.strokeText(text, x, y)
    ctx.fillText(text, x, y)
  }

  let cursor = 0
  let para = 0
  let y = pad + lineHeightPx / 2
  for (const line of lines) {
    const text = line.text
    // Where this line sits in the clean text (wrapping drops the white
    // space at a break). Not found = draw it unstyled.
    const at = text ? spec.clean.indexOf(text, cursor) : -1
    if (at >= 0) { cursor = at + text.length; para = spec.paraOf[at] ?? para }
    const accentAt = (i: number) => (at >= 0 ? (spec.accentOf[at + i] ?? -1) : -1)
    ctx.globalAlpha = alpha0 * (live?.lines ? (live.lines[para] ?? 1) : 1)

    let x = pad
    if (align === 'right') x += totalW - line.width - pad * 2
    else if (align === 'center') x += (totalW - line.width - pad * 2) / 2

    if (spacing !== 0 || align === 'justify') {
      const spaces = text.split(' ').length - 1
      const justify = align === 'justify' && !line.lastInParagraph && spaces > 0
      let i = 0
      for (const ch of text) {
        if (ch === ' ' && justify) x += (totalW - pad * 2 - line.width) / spaces
        paint(ch, x, y, accentAt(i))
        x += ctx.measureText(ch).width + spacing
        i += ch.length
      }
    } else {
      // One fillText per run, placed by measuring the text before it, so
      // kerning inside a run is the font's own.
      let start = 0
      while (start < text.length) {
        const a = accentAt(start)
        let end = start + 1
        while (end < text.length && accentAt(end) === a) end++
        paint(text.slice(start, end), x + (start ? ctx.measureText(text.slice(0, start)).width : 0), y, a)
        start = end
      }
    }
    if (line.lastInParagraph && at < 0) para++
    y += lineHeightPx
  }
  ctx.globalAlpha = alpha0
}

/* ------------------------------------------------------------------ */
/*  Light band                                                        */
/* ------------------------------------------------------------------ */

interface Mask {
  item: PlacedMedia
  scale: number
  canvas: HTMLCanvasElement
  scratch: HTMLCanvasElement
  /** Where the mask sits, in the item's parent's coordinates. */
  x: number; y: number; w: number; h: number
}
const masks = new Map<string, Mask>()

/** The item's own pixels, used to keep the band inside its shape. Taken
 *  while the node is unposed and reused until the item or the zoom changes;
 *  video and GIF frames are taken fresh every time. */
function maskFor(stage: Konva.Stage, item: PlacedMedia, node: Konva.Node): Mask | null {
  const scale = stage.scaleX()
  const hit = masks.get(item.id)
  const live = item.type === 'video' || item.type === 'gif'
  if (hit && !live && hit.item === item && hit.scale === scale) return hit
  const parent = node.getParent()
  if (!parent || !node.visible()) return null
  const r = node.getClientRect({ skipShadow: true })
  const w = Math.ceil(r.width), h = Math.ceil(r.height)
  if (w < 1 || h < 1) return null
  let pr = Math.min(2, window.devicePixelRatio || 1)
  if (Math.max(w, h) * pr > 4096) pr = 4096 / Math.max(w, h)
  const shape = node as Konva.Shape
  const shadowWas = shape.shadowEnabled()
  let canvas: HTMLCanvasElement
  shape.shadowEnabled(false)
  try {
    canvas = node.toCanvas({ x: r.x, y: r.y, width: w, height: h, pixelRatio: pr })
  } finally {
    shape.shadowEnabled(shadowWas)
  }
  const origin = parent.getAbsoluteTransform().copy().invert().point({ x: r.x, y: r.y })
  const k = parent.getAbsoluteScale().x || 1
  const scratch = hit?.scratch ?? document.createElement('canvas')
  scratch.width = canvas.width
  scratch.height = canvas.height
  const mask: Mask = { item, scale, canvas, scratch, x: origin.x, y: origin.y, w: w / k, h: h / k }
  masks.set(item.id, mask)
  return mask
}

/** Paints the band at position `u` (0..1 across) into the mask's scratch. */
function paintBand(mask: Mask, u: number, color: string, strength: number) {
  const { scratch, canvas } = mask
  const ctx = scratch.getContext('2d')
  if (!ctx) return
  const W = scratch.width, H = scratch.height
  ctx.globalCompositeOperation = 'copy'
  ctx.drawImage(canvas, 0, 0)
  ctx.globalCompositeOperation = 'source-in'
  // A slanted band: its slant adds to the travel so both ends clear the box.
  const slant = H * 0.35
  const band = Math.max(24, W * 0.3)
  const cx = -band - slant + u * (W + 2 * band + slant)
  const g = ctx.createLinearGradient(cx - band / 2, 0, cx + band / 2 + slant, H)
  g.addColorStop(0, withAlpha(color, 0))
  g.addColorStop(0.5, withAlpha(color, 0.35 + 0.6 * strength))
  g.addColorStop(1, withAlpha(color, 0))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'source-over'
}

/* ------------------------------------------------------------------ */
/*  Posing                                                            */
/* ------------------------------------------------------------------ */

/** Poses one slide's items for `t` seconds in. Returns the undo, which puts
 *  back only what is still as the pose left it — an edit made meanwhile
 *  wins. `items` are the slide's own (not master copies). */
export function poseSlideAt(stage: Konva.Stage, items: PlacedMedia[], t: number, slideH: number): () => void {
  const sets: { node: Konva.Node; attr: string; before: unknown; after: unknown }[] = []
  const touched: string[] = []
  const set = (node: Konva.Node, attr: string, value: number) => {
    const before = node.getAttr(attr)
    if (before === value) return
    node.setAttr(attr, value)
    sets.push({ node, attr, before, after: value })
  }

  for (const item of items) {
    if (!hasMotion(item) && !hasEntrance(item)) continue
    const rich = richSpecOf(item)
    const pose = poseAt(item, t, { slideH, accents: rich?.accents ?? 0, paragraphs: rich?.paragraphs ?? 0 })
    if (isRest(pose)) continue
    const media = stage.findOne(`#media-${item.id}`)
    if (!media) continue
    const live: FxLive = {}

    // The mask is read before anything moves.
    const shimmer = effectOf(item, 'shimmer')
    if (shimmer && pose.shimmer !== null) {
      const mask = maskFor(stage, item, media)
      if (mask) {
        paintBand(mask, pose.shimmer, shimmer.color || '#ffffff', shimmer.strength)
        live.shimmer = { canvas: mask.scratch, x: mask.x, y: mask.y, w: mask.w, h: mask.h }
      }
    }
    if (pose.ripple !== null) {
      const travel = effectOf(item, 'travel')
      const reach = Math.max(28, item.width * 0.9) * (0.6 + 0.8 * (travel?.strength ?? 0.6))
      live.ripple = {
        x: item.x, y: item.y, r: 6 + pose.ripple * reach,
        alpha: (1 - pose.ripple) * 0.9, width: Math.max(2, item.width * 0.05),
        color: travel?.color || item.strokeColor || '#ffffff',
      }
    }
    if (live.shimmer || live.ripple) fxLive.set(item.id, live)
    if (pose.accents || pose.lines) richLive.set(item.id, { accents: pose.accents, lines: pose.lines })
    touched.push(item.id)

    if (pose.glow !== null) {
      const shape = media as Konva.Shape
      set(media, 'shadowOpacity', (shape.shadowOpacity() ?? 1) * pose.glow)
    }

    const moved = pose.dx !== 0 || pose.dy !== 0 || pose.scale !== 1 || pose.opacity !== 1
    if (!moved) continue
    const cx = item.x + item.width / 2
    const cy = item.y + item.height / 2
    const nodes = [stage.findOne(`#textbg-${item.id}`), media, stage.findOne(`#fx-${item.id}`)]
    for (const node of nodes) {
      if (!node) continue
      if (pose.opacity !== 1) set(node, 'opacity', node.opacity() * pose.opacity)
      const x = node.x(), y = node.y()
      // Scale about the item's centre, whatever the node's own origin.
      const k = pose.scale
      if (k !== 1) {
        set(node, 'scaleX', node.scaleX() * k)
        set(node, 'scaleY', node.scaleY() * k)
      }
      set(node, 'x', x + pose.dx + (1 - k) * (cx - x))
      set(node, 'y', y + pose.dy + (1 - k) * (cy - y))
    }
  }

  return () => {
    for (let i = sets.length - 1; i >= 0; i--) {
      const s = sets[i]!
      if (s.node.getAttr(s.attr) === s.after) s.node.setAttr(s.attr, s.before)
    }
    for (const id of touched) { fxLive.delete(id); richLive.delete(id) }
  }
}

/** Forget cached masks (items removed, document replaced). */
export function clearEffectCaches() {
  masks.clear()
  fxLive.clear()
  richLive.clear()
}
