import { useCallback, useEffect, useRef, useState } from 'react'
import EditorStage, { type EditorStageHandle } from './components/EditorStage'
import { useCarouselStore } from './store/useCarouselStore'
import { videoElements } from './lib/videoRegistry'
import { PRESETS } from './lib/presets'
import { createZip } from './lib/zip'
import './App.css'

/* ============================================================
   Tiny inline icon set — keeps bundle small, tunable with CSS
   ============================================================ */
const Icon = {
  Export: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 4v12" />
      <path d="M7 9l5-5 5 5" />
      <path d="M5 20h14" />
    </svg>
  ),
  Plus: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  Grid: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  Sliders: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  ),
  Target: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  ),
  Trash: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  ),
  Reset: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  ),
}

/* Map slider value to a 0-100% fill, used by the CSS gradient track */
function sliderFill(value: number, min: number, max: number) {
  const pct = ((value - min) / (max - min)) * 100
  return { ['--fill' as string]: `${Math.min(100, Math.max(0, pct))}%` } as React.CSSProperties
}

function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(a.href)
  }, 2000)
}

/* ---- Cover frame picker for video items ---- */
function CoverFramePicker({ item }: { item: { id: string; src: string; coverTime: number } }) {
  const updateItem = useCarouselStore((s) => s.updateItem)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(item.coverTime || 0)

  useEffect(() => {
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
      // Draw the frame to canvas
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
  }, [item.src, item.coverTime])

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value)
    setCurrentTime(t)
    if (videoRef.current) {
      videoRef.current.currentTime = t
    }
  }, [])

  const handleScrubEnd = useCallback(() => {
    updateItem(item.id, { coverTime: currentTime })
  }, [item.id, currentTime, updateItem])

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    const ms = Math.floor((t % 1) * 10)
    return `${m}:${String(s).padStart(2, '0')}.${ms}`
  }

  return (
    <div className="cover-frame-picker">
      <h2>Cover frame</h2>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          borderRadius: 6,
          background: '#000',
          aspectRatio: '16/9',
          objectFit: 'contain',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
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
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: 'var(--mono)', minWidth: 48, textAlign: 'right' }}>
          {formatTime(currentTime)}
        </span>
      </div>
    </div>
  )
}

export default function App() {
  const stageRef = useRef<EditorStageHandle>(null)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState('')
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
    setExportProgress('')
    st.setSelected(null)
    try {
      // Desktop app: save to a directory via native dialog
      if (window.electronAPI) {
        const dir = await window.electronAPI.pickDirectory()
        if (!dir) return

        const pngFiles: { name: string; buffer: Uint8Array }[] = []

        for (let i = 0; i < st.slides.length; i++) {
          const slideId = st.slides[i]!.id
          const n = String(i + 1).padStart(2, '0')
          const hasVideo = st.items.some((it) => it.slideId === slideId && it.type === 'video')

          if (hasVideo) {
            // Video slide → export as MP4
            setExportProgress(`Encoding slide ${i + 1} video...`)
            const outputPath = `${dir}/carousel_${n}.mp4`
            await stageRef.current!.exportSlideVideo(
              slideId,
              outputPath,
              30,
              (pct) => setExportProgress(`Encoding slide ${i + 1}: ${Math.round(pct)}%`),
            )

            // Also export the cover frame as PNG
            const coverItems = st.items.filter((it) => it.slideId === slideId && it.type === 'video')
            for (const ci of coverItems) {
              if (ci.coverTime > 0) {
                // Seek video to cover time, render, export PNG
                const vel = videoElements.get(ci.id)
                if (vel) {
                  vel.pause()
                  vel.currentTime = ci.coverTime
                  await new Promise<void>((r) => {
                    const onSeeked = () => { vel.removeEventListener('seeked', onSeeked); r() }
                    vel.addEventListener('seeked', onSeeked)
                  })
                  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
                }
              }
            }
            // Export cover frame PNG
            await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
            const coverBlob = await stageRef.current!.exportSlidePng(slideId)
            if (coverBlob) {
              pngFiles.push({
                name: `carousel_${n}_cover.png`,
                buffer: new Uint8Array(await coverBlob.arrayBuffer()),
              })
            }
            // Restore video playback
            for (const ci of coverItems) {
              const vel = videoElements.get(ci.id)
              if (vel) { vel.loop = true; vel.play().catch(() => {}) }
            }
          } else {
            // Image slide → export as PNG
            setExportProgress(`Exporting slide ${i + 1}...`)
            await new Promise<void>((r) =>
              requestAnimationFrame(() => requestAnimationFrame(() => r())),
            )
            const blob = await stageRef.current!.exportSlidePng(slideId)
            if (blob) {
              pngFiles.push({
                name: `carousel_${n}.png`,
                buffer: new Uint8Array(await blob.arrayBuffer()),
              })
            }
          }
        }

        // Save all PNG files (images + cover frames)
        if (pngFiles.length > 0) {
          await window.electronAPI.saveFilesToDir({ dirPath: dir, files: pngFiles })
        }
        return
      }

      // Web fallback: only PNG export (no video encoding without ffmpeg)
      const files: { name: string; data: Blob }[] = []
      for (let i = 0; i < st.slides.length; i++) {
        const slideId = st.slides[i]!.id
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        )
        const blob = await stageRef.current!.exportSlidePng(slideId)
        if (blob) {
          const n = String(i + 1).padStart(2, '0')
          files.push({ name: `carousel_${n}.png`, data: blob })
        }
      }
      if (!files.length) return
      if (files.length === 1) {
        downloadBlob(files[0]!.data, files[0]!.name)
      } else {
        const zip = await createZip(files)
        downloadBlob(zip, 'carousel.zip')
      }
    } finally {
      setExporting(false)
      setExportProgress('')
    }
  }, [])

  /* ---- Active slide indicator ---- */
  const activeSlideIndex = slides.findIndex((s) => s.id === activeSlideId)

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <div className="app__brand-mark" aria-hidden>C</div>
          <span className="app__brand-title">Carrouseler</span>
        </div>
        <div className="app__brand-sep" aria-hidden />
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
        <div className="app__spacer" />
        <button
          type="button"
          className="btn btn--export"
          disabled={exporting}
          onClick={exportAll}
        >
          <Icon.Export />
          {exporting ? (exportProgress || 'Exporting…') : 'Export all'}
        </button>
      </header>

      <div className="app__body">
        <aside className="app__sidebar">
          <details className="collapsible" open>
            <summary><h2><Icon.Grid />Guides & snap</h2></summary>
            <div className="collapsible__body">
              <label className="check">
                <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
                Grid
              </label>
              <label className="field">
                <span>Grid px</span>
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
                <h2><Icon.Target />Selection</h2>
                <label className="field">
                  <span>Move to slide</span>
                  <select
                    value={sel.slideId}
                    onChange={(e) => moveItemToSlide(selectedId, e.target.value)}
                  >
                    {slides.map((s, i) => (
                      <option key={s.id} value={s.id}>{i + 1}</option>
                    ))}
                  </select>
                </label>

                {sel.type === 'video' && <CoverFramePicker item={sel} />}

                <h2><Icon.Sliders />Color corrections</h2>
                <label className="slider-field">
                  <span className="slider-field__label">
                    Exposure
                    <span className="slider-field__value">{sel.brightness.toFixed(2)}</span>
                  </span>
                  <input type="range" min={-1} max={1} step={0.01} value={sel.brightness}
                    style={sliderFill(sel.brightness, -1, 1)}
                    onChange={(e) => updateItem(selectedId, { brightness: Number(e.target.value) })}
                  />
                </label>
                <label className="slider-field">
                  <span className="slider-field__label">
                    Contrast
                    <span className="slider-field__value">{Math.round(sel.contrast)}</span>
                  </span>
                  <input type="range" min={-100} max={100} step={1} value={sel.contrast}
                    style={sliderFill(sel.contrast, -100, 100)}
                    onChange={(e) => updateItem(selectedId, { contrast: Number(e.target.value) })}
                  />
                </label>
                <label className="slider-field">
                  <span className="slider-field__label">
                    Saturation
                    <span className="slider-field__value">{sel.saturation.toFixed(2)}</span>
                  </span>
                  <input type="range" min={0} max={2} step={0.01} value={sel.saturation}
                    style={sliderFill(sel.saturation, 0, 2)}
                    onChange={(e) => updateItem(selectedId, { saturation: Number(e.target.value) })}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  style={{ marginTop: 8, alignSelf: 'flex-start', gap: 6, flexDirection: 'row' }}
                  onClick={() => updateItem(selectedId, { brightness: 0, contrast: 0, saturation: 1 })}
                >
                  <Icon.Reset style={{ width: 11, height: 11 }} />
                  Reset
                </button>

                <button
                  type="button"
                  className="btn btn--ghost btn--danger btn--sm"
                  style={{ marginTop: 10, alignSelf: 'flex-start', gap: 6, flexDirection: 'row' }}
                  onClick={() => removeItem(selectedId)}
                >
                  <Icon.Trash style={{ width: 11, height: 11 }} />
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
                  <span className="drop-overlay__icon">
                    <Icon.Plus />
                  </span>
                  <span>
                    Drop to add to
                    <span className="drop-overlay__slide">Slide {activeSlideIndex + 1}</span>
                  </span>
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
