/* Effects — motion and light an item carries itself, so a slide can move
 * without a baked video. Everything here is pure: given an item and a time
 * it says how the item should be posed. The canvas applies the pose; the
 * preview clock and every video export share it, so what plays in the
 * editor is what lands in the file. */

export type EffectKind = 'glow' | 'pulse' | 'drift' | 'shimmer' | 'flash' | 'highlight' | 'reveal' | 'travel'

export interface EffectSettings {
  on: boolean
  /** Rate multiplier; 1 = the effect's natural pace. */
  speed?: number
  /** 0..1 — how much. */
  strength?: number
  /** Seconds into the slide before it starts. */
  delay?: number
  /** Seconds between repeats (pulse, shimmer, travel). 0 = once per loop. */
  every?: number
  color?: string
  /** Drift direction in degrees: 0 = sideways, 90 = up and down. */
  angle?: number
  /** Glow only: the glow swells and fades instead of holding steady. */
  breathe?: boolean
  /** Travel only: where the pointer starts, relative to where it ends. */
  dx?: number
  dy?: number
}

export type ItemEffects = Partial<Record<EffectKind, EffectSettings>>

/** The part of an item the effect maths reads. */
export interface EffectItem {
  type: string
  shapeKind?: string
  effects?: ItemEffects
  animIn?: string
  animDelay?: number
  text?: string
  accentColor?: string
  textColor?: string
  fillColor?: string
  strokeColor?: string
}

export const EFFECT_KINDS: { kind: EffectKind; label: string; hint: string }[] = [
  { kind: 'glow', label: 'Glow', hint: 'A soft halo in the layer\'s own colour, or one you pick.' },
  { kind: 'pulse', label: 'Pulse', hint: 'A brief swell, repeating.' },
  { kind: 'drift', label: 'Drift', hint: 'A slow float back and forth.' },
  { kind: 'shimmer', label: 'Shimmer', hint: 'A band of light sweeping across.' },
  { kind: 'flash', label: 'Show briefly', hint: 'Appears, holds, then fades away — for callouts that come and go.' },
  { kind: 'highlight', label: 'Highlight in turn', hint: 'Lights the accent words one after another.' },
  { kind: 'reveal', label: 'Reveal line by line', hint: 'Each paragraph comes up from dim, in order.' },
  { kind: 'travel', label: 'Move and click', hint: 'The pointer glides in, then clicks.' },
]

export function effectApplies(kind: EffectKind, item: EffectItem): boolean {
  const cursor = item.type === 'shape' && item.shapeKind === 'cursor'
  if (kind === 'travel') return cursor
  if (kind === 'highlight' || kind === 'reveal') return item.type === 'text'
  if (cursor) return false
  return true
}

export const EFFECT_DEFAULTS: Record<EffectKind, Required<Pick<EffectSettings, 'speed' | 'strength' | 'delay'>> & EffectSettings> = {
  glow: { on: true, speed: 1, strength: 0.6, delay: 0, breathe: false },
  pulse: { on: true, speed: 1, strength: 0.5, delay: 0, every: 2 },
  drift: { on: true, speed: 1, strength: 0.5, delay: 0, angle: 90 },
  shimmer: { on: true, speed: 1, strength: 0.7, delay: 0, every: 3, color: '#ffffff' },
  flash: { on: true, speed: 1, strength: 1, delay: 0, every: 0 },
  highlight: { on: true, speed: 1, strength: 1, delay: 0 },
  reveal: { on: true, speed: 1, strength: 0.65, delay: 0 },
  travel: { on: true, speed: 1, strength: 0.6, delay: 0.3, every: 0, dx: -160, dy: 120 },
}

/** An effect's settings with every gap filled; null when it is off. */
export function effectOf(item: EffectItem, kind: EffectKind): (typeof EFFECT_DEFAULTS)[EffectKind] | null {
  const e = item.effects?.[kind]
  if (!e || !e.on || !effectApplies(kind, item)) return null
  const d = EFFECT_DEFAULTS[kind]
  const out = { ...d }
  for (const [k, v] of Object.entries(e)) {
    if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v
  }
  out.speed = Math.min(4, Math.max(0.1, out.speed))
  out.strength = Math.min(1, Math.max(0, out.strength))
  out.delay = Math.max(0, out.delay)
  return out
}

/** True when the item changes over time (a steady glow does not). */
export function hasMotion(item: EffectItem): boolean {
  if (!item.effects) return false
  for (const { kind } of EFFECT_KINDS) {
    const e = effectOf(item, kind)
    if (!e) continue
    if (kind === 'glow') { if (e.breathe) return true } else return true
  }
  return false
}

export function hasEntrance(item: EffectItem): boolean {
  return !!item.animIn && item.animIn !== 'none'
}

/** The colour a glow takes when none is picked: the layer's own. */
export function glowColor(item: EffectItem): string {
  const picked = item.effects?.glow?.color
  if (picked) return picked
  if (item.type === 'text') return item.textColor || '#ffffff'
  if (item.type === 'shape') {
    if (item.strokeColor && item.strokeColor !== 'transparent') return item.strokeColor
    if (item.fillColor && item.fillColor !== 'transparent') return item.fillColor
  }
  return '#ffffff'
}

/** Shadow settings that draw the resting glow, or null without one. */
export function glowShadow(item: EffectItem): { color: string; blur: number; opacity: number } | null {
  const g = effectOf(item, 'glow')
  if (!g) return null
  return { color: glowColor(item), blur: 6 + 44 * g.strength, opacity: Math.min(1, 0.45 + 0.55 * g.strength) }
}

/* ------------------------------------------------------------------ */
/*  Accent words                                                      */
/* ------------------------------------------------------------------ */

export interface Accents {
  /** The text with the markers removed — what is measured and drawn. */
  clean: string
  /** [start, end) ranges of `clean` drawn in the accent colour. */
  ranges: [number, number][]
}

/** `*words*` mark an accent. A lone asterisk, or one hugging a space on the
 *  inside, is left as it is. */
export function parseAccents(text: string): Accents {
  const ranges: [number, number][] = []
  let clean = ''
  let last = 0
  const re = /\*([^*\n]+)\*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const inner = m[1]!
    if (inner !== inner.trim()) { re.lastIndex = m.index + 1; continue }
    clean += text.slice(last, m.index)
    ranges.push([clean.length, clean.length + inner.length])
    clean += inner
    last = m.index + m[0].length
  }
  clean += text.slice(last)
  return { clean, ranges }
}

/** What a text item shows: markers only count once an accent colour is set. */
export function accentsOf(item: { text?: string; accentColor?: string }): Accents {
  const text = item.text || ''
  if (!item.accentColor) return { clean: text, ranges: [] }
  return parseAccents(text)
}

export function plainText(item: { text?: string; accentColor?: string }): string {
  return accentsOf(item).clean
}

/** The words of a marked-up text, each with whether it is accented. */
export function accentWords(text: string): { word: string; accent: boolean }[] {
  const { clean, ranges } = parseAccents(text)
  const out: { word: string; accent: boolean }[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(clean))) {
    const s = m.index, e = s + m[0].length
    out.push({ word: m[0], accent: ranges.some(([a, b]) => a < e && b > s) })
  }
  return out
}

/** Marked-up text with word number `index` switched. Neighbouring accented
 *  words on a line share one pair of markers. */
export function toggleAccentWord(text: string, index: number): string {
  const { clean, ranges } = parseAccents(text)
  const tokens: { text: string; word: boolean; accent: boolean }[] = []
  const re = /\S+|\s+/g
  let m: RegExpExecArray | null
  let n = 0
  while ((m = re.exec(clean))) {
    const word = /\S/.test(m[0])
    const s = m.index, e = s + m[0].length
    let accent = word && ranges.some(([a, b]) => a < e && b > s)
    if (word) { if (n === index) accent = !accent; n++ }
    tokens.push({ text: m[0], word, accent })
  }
  let out = ''
  let open = false
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.word) {
      if (t.accent && !open) { out += '*'; open = true }
      out += t.text
      // Close unless the next word continues the run on the same line.
      const gap = tokens[i + 1]
      const next = tokens[i + 2]
      const continues = t.accent && gap && !gap.word && !gap.text.includes('\n') && next?.word && next.accent
      if (open && !continues) { out += '*'; open = false }
    } else {
      out += t.text
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/*  Pose                                                              */
/* ------------------------------------------------------------------ */

export interface Pose {
  dx: number
  dy: number
  scale: number
  opacity: number
  /** Multiplier on the resting glow; null leaves it alone. */
  glow: number | null
  /** 0..1 position of the light band; null while it is off the layer. */
  shimmer: number | null
  /** How lit each accent run is (0 = base colour, 1 = accent). */
  accents: number[] | null
  /** Opacity of each paragraph. */
  lines: number[] | null
  /** 0..1 growth of the pointer's click ring. */
  ripple: number | null
}

export const REST_POSE: Pose = {
  dx: 0, dy: 0, scale: 1, opacity: 1, glow: null, shimmer: null, accents: null, lines: null, ripple: null,
}

export const ENTRANCE_SECONDS = 0.5

const easeOut = (p: number) => 1 - Math.pow(1 - p, 3)
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Progress 0..1 through a beat that lasts `dur` and comes round `every`
 *  seconds; null between beats and before `delay`. */
function beat(t: number, delay: number, every: number | undefined, dur: number): number | null {
  let local = t - delay
  if (local < 0) return null
  if (every && every > 0) local %= Math.max(every, dur)
  return local < dur ? local / dur : null
}

export interface PoseContext {
  /** Slide height, for the rise entrance. */
  slideH: number
  /** Number of accent runs / paragraphs in a text item. */
  accents?: number
  paragraphs?: number
}

/** How `item` looks `t` seconds into its slide. */
export function poseAt(item: EffectItem, t: number, ctx: PoseContext): Pose {
  const pose: Pose = { ...REST_POSE }

  if (hasEntrance(item)) {
    const p = clamp01((t - (item.animDelay ?? 0)) / ENTRANCE_SECONDS)
    if (p < 1) {
      const e = easeOut(p)
      pose.opacity *= e
      if (item.animIn === 'rise') pose.dy += (1 - e) * ctx.slideH * 0.035
      else if (item.animIn === 'pop') pose.scale *= 0.88 + 0.12 * e
    }
  }

  const pulse = effectOf(item, 'pulse')
  if (pulse) {
    const u = beat(t, pulse.delay, pulse.every, 0.7 / pulse.speed)
    if (u !== null) pose.scale *= 1 + 0.12 * pulse.strength * Math.sin(Math.PI * u)
  }

  const drift = effectOf(item, 'drift')
  if (drift && t >= drift.delay) {
    const period = 3 / drift.speed
    const d = Math.sin((2 * Math.PI * (t - drift.delay)) / period) * 28 * drift.strength
    const a = ((drift.angle ?? 90) * Math.PI) / 180
    pose.dx += Math.cos(a) * d
    pose.dy += Math.sin(a) * d
  }

  const glow = effectOf(item, 'glow')
  if (glow?.breathe) {
    const period = 2.4 / glow.speed
    pose.glow = 0.6 + 0.4 * Math.cos((2 * Math.PI * Math.max(0, t - glow.delay)) / period)
  }

  const shimmer = effectOf(item, 'shimmer')
  if (shimmer) pose.shimmer = beat(t, shimmer.delay, shimmer.every, 0.9 / shimmer.speed)

  const flash = effectOf(item, 'flash')
  if (flash) {
    const hold = 1.6 / flash.speed
    const u = beat(t, flash.delay, flash.every, hold)
    pose.opacity *= u === null ? 0 : clamp01(Math.min((u * hold) / 0.25, ((1 - u) * hold) / 0.35))
  }

  const highlight = effectOf(item, 'highlight')
  const nAcc = ctx.accents ?? 0
  if (highlight && nAcc > 0) {
    const step = 1.2 / highlight.speed
    const fade = Math.min(0.3, step / 3)
    const local = t - highlight.delay
    pose.accents = Array.from({ length: nAcc }, (_, i) => {
      if (local < 0) return 0
      if (Math.floor(local / step) % nAcc !== i) return 0
      const within = local % step
      return clamp01(Math.min(within / fade, (step - within) / fade))
    })
  }

  const reveal = effectOf(item, 'reveal')
  const nPar = ctx.paragraphs ?? 0
  if (reveal && nPar > 0) {
    const step = 0.7 / reveal.speed
    const fade = 0.45 / reveal.speed
    const dim = 1 - reveal.strength
    pose.lines = Array.from({ length: nPar }, (_, i) =>
      dim + (1 - dim) * easeOut(clamp01((t - reveal.delay - i * step) / fade)))
  }

  const travel = effectOf(item, 'travel')
  if (travel) {
    const dur = 0.9 / travel.speed
    let local = t - travel.delay
    if (local < 0) {
      pose.opacity = 0
    } else {
      if (travel.every && travel.every > 0) local %= Math.max(travel.every, dur + 1)
      if (local < dur) {
        const u = local / dur
        const e = easeInOut(u)
        pose.dx += (1 - e) * (travel.dx ?? 0)
        pose.dy += (1 - e) * (travel.dy ?? 0)
        pose.opacity *= clamp01(u / 0.2)
      } else {
        const c = local - dur
        if (c < 0.25) pose.scale *= 1 - 0.14 * Math.sin((Math.PI * c) / 0.25)
        if (c < 0.6) pose.ripple = c / 0.6
      }
    }
  }

  return pose
}

export function isRest(p: Pose): boolean {
  return p.dx === 0 && p.dy === 0 && p.scale === 1 && p.opacity === 1
    && p.glow === null && p.shimmer === null && p.accents === null && p.lines === null && p.ripple === null
}

/** How long a slide of these items should run before it loops. Six seconds
 *  holds whole cycles of every effect at its natural pace; slow or late
 *  ones stretch it so nothing is cut off mid-move. */
export function loopSeconds(items: EffectItem[]): number {
  let need = 0
  for (const item of items) {
    if (hasEntrance(item)) need = Math.max(need, (item.animDelay ?? 0) + ENTRANCE_SECONDS + 1.5)
    if (!hasMotion(item)) continue
    need = Math.max(need, 6)
    const reveal = effectOf(item, 'reveal')
    if (reveal) {
      const n = accentsOf(item).clean.split('\n').length
      need = Math.max(need, reveal.delay + ((n - 1) * 0.7 + 0.45) / reveal.speed + 1.5)
    }
    const highlight = effectOf(item, 'highlight')
    if (highlight) {
      const n = accentsOf(item).ranges.length
      if (n > 0) need = Math.max(need, highlight.delay + (n * 1.2) / highlight.speed)
    }
    const travel = effectOf(item, 'travel')
    if (travel) need = Math.max(need, travel.delay + 0.9 / travel.speed + 1.6)
    // A late beat must at least finish before the loop comes round.
    const beats = { pulse: 0.7, shimmer: 0.9, flash: 1.6 } as const
    for (const kind of ['pulse', 'shimmer', 'flash'] as const) {
      const e = effectOf(item, kind)
      if (e) need = Math.max(need, e.delay + beats[kind] / e.speed + 0.5)
    }
  }
  return Math.ceil(need * 2) / 2
}

/* ------------------------------------------------------------------ */
/*  Colour                                                            */
/* ------------------------------------------------------------------ */

function rgbOf(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return null
  let h = m[1]!
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** `a` blended `k` of the way to `b`. Colours that are not hex snap. */
export function mixColor(a: string, b: string, k: number): string {
  if (k <= 0) return a
  if (k >= 1) return b
  const ca = rgbOf(a), cb = rgbOf(b)
  if (!ca || !cb) return k < 0.5 ? a : b
  const c = ca.map((v, i) => Math.round(v + (cb[i]! - v) * k))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

export function withAlpha(color: string, alpha: number): string {
  const c = rgbOf(color) ?? [255, 255, 255]
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`
}

/* ------------------------------------------------------------------ */
/*  Validation (agent / file input)                                   */
/* ------------------------------------------------------------------ */

const SETTING_TYPES: Record<keyof EffectSettings, 'number' | 'boolean' | 'string'> = {
  on: 'boolean', speed: 'number', strength: 'number', delay: 'number', every: 'number',
  color: 'string', angle: 'number', breathe: 'boolean', dx: 'number', dy: 'number',
}

/** Checks an `effects` bag from outside the app. Each kind maps to its
 *  settings (`on` defaults to true), or to null / false to remove it.
 *  Throws with a message that says what to fix. */
export function parseEffects(input: unknown, item: EffectItem): Partial<Record<EffectKind, EffectSettings | null>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('"effects" must be an object such as { "glow": { "strength": 0.6 } }.')
  }
  const kinds = EFFECT_KINDS.map((k) => k.kind)
  const out: Partial<Record<EffectKind, EffectSettings | null>> = {}
  for (const [kind, raw] of Object.entries(input)) {
    if (!kinds.includes(kind as EffectKind)) {
      throw new Error(`"${kind}" is not an effect. Effects: ${kinds.join(', ')}.`)
    }
    if (raw === null || raw === false) { out[kind as EffectKind] = null; continue }
    if (!effectApplies(kind as EffectKind, item)) {
      const what = item.type === 'shape' ? `${item.shapeKind ?? 'rect'} shapes` : `${item.type} items`
      throw new Error(`The "${kind}" effect does not apply to ${what}.`)
    }
    const bag = raw === true ? {} : raw
    if (typeof bag !== 'object' || Array.isArray(bag)) {
      throw new Error(`effects.${kind} must be an object of settings, true, or null to remove it.`)
    }
    const settings: EffectSettings = { on: true }
    for (const [key, value] of Object.entries(bag as object)) {
      const want = SETTING_TYPES[key as keyof EffectSettings]
      if (!want) {
        throw new Error(`"${key}" is not an effect setting. Settings: ${Object.keys(SETTING_TYPES).join(', ')}.`)
      }
      if (typeof value !== want || (want === 'number' && !Number.isFinite(value))) {
        throw new Error(`effects.${kind}.${key} must be a ${want}.`)
      }
      ;(settings as unknown as Record<string, unknown>)[key] = value
    }
    out[kind as EffectKind] = settings
  }
  return out
}

/** `current` with a parsed bag laid over it; undefined once nothing is left. */
export function mergeEffects(
  current: ItemEffects | undefined,
  patch: Partial<Record<EffectKind, EffectSettings | null>>,
): ItemEffects | undefined {
  const next: ItemEffects = { ...current }
  for (const [kind, value] of Object.entries(patch)) {
    if (value === null) delete next[kind as EffectKind]
    else next[kind as EffectKind] = value
  }
  return Object.keys(next).length ? next : undefined
}
