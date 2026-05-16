import { create } from 'zustand'
import type { PresetId, Size } from '../lib/presets'
import { PRESETS, clampSize } from '../lib/presets'
import { generateThumbnail } from '../lib/thumbnail'

export type MediaType = 'image' | 'video' | 'gif' | 'text'

export type TextAlign = 'left' | 'center' | 'right' | 'justify'

export interface TextStyleDefaults {
  fontFamily: string
  fontSize: number
  bold: boolean
  italic: boolean
  textColor: string
  textAlign: TextAlign
  lineHeight: number
  letterSpacing: number
  fillMode: boolean
}

const DEFAULT_TEXT_STYLE: TextStyleDefaults = {
  fontFamily: 'Inter',
  fontSize: 64,
  bold: false,
  italic: false,
  textColor: '#111111',
  textAlign: 'left',
  lineHeight: 1.15,
  letterSpacing: 0,
  fillMode: false,
}

const TEXT_STYLE_KEYS: (keyof TextStyleDefaults)[] = [
  'fontFamily', 'fontSize', 'bold', 'italic', 'textColor',
  'textAlign', 'lineHeight', 'letterSpacing', 'fillMode',
]

export interface PlacedMedia {
  id: string
  slideId: string
  type: MediaType
  src: string          // empty string for text items
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  naturalWidth: number
  naturalHeight: number
  brightness: number   // -1 to 1  (exposure)
  contrast: number     // -100 to 100
  saturation: number   // 0 to 2 (1 = normal)
  blur: number         // 0 to 200 (pixel radius, 0 = no blur)
  flipX: boolean       // horizontal mirror
  flipY: boolean       // vertical mirror
  cropX: number        // crop region in natural image coords
  cropY: number
  cropW: number        // 0 = no crop (use full image)
  cropH: number
  coverTime: number    // video cover frame time in seconds (0 = first frame)
  coverImageSrc?: string // optional custom cover image (overrides coverTime when set)
  trimStart: number    // video trim start in seconds (0 = from start)
  trimEnd: number      // video trim end in seconds (0 = play to end)

  // Text-only fields (only populated when type === 'text')
  text?: string
  fontFamily?: string
  fontSize?: number      // px in slide-space (user-set value; ignored when fillMode is on)
  bold?: boolean
  italic?: boolean
  textColor?: string     // CSS color, e.g. '#ffffff'
  textAlign?: TextAlign
  lineHeight?: number    // multiplier, 1 = single
  letterSpacing?: number // px
  fillMode?: boolean     // when true, fontSize is derived to fill (width, height)
}

export interface Slide {
  id: string
  bgColor: string
  exportEnabled: boolean
}

function newId() {
  return crypto.randomUUID()
}

/** When slide dimensions change, reposition items proportionally but keep their real size */
function repositionItems(
  items: PlacedMedia[],
  from: Size,
  to: Size,
): PlacedMedia[] {
  if (from.width <= 0 || from.height <= 0) return items
  const sx = to.width / from.width
  const sy = to.height / from.height
  return items.map((i) => ({
    ...i,
    // Reposition center proportionally, keep width/height unchanged
    x: (i.x + i.width / 2) * sx - i.width / 2,
    y: (i.y + i.height / 2) * sy - i.height / 2,
  }))
}

interface TiovivoState {
  slides: Slide[]
  activeSlideId: string
  dimensions: Size
  presetId: PresetId
  customWidth: number
  customHeight: number

  items: PlacedMedia[]
  selectedIds: string[]

  workspaceBgColor: string

  showGrid: boolean
  gridSize: number
  gridOpacity: number  // 0..1; multiplies the contrast-aware grid stroke alpha
  marginPct: number
  showCenterGuides: boolean
  seamlessSlides: boolean
  showHiddenZone: boolean
  snapGrid: boolean
  snapCenter: boolean
  snapItems: boolean
  snapMargins: boolean

  /**
   * Style defaults applied to the next text item added via addText().
   * Updated whenever a text item is patched so that styling choices
   * (font, size, alignment, color, fillMode, etc.) carry between new
   * text items in the same project — and are persisted in the .vpost.
   */
  lastTextStyle: TextStyleDefaults

  /** Has the in-memory document diverged from what was last saved to disk?
   *  Used to drive the "Save changes before closing?" prompt. */
  isDirty: boolean
  setDirty: (v: boolean) => void

  setPreset: (id: PresetId) => void
  setCustomDimensions: (w: number, h: number) => void
  setActiveSlide: (id: string) => void
  addSlide: (afterIndex?: number) => void
  duplicateSlide: (id: string) => void
  removeSlide: (id: string) => void
  reorderSlides: (activeId: string, overId: string) => void

  addMedia: (file: File, naturalW: number, naturalH: number) => void
  addText: (overrides?: Partial<PlacedMedia>) => string
  /** Insert clones onto the active slide. Strips id/slideId from each template
   *  and assigns fresh ones; returns the new item ids. */
  pasteItems: (templates: Omit<PlacedMedia, 'id' | 'slideId'>[]) => string[]
  updateItem: (id: string, patch: Partial<PlacedMedia>) => void
  updateItems: (patches: { id: string; patch: Partial<PlacedMedia> }[]) => void
  removeItem: (id: string) => void
  removeItems: (ids: string[]) => void
  moveItemToSlide: (itemId: string, slideId: string) => void
  reorderSlideLayers: (slideId: string, orderedIds: string[]) => void
  setSelected: (id: string | null) => void
  setSelectedIds: (ids: string[]) => void
  toggleSelected: (id: string) => void

  thumbnails: Record<string, string>
  refreshThumbnail: (slideId: string) => void
  refreshAllThumbnails: () => void

  setSeamlessSlides: (v: boolean) => void
  setShowHiddenZone: (v: boolean) => void
  setShowGrid: (v: boolean) => void
  setGridSize: (n: number) => void
  setGridOpacity: (n: number) => void
  setMarginPct: (n: number) => void
  setShowCenterGuides: (v: boolean) => void
  setSnapGrid: (v: boolean) => void
  setSnapCenter: (v: boolean) => void
  setSnapItems: (v: boolean) => void
  setSnapMargins: (v: boolean) => void
  setSlideBgColor: (slideId: string, color: string) => void
  setAllSlidesBgColor: (color: string) => void
  setWorkspaceBgColor: (color: string) => void
  toggleSlideExport: (slideId: string) => void
  setSlideExport: (slideId: string, enabled: boolean) => void
  fitItemToSlide: (id: string) => void
  fillItemToSlide: (id: string) => void
  resetItemScale: (id: string) => void

  cropItemId: string | null
  setCropMode: (id: string | null) => void
  applyCrop: (id: string, cx: number, cy: number, cw: number, ch: number) => void
  resetCrop: (id: string) => void

  _past: HistorySnapshot[]
  _future: HistorySnapshot[]
  _historyKey: string | null
  _historyTime: number
  undo: () => void
  redo: () => void

  loadProjectState: (payload: {
    slides: Slide[]
    items: PlacedMedia[]
    dimensions: Size
    presetId: PresetId
    customWidth: number
    customHeight: number
    workspaceBgColor?: string
    guides?: Partial<GuideSettings>
    lastTextStyle?: Partial<TextStyleDefaults>
  }) => void
  resetProject: () => void
}

/** All workspace-level guides + snap toggles, persisted per-project. */
export interface GuideSettings {
  showGrid: boolean
  gridSize: number
  gridOpacity: number
  showCenterGuides: boolean
  seamlessSlides: boolean
  showHiddenZone: boolean
  marginPct: number
  snapGrid: boolean
  snapCenter: boolean
  snapItems: boolean
  snapMargins: boolean
}

interface HistorySnapshot {
  slides: Slide[]
  items: PlacedMedia[]
  dimensions: Size
  presetId: PresetId
  customWidth: number
  customHeight: number
  workspaceBgColor: string
}

const HISTORY_LIMIT = 100
const HISTORY_COALESCE_MS = 500

const initialSlideId = newId()

/* Undo/redo helpers — snapshot content-bearing fields only (not UI toggles). */
function snapshotOf(s: TiovivoState): HistorySnapshot {
  return {
    slides: s.slides,
    items: s.items,
    dimensions: s.dimensions,
    presetId: s.presetId,
    customWidth: s.customWidth,
    customHeight: s.customHeight,
    workspaceBgColor: s.workspaceBgColor,
  }
}

/**
 * Revoke every `blob:` URL referenced by the given snapshots so we don't
 * accumulate references to dead Blobs after a project replace. Items added
 * via file drop and items hydrated from a .vpost both use blob URLs.
 *
 * Used when discarding the current project (load / reset) — at that point
 * the in-memory state and the undo/redo history are about to be wiped, so
 * any URL we still hold is leakable.
 */
function revokeBlobUrlsForSnapshots(snapshots: HistorySnapshot[]) {
  const seen = new Set<string>()
  for (const snap of snapshots) {
    for (const it of snap.items) {
      if (it.src && it.src.startsWith('blob:') && !seen.has(it.src)) {
        seen.add(it.src)
        try { URL.revokeObjectURL(it.src) } catch { /* best effort */ }
      }
      if (it.coverImageSrc && it.coverImageSrc.startsWith('blob:') && !seen.has(it.coverImageSrc)) {
        seen.add(it.coverImageSrc)
        try { URL.revokeObjectURL(it.coverImageSrc) } catch { /* best effort */ }
      }
    }
  }
}

function pushHistory(key: string) {
  const s = useTiovivoStore.getState()
  const now = Date.now()
  // Coalesce: if the same "kind" of change fires within HISTORY_COALESCE_MS,
  // treat as a single logical edit (e.g. a drag streams many updateItem calls).
  if (s._historyKey === key && now - s._historyTime < HISTORY_COALESCE_MS) {
    useTiovivoStore.setState({ _historyTime: now, _future: [], isDirty: true })
    return
  }
  const past = s._past.concat([snapshotOf(s)])
  if (past.length > HISTORY_LIMIT) past.shift()
  useTiovivoStore.setState({
    _past: past,
    _future: [],
    _historyKey: key,
    _historyTime: now,
    // Any change that warrants a history entry also dirties the document
    // against the on-disk version.
    isDirty: true,
  })
}

/* Debounced thumbnail regeneration per slide */
const thumbTimers: Record<string, ReturnType<typeof setTimeout>> = {}

function debouncedThumbRefresh(slideId: string, delay = 300) {
  if (thumbTimers[slideId]) clearTimeout(thumbTimers[slideId])
  thumbTimers[slideId] = setTimeout(() => {
    const st = useTiovivoStore.getState()
    const slideItems = st.items.filter((i) => i.slideId === slideId)
    generateThumbnail(slideItems, st.dimensions).then((url) => {
      useTiovivoStore.setState((prev) => ({
        thumbnails: { ...prev.thumbnails, [slideId]: url },
      }))
    })
  }, delay)
}

export const useTiovivoStore = create<TiovivoState>((set, get) => ({
  slides: [{ id: initialSlideId, bgColor: '#ffffff', exportEnabled: true }],
  activeSlideId: initialSlideId,
  dimensions: { ...PRESETS['3:4'] },
  presetId: '3:4',
  customWidth: 1080,
  customHeight: 1350,

  items: [],
  selectedIds: [],

  workspaceBgColor: '#0a0a0e',

  showGrid: false,
  gridSize: 40,
  gridOpacity: 0.45,
  marginPct: 4,
  showCenterGuides: false,
  seamlessSlides: false,
  showHiddenZone: true,
  snapGrid: false,
  snapCenter: true,
  snapItems: true,
  snapMargins: true,

  lastTextStyle: { ...DEFAULT_TEXT_STYLE },

  isDirty: false,
  setDirty: (v) => set({ isDirty: v }),

  thumbnails: {},
  cropItemId: null,

  _past: [],
  _future: [],
  _historyKey: null,
  _historyTime: 0,

  refreshThumbnail: (slideId) => {
    debouncedThumbRefresh(slideId)
  },

  refreshAllThumbnails: () => {
    const { slides } = get()
    for (const s of slides) {
      debouncedThumbRefresh(s.id, 50)
    }
  },

  setPreset: (id) => {
    pushHistory('preset')
    const prev = get().dimensions
    if (id === 'custom') {
      const cur = get().dimensions
      set({
        presetId: 'custom',
        customWidth: cur.width,
        customHeight: cur.height,
        dimensions: { ...cur },
      })
      return
    }
    const next = { ...PRESETS[id] }
    set({
      presetId: id,
      dimensions: next,
      items: repositionItems(get().items, prev, next),
    })
  },

  setCustomDimensions: (w, h) => {
    pushHistory('dims')
    const prev = get().dimensions
    const next = clampSize(w, h)
    set({
      presetId: 'custom',
      customWidth: next.width,
      customHeight: next.height,
      dimensions: next,
      items: repositionItems(get().items, prev, next),
    })
  },

  // Note: this does NOT clear selectedIds. Click handlers that want to replace
  // selection must call setSelected(...) / setSelectedIds(...) explicitly. Keeping
  // selection here is what enables additive (cmd/shift) click to preserve prior
  // selection — including cross-slide multi-select.
  setActiveSlide: (id) => set({ activeSlideId: id }),

  addSlide: (afterIndex) => {
    pushHistory('addSlide')
    const { slides, activeSlideId } = get()
    const sid = newId()
    const activeIdx = slides.findIndex((s) => s.id === activeSlideId)
    const idx = afterIndex !== undefined ? afterIndex + 1 : activeIdx + 1
    const inheritedColor = slides[activeIdx]?.bgColor ?? '#ffffff'
    const next = [...slides]
    next.splice(Math.min(idx, next.length), 0, { id: sid, bgColor: inheritedColor, exportEnabled: true })
    set({ slides: next, activeSlideId: sid, selectedIds: [] })
  },

  duplicateSlide: (id) => {
    const { slides, items } = get()
    const idx = slides.findIndex((s) => s.id === id)
    if (idx < 0) return
    pushHistory('duplicateSlide:' + id)
    const src = slides[idx]!
    const newSid = newId()
    const cloneSlide: Slide = {
      id: newSid,
      bgColor: src.bgColor,
      exportEnabled: src.exportEnabled,
    }
    const newSlides = [...slides]
    newSlides.splice(idx + 1, 0, cloneSlide)
    // Clone every item that lived on the source slide, with fresh IDs pointing
    // to the new slide. src URLs (blob: for images/videos) are reused — they
    // outlive both items, and copying the underlying bytes would burn memory
    // for no benefit.
    const srcItems = items.filter((it) => it.slideId === id)
    const newItems = srcItems.map((it) => ({ ...it, id: newId(), slideId: newSid }))
    set({
      slides: newSlides,
      items: [...items, ...newItems],
      activeSlideId: newSid,
      selectedIds: [],
    })
    debouncedThumbRefresh(newSid)
  },

  removeSlide: (id) => {
    const { slides, items, activeSlideId } = get()
    if (slides.length <= 1) return
    const idx = slides.findIndex((s) => s.id === id)
    if (idx < 0) return
    pushHistory('removeSlide:' + id)
    const fallback = slides[idx + 1]?.id ?? slides[idx - 1]!.id
    const nextSlides = slides.filter((s) => s.id !== id)
    const removedItems = items.filter((i) => i.slideId === id)
    // Note: don't revoke URLs so undo can still use them.
    set({
      slides: nextSlides,
      activeSlideId: activeSlideId === id ? fallback : activeSlideId,
      items: items.filter((i) => i.slideId !== id),
      selectedIds: get().selectedIds.filter((sid) => !removedItems.some((r) => r.id === sid)),
    })
  },

  reorderSlides: (activeId, overId) => {
    if (activeId === overId) return
    const { slides } = get()
    const from = slides.findIndex((s) => s.id === activeId)
    const to = slides.findIndex((s) => s.id === overId)
    if (from < 0 || to < 0) return
    pushHistory('reorderSlides')
    const next = [...slides]
    const [removed] = next.splice(from, 1)
    next.splice(to, 0, removed!)
    set({ slides: next })
  },

  addMedia: (file, naturalW, naturalH) => {
    pushHistory('addMedia')
    const { dimensions, activeSlideId, items } = get()
    const src = URL.createObjectURL(file)
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    let type: MediaType = 'image'
    if (file.type.startsWith('video/')) type = 'video'
    else if (file.type === 'image/gif' || ext === 'gif') type = 'gif'

    // Place at real pixel size — overflow is allowed; user can fit/fill explicitly.
    const w = naturalW
    const h = naturalH

    const item: PlacedMedia = {
      id: newId(),
      slideId: activeSlideId,
      type,
      src,
      name: file.name,
      x: (dimensions.width - w) / 2,
      y: (dimensions.height - h) / 2,
      width: w,
      height: h,
      rotation: 0,
      naturalWidth: naturalW,
      naturalHeight: naturalH,
      brightness: 0,
      contrast: 0,
      saturation: 1,
      blur: 0,
      flipX: false,
      flipY: false,
      cropX: 0,
      cropY: 0,
      cropW: 0,
      cropH: 0,
      coverTime: 0,
      trimStart: 0,
      trimEnd: 0,
    }
    set({ items: [...items, item], selectedIds: [item.id] })
    debouncedThumbRefresh(activeSlideId)
  },

  addText: (overrides) => {
    pushHistory('addText')
    const { dimensions, activeSlideId, items, slides, lastTextStyle } = get()
    const slide = slides.find((s) => s.id === activeSlideId)
    // If the last text color is "white-ish" but the slide is bright (or vice
    // versa), the carried-over color would be unreadable. Override the carried
    // color with a contrast-aware default only when it would be invisible.
    const bg = (slide?.bgColor || '#ffffff').replace('#', '')
    const br = parseInt(bg.slice(0, 2), 16) || 0
    const bgg = parseInt(bg.slice(2, 4), 16) || 0
    const bb = parseInt(bg.slice(4, 6), 16) || 0
    const bgLum = 0.2126 * br + 0.7152 * bgg + 0.0722 * bb
    const carriedColor = (lastTextStyle.textColor || '#111111').replace('#', '')
    const cr = parseInt(carriedColor.slice(0, 2), 16) || 0
    const cg = parseInt(carriedColor.slice(2, 4), 16) || 0
    const cb = parseInt(carriedColor.slice(4, 6), 16) || 0
    const fgLum = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb
    const contrast = Math.abs(bgLum - fgLum)
    const textColor = contrast < 60
      ? (bgLum > 140 ? '#111111' : '#ffffff')
      : lastTextStyle.textColor

    const w = Math.min(720, Math.round(dimensions.width * 0.7))
    const h = 120 // approximate; updated after Konva measures the rendered text
    const item: PlacedMedia = {
      id: newId(),
      slideId: activeSlideId,
      type: 'text',
      src: '',
      name: 'Text',
      x: Math.round((dimensions.width - w) / 2),
      y: Math.round((dimensions.height - h) / 2),
      width: w,
      height: h,
      rotation: 0,
      naturalWidth: 0,
      naturalHeight: 0,
      brightness: 0,
      contrast: 0,
      saturation: 1,
      blur: 0,
      flipX: false,
      flipY: false,
      cropX: 0,
      cropY: 0,
      cropW: 0,
      cropH: 0,
      coverTime: 0,
      trimStart: 0,
      trimEnd: 0,
      text: 'Your text',
      // Inherit styling from the last text item the user customised
      fontFamily: lastTextStyle.fontFamily,
      fontSize: lastTextStyle.fontSize,
      bold: lastTextStyle.bold,
      italic: lastTextStyle.italic,
      textColor,
      textAlign: lastTextStyle.textAlign,
      lineHeight: lastTextStyle.lineHeight,
      letterSpacing: lastTextStyle.letterSpacing,
      fillMode: lastTextStyle.fillMode,
      ...overrides,
    }
    set({ items: [...items, item], selectedIds: [item.id] })
    debouncedThumbRefresh(activeSlideId)
    return item.id
  },

  pasteItems: (templates) => {
    if (!templates.length) return []
    pushHistory('pasteItems')
    const { activeSlideId, items } = get()
    const newItems: PlacedMedia[] = templates.map((t) => ({
      ...t,
      id: newId(),
      slideId: activeSlideId,
    }))
    set({
      items: [...items, ...newItems],
      selectedIds: newItems.map((i) => i.id),
    })
    debouncedThumbRefresh(activeSlideId)
    return newItems.map((i) => i.id)
  },

  updateItem: (id, patch) => {
    pushHistory('updateItem:' + id)
    const item = get().items.find((x) => x.id === id)
    // If editing a text item with style-affecting fields in the patch, also
    // update lastTextStyle so subsequent addText() calls inherit them.
    let styleUpdate: Partial<TextStyleDefaults> | null = null
    if (item?.type === 'text') {
      const collected: Partial<TextStyleDefaults> = {}
      for (const k of TEXT_STYLE_KEYS) {
        if (k in patch) {
          ;(collected as Record<string, unknown>)[k] = (patch as Record<string, unknown>)[k]
        }
      }
      if (Object.keys(collected).length > 0) styleUpdate = collected
    }
    set((prev) => ({
      items: prev.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
      ...(styleUpdate ? { lastTextStyle: { ...prev.lastTextStyle, ...styleUpdate } } : {}),
    }))
    if (item) debouncedThumbRefresh(item.slideId)
  },

  updateItems: (patches) => {
    if (patches.length === 0) return
    pushHistory('updateItems:' + patches.map((p) => p.id).sort().join(','))
    const map = new Map(patches.map((p) => [p.id, p.patch]))
    const touchedSlides = new Set<string>()
    const next = get().items.map((i) => {
      const p = map.get(i.id)
      if (!p) return i
      touchedSlides.add(i.slideId)
      return { ...i, ...p }
    })
    set({ items: next })
    touchedSlides.forEach((sid) => debouncedThumbRefresh(sid))
  },

  removeItem: (id) => {
    pushHistory('removeItem:' + id)
    const i = get().items.find((x) => x.id === id)
    // Note: don't revoke URLs so undo can still use them.
    set({
      items: get().items.filter((x) => x.id !== id),
      selectedIds: get().selectedIds.filter((sid) => sid !== id),
    })
    if (i) debouncedThumbRefresh(i.slideId)
  },

  removeItems: (ids) => {
    if (ids.length === 0) return
    pushHistory('removeItems:' + ids.slice().sort().join(','))
    const idSet = new Set(ids)
    const removed = get().items.filter((x) => idSet.has(x.id))
    set({
      items: get().items.filter((x) => !idSet.has(x.id)),
      selectedIds: get().selectedIds.filter((sid) => !idSet.has(sid)),
    })
    const slideIds = new Set(removed.map((r) => r.slideId))
    slideIds.forEach((sid) => debouncedThumbRefresh(sid))
  },

  moveItemToSlide: (itemId, slideId) => {
    pushHistory('moveItemToSlide:' + itemId)
    const item = get().items.find((x) => x.id === itemId)
    const oldSlideId = item?.slideId
    set({
      items: get().items.map((i) =>
        i.id === itemId ? { ...i, slideId } : i,
      ),
    })
    if (oldSlideId) debouncedThumbRefresh(oldSlideId)
    debouncedThumbRefresh(slideId)
  },

  reorderSlideLayers: (slideId, orderedIds) => {
    pushHistory('reorderLayers:' + slideId)
    const { items } = get()
    const idToItem = new Map(items.map((it) => [it.id, it]))
    const targetSet = new Set(orderedIds)
    if (targetSet.size !== orderedIds.length) return
    for (const id of orderedIds) if (!idToItem.has(id)) return
    // Indices in global items where the target items live, in global order.
    const slotIdxs: number[] = []
    items.forEach((it, i) => { if (targetSet.has(it.id)) slotIdxs.push(i) })
    if (slotIdxs.length !== orderedIds.length) return
    const newItems = items.slice()
    slotIdxs.forEach((globalIdx, j) => {
      newItems[globalIdx] = idToItem.get(orderedIds[j]!)!
    })
    set({ items: newItems })
    debouncedThumbRefresh(slideId)
  },

  setSelected: (id) => set({ selectedIds: id ? [id] : [] }),

  setSelectedIds: (ids) => set({ selectedIds: ids }),

  toggleSelected: (id) => {
    const cur = get().selectedIds
    if (cur.includes(id)) set({ selectedIds: cur.filter((x) => x !== id) })
    else set({ selectedIds: [...cur, id] })
  },

  // Workspace toggles are persisted in .vpost, so changing them dirties the
  // document. We don't push them into history because they're not part of
  // the undo stack — but they still need to trigger the unsaved-changes prompt.
  setShowGrid: (v) => set({ showGrid: v, isDirty: true }),
  setGridSize: (n) => set({ gridSize: Math.max(4, Math.min(400, n)), isDirty: true }),
  setGridOpacity: (n) => set({ gridOpacity: Math.max(0, Math.min(1, n)), isDirty: true }),
  setMarginPct: (n) => set({ marginPct: Math.max(0, Math.min(30, n)), isDirty: true }),
  setShowCenterGuides: (v) => set({ showCenterGuides: v, isDirty: true }),
  setSnapGrid: (v) => set({ snapGrid: v, isDirty: true }),
  setSnapCenter: (v) => set({ snapCenter: v, isDirty: true }),
  setSnapItems: (v) => set({ snapItems: v, isDirty: true }),
  setSeamlessSlides: (v) => set({ seamlessSlides: v, isDirty: true }),
  setShowHiddenZone: (v) => set({ showHiddenZone: v, isDirty: true }),
  setSnapMargins: (v) => set({ snapMargins: v, isDirty: true }),

  setSlideBgColor: (slideId, color) => {
    pushHistory('bgColor:' + slideId)
    set({
      slides: get().slides.map((s) =>
        s.id === slideId ? { ...s, bgColor: color } : s,
      ),
    })
  },

  setAllSlidesBgColor: (color) => {
    pushHistory('bgColorAll')
    set({
      slides: get().slides.map((s) => ({ ...s, bgColor: color })),
    })
    get().refreshAllThumbnails()
  },

  setWorkspaceBgColor: (color) => {
    pushHistory('workspaceBg')
    set({ workspaceBgColor: color })
  },

  toggleSlideExport: (slideId) => {
    pushHistory('toggleExport:' + slideId)
    set({
      slides: get().slides.map((s) =>
        s.id === slideId ? { ...s, exportEnabled: !s.exportEnabled } : s,
      ),
    })
  },

  setSlideExport: (slideId, enabled) => {
    pushHistory('setExport:' + slideId)
    set({
      slides: get().slides.map((s) =>
        s.id === slideId ? { ...s, exportEnabled: enabled } : s,
      ),
    })
  },

  fitItemToSlide: (id) => {
    const item = get().items.find((x) => x.id === id)
    if (!item) return
    const { dimensions } = get()
    const effW = item.cropW > 0 ? item.cropW : item.naturalWidth
    const effH = item.cropH > 0 ? item.cropH : item.naturalHeight
    if (effW <= 0 || effH <= 0) return
    const scale = Math.min(dimensions.width / effW, dimensions.height / effH)
    const newW = effW * scale
    const newH = effH * scale
    pushHistory('fitItem:' + id)
    set({
      items: get().items.map((i) =>
        i.id === id
          ? {
              ...i,
              width: newW,
              height: newH,
              x: (dimensions.width - newW) / 2,
              y: (dimensions.height - newH) / 2,
              rotation: 0,
            }
          : i,
      ),
    })
    debouncedThumbRefresh(item.slideId)
  },

  fillItemToSlide: (id) => {
    const item = get().items.find((x) => x.id === id)
    if (!item) return
    const { dimensions } = get()
    const effW = item.cropW > 0 ? item.cropW : item.naturalWidth
    const effH = item.cropH > 0 ? item.cropH : item.naturalHeight
    if (effW <= 0 || effH <= 0) return
    const scale = Math.max(dimensions.width / effW, dimensions.height / effH)
    const newW = effW * scale
    const newH = effH * scale
    pushHistory('fillItem:' + id)
    set({
      items: get().items.map((i) =>
        i.id === id
          ? {
              ...i,
              width: newW,
              height: newH,
              x: (dimensions.width - newW) / 2,
              y: (dimensions.height - newH) / 2,
              rotation: 0,
            }
          : i,
      ),
    })
    debouncedThumbRefresh(item.slideId)
  },

  resetItemScale: (id) => {
    const item = get().items.find((x) => x.id === id)
    if (!item) return
    const effW = item.cropW > 0 ? item.cropW : item.naturalWidth
    const effH = item.cropH > 0 ? item.cropH : item.naturalHeight
    if (effW <= 0 || effH <= 0) return
    const cx = item.x + item.width / 2
    const cy = item.y + item.height / 2
    pushHistory('resetScale:' + id)
    set({
      items: get().items.map((i) =>
        i.id === id
          ? {
              ...i,
              width: effW,
              height: effH,
              x: cx - effW / 2,
              y: cy - effH / 2,
            }
          : i,
      ),
    })
    debouncedThumbRefresh(item.slideId)
  },

  setCropMode: (id) => set({ cropItemId: id, selectedIds: id ? [id] : [] }),

  applyCrop: (id, cx, cy, cw, ch) => {
    const item = get().items.find((x) => x.id === id)
    if (!item) return
    pushHistory('applyCrop:' + id)
    const oldCX = item.cropW > 0 ? item.cropX : 0
    const oldCY = item.cropH > 0 ? item.cropY : 0
    const effCW = item.cropW || item.naturalWidth
    const scale = item.width / effCW
    set({
      items: get().items.map((i) =>
        i.id === id
          ? {
              ...i,
              cropX: cx, cropY: cy, cropW: cw, cropH: ch,
              x: i.x + (cx - oldCX) * scale,
              y: i.y + (cy - oldCY) * scale,
              width: cw * scale,
              height: ch * scale,
            }
          : i,
      ),
      cropItemId: null,
    })
    debouncedThumbRefresh(item.slideId)
  },

  resetCrop: (id) => {
    const item = get().items.find((x) => x.id === id)
    if (!item || item.cropW === 0) return
    pushHistory('resetCrop:' + id)
    const scale = item.width / item.cropW
    set({
      items: get().items.map((i) =>
        i.id === id
          ? {
              ...i,
              x: i.x - i.cropX * scale,
              y: i.y - i.cropY * scale,
              width: i.naturalWidth * scale,
              height: i.naturalHeight * scale,
              cropX: 0, cropY: 0, cropW: 0, cropH: 0,
            }
          : i,
      ),
    })
    debouncedThumbRefresh(item.slideId)
  },

  undo: () => {
    const s = get()
    if (s._past.length === 0) return
    const past = s._past.slice()
    const prev = past.pop()!
    const future = s._future.concat([snapshotOf(s)])
    const validIds = new Set(prev.items.map((i) => i.id))
    set({
      ...prev,
      _past: past,
      _future: future,
      _historyKey: null,
      _historyTime: 0,
      cropItemId: null,
      selectedIds: s.selectedIds.filter((id) => validIds.has(id)),
      activeSlideId: prev.slides.some((sl) => sl.id === s.activeSlideId) ? s.activeSlideId : prev.slides[0]!.id,
    })
    get().refreshAllThumbnails()
  },

  redo: () => {
    const s = get()
    if (s._future.length === 0) return
    const future = s._future.slice()
    const next = future.pop()!
    const past = s._past.concat([snapshotOf(s)])
    const validIds = new Set(next.items.map((i) => i.id))
    set({
      ...next,
      _past: past,
      _future: future,
      _historyKey: null,
      _historyTime: 0,
      cropItemId: null,
      selectedIds: s.selectedIds.filter((id) => validIds.has(id)),
      activeSlideId: next.slides.some((sl) => sl.id === s.activeSlideId) ? s.activeSlideId : next.slides[0]!.id,
    })
    get().refreshAllThumbnails()
  },

  loadProjectState: (payload) => {
    const firstSlideId = payload.slides[0]?.id
    if (!firstSlideId) throw new Error('Project has no slides')
    // Backwards compat: older project files don't have exportEnabled on slides.
    const slides = payload.slides.map((s) => ({
      ...s,
      exportEnabled: s.exportEnabled ?? true,
    }))
    const cur = get()
    // Free blob URLs from the project we're about to discard (including any
    // referenced only by undo/redo history) so they don't pile up over a
    // session of opening multiple projects.
    revokeBlobUrlsForSnapshots([
      snapshotOf(cur),
      ...cur._past,
      ...cur._future,
    ])
    const g = payload.guides ?? {}
    set({
      slides,
      items: payload.items,
      dimensions: payload.dimensions,
      presetId: payload.presetId,
      customWidth: payload.customWidth,
      customHeight: payload.customHeight,
      workspaceBgColor: payload.workspaceBgColor ?? '#0a0a0e',
      activeSlideId: firstSlideId,
      selectedIds: [],
      cropItemId: null,
      thumbnails: {},
      _past: [],
      _future: [],
      _historyKey: null,
      _historyTime: 0,
      // Guides / snap — pull each field individually so loading an older
      // .vpost that's missing some keys keeps the current value for those.
      showGrid: g.showGrid ?? cur.showGrid,
      gridSize: g.gridSize ?? cur.gridSize,
      gridOpacity: g.gridOpacity ?? cur.gridOpacity,
      showCenterGuides: g.showCenterGuides ?? cur.showCenterGuides,
      seamlessSlides: g.seamlessSlides ?? cur.seamlessSlides,
      showHiddenZone: g.showHiddenZone ?? cur.showHiddenZone,
      marginPct: g.marginPct ?? cur.marginPct,
      snapGrid: g.snapGrid ?? cur.snapGrid,
      snapCenter: g.snapCenter ?? cur.snapCenter,
      snapItems: g.snapItems ?? cur.snapItems,
      snapMargins: g.snapMargins ?? cur.snapMargins,
      lastTextStyle: { ...DEFAULT_TEXT_STYLE, ...(payload.lastTextStyle ?? {}) },
      // Just loaded from disk — in sync with the file.
      isDirty: false,
    })
    get().refreshAllThumbnails()
  },

  resetProject: () => {
    const cur = get()
    // Same cleanup as loadProjectState — drop blob URLs for items we're
    // about to discard.
    revokeBlobUrlsForSnapshots([
      snapshotOf(cur),
      ...cur._past,
      ...cur._future,
    ])
    const sid = newId()
    set({
      slides: [{ id: sid, bgColor: '#ffffff', exportEnabled: true }],
      activeSlideId: sid,
      dimensions: { ...PRESETS['3:4'] },
      presetId: '3:4',
      customWidth: 1080,
      customHeight: 1350,
      workspaceBgColor: '#0a0a0e',
      items: [],
      selectedIds: [],
      cropItemId: null,
      thumbnails: {},
      _past: [],
      _future: [],
      _historyKey: null,
      _historyTime: 0,
      lastTextStyle: { ...DEFAULT_TEXT_STYLE },
      // Fresh, empty document.
      isDirty: false,
    })
  },
}))
