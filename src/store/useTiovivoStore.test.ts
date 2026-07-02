import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { useTiovivoStore, type PlacedMedia, type Slide } from './useTiovivoStore'

// generateThumbnail draws to a canvas — not available (and not wanted) in node.
vi.mock('../lib/thumbnail', () => ({
  generateThumbnail: vi.fn(async () => 'data:image/png;base64,mock'),
}))

let urlCounter = 0

beforeAll(() => {
  // addMedia / history cleanup use blob URLs; stub them for node.
  Object.assign(URL, {
    createObjectURL: () => `blob:test-${++urlCounter}`,
    revokeObjectURL: () => {},
  })
})

const store = () => useTiovivoStore.getState()

/** History coalesces same-key edits within 500ms — jump past that window. */
const passCoalesceWindow = () => vi.advanceTimersByTime(600)

beforeEach(() => {
  vi.useFakeTimers()
  store().resetProject()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('text items', () => {
  it('addText places a selected text item on the active slide', () => {
    const id = store().addText({ x: 50, y: 60 })
    const s = store()
    expect(s.items).toHaveLength(1)
    expect(s.items[0]!.id).toBe(id)
    expect(s.items[0]!.type).toBe('text')
    expect(s.items[0]!.slideId).toBe(s.activeSlideId)
    expect(s.selectedIds).toEqual([id])
  })

  it('keeps the carried text color when it contrasts with the slide bg', () => {
    // Default slide bg is #ffffff and default text color #111111 — high contrast.
    const id = store().addText()
    expect(store().items.find((i) => i.id === id)!.textColor).toBe('#111111')
  })

  it('overrides an unreadable carried color with a contrast-aware default', () => {
    const s = store()
    s.setSlideBgColor(s.activeSlideId, '#101010')
    passCoalesceWindow()
    const id = store().addText()
    // #111111 on #101010 would be invisible → flips to white.
    expect(store().items.find((i) => i.id === id)!.textColor).toBe('#ffffff')
  })

  it('carries style edits into the next text item via lastTextStyle', () => {
    const id = store().addText()
    passCoalesceWindow()
    store().updateItem(id, { fontSize: 120, textAlign: 'center' })
    passCoalesceWindow()
    const id2 = store().addText()
    const item2 = store().items.find((i) => i.id === id2)!
    expect(item2.fontSize).toBe(120)
    expect(item2.textAlign).toBe('center')
  })
})

describe('media items', () => {
  it('addMedia centers the file at natural size and detects the type', () => {
    const file = new File([new Uint8Array(4)], 'clip.mp4', { type: 'video/mp4' })
    store().addMedia(file, 640, 360)
    const item = store().items[0]!
    expect(item.type).toBe('video')
    expect(item.width).toBe(640)
    expect(item.naturalHeight).toBe(360)
    // Centered on the default 1080x1440 artboard
    expect(item.x).toBe((1080 - 640) / 2)
    expect(item.y).toBe((1440 - 360) / 2)
  })

  it('detects gifs by mime type', () => {
    store().addMedia(new File([new Uint8Array(4)], 'a.gif', { type: 'image/gif' }), 100, 100)
    expect(store().items[0]!.type).toBe('gif')
  })
})

describe('slides', () => {
  it('addSlide inserts after the active slide, inherits bg color, and activates it', () => {
    const first = store().activeSlideId
    store().setSlideBgColor(first, '#ff0000')
    passCoalesceWindow()
    store().addSlide()
    const s = store()
    expect(s.slides).toHaveLength(2)
    expect(s.slides[1]!.id).toBe(s.activeSlideId)
    expect(s.slides[1]!.bgColor).toBe('#ff0000')
    expect(s.activeSlideId).not.toBe(first)
  })

  it('duplicateSlide clones the slide items with fresh ids', () => {
    const sid = store().activeSlideId
    const itemId = store().addText({ x: 10 })
    passCoalesceWindow()
    store().duplicateSlide(sid)
    const s = store()
    expect(s.slides).toHaveLength(2)
    const cloneSlideId = s.slides[1]!.id
    const clone = s.items.find((i) => i.slideId === cloneSlideId)!
    expect(clone).toBeDefined()
    expect(clone.id).not.toBe(itemId)
    expect(clone.x).toBe(10)
    expect(s.items).toHaveLength(2)
  })

  it('removeSlide is a no-op on the last remaining slide', () => {
    store().removeSlide(store().activeSlideId)
    expect(store().slides).toHaveLength(1)
  })

  it('removeSlide drops native items but reparents appears-on-all-slides items', () => {
    const first = store().activeSlideId
    const nativeId = store().addText({})
    passCoalesceWindow()
    const masterId = store().addText({ appearsOnAllSlides: true })
    passCoalesceWindow()
    store().addSlide()
    passCoalesceWindow()
    const second = store().activeSlideId
    store().removeSlide(first)
    const s = store()
    expect(s.slides).toHaveLength(1)
    expect(s.items.find((i) => i.id === nativeId)).toBeUndefined()
    const master = s.items.find((i) => i.id === masterId)!
    expect(master.slideId).toBe(second)
  })

  it('reorderSlides moves a slide to the target position', () => {
    store().addSlide()
    passCoalesceWindow()
    store().addSlide()
    passCoalesceWindow()
    const [a, b, c] = store().slides.map((s) => s.id)
    store().reorderSlides(a!, c!)
    expect(store().slides.map((s) => s.id)).toEqual([b, c, a])
  })
})

describe('undo / redo', () => {
  it('round-trips content changes', () => {
    passCoalesceWindow()
    const id = store().addText({ x: 100 })
    passCoalesceWindow()
    store().updateItem(id, { x: 999 })
    passCoalesceWindow()

    store().undo()
    expect(store().items.find((i) => i.id === id)!.x).toBe(100)
    store().undo()
    expect(store().items).toHaveLength(0)
    store().redo()
    expect(store().items).toHaveLength(1)
    store().redo()
    expect(store().items.find((i) => i.id === id)!.x).toBe(999)
  })

  it('coalesces rapid same-key edits into one history entry', () => {
    passCoalesceWindow()
    const id = store().addText({ x: 0 })
    passCoalesceWindow()
    // Two updates within the coalesce window — e.g. a drag streaming positions.
    store().updateItem(id, { x: 10 })
    store().updateItem(id, { x: 20 })
    store().undo()
    // One undo reverts the whole drag, not just the last tick.
    expect(store().items.find((i) => i.id === id)!.x).toBe(0)
  })

  it('prunes selection to items that survive the undo', () => {
    passCoalesceWindow()
    const id = store().addText({})
    expect(store().selectedIds).toEqual([id])
    store().undo()
    expect(store().selectedIds).toEqual([])
  })

  it('does nothing with an empty history', () => {
    const before = store().items
    store().undo()
    expect(store().items).toBe(before)
  })
})

describe('dimensions and presets', () => {
  it('setPreset repositions item centers proportionally, keeping size', () => {
    // Default is 3:4 → 1080x1440. Item centered at (540, 720).
    store().addText({ x: 490, y: 670, width: 100, height: 100 })
    passCoalesceWindow()
    store().setPreset('1:1') // 1080x1080; sy = 0.75
    const item = store().items[0]!
    expect(item.width).toBe(100)
    expect(item.x + 50).toBeCloseTo(540)
    expect(item.y + 50).toBeCloseTo(720 * 0.75)
  })

  it('setCustomDimensions clamps to the 64–8192 range', () => {
    store().setCustomDimensions(10, 99999)
    const s = store()
    expect(s.presetId).toBe('custom')
    expect(s.dimensions).toEqual({ width: 64, height: 8192 })
  })
})

describe('item geometry helpers', () => {
  function addRawImage(): string {
    store().addMedia(new File([new Uint8Array(4)], 'p.png', { type: 'image/png' }), 1000, 800)
    passCoalesceWindow()
    return store().items[0]!.id
  }

  it('fitItemToSlide letterboxes into the artboard', () => {
    const id = addRawImage()
    store().fitItemToSlide(id)
    const item = store().items[0]!
    // 1080x1440 stage; scale = min(1.08, 1.8) = 1.08
    expect(item.width).toBeCloseTo(1080)
    expect(item.height).toBeCloseTo(864)
    expect(item.x).toBeCloseTo(0)
    expect(item.y).toBeCloseTo((1440 - 864) / 2)
  })

  it('fillItemToSlide covers the artboard', () => {
    const id = addRawImage()
    store().fillItemToSlide(id)
    const item = store().items[0]!
    // scale = max(1.08, 1.8) = 1.8
    expect(item.width).toBeCloseTo(1800)
    expect(item.height).toBeCloseTo(1440)
    expect(item.x).toBeCloseTo((1080 - 1800) / 2)
  })

  it('applyCrop and resetCrop are inverse operations', () => {
    const id = addRawImage()
    store().updateItem(id, { x: 0, y: 0, width: 500, height: 400 }) // scale 0.5
    passCoalesceWindow()

    store().applyCrop(id, 100, 50, 400, 300)
    let item = store().items[0]!
    expect(item.x).toBeCloseTo(50)
    expect(item.y).toBeCloseTo(25)
    expect(item.width).toBeCloseTo(200)
    expect(item.height).toBeCloseTo(150)
    expect(store().cropItemId).toBeNull()
    passCoalesceWindow()

    store().resetCrop(id)
    item = store().items[0]!
    expect(item.x).toBeCloseTo(0)
    expect(item.y).toBeCloseTo(0)
    expect(item.width).toBeCloseTo(500)
    expect(item.height).toBeCloseTo(400)
    expect(item.cropW).toBe(0)
  })
})

describe('clipboard and selection', () => {
  it('pasteItems clones templates onto the active slide with fresh ids', () => {
    const id = store().addText({ x: 5 })
    passCoalesceWindow()
    const { id: _id, slideId: _sid, ...template } = store().items[0]!
    void _id; void _sid
    const newIds = store().pasteItems([template])
    const s = store()
    expect(newIds).toHaveLength(1)
    expect(newIds[0]).not.toBe(id)
    expect(s.items).toHaveLength(2)
    expect(s.selectedIds).toEqual(newIds)
  })

  it('removeItems prunes removed ids from the selection', () => {
    const a = store().addText({})
    passCoalesceWindow()
    const b = store().addText({})
    passCoalesceWindow()
    store().setSelectedIds([a, b])
    store().removeItems([a])
    const s = store()
    expect(s.items.map((i) => i.id)).toEqual([b])
    expect(s.selectedIds).toEqual([b])
  })

  it('moveItemToSlide reassigns the item', () => {
    const id = store().addText({})
    passCoalesceWindow()
    store().addSlide()
    const target = store().activeSlideId
    store().moveItemToSlide(id, target)
    expect(store().items[0]!.slideId).toBe(target)
  })
})

describe('project lifecycle', () => {
  const basePayload = () => ({
    slides: [{ id: 's1', bgColor: '#123456' } as Slide],
    items: [] as PlacedMedia[],
    dimensions: { width: 500, height: 500 },
    presetId: 'custom' as const,
    customWidth: 500,
    customHeight: 500,
  })

  it('loadProjectState defaults exportEnabled for older files and clears dirty', () => {
    store().addText({}) // dirty the doc first
    expect(store().isDirty).toBe(true)
    store().loadProjectState(basePayload())
    const s = store()
    expect(s.slides[0]!.exportEnabled).toBe(true)
    expect(s.activeSlideId).toBe('s1')
    expect(s.isDirty).toBe(false)
    expect(s._past).toHaveLength(0)
  })

  it('loadProjectState merges partial guide settings, keeping current values for missing keys', () => {
    store().setGridSize(80)
    store().loadProjectState({ ...basePayload(), guides: { showGrid: true } })
    const s = store()
    expect(s.showGrid).toBe(true)
    expect(s.gridSize).toBe(80) // not in payload → kept
  })

  it('loadProjectState rejects projects with no slides', () => {
    expect(() => store().loadProjectState({ ...basePayload(), slides: [] })).toThrow(/no slides/)
  })

  it('content edits mark the document dirty; setDirty clears it', () => {
    expect(store().isDirty).toBe(false)
    store().addText({})
    expect(store().isDirty).toBe(true)
    store().setDirty(false)
    store().setShowGrid(true)
    expect(store().isDirty).toBe(true) // persisted workspace toggles dirty too
  })
})
