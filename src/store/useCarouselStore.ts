import { create } from 'zustand'
import type { PresetId, Size } from '../lib/presets'
import { PRESETS, clampSize } from '../lib/presets'
import { generateThumbnail } from '../lib/thumbnail'

export type MediaType = 'image' | 'video' | 'gif'

export interface PlacedMedia {
  id: string
  slideId: string
  type: MediaType
  src: string
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
  cropX: number        // crop region in natural image coords
  cropY: number
  cropW: number        // 0 = no crop (use full image)
  cropH: number
}

export interface Slide {
  id: string
  bgColor: string
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

interface CarouselState {
  slides: Slide[]
  activeSlideId: string
  dimensions: Size
  presetId: PresetId
  customWidth: number
  customHeight: number

  items: PlacedMedia[]
  selectedId: string | null

  showGrid: boolean
  gridSize: number
  marginPct: number
  showCenterGuides: boolean
  snapGrid: boolean
  snapCenter: boolean
  snapItems: boolean
  snapMargins: boolean

  setPreset: (id: PresetId) => void
  setCustomDimensions: (w: number, h: number) => void
  setActiveSlide: (id: string) => void
  addSlide: (afterIndex?: number) => void
  removeSlide: (id: string) => void
  reorderSlides: (activeId: string, overId: string) => void

  addMedia: (file: File, naturalW: number, naturalH: number) => void
  updateItem: (id: string, patch: Partial<PlacedMedia>) => void
  removeItem: (id: string) => void
  moveItemToSlide: (itemId: string, slideId: string) => void
  setSelected: (id: string | null) => void

  thumbnails: Record<string, string>
  refreshThumbnail: (slideId: string) => void
  refreshAllThumbnails: () => void

  setShowGrid: (v: boolean) => void
  setGridSize: (n: number) => void
  setMarginPct: (n: number) => void
  setShowCenterGuides: (v: boolean) => void
  setSnapGrid: (v: boolean) => void
  setSnapCenter: (v: boolean) => void
  setSnapItems: (v: boolean) => void
  setSnapMargins: (v: boolean) => void
  setSlideBgColor: (slideId: string, color: string) => void

  cropItemId: string | null
  setCropMode: (id: string | null) => void
  applyCrop: (id: string, cx: number, cy: number, cw: number, ch: number) => void
  resetCrop: (id: string) => void
}

const initialSlideId = newId()

/* Debounced thumbnail regeneration per slide */
const thumbTimers: Record<string, ReturnType<typeof setTimeout>> = {}

function debouncedThumbRefresh(slideId: string, delay = 300) {
  if (thumbTimers[slideId]) clearTimeout(thumbTimers[slideId])
  thumbTimers[slideId] = setTimeout(() => {
    const st = useCarouselStore.getState()
    const slideItems = st.items.filter((i) => i.slideId === slideId)
    generateThumbnail(slideItems, st.dimensions).then((url) => {
      useCarouselStore.setState((prev) => ({
        thumbnails: { ...prev.thumbnails, [slideId]: url },
      }))
    })
  }, delay)
}

export const useCarouselStore = create<CarouselState>((set, get) => ({
  slides: [{ id: initialSlideId, bgColor: '#ffffff' }],
  activeSlideId: initialSlideId,
  dimensions: { ...PRESETS['4:5'] },
  presetId: '4:5',
  customWidth: 1080,
  customHeight: 1350,

  items: [],
  selectedId: null,

  showGrid: false,
  gridSize: 40,
  marginPct: 4,
  showCenterGuides: false,
  snapGrid: true,
  snapCenter: true,
  snapItems: true,
  snapMargins: true,

  thumbnails: {},
  cropItemId: null,

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

  setActiveSlide: (id) => set({ activeSlideId: id, selectedId: null }),

  addSlide: (afterIndex) => {
    const { slides } = get()
    const sid = newId()
    const idx =
      afterIndex !== undefined
        ? afterIndex + 1
        : slides.findIndex((s) => s.id === get().activeSlideId) + 1
    const next = [...slides]
    next.splice(Math.min(idx, next.length), 0, { id: sid, bgColor: '#ffffff' })
    set({ slides: next, activeSlideId: sid, selectedId: null })
  },

  removeSlide: (id) => {
    const { slides, items, activeSlideId } = get()
    if (slides.length <= 1) return
    const idx = slides.findIndex((s) => s.id === id)
    if (idx < 0) return
    const fallback = slides[idx + 1]?.id ?? slides[idx - 1]!.id
    const nextSlides = slides.filter((s) => s.id !== id)
    const removedItems = items.filter((i) => i.slideId === id)
    removedItems.forEach((i) => URL.revokeObjectURL(i.src))
    set({
      slides: nextSlides,
      activeSlideId: activeSlideId === id ? fallback : activeSlideId,
      items: items.filter((i) => i.slideId !== id),
      selectedId: get().selectedId && removedItems.some((r) => r.id === get().selectedId)
        ? null
        : get().selectedId,
    })
  },

  reorderSlides: (activeId, overId) => {
    if (activeId === overId) return
    const { slides } = get()
    const from = slides.findIndex((s) => s.id === activeId)
    const to = slides.findIndex((s) => s.id === overId)
    if (from < 0 || to < 0) return
    const next = [...slides]
    const [removed] = next.splice(from, 1)
    next.splice(to, 0, removed!)
    set({ slides: next })
  },

  addMedia: (file, naturalW, naturalH) => {
    const { dimensions, activeSlideId, items } = get()
    const src = URL.createObjectURL(file)
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    let type: MediaType = 'image'
    if (file.type.startsWith('video/')) type = 'video'
    else if (file.type === 'image/gif' || ext === 'gif') type = 'gif'

    // Place at real pixel size; only scale down if larger than the slide
    let w = naturalW
    let h = naturalH
    if (w > dimensions.width || h > dimensions.height) {
      const scale = Math.min(dimensions.width / w, dimensions.height / h)
      w *= scale
      h *= scale
    }

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
      cropX: 0,
      cropY: 0,
      cropW: 0,
      cropH: 0,
    }
    set({ items: [...items, item], selectedId: item.id })
    debouncedThumbRefresh(activeSlideId)
  },

  updateItem: (id, patch) => {
    const item = get().items.find((x) => x.id === id)
    set({
      items: get().items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    })
    if (item) debouncedThumbRefresh(item.slideId)
  },

  removeItem: (id) => {
    const i = get().items.find((x) => x.id === id)
    if (i) URL.revokeObjectURL(i.src)
    set({
      items: get().items.filter((x) => x.id !== id),
      selectedId: get().selectedId === id ? null : get().selectedId,
    })
    if (i) debouncedThumbRefresh(i.slideId)
  },

  moveItemToSlide: (itemId, slideId) => {
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

  setSelected: (id) => set({ selectedId: id }),

  setShowGrid: (v) => set({ showGrid: v }),
  setGridSize: (n) => set({ gridSize: Math.max(4, Math.min(400, n)) }),
  setMarginPct: (n) => set({ marginPct: Math.max(0, Math.min(30, n)) }),
  setShowCenterGuides: (v) => set({ showCenterGuides: v }),
  setSnapGrid: (v) => set({ snapGrid: v }),
  setSnapCenter: (v) => set({ snapCenter: v }),
  setSnapItems: (v) => set({ snapItems: v }),
  setSnapMargins: (v) => set({ snapMargins: v }),

  setSlideBgColor: (slideId, color) => {
    set({
      slides: get().slides.map((s) =>
        s.id === slideId ? { ...s, bgColor: color } : s,
      ),
    })
  },

  setCropMode: (id) => set({ cropItemId: id, selectedId: id }),

  applyCrop: (id, cx, cy, cw, ch) => {
    const item = get().items.find((x) => x.id === id)
    if (!item) return
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
}))
