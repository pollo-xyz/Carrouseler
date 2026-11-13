import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useTiovivoStore } from '../store/useTiovivoStore'
import { DEFAULT_BRAND, applyBrandToDeck, readableOn, type BrandKit } from './brand'
import { TEMPLATES } from './templates'

vi.mock('./thumbnail', () => ({
  generateThumbnail: vi.fn(async () => 'data:image/png;base64,mock'),
}))

const store = () => useTiovivoStore.getState()

function open(templateId: string, brand: BrandKit) {
  const deck = TEMPLATES.find((t) => t.id === templateId)!.build(brand)
  store().loadProjectState({
    slides: deck.slides,
    items: deck.items,
    dimensions: deck.dimensions,
    presetId: deck.presetId,
    customWidth: deck.dimensions.width,
    customHeight: deck.dimensions.height,
  })
  return deck
}

beforeEach(() => {
  store().resetProject()
})

describe('templates', () => {
  it('every template builds a well-formed deck inside its format', () => {
    for (const t of TEMPLATES) {
      const deck = t.build({ ...DEFAULT_BRAND, handle: '@studio' })
      expect(deck.slides.length, t.id).toBeGreaterThan(0)
      const slideIds = new Set(deck.slides.map((s) => s.id))
      expect(new Set(deck.items.map((i) => i.id)).size, t.id).toBe(deck.items.length)
      for (const it of deck.items) {
        expect(slideIds.has(it.slideId), `${t.id}: item on a real slide`).toBe(true)
        expect(it.x, `${t.id}: "${it.text ?? it.name}" inside left edge`).toBeGreaterThanOrEqual(0)
        expect(it.x + it.width, `${t.id}: "${it.text ?? it.name}" inside right edge`).toBeLessThanOrEqual(deck.dimensions.width)
        expect(it.y, `${t.id}: "${it.text ?? it.name}" inside top`).toBeGreaterThanOrEqual(0)
        expect(it.y, `${t.id}: "${it.text ?? it.name}" inside bottom`).toBeLessThan(deck.dimensions.height)
      }
    }
  })

  it('stamps the handle on every slide only when the kit has one', () => {
    const list = TEMPLATES.find((t) => t.id === 'list')!
    expect(list.build(DEFAULT_BRAND).items.some((i) => i.appearsOnAllSlides)).toBe(false)
    const stamped = list.build({ ...DEFAULT_BRAND, handle: '@studio' }).items.filter((i) => i.appearsOnAllSlides)
    expect(stamped).toHaveLength(1)
    expect(stamped[0]!.text).toBe('@studio')
  })

  it('keeps cover text readable on any accent', () => {
    const pale: BrandKit = { ...DEFAULT_BRAND, accent: '#ffe94a' }
    expect(readableOn(pale.accent, pale)).toBe(pale.text)
    const deep: BrandKit = { ...DEFAULT_BRAND, accent: '#1b1f6b' }
    expect(readableOn(deep.accent, deep)).toBe(deep.background)
  })
})

describe('applyBrandToDeck', () => {
  it('swaps each old brand colour for its new counterpart, in one undo step', () => {
    open('list', DEFAULT_BRAND)
    const next: BrandKit = {
      ...DEFAULT_BRAND, background: '#101010', text: '#fafafa', accent: '#ff5500', headingFont: 'Georgia', bodyFont: 'Arial',
    }
    const before = store()._past.length
    expect(applyBrandToDeck(next, [DEFAULT_BRAND])).toBeGreaterThan(0)
    const s = store()
    expect(s._past.length).toBe(before + 1)
    // The accent cover stays an accent cover; point slides take the new ground.
    expect(s.slides[0]!.bgColor).toBe('#ff5500')
    expect(s.slides[1]!.bgColor).toBe('#101010')
    expect(s.slides.at(-1)!.bgColor).toBe('#fafafa')
    const onPoint = s.items.filter((i) => i.slideId === s.slides[1]!.id)
    const heading = onPoint.filter((i) => i.type === 'text').reduce((a, b) => ((b.fontSize ?? 0) > (a.fontSize ?? 0) ? b : a))
    expect(heading.fontFamily).toBe('Georgia')
    expect(heading.textColor).toBe('#fafafa')
    expect(onPoint.find((i) => i.text === '01')).toMatchObject({ fontFamily: 'Arial', textColor: '#ff5500' })
    expect(onPoint.find((i) => i.type === 'shape')!.fillColor).toBe('#fafafa')

    s.undo()
    expect(store().slides[0]!.bgColor).toBe(DEFAULT_BRAND.accent)
    expect(store().items.every((i) => i.type !== 'text' || i.fontFamily === 'Inter')).toBe(true)
  })

  it('after an undo, swaps away from the kit the deck wears again', () => {
    open('list', DEFAULT_BRAND)
    const green: BrandKit = { ...DEFAULT_BRAND, accent: '#1f8a5b' }
    applyBrandToDeck(green, [DEFAULT_BRAND])
    store().undo() // back in the default kit, though green was applied last
    const red: BrandKit = { ...DEFAULT_BRAND, accent: '#cc2200' }
    applyBrandToDeck(red, [green, DEFAULT_BRAND])
    expect(store().slides[0]!.bgColor).toBe('#cc2200')
    expect(store().slides[1]!.bgColor).toBe(DEFAULT_BRAND.background)
  })

  it('restyles a deck that never used the kit plainly, sparing pill text', () => {
    store().setSlideBgColor(store().slides[0]!.id, '#00ff00')
    const big = store().addText({ text: 'Title', fontSize: 120, textColor: '#123456' })
    const small = store().addText({ text: 'Body', fontSize: 40, textColor: '#123456' })
    const pill = store().addText({ text: 'Tag', fontSize: 30, textColor: '#ffffff', textBgColor: '#000000' })
    const brand: BrandKit = { ...DEFAULT_BRAND, headingFont: 'Georgia', bodyFont: 'Arial' }
    applyBrandToDeck(brand, [DEFAULT_BRAND])
    const byId = (id: string) => store().items.find((i) => i.id === id)!
    expect(store().slides[0]!.bgColor).toBe(brand.background)
    expect(byId(big)).toMatchObject({ fontFamily: 'Georgia', textColor: brand.text })
    expect(byId(small)).toMatchObject({ fontFamily: 'Arial', textColor: brand.text })
    expect(byId(pill)).toMatchObject({ fontFamily: 'Arial', textColor: '#ffffff' })
  })

  it('does nothing — and adds no undo step — when the deck already matches', () => {
    open('quote', DEFAULT_BRAND)
    const before = store()._past.length
    expect(applyBrandToDeck(DEFAULT_BRAND, [DEFAULT_BRAND])).toBe(0)
    expect(store()._past.length).toBe(before)
  })
})
