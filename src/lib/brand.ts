/* Brand kit — the person's own fonts, colours and handle. App-level (it
 * belongs to the person, not to one document), so it lives in localStorage
 * rather than in the .vpost. Templates are built from it, colour fields
 * offer it as swatches, and a connected agent reads it via get_project. */
import { create } from 'zustand'
import { useTiovivoStore } from '../store/useTiovivoStore'
import type { PlacedMedia } from '../store/useTiovivoStore'

export interface BrandKit {
  /** Social handle or name stamped on templates, e.g. "@studio". Optional. */
  handle: string
  headingFont: string
  bodyFont: string
  /** Slide ground. */
  background: string
  /** Text colour on that ground. */
  text: string
  /** The one loud colour: highlights, cover slides, calls to action. */
  accent: string
  /** How the brand writes — read by the assistant and connected agents. */
  voice: string
}

export const DEFAULT_BRAND: BrandKit = {
  handle: '',
  headingFont: 'Inter',
  bodyFont: 'Inter',
  background: '#f4f1ec',
  text: '#161614',
  accent: '#3d7bfd',
  voice: '',
}

const STORAGE_KEY = 'tiovivo-brand'
const HEX = /^#[0-9a-f]{6}$/i

function load(): BrandKit {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_BRAND }
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<BrandKit> | null
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_BRAND }
    const str = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v : fallback)
    const hex = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v : fallback)
    return {
      handle: typeof raw.handle === 'string' ? raw.handle : '',
      headingFont: str(raw.headingFont, DEFAULT_BRAND.headingFont),
      bodyFont: str(raw.bodyFont, DEFAULT_BRAND.bodyFont),
      background: hex(raw.background, DEFAULT_BRAND.background),
      text: hex(raw.text, DEFAULT_BRAND.text),
      accent: hex(raw.accent, DEFAULT_BRAND.accent),
      voice: typeof raw.voice === 'string' ? raw.voice : '',
    }
  } catch {
    return { ...DEFAULT_BRAND } // storage disabled or corrupt
  }
}

interface BrandState {
  brand: BrandKit
  /** Kits the open deck has been drawn in this session, newest first —
   *  what "Apply to this deck" swaps away from. More than one because undo
   *  can take the deck back to an earlier look. A reopened file matches
   *  none and gets the plain restyle. */
  drawnWith: BrandKit[]
  setBrand: (patch: Partial<BrandKit>) => void
  markDrawn: () => void
}

export const useBrandStore = create<BrandState>((set, get) => ({
  brand: load(),
  drawnWith: [load()],
  setBrand: (patch) => {
    const brand = { ...get().brand, ...patch }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(brand)) } catch { /* not persisted */ }
    set({ brand })
  },
  markDrawn: () => set({ drawnWith: [get().brand, ...get().drawnWith].slice(0, 6) }),
}))

/** Perceived lightness 0–255 of a #rrggbb colour. */
export function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16) || 0
  const g = parseInt(h.slice(2, 4), 16) || 0
  const b = parseInt(h.slice(4, 6), 16) || 0
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Whichever of the two brand neutrals reads better on `ground`. */
export function readableOn(ground: string, brand: BrandKit): string {
  const l = luminance(ground)
  return Math.abs(l - luminance(brand.text)) >= Math.abs(l - luminance(brand.background))
    ? brand.text
    : brand.background
}

const same = (a: string | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase()

/** Restyle the open document with the brand, as one undo step.
 *
 *  `drawnWith` lists the kits the deck may be drawn in (a template, earlier
 *  applies); the one it still wears is the kit to swap away from.
 *  Where the deck still uses those colours, each one is swapped for its new
 *  counterpart — an accent cover stays an accent cover. A deck that wears
 *  none of them is restyled plainly instead: brand ground on solid
 *  slides, brand text colour on text (pill-backed text and vibe slides keep
 *  theirs, their ground isn't one colour).
 *
 *  Fonts either way: each slide's largest text takes the heading font, the
 *  rest the body font. Returns how many layers and slides changed. */
export function applyBrandToDeck(brand: BrandKit, drawnWith: BrandKit[]): number {
  const st = useTiovivoStore.getState()
  // The most recent kit whose colours the deck actually still wears.
  const wears = (k: BrandKit) => [k.background, k.text, k.accent].filter((c) =>
    st.slides.some((s) => !s.bgVibe && same(s.bgColor, c)) ||
    st.items.some((i) => same(i.textColor, c) || same(i.fillColor, c) || same(i.textBgColor, c))).length
  // Kits often share their neutrals, so take the best match, newest on a tie.
  let from = drawnWith[0] ?? brand
  let best = 0
  for (const k of drawnWith) {
    const n = wears(k)
    if (n > best) { best = n; from = k }
  }
  const swap = (c: string | undefined): string | undefined => {
    if (same(c, from.background)) return brand.background
    if (same(c, from.text)) return brand.text
    if (same(c, from.accent)) return brand.accent
    return undefined
  }
  const usesOld =
    st.slides.some((s) => !s.bgVibe && swap(s.bgColor)) ||
    st.items.some((i) => swap(i.textColor) || swap(i.fillColor) || swap(i.textBgColor))

  const slideColors: Record<string, string> = {}
  for (const s of st.slides) {
    if (s.bgVibe) continue
    const next = usesOld ? swap(s.bgColor) : brand.background
    if (next && !same(s.bgColor, next)) slideColors[s.id] = next
  }

  const patches: { id: string; patch: Partial<PlacedMedia> }[] = []
  const biggestBySlide = new Map<string, string>()
  for (const s of st.slides) {
    const texts = st.items.filter((i) => i.type === 'text' && i.slideId === s.id && !i.appearsOnAllSlides)
    if (texts.length) biggestBySlide.set(s.id, texts.reduce((a, b) => ((b.fontSize ?? 0) > (a.fontSize ?? 0) ? b : a)).id)
  }
  for (const it of st.items) {
    const patch: Partial<PlacedMedia> = {}
    if (it.type === 'text') {
      const font = biggestBySlide.get(it.slideId) === it.id ? brand.headingFont : brand.bodyFont
      if (it.fontFamily !== font) patch.fontFamily = font
      if (usesOld) {
        const color = swap(it.textColor)
        if (color && !same(it.textColor, color)) patch.textColor = color
        const pill = swap(it.textBgColor)
        if (pill && !same(it.textBgColor, pill)) patch.textBgColor = pill
      } else if (!it.textBgColor && !st.slides.find((s) => s.id === it.slideId)?.bgVibe && !same(it.textColor, brand.text)) {
        patch.textColor = brand.text
      }
    } else if (it.type === 'shape' && usesOld) {
      const fill = swap(it.fillColor)
      if (fill && !same(it.fillColor, fill)) patch.fillColor = fill
      const stroke = swap(it.strokeColor)
      if (stroke && !same(it.strokeColor, stroke)) patch.strokeColor = stroke
    }
    if (Object.keys(patch).length) patches.push({ id: it.id, patch })
  }
  st.restyleDeck(slideColors, patches)
  return patches.length + Object.keys(slideColors).length
}
