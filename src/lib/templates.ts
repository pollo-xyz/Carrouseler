/* Starter decks. Each template is a structure — a hook, the beats, a close —
 * drawn in the person's brand kit, with placeholder copy that says what goes
 * where. They are plain documents once opened: nothing stays linked. */
import type { PlacedMedia, Slide } from '../store/useTiovivoStore'
import { PRESETS } from './presets'
import type { PresetId, Size } from './presets'
import type { BrandKit } from './brand'
import { readableOn } from './brand'

export interface TemplateDeck {
  presetId: Exclude<PresetId, 'custom'>
  dimensions: Size
  slides: Slide[]
  items: PlacedMedia[]
}

export interface Template {
  id: string
  name: string
  /** What it's for, in a few words. */
  blurb: string
  build: (brand: BrandKit) => TemplateDeck
}

const id = () => crypto.randomUUID()

const BASE: Omit<PlacedMedia, 'id' | 'slideId' | 'type' | 'name' | 'x' | 'y' | 'width' | 'height'> = {
  src: '', rotation: 0, naturalWidth: 0, naturalHeight: 0,
  brightness: 0, contrast: 0, saturation: 1, blur: 0, flipX: false, flipY: false,
  cropX: 0, cropY: 0, cropW: 0, cropH: 0, coverTime: 0, trimStart: 0, trimEnd: 0,
}

interface TextOpts {
  size: number
  color: string
  font: string
  bold?: boolean
  width?: number
  lineHeight?: number
  letterSpacing?: number
  align?: PlacedMedia['textAlign']
  /** Highlight pill colour behind the text. */
  pill?: string
  allSlides?: boolean
}

/** Builds one deck: tracks the current slide and the page margin. */
class Deck {
  slides: Slide[] = []
  items: PlacedMedia[] = []
  readonly w: number
  readonly h: number
  /** Page margin — the same on every side. */
  readonly m: number
  private current = ''
  readonly presetId: Exclude<PresetId, 'custom'>
  readonly brand: BrandKit

  constructor(presetId: Exclude<PresetId, 'custom'>, brand: BrandKit) {
    this.presetId = presetId
    this.brand = brand
    this.w = PRESETS[presetId].width
    this.h = PRESETS[presetId].height
    this.m = Math.round(this.w * 0.082)
  }

  slide(name: string, bgColor: string) {
    this.current = id()
    this.slides.push({ id: this.current, bgColor, exportEnabled: true, name })
    return this
  }

  text(text: string, x: number, y: number, o: TextOpts) {
    const lineHeight = o.lineHeight ?? 1.15
    const width = o.width ?? this.w - this.m * 2
    this.items.push({
      ...BASE,
      id: id(), slideId: this.current, type: 'text', name: 'Text',
      x, y, width,
      // The canvas measures the real height; this is a sane first guess.
      height: Math.round(o.size * lineHeight * text.split('\n').length),
      text, fontFamily: o.font, fontSize: o.size, bold: o.bold ?? false, italic: false,
      textColor: o.color, textAlign: o.align ?? 'left', lineHeight,
      letterSpacing: o.letterSpacing ?? 0, fillMode: false,
      ...(o.pill ? { textBgColor: o.pill, textBgPadding: Math.round(o.size * 0.45), textBgCornerRadius: Math.round(o.size * 0.3), textBgOpacity: 1 } : {}),
      ...(o.allSlides ? { appearsOnAllSlides: true } : {}),
    })
    return this
  }

  rule(x: number, y: number, width: number, color: string, thickness = 6) {
    this.items.push({
      ...BASE,
      id: id(), slideId: this.current, type: 'shape', name: 'Rule',
      x, y, width, height: thickness,
      shapeKind: 'rect', fillColor: color, strokeColor: color, strokeWidth: 0, cornerRadius: 0,
    })
    return this
  }

  done(): TemplateDeck {
    return { presetId: this.presetId, dimensions: { ...PRESETS[this.presetId] }, slides: this.slides, items: this.items }
  }
}

/* ---- shared slide recipes (4:5 unless the deck says otherwise) ---- */

function cover(d: Deck, kicker: string, headline: string, sub: string) {
  const { brand: b, m, h } = d
  const ink = readableOn(b.accent, b)
  d.slide('Cover', b.accent)
    .text(kicker.toUpperCase(), m, m, { size: 30, color: ink, font: b.bodyFont, bold: true, letterSpacing: 4 })
    .text(headline, m, Math.round(h * 0.3), { size: 132, color: ink, font: b.headingFont, bold: true, lineHeight: 0.98, letterSpacing: -4 })
    .text(sub, m, Math.round(h * 0.68), { size: 44, color: ink, font: b.bodyFont, lineHeight: 1.3, width: Math.round(d.w * 0.72) })
    .text('Swipe →', m, h - m - 52, { size: 34, color: ink, font: b.bodyFont, bold: true })
}

function point(d: Deck, label: string, headline: string, body: string) {
  const { brand: b, m, h } = d
  d.slide(label, b.background)
    .text(label, m, m, { size: 72, color: b.accent, font: b.headingFont, bold: true, letterSpacing: -2 })
    .rule(m, m + 118, 96, b.text)
    .text(headline, m, Math.round(h * 0.22), { size: 96, color: b.text, font: b.headingFont, bold: true, lineHeight: 1.02, letterSpacing: -3 })
    .text(body, m, Math.round(h * 0.55), { size: 42, color: b.text, font: b.bodyFont, lineHeight: 1.35, width: Math.round(d.w * 0.76) })
}

function close(d: Deck, headline: string, action: string) {
  const { brand: b, m, h } = d
  d.slide('Close', b.text)
    .text(headline, m, Math.round(h * 0.26), { size: 112, color: b.background, font: b.headingFont, bold: true, lineHeight: 1, letterSpacing: -3 })
    .text(action, m + 20, Math.round(h * 0.66), {
      size: 40, color: readableOn(b.accent, b), font: b.bodyFont, bold: true, pill: b.accent,
      width: Math.round(d.w * 0.6),
    })
}

/** The handle, bottom-right of every slide — only when the kit has one. */
function stampHandle(d: Deck) {
  const { brand: b, m, w, h } = d
  if (!b.handle.trim() || d.slides.length === 0) return
  // Lives on the first slide and repeats; mid-grey reads on light and dark grounds.
  const first = d.slides[0]!.id
  d.items.push({
    ...BASE,
    id: id(), slideId: first, type: 'text', name: 'Handle',
    x: w - m - 420, y: h - m - 46, width: 420, height: 36,
    text: b.handle.trim(), fontFamily: b.bodyFont, fontSize: 28, bold: true, italic: false,
    textColor: '#8a8a86', textAlign: 'right', lineHeight: 1.15, letterSpacing: 0, fillMode: false,
    appearsOnAllSlides: true,
  })
}

export const TEMPLATES: Template[] = [
  {
    id: 'list',
    name: 'List',
    blurb: 'A hook, three points, a close',
    build: (brand) => {
      const d = new Deck('4:5', brand)
      cover(d, 'Guide', 'Three things\nnobody tells\nyou', 'The promise of the post, in one line.')
      point(d, '01', 'Your first point, said plainly.', 'Two sentences that back it up. Keep them short enough to read in one glance.')
      point(d, '02', 'The second point builds on it.', 'An example, a number or a small story makes this one stick.')
      point(d, '03', 'End on the strongest one.', 'People remember the last slide they read. Give them something to repeat.')
      close(d, 'Found this\nuseful?', 'Save it for later')
      stampHandle(d)
      return d.done()
    },
  },
  {
    id: 'steps',
    name: 'How-to',
    blurb: 'A process, one step per slide',
    build: (brand) => {
      const d = new Deck('4:5', brand)
      cover(d, 'How to', 'Do the thing\nin four steps', 'What they will be able to do by the last slide.')
      point(d, 'Step 1', 'Start with the smallest action.', 'Say exactly what to do. One instruction, no options.')
      point(d, 'Step 2', 'Then the part people skip.', 'Explain why it matters in a sentence, then how to do it.')
      point(d, 'Step 3', 'Now the step that takes time.', 'Set the expectation: how long, and what good looks like.')
      point(d, 'Step 4', 'Finish and check the result.', 'Tell them how they will know it worked.')
      close(d, 'Try it\nthis week', 'Send this to someone who needs it')
      stampHandle(d)
      return d.done()
    },
  },
  {
    id: 'myth',
    name: 'Myth / fact',
    blurb: 'Correct a common belief',
    build: (brand) => {
      const d = new Deck('4:5', brand)
      const { brand: b, m, h } = d
      cover(d, 'Myth busting', 'You have\nbeen told\nthis wrong', 'The belief you are about to take apart.')
      const pair = (n: number, myth: string, fact: string) => {
        d.slide(`Myth ${n}`, b.background)
          .text('MYTH', m, m, { size: 30, color: b.text, font: b.bodyFont, bold: true, letterSpacing: 4 })
          .text(myth, m, m + 70, { size: 76, color: b.text, font: b.headingFont, bold: true, lineHeight: 1.05, letterSpacing: -2 })
          .rule(m, Math.round(h * 0.5), d.w - m * 2, b.text, 3)
          .text('FACT', m, Math.round(h * 0.5) + 44, { size: 30, color: b.accent, font: b.bodyFont, bold: true, letterSpacing: 4 })
          .text(fact, m, Math.round(h * 0.5) + 114, { size: 60, color: b.accent, font: b.headingFont, bold: true, lineHeight: 1.1, letterSpacing: -1.5 })
      }
      pair(1, '“Everyone knows this is how it works.”', 'What is actually true, in one sentence.')
      pair(2, '“You need more of it to get results.”', 'The smaller thing that matters more.')
      close(d, 'Which one\nsurprised you?', 'Tell me in the comments')
      stampHandle(d)
      return d.done()
    },
  },
  {
    id: 'quote',
    name: 'Quote',
    blurb: 'One line worth sharing',
    build: (brand) => {
      const d = new Deck('1:1', brand)
      const { brand: b, m, h } = d
      d.slide('Quote', b.background)
        .text('“', m - 8, m - 60, { size: 260, color: b.accent, font: b.headingFont, bold: true, lineHeight: 1 })
        .text('A sentence people will want to put their name next to.', m, Math.round(h * 0.3), {
          size: 84, color: b.text, font: b.headingFont, bold: true, lineHeight: 1.08, letterSpacing: -2,
        })
        .rule(m, h - m - 96, 96, b.text)
        .text('Who said it', m, h - m - 62, { size: 34, color: b.text, font: b.bodyFont, bold: true })
      stampHandle(d)
      return d.done()
    },
  },
  {
    id: 'launch',
    name: 'Announcement',
    blurb: 'News, the details, what to do',
    build: (brand) => {
      const d = new Deck('4:5', brand)
      const { brand: b, m, h } = d
      cover(d, 'New', 'Something\nis coming', 'The date, or the one fact that makes it news.')
      d.slide('Details', b.background)
        .text('What it is', m, m, { size: 30, color: b.accent, font: b.bodyFont, bold: true, letterSpacing: 2 })
        .text('Describe it the way you would to a friend.', m, m + 70, { size: 84, color: b.text, font: b.headingFont, bold: true, lineHeight: 1.05, letterSpacing: -2 })
        .rule(m, Math.round(h * 0.56), d.w - m * 2, b.text, 3)
        .text('When\nWhere\nHow much', m, Math.round(h * 0.6), { size: 42, color: b.text, font: b.bodyFont, bold: true, lineHeight: 1.6, width: 300 })
        .text('The date\nThe place or link\nThe price', m + 320, Math.round(h * 0.6), { size: 42, color: b.text, font: b.bodyFont, lineHeight: 1.6, width: d.w - m * 2 - 320 })
      close(d, 'Be first\nin line', 'Link in bio')
      stampHandle(d)
      return d.done()
    },
  },
  {
    id: 'reel',
    name: 'Reel cover',
    blurb: '9:16, clear of the app interface',
    build: (brand) => {
      const d = new Deck('9:16', brand)
      const { brand: b, m, h } = d
      const ink = readableOn(b.accent, b)
      // Top ~250px and bottom ~420px belong to the apps' own interface.
      d.slide('Cover', b.accent)
        .text('EPISODE 01', m, 300, { size: 34, color: ink, font: b.bodyFont, bold: true, letterSpacing: 4 })
        .text('The title\nof this\nvideo', m, Math.round(h * 0.3), { size: 168, color: ink, font: b.headingFont, bold: true, lineHeight: 0.96, letterSpacing: -5 })
        .text('One line on why to watch.', m, Math.round(h * 0.62), { size: 50, color: ink, font: b.bodyFont, lineHeight: 1.3, width: Math.round(d.w * 0.72) })
      return d.done()
    },
  },
]
