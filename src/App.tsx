import { useCallback, useEffect, useRef, useState } from 'react'
import EditorStage, { type EditorStageHandle } from './components/EditorStage'
import { useCarouselStore } from './store/useCarouselStore'
import { PRESETS } from './lib/presets'
import './App.css'

function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

export default function App() {
  const stageRef = useRef<EditorStageHandle>(null)
  const [exporting, setExporting] = useState(false)
  const [viewport, setViewport] = useState({ w: 920, h: 640 })
  const [isDragOver, setIsDragOver] = useState(false)

  const dimensions = useCarouselStore((s) => s.dimensions)
  const presetId = useCarouselStore((s) => s.presetId)
  const customWidth = useCarouselStore((s) => s.customWidth)
  const customHeight = useCarouselStore((s) => s.customHeight)
  const setPreset = useCarouselStore((s) => s.setPreset)
  const setCustomDimensions = useCarouselStore((s) => s.setCustomDimensions)

  const slides = useCarouselStore((s) => s.slides)
  const activeSlideId = useCarouselStore((s) => s.activeSlideId)
  const selectedId = useCarouselStore((s) => s.selectedId)
  const items = useCarouselStore((s) => s.items)
  const moveItemToSlide = useCarouselStore((s) => s.moveItemToSlide)
  const removeItem = useCarouselStore((s) => s.removeItem)
  const updateItem = useCarouselStore((s) => s.updateItem)
  const addMedia = useCarouselStore((s) => s.addMedia)
  const cropItemId = useCarouselStore((s) => s.cropItemId)

  const showGrid = useCarouselStore((s) => s.showGrid)
  const gridSize = useCarouselStore((s) => s.gridSize)
  const marginPct = useCarouselStore((s) => s.marginPct)
  const showCenterGuides = useCarouselStore((s) => s.showCenterGuides)
  const snapGrid = useCarouselStore((s) => s.snapGrid)
  const snapCenter = useCarouselStore((s) => s.snapCenter)
  const snapItems = useCarouselStore((s) => s.snapItems)
  const snapMargins = useCarouselStore((s) => s.snapMargins)
  const setShowGrid = useCarouselStore((s) => s.setShowGrid)
  const setGridSize = useCarouselStore((s) => s.setGridSize)
  const setMarginPct = useCarouselStore((s) => s.setMarginPct)
  const setShowCenterGuides = useCarouselStore((s) => s.setShowCenterGuides)
  const setSnapGrid = useCarouselStore((s) => s.setSnapGrid)
  const setSnapCenter = useCarouselStore((s) => s.setSnapCenter)
  const setSnapItems = useCarouselStore((s) => s.setSnapItems)
  const setSnapMargins = useCarouselStore((s) => s.setSnapMargins)

  const layoutRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = layoutRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setViewport({
        w: Math.max(320, r.width - 8),
        h: Math.max(280, r.height - 8),
      })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* ---- File processing ---- */
  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) continue
        const url = URL.createObjectURL(file)
        if (file.type.startsWith('video/')) {
          const v = document.createElement('video')
          v.preload = 'metadata'
          v.src = url
          await new Promise<void>((res, rej) => {
            v.onloadedmetadata = () => res()
            v.onerror = () => rej(new Error('video'))
          }).catch(() => {})
          const nw = v.videoWidth || dimensions.width * 0.5
          const nh = v.videoHeight || dimensions.height * 0.5
          URL.revokeObjectURL(url)
          addMedia(file, nw, nh)
          continue
        }
        const img = new Image()
        img.src = url
        await new Promise<void>((res, rej) => {
          img.onload = () => res()
          img.onerror = () => rej(new Error('img'))
        }).catch(() => { URL.revokeObjectURL(url) })
        addMedia(file, img.naturalWidth, img.naturalHeight)
        URL.revokeObjectURL(url)
      }
    },
    [addMedia, dimensions.height, dimensions.width],
  )

  /* ---- Canvas drag-and-drop ---- */
  const dragCounterRef = useRef(0)

  const onCanvasDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current++
    setIsDragOver(true)
  }, [])

  const onCanvasDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current--
    if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setIsDragOver(false) }
  }, [])

  const onCanvasDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      dragCounterRef.current = 0
      setIsDragOver(false)
      onFiles(e.dataTransfer.files)
    },
    [onFiles],
  )

  /* ---- Keyboard shortcuts ---- */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      const st = useCarouselStore.getState()

      // Block shortcuts during crop mode
      if (st.cropItemId) return

      // [ and ] to move selected item to prev/next slide
      if ((e.key === '[' || e.key === ']') && st.selectedId) {
        const item = st.items.find((x) => x.id === st.selectedId)
        if (!item) return
        const currentIdx = st.slides.findIndex((s) => s.id === item.slideId)
        if (currentIdx < 0) return
        const targetIdx = e.key === '[' ? currentIdx - 1 : currentIdx + 1
        if (targetIdx < 0 || targetIdx >= st.slides.length) return
        st.moveItemToSlide(st.selectedId, st.slides[targetIdx]!.id)
        e.preventDefault()
        return
      }

      // Delete/Backspace to remove selected item
      if ((e.key === 'Delete' || e.key === 'Backspace') && st.selectedId) {
        st.removeItem(st.selectedId)
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /* ---- Export all slides ---- */
  const exportAll = useCallback(async () => {
    const st = useCarouselStore.getState()
    if (!st.slides.length || !stageRef.current) return
    setExporting(true)
    st.setSelected(null)
    try {
      for (let i = 0; i < st.slides.length; i++) {
        const slideId = st.slides[i]!.id
        // Small delay for rendering
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        )
        const blob = await stageRef.current!.exportSlidePng(slideId)
        if (blob) {
          const n = String(i + 1).padStart(2, '0')
          downloadBlob(blob, `carousel_${n}.png`)
        }
      }
    } finally {
      setExporting(false)
    }
  }, [])

  /* ---- Active slide indicator ---- */
  const activeSlideIndex = slides.findIndex((s) => s.id === activeSlideId)

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__presets">
          {(
            [
              ['hd', 'HD 16:9'],
              ['1:1', '1 : 1'],
              ['4:5', '4 : 5'],
              ['3:4', '3 : 4'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`btn ${presetId === id ? 'btn--accent' : ''}`}
              onClick={() => setPreset(id)}
            >
              {label}
              <span className="btn__hint">
                {PRESETS[id].width}x{PRESETS[id].height}
              </span>
            </button>
          ))}
          <button
            type="button"
            className={`btn ${presetId === 'custom' ? 'btn--accent' : ''}`}
            onClick={() => setPreset('custom')}
          >
            Custom
          </button>
        </div>
        <div className="app__custom-size">
          <label>
            W
            <input
              type="number"
              min={64}
              max={8192}
              value={customWidth}
              onChange={(e) =>
                setCustomDimensions(Number(e.target.value) || 64, customHeight)
              }
            />
          </label>
          <span>x</span>
          <label>
            H
            <input
              type="number"
              min={64}
              max={8192}
              value={customHeight}
              onChange={(e) =>
                setCustomDimensions(customWidth, Number(e.target.value) || 64)
              }
            />
          </label>
        </div>
        <button
          type="button"
          className="btn btn--export"
          disabled={exporting}
          onClick={exportAll}
        >
          {exporting ? 'Exporting...' : 'Export all PNGs'}
        </button>
      </header>

      <div className="app__body">
        <aside className="app__sidebar">
          <details className="collapsible">
            <summary><h2>Guides & snap</h2></summary>
            <div className="collapsible__body">
              <label className="check">
                <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
                Grid
              </label>
              <label className="field">
                Grid px
                <input type="number" min={4} max={400} value={gridSize} onChange={(e) => setGridSize(Number(e.target.value) || 40)} />
              </label>
              <label className="check">
                <input type="checkbox" checked={showCenterGuides} onChange={(e) => setShowCenterGuides(e.target.checked)} />
                Center lines
              </label>
              <hr />
              <label className="check">
                <input type="checkbox" checked={snapGrid} onChange={(e) => setSnapGrid(e.target.checked)} />
                Snap to grid
              </label>
              <label className="check">
                <input type="checkbox" checked={snapCenter} onChange={(e) => setSnapCenter(e.target.checked)} />
                Snap to center
              </label>
              <label className="check">
                <input type="checkbox" checked={snapItems} onChange={(e) => setSnapItems(e.target.checked)} />
                Snap to other media
              </label>
              <label className="check">
                <input type="checkbox" checked={snapMargins} onChange={(e) => setSnapMargins(e.target.checked)} />
                Snap to margins
              </label>
            </div>
          </details>

          {selectedId && (() => {
            const raw = items.find((x) => x.id === selectedId)
            if (!raw) return null
            const sel = { brightness: 0, contrast: 0, saturation: 1, ...raw }
            return (
              <div className="selection-panel">
                <h2>Selection</h2>
                <label className="field">
                  Move to slide
                  <select
                    value={sel.slideId}
                    onChange={(e) => moveItemToSlide(selectedId, e.target.value)}
                  >
                    {slides.map((s, i) => (
                      <option key={s.id} value={s.id}>{i + 1}</option>
                    ))}
                  </select>
                </label>

                <h2>Color corrections</h2>
                <label className="slider-field">
                  <span className="slider-field__label">
                    Exposure
                    <span className="slider-field__value">{sel.brightness.toFixed(2)}</span>
                  </span>
                  <input type="range" min={-1} max={1} step={0.01} value={sel.brightness}
                    onChange={(e) => updateItem(selectedId, { brightness: Number(e.target.value) })}
                  />
                </label>
                <label className="slider-field">
                  <span className="slider-field__label">
                    Contrast
                    <span className="slider-field__value">{Math.round(sel.contrast)}</span>
                  </span>
                  <input type="range" min={-100} max={100} step={1} value={sel.contrast}
                    onChange={(e) => updateItem(selectedId, { contrast: Number(e.target.value) })}
                  />
                </label>
                <label className="slider-field">
                  <span className="slider-field__label">
                    Saturation
                    <span className="slider-field__value">{sel.saturation.toFixed(2)}</span>
                  </span>
                  <input type="range" min={0} max={2} step={0.01} value={sel.saturation}
                    onChange={(e) => updateItem(selectedId, { saturation: Number(e.target.value) })}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  style={{ marginTop: 4, alignSelf: 'flex-start' }}
                  onClick={() => updateItem(selectedId, { brightness: 0, contrast: 0, saturation: 1 })}
                >
                  Reset
                </button>

                <button
                  type="button"
                  className="btn btn--ghost btn--danger"
                  style={{ marginTop: 8 }}
                  onClick={() => removeItem(selectedId)}
                >
                  Remove media
                </button>
              </div>
            )
          })()}
        </aside>

        <main className="app__main">
          <div
            className="app__canvas-host"
            ref={layoutRef}
            style={{ flex: 1, minHeight: 0, position: 'relative' }}
            onDragEnter={onCanvasDragEnter}
            onDragLeave={onCanvasDragLeave}
            onDragOver={onCanvasDragOver}
            onDrop={onCanvasDrop}
          >
            {isDragOver && (
              <div className="drop-overlay">
                <div className="drop-overlay__content">
                  <span className="drop-overlay__icon">+</span>
                  <span>Drop to add to Slide {activeSlideIndex + 1}</span>
                </div>
              </div>
            )}
            <EditorStage
              ref={stageRef}
              maxViewWidth={viewport.w}
              maxViewHeight={viewport.h}
            />
          </div>
        </main>
      </div>
    </div>
  )
}
