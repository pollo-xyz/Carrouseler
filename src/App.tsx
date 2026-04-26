import { useCallback, useEffect, useRef, useState } from 'react'
import EditorStage, { type EditorStageHandle } from './components/EditorStage'
import { useCarouselStore } from './store/useCarouselStore'
import { PRESETS } from './lib/presets'
import { serializeProject, deserializeProject, hydrateItems } from './lib/projectFile'
import './App.css'

const VPOST_FILTER = [{ name: 'Tiovivo Project', extensions: ['vpost'] }]

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


export default function App() {
  const stageRef = useRef<EditorStageHandle>(null)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState('')
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const projectPathRef = useRef<string | null>(null)
  projectPathRef.current = projectPath
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
  const selectedIds = useCarouselStore((s) => s.selectedIds)
  const items = useCarouselStore((s) => s.items)
  const removeItem = useCarouselStore((s) => s.removeItem)
  const removeItems = useCarouselStore((s) => s.removeItems)
  const addMedia = useCarouselStore((s) => s.addMedia)

  const showGrid = useCarouselStore((s) => s.showGrid)
  const gridSize = useCarouselStore((s) => s.gridSize)
  const showCenterGuides = useCarouselStore((s) => s.showCenterGuides)
  const snapGrid = useCarouselStore((s) => s.snapGrid)
  const snapCenter = useCarouselStore((s) => s.snapCenter)
  const snapItems = useCarouselStore((s) => s.snapItems)
  const snapMargins = useCarouselStore((s) => s.snapMargins)
  const seamlessSlides = useCarouselStore((s) => s.seamlessSlides)
  const setSeamlessSlides = useCarouselStore((s) => s.setSeamlessSlides)
  const showHiddenZone = useCarouselStore((s) => s.showHiddenZone)
  const setShowHiddenZone = useCarouselStore((s) => s.setShowHiddenZone)
  const setShowGrid = useCarouselStore((s) => s.setShowGrid)
  const setGridSize = useCarouselStore((s) => s.setGridSize)
  const setShowCenterGuides = useCarouselStore((s) => s.setShowCenterGuides)
  const setSnapGrid = useCarouselStore((s) => s.setSnapGrid)
  const setSnapCenter = useCarouselStore((s) => s.setSnapCenter)
  const setSnapItems = useCarouselStore((s) => s.setSnapItems)
  const setSnapMargins = useCarouselStore((s) => s.setSnapMargins)
  const setAllSlidesBgColor = useCarouselStore((s) => s.setAllSlidesBgColor)

  // Global background color — shared across slides. Reflects the shared color
  // when all slides match, else shows the first slide's color.
  const allBgSameColor = (() => {
    if (slides.length === 0) return '#ffffff'
    const first = slides[0]!.bgColor || '#ffffff'
    return slides.every((s) => (s.bgColor || '#ffffff') === first) ? first : ''
  })()

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

      // Undo / redo (allowed even in crop mode so user can escape).
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        if (e.shiftKey) st.redo()
        else st.undo()
        e.preventDefault()
        return
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) {
        st.redo()
        e.preventDefault()
        return
      }

      // Block shortcuts during crop mode
      if (st.cropItemId) return

      // [ and ] to move selected item(s) to prev/next slide
      if ((e.key === '[' || e.key === ']') && st.selectedIds.length) {
        const primaryId = st.selectedIds[0]!
        const item = st.items.find((x) => x.id === primaryId)
        if (!item) return
        const currentIdx = st.slides.findIndex((s) => s.id === item.slideId)
        if (currentIdx < 0) return
        const targetIdx = e.key === '[' ? currentIdx - 1 : currentIdx + 1
        if (targetIdx < 0 || targetIdx >= st.slides.length) return
        const targetSlideId = st.slides[targetIdx]!.id
        st.selectedIds.forEach((id) => st.moveItemToSlide(id, targetSlideId))
        e.preventDefault()
        return
      }

      // Delete/Backspace to remove selected item(s)
      if ((e.key === 'Delete' || e.key === 'Backspace') && st.selectedIds.length) {
        st.removeItems(st.selectedIds)
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    // In Electron, the Edit menu's Cmd/Ctrl+Z accelerator fires before the
    // renderer sees the keydown — so also listen for IPC events from main.
    const offUndo = window.electronAPI?.onUndo(() => useCarouselStore.getState().undo())
    const offRedo = window.electronAPI?.onRedo(() => useCarouselStore.getState().redo())
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      offUndo?.()
      offRedo?.()
    }
  }, [])

  /* ---- Export all slides ---- */
  const exportAll = useCallback(async () => {
    const st = useCarouselStore.getState()
    if (!st.slides.length || !stageRef.current) return
    if (!window.electronAPI) {
      console.error('[export] window.electronAPI is undefined — run inside the Electron app')
      alert('Export only works in the desktop app, not the browser.')
      return
    }
    setExporting(true)
    setExportProgress('')
    st.setSelectedIds([])
    try {
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

      if (pngFiles.length > 0) {
        await window.electronAPI.saveFilesToDir({ dirPath: dir, files: pngFiles })
      }
      console.log(`[export] wrote ${pngFiles.length} PNG(s) to ${dir}`)
    } catch (err) {
      console.error('[export] failed:', err)
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(false)
      setExportProgress('')
    }
  }, [])

  /* ---- Save / Open project ---- */
  const handleSave = useCallback(async (forcePrompt: boolean) => {
    if (!window.electronAPI) {
      alert('Saving projects only works in the desktop app, not the browser.')
      return
    }
    const st = useCarouselStore.getState()
    try {
      const blob = await serializeProject(
        {
          slides: st.slides,
          items: st.items,
          dimensions: st.dimensions,
          presetId: st.presetId,
          customWidth: st.customWidth,
          customHeight: st.customHeight,
        },
        async (src) => (await fetch(src)).blob(),
      )
      const buffer = new Uint8Array(await blob.arrayBuffer())

      const existing = projectPathRef.current
      if (existing && !forcePrompt) {
        await window.electronAPI.writeFile({ path: existing, buffer })
        return
      }

      const defaultName = existing
        ? existing.split('/').pop() || 'Untitled.vpost'
        : 'Untitled.vpost'
      const path = await window.electronAPI.saveFile({
        defaultName,
        filters: VPOST_FILTER,
        buffer,
      })
      if (path) setProjectPath(path)
    } catch (err) {
      console.error('[save] failed:', err)
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

  const loadFromBuffer = useCallback((buffer: Uint8Array, path: string) => {
    try {
      const { manifest, assetBlobs } = deserializeProject(buffer)
      const assetUrls = new Map<string, string>()
      for (const [id, blob] of assetBlobs) {
        assetUrls.set(id, URL.createObjectURL(blob))
      }
      const items = hydrateItems(manifest, assetUrls)
      useCarouselStore.getState().loadProjectState({
        slides: manifest.slides,
        items,
        dimensions: manifest.dimensions,
        presetId: manifest.presetId,
        customWidth: manifest.customWidth,
        customHeight: manifest.customHeight,
      })
      setProjectPath(path)
    } catch (err) {
      console.error('[open] failed:', err)
      alert(`Open failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

  const handleOpen = useCallback(async () => {
    if (!window.electronAPI) {
      alert('Opening projects only works in the desktop app, not the browser.')
      return
    }
    try {
      const result = await window.electronAPI.openFile({ filters: VPOST_FILTER })
      if (!result) return
      loadFromBuffer(result.buffer, result.path)
    } catch (err) {
      console.error('[open] failed:', err)
      alert(`Open failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [loadFromBuffer])

  const handleNew = useCallback(() => {
    if (!window.confirm('Discard current project and start fresh?')) return
    useCarouselStore.getState().resetProject()
    setProjectPath(null)
  }, [])

  /* ---- Wire File menu IPC + window title ---- */
  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    const offNew = api.onNewProject(() => handleNew())
    const offOpen = api.onOpenProject(() => handleOpen())
    const offSave = api.onSaveProject(() => handleSave(false))
    const offSaveAs = api.onSaveProjectAs(() => handleSave(true))
    const offOpenFile = api.onOpenProjectFile(({ path, buffer }) => {
      loadFromBuffer(buffer, path)
    })
    return () => {
      offNew?.()
      offOpen?.()
      offSave?.()
      offSaveAs?.()
      offOpenFile?.()
    }
  }, [handleNew, handleOpen, handleSave, loadFromBuffer])

  useEffect(() => {
    const base = projectPath ? projectPath.split('/').pop() : null
    document.title = base ? `${base} — Tiovivo` : 'Tiovivo'
  }, [projectPath])

  /* ---- Active slide indicator ---- */
  const activeSlideIndex = slides.findIndex((s) => s.id === activeSlideId)

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <div className="app__brand-mark" aria-hidden>T</div>
          <span className="app__brand-title">Tiovivo</span>
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
          className="btn"
          onClick={handleOpen}
          title="Open project (⌘O)"
        >
          Open
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => handleSave(false)}
          title="Save project (⌘S)"
        >
          Save
        </button>
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
            <summary><h2><Icon.Sliders />Background</h2></summary>
            <div className="collapsible__body">
              <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <span>All slides</span>
                <input
                  type="color"
                  value={allBgSameColor || '#ffffff'}
                  onChange={(e) => setAllSlidesBgColor(e.target.value)}
                  title="Apply this background color to every slide"
                  style={{ width: 32, height: 24, padding: 0, border: '1.5px solid rgba(255,255,255,0.2)', borderRadius: 4, background: 'transparent', cursor: 'pointer' }}
                />
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontFamily: 'var(--mono)' }}>
                  {allBgSameColor ? allBgSameColor : 'mixed'}
                </span>
              </label>
            </div>
          </details>

          <details className="collapsible" open>
            <summary><h2><Icon.Grid />Guides & snap</h2></summary>
            <div className="collapsible__body">
              <label className="check">
                <input type="checkbox" checked={seamlessSlides} onChange={(e) => setSeamlessSlides(e.target.checked)} />
                Seamless slides
              </label>
              <label className="check">
                <input type="checkbox" checked={showHiddenZone} onChange={(e) => setShowHiddenZone(e.target.checked)} />
                Hidden zone
              </label>
              <hr />
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

          {selectedIds.length > 0 && (() => {
            const count = selectedIds.length
            const singleId = count === 1 ? selectedIds[0]! : null
            const singleOk = singleId ? !!items.find((x) => x.id === singleId) : false
            if (singleId && !singleOk) return null
            return (
              <div className="selection-panel">
                <h2><Icon.Target />{count > 1 ? `Selection (${count})` : 'Selection'}</h2>
                <button
                  type="button"
                  className="btn btn--ghost btn--danger btn--sm"
                  style={{ marginTop: 10, alignSelf: 'flex-start', gap: 6, flexDirection: 'row' }}
                  onClick={() => {
                    if (count > 1) removeItems(selectedIds)
                    else if (singleId) removeItem(singleId)
                  }}
                >
                  <Icon.Trash style={{ width: 11, height: 11 }} />
                  {count > 1 ? `Remove ${count} items` : 'Remove media'}
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
