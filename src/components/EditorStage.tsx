import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Group, Layer, Line, Rect, Stage, Transformer } from 'react-konva'
import Konva from 'konva'
import { Image as KonvaImage } from 'react-konva'
import { useCarouselStore, type PlacedMedia } from '../store/useCarouselStore'
import { snapPosition, type GuideLine } from '../lib/snapping'
import { videoElements } from '../lib/videoRegistry'

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const PASTEBOARD_PAD = 400
const ARTBOARD_GAP = 120
const PASTEBOARD_COLOR = '#0a0a0e'
const ARTBOARD_COLOR = '#1a1a1f'
const GUIDE_COLOR = '#3366ff'
const GUIDE_COLOR_CENTER = '#3399ff'
const MIN_ZOOM = 0.02
const MAX_ZOOM = 8

/* ------------------------------------------------------------------ */
/*  useHtmlMedia                                                      */
/* ------------------------------------------------------------------ */

function useHtmlMedia(
  src: string,
  type: PlacedMedia['type'],
  itemId?: string,
): HTMLImageElement | HTMLVideoElement | null {
  const [node, setNode] = useState<HTMLImageElement | HTMLVideoElement | null>(null)
  useEffect(() => {
    if (type === 'video') {
      const v = document.createElement('video')
      v.src = src; v.muted = true; v.playsInline = true; v.loop = true; v.preload = 'auto'
      const onReady = () => {
        setNode(v)
        if (itemId) videoElements.set(itemId, v)
      }
      v.addEventListener('loadeddata', onReady)
      v.play().catch(() => {})
      return () => {
        v.removeEventListener('loadeddata', onReady); v.pause(); setNode(null)
        if (itemId) videoElements.delete(itemId)
      }
    }
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => setNode(img)
    img.src = src
    return () => { setNode(null) }
  }, [src, type, itemId])
  return node
}

/* ------------------------------------------------------------------ */
/*  Custom saturation filter (Konva HSL doesn't fully desaturate)     */
/* ------------------------------------------------------------------ */

function makeSaturationFilter(amount: number) {
  // amount: 0 = grayscale, 1 = normal, 2 = oversaturated
  return function saturationFilter(imageData: ImageData) {
    const d = imageData.data
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b
      d[i] = Math.min(255, Math.max(0, gray + (r - gray) * amount))
      d[i + 1] = Math.min(255, Math.max(0, gray + (g - gray) * amount))
      d[i + 2] = Math.min(255, Math.max(0, gray + (b - gray) * amount))
    }
  }
}

/* ------------------------------------------------------------------ */
/*  MediaItemView                                                     */
/* ------------------------------------------------------------------ */

function MediaItemView({
  item,
  isCropping,
  onSelect,
  onChange,
  onDragMove,
  onDragEnd,
}: {
  item: PlacedMedia
  isCropping?: boolean
  onSelect: () => void
  onChange: (patch: Partial<PlacedMedia>) => void
  onDragMove: (node: Konva.Image) => void
  onDragEnd: (node: Konva.Image) => void
}) {
  const img = useHtmlMedia(item.src, item.type, item.id)
  const shapeRef = useRef<Konva.Image>(null)

  // Apply Konva filters when image loads or filter values change
  const satAmount = item.saturation ?? 1
  const hasSatChange = Math.abs(satAmount - 1) > 0.001
  const hasFilters = item.brightness !== 0 || item.contrast !== 0 || hasSatChange
  const satFilter = useMemo(() => makeSaturationFilter(satAmount), [satAmount])
  const filters = useMemo(() => {
    const f: ((imageData: ImageData) => void)[] = []
    if (item.brightness !== 0) f.push(Konva.Filters.Brighten)
    if (item.contrast !== 0) f.push(Konva.Filters.Contrast)
    if (hasSatChange) f.push(satFilter as any)
    return f.length > 0 ? f : undefined
  }, [item.brightness, item.contrast, hasSatChange, satFilter])

  useEffect(() => {
    const node = shapeRef.current
    if (!node || !img) return
    if (hasFilters) {
      node.cache()
      node.getLayer()?.batchDraw()
    } else {
      node.clearCache()
      node.getLayer()?.batchDraw()
    }
  }, [img, hasFilters, item.brightness, item.contrast, item.saturation, item.width, item.height])

  useEffect(() => {
    if (item.type !== 'video' || !img) return
    const layer = shapeRef.current?.getLayer()
    if (!layer) return
    let id: number
    const tick = () => { layer.batchDraw(); id = requestAnimationFrame(tick) }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [item.type, img])

  if (!img) return null

  // Crop rendering
  const hasCrop = item.cropW > 0 && item.cropH > 0
  let rx = item.x, ry = item.y, rw = item.width, rh = item.height
  let cropObj: { x: number; y: number; width: number; height: number } | undefined

  if (hasCrop && !isCropping) {
    cropObj = { x: item.cropX, y: item.cropY, width: item.cropW, height: item.cropH }
  } else if (hasCrop && isCropping) {
    const sc = item.width / item.cropW
    rx = item.x - item.cropX * sc
    ry = item.y - item.cropY * sc
    rw = item.naturalWidth * sc
    rh = item.naturalHeight * sc
  }

  return (
    <KonvaImage
      ref={shapeRef}
      id={`media-${item.id}`}
      image={img}
      x={rx} y={ry}
      width={rw} height={rh}
      rotation={isCropping ? 0 : item.rotation}
      crop={cropObj}
      name="media"
      draggable={!isCropping}
      filters={filters}
      brightness={item.brightness}
      contrast={item.contrast}
      onClick={(e) => { e.cancelBubble = true; if (!isCropping) onSelect() }}
      onTap={(e) => { e.cancelBubble = true; if (!isCropping) onSelect() }}
      onDragMove={(e) => onDragMove(e.target as Konva.Image)}
      onDragEnd={(e) => onDragEnd(e.target as Konva.Image)}
      onTransformEnd={() => {
        const n = shapeRef.current
        if (!n) return
        const sx = n.scaleX(), sy = n.scaleY()
        n.scaleX(1); n.scaleY(1)
        onChange({
          x: n.x(), y: n.y(),
          width: Math.max(8, n.width() * sx),
          height: Math.max(8, n.height() * sy),
          rotation: n.rotation(),
        })
      }}
    />
  )
}

/* ------------------------------------------------------------------ */
/*  CropOverlay                                                       */
/* ------------------------------------------------------------------ */

function CropOverlay({
  item,
  zoom: stageZoom,
  onRegisterApply,
}: {
  item: PlacedMedia
  zoom: number
  onRegisterApply: (fn: (() => void) | null) => void
}) {
  const applyCropAction = useCarouselStore((s) => s.applyCrop)
  const setCropMode = useCarouselStore((s) => s.setCropMode)

  const cropRectRef = useRef<Konva.Rect>(null)
  const cropTrRef = useRef<Konva.Transformer>(null)
  const topRef = useRef<Konva.Rect>(null)
  const botRef = useRef<Konva.Rect>(null)
  const leftRef = useRef<Konva.Rect>(null)
  const rightRef = useRef<Konva.Rect>(null)
  const thirdsRefs = useRef<(Konva.Line | null)[]>([])

  // Scale from natural to display pixels
  const effCW = item.cropW || item.naturalWidth
  const s = item.width / effCW

  // Full image bounds in slide-local coords
  const fx = item.x - (item.cropW > 0 ? item.cropX : 0) * s
  const fy = item.y - (item.cropH > 0 ? item.cropY : 0) * s
  const fw = item.naturalWidth * s
  const fh = item.naturalHeight * s

  // Initial crop rect (matches current item display rect)
  const cx0 = item.x
  const cy0 = item.y
  const cw0 = item.width
  const ch0 = item.height

  const updateOverlay = useCallback(() => {
    const node = cropRectRef.current
    if (!node) return
    const nx = node.x(), ny = node.y()
    const nw = Math.abs(node.width() * node.scaleX())
    const nh = Math.abs(node.height() * node.scaleY())

    topRef.current?.setAttrs({ x: fx, y: fy, width: fw, height: Math.max(0, ny - fy) })
    botRef.current?.setAttrs({ x: fx, y: ny + nh, width: fw, height: Math.max(0, fy + fh - ny - nh) })
    leftRef.current?.setAttrs({ x: fx, y: ny, width: Math.max(0, nx - fx), height: nh })
    rightRef.current?.setAttrs({ x: nx + nw, y: ny, width: Math.max(0, fx + fw - nx - nw), height: nh })

    const lines = thirdsRefs.current
    if (lines[0]) lines[0].points([nx + nw / 3, ny, nx + nw / 3, ny + nh])
    if (lines[1]) lines[1].points([nx + (2 * nw) / 3, ny, nx + (2 * nw) / 3, ny + nh])
    if (lines[2]) lines[2].points([nx, ny + nh / 3, nx + nw, ny + nh / 3])
    if (lines[3]) lines[3].points([nx, ny + (2 * nh) / 3, nx + nw, ny + (2 * nh) / 3])

    node.getLayer()?.batchDraw()
  }, [fx, fy, fw, fh])

  // Connect Transformer + initial overlay
  useEffect(() => {
    const tr = cropTrRef.current
    const rect = cropRectRef.current
    if (tr && rect) {
      tr.nodes([rect])
      tr.getLayer()?.batchDraw()
    }
    updateOverlay()
  }, [updateOverlay])

  // Get final crop in natural coords
  const getCropNatural = useCallback(() => {
    const node = cropRectRef.current
    if (!node) return null
    const nx = (node.x() - fx) / s
    const ny = (node.y() - fy) / s
    const nw = Math.abs(node.width() * node.scaleX()) / s
    const nh = Math.abs(node.height() * node.scaleY()) / s
    return {
      x: Math.max(0, Math.round(nx)),
      y: Math.max(0, Math.round(ny)),
      w: Math.min(item.naturalWidth, Math.round(nw)),
      h: Math.min(item.naturalHeight, Math.round(nh)),
    }
  }, [fx, fy, s, item.naturalWidth, item.naturalHeight])

  const doApply = useCallback(() => {
    const c = getCropNatural()
    if (c && c.w > 0 && c.h > 0) {
      applyCropAction(item.id, c.x, c.y, c.w, c.h)
    }
  }, [getCropNatural, applyCropAction, item.id])

  // Register apply callback for external use
  useEffect(() => {
    onRegisterApply(doApply)
    return () => onRegisterApply(null)
  }, [doApply, onRegisterApply])

  // Keyboard: Enter to apply, Escape to cancel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); doApply() }
      if (e.key === 'Escape') { e.preventDefault(); setCropMode(null) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [doApply, setCropMode])

  const OVERLAY = 'rgba(0,0,0,0.55)'
  const THIRDS = 'rgba(255,255,255,0.2)'

  return (
    <>
      {/* Dark overlay bands */}
      <Rect ref={topRef} fill={OVERLAY} listening={false} />
      <Rect ref={botRef} fill={OVERLAY} listening={false} />
      <Rect ref={leftRef} fill={OVERLAY} listening={false} />
      <Rect ref={rightRef} fill={OVERLAY} listening={false} />

      {/* Rule of thirds */}
      {[0, 1, 2, 3].map((i) => (
        <Line
          key={`thirds-${i}`}
          ref={(el) => { thirdsRefs.current[i] = el }}
          stroke={THIRDS}
          strokeWidth={0.5}
          listening={false}
        />
      ))}

      {/* Crop rect */}
      <Rect
        ref={cropRectRef}
        x={cx0} y={cy0}
        width={cw0} height={ch0}
        fill="transparent"
        draggable
        dragBoundFunc={(pos) => {
          const node = cropRectRef.current
          if (!node) return pos
          const gp = node.getParent()?.absolutePosition() ?? { x: 0, y: 0 }
          const w = Math.abs(node.width() * node.scaleX())
          const h = Math.abs(node.height() * node.scaleY())
          const lx = pos.x - gp.x
          const ly = pos.y - gp.y
          return {
            x: gp.x + Math.max(fx, Math.min(fx + fw - w, lx)),
            y: gp.y + Math.max(fy, Math.min(fy + fh - h, ly)),
          }
        }}
        onDragMove={updateOverlay}
        onTransform={updateOverlay}
        onTransformEnd={() => {
          const node = cropRectRef.current
          if (!node) return
          const w = node.width() * node.scaleX()
          const h = node.height() * node.scaleY()
          node.scaleX(1)
          node.scaleY(1)
          node.width(Math.abs(w))
          node.height(Math.abs(h))
          updateOverlay()
        }}
      />

      {/* Crop Transformer */}
      <Transformer
        ref={cropTrRef}
        rotateEnabled={false}
        keepRatio={false}
        enabledAnchors={[
          'top-left', 'top-center', 'top-right',
          'middle-right', 'middle-left',
          'bottom-left', 'bottom-center', 'bottom-right',
        ]}
        boundBoxFunc={(old, nw) => (nw.width < 20 || nw.height < 20 ? old : nw)}
        anchorSize={Math.max(10, 14 / stageZoom)}
        anchorFill={GUIDE_COLOR}
        anchorStroke="#1144cc"
        anchorStrokeWidth={Math.max(1, 1.5 / stageZoom)}
        anchorCornerRadius={Math.max(1, 2 / stageZoom)}
        borderStroke={GUIDE_COLOR}
        borderStrokeWidth={Math.max(1, 1.5 / stageZoom)}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  EditorStage                                                       */
/* ------------------------------------------------------------------ */

export interface EditorStageHandle {
  exportSlidePng: (slideId: string) => Promise<Blob | null>
  exportSlideVideo: (slideId: string, outputPath: string, fps?: number, onProgress?: (pct: number) => void) => Promise<string | null>
  fitToScreen: () => void
  applyCrop: () => void
}

const EditorStage = forwardRef<
  EditorStageHandle,
  { maxViewWidth: number; maxViewHeight: number }
>(function EditorStage({ maxViewWidth, maxViewHeight }, ref) {
  const stageRef = useRef<Konva.Stage>(null)
  const guidesLayerRef = useRef<Konva.Layer>(null)
  const snapGuidesLayerRef = useRef<Konva.Layer>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const cropApplyRef = useRef<(() => void) | null>(null)

  /* ---- store ---- */
  const dimensions = useCarouselStore((s) => s.dimensions)
  const slides = useCarouselStore((s) => s.slides)
  const items = useCarouselStore((s) => s.items)
  const selectedId = useCarouselStore((s) => s.selectedId)
  const setSelected = useCarouselStore((s) => s.setSelected)
  const updateItem = useCarouselStore((s) => s.updateItem)
  const moveItemToSlide = useCarouselStore((s) => s.moveItemToSlide)
  const addSlide = useCarouselStore((s) => s.addSlide)
  const removeSlide = useCarouselStore((s) => s.removeSlide)
  const reorderSlides = useCarouselStore((s) => s.reorderSlides)
  const setSlideBgColor = useCarouselStore((s) => s.setSlideBgColor)
  const cropItemId = useCarouselStore((s) => s.cropItemId)
  const setCropMode = useCarouselStore((s) => s.setCropMode)
  const resetCropAction = useCarouselStore((s) => s.resetCrop)

  const showGrid = useCarouselStore((s) => s.showGrid)
  const gridSize = useCarouselStore((s) => s.gridSize)
  const marginPct = useCarouselStore((s) => s.marginPct)
  const showCenterGuides = useCarouselStore((s) => s.showCenterGuides)
  const snapGrid = useCarouselStore((s) => s.snapGrid)
  const snapCenter = useCarouselStore((s) => s.snapCenter)
  const snapItems = useCarouselStore((s) => s.snapItems)
  const snapMargins = useCarouselStore((s) => s.snapMargins)

  const W = dimensions.width
  const H = dimensions.height
  const marginPx = (Math.min(W, H) * marginPct) / 100

  /* ---- artboard layout ---- */
  const artboardPositions = useMemo(() => {
    return slides.map((_, i) => ({
      x: PASTEBOARD_PAD + i * (W + ARTBOARD_GAP),
      y: PASTEBOARD_PAD,
    }))
  }, [slides, W])

  const wsW = slides.length > 0
    ? PASTEBOARD_PAD * 2 + slides.length * W + (slides.length - 1) * ARTBOARD_GAP + ARTBOARD_GAP
    : PASTEBOARD_PAD * 2 + W + ARTBOARD_GAP
  const wsH = PASTEBOARD_PAD * 2 + H

  /* ---- zoom & pan (single state to prevent tearing) ---- */
  const [camera, setCamera] = useState({ zoom: 1, x: 0, y: 0 })
  const zoom = camera.zoom
  const panOffset = { x: camera.x, y: camera.y }
  const setPanOffset = useCallback((v: { x: number; y: number } | ((p: { x: number; y: number }) => { x: number; y: number })) => {
    setCamera((c) => {
      const nv = typeof v === 'function' ? v({ x: c.x, y: c.y }) : v
      return { ...c, x: nv.x, y: nv.y }
    })
  }, [])
  const setZoom = useCallback((z: number) => setCamera((c) => ({ ...c, zoom: z })), [])
  const isPanningRef = useRef(false)
  const spaceDownRef = useRef(false)
  const lastPointerRef = useRef({ x: 0, y: 0 })

  /* ---- snap guides ---- */
  const [activeGuides, setActiveGuides] = useState<{ slideIdx: number; guides: GuideLine[] } | null>(null)

  /* ---- slide label drag-to-reorder (mouse-based) ---- */
  const reorderDragRef = useRef<string | null>(null)
  const [isReordering, setIsReordering] = useState(false)
  const [reorderDropTarget, setReorderDropTarget] = useState<string | null>(null)

  /* ---- fit to screen ---- */
  const fitToScreen = useCallback(() => {
    if (W <= 0 || H <= 0 || maxViewWidth <= 0 || maxViewHeight <= 0) return
    const CHROME_TOP = 34  // screen-space: label above artboard
    const CHROME_BOT = 36  // screen-space: color picker below artboard
    const pad = 30
    const totalW = slides.length * W + (slides.length - 1) * ARTBOARD_GAP
    const availW = maxViewWidth - pad * 2
    const availH = maxViewHeight - pad * 2 - CHROME_TOP - CHROME_BOT
    const fitZoom = Math.min(availW / totalW, availH / H, 2)
    const contentCx = PASTEBOARD_PAD + totalW / 2
    const contentCy = PASTEBOARD_PAD + H / 2
    // Offset Y so label+artboard+picker are centered in available area
    const yShift = (CHROME_TOP - CHROME_BOT) / 2
    setCamera({
      zoom: fitZoom,
      x: maxViewWidth / 2 - contentCx * fitZoom,
      y: maxViewHeight / 2 + yShift - contentCy * fitZoom,
    })
  }, [W, H, maxViewWidth, maxViewHeight, slides.length])

  // Only fit on first mount, not every time slides change
  const hasFitRef = useRef(false)
  useEffect(() => {
    if (!hasFitRef.current) {
      fitToScreen()
      hasFitRef.current = true
    }
  }, [fitToScreen])

  /* ---- space key ---- */
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault(); spaceDownRef.current = true; document.body.style.cursor = 'grab'
      }
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDownRef.current = false; isPanningRef.current = false; document.body.style.cursor = ''
      }
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); document.body.style.cursor = '' }
  }, [])

  /* ---- wheel zoom (native listener, single atomic camera update) ---- */
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const rect = wrap.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      setCamera((cam) => {
        const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
        const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor))
        const wx = (mx - cam.x) / cam.zoom
        const wy = (my - cam.y) / cam.zoom
        return { zoom: nz, x: mx - wx * nz, y: my - wy * nz }
      })
    }
    wrap.addEventListener('wheel', handler, { passive: false })
    return () => wrap.removeEventListener('wheel', handler)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- pointer pan ---- */
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (spaceDownRef.current || e.button === 1) {
      e.preventDefault(); isPanningRef.current = true
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
      document.body.style.cursor = 'grabbing'
      ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    }
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current) return
    const dx = e.clientX - lastPointerRef.current.x
    const dy = e.clientY - lastPointerRef.current.y
    lastPointerRef.current = { x: e.clientX, y: e.clientY }
    setPanOffset((p) => ({ x: p.x + dx, y: p.y + dy }))
  }, [])
  const onPointerUp = useCallback(() => {
    if (isPanningRef.current) {
      isPanningRef.current = false
      document.body.style.cursor = spaceDownRef.current ? 'grab' : ''
    }
  }, [])

  /* ---- which artboard is at a workspace point ---- */
  const getSlideAtPoint = useCallback(
    (wsX: number, wsY: number): { slideId: string; slideIdx: number } | null => {
      for (let i = 0; i < slides.length; i++) {
        const ap = artboardPositions[i]!
        const margin = ARTBOARD_GAP / 2
        if (wsX >= ap.x - margin && wsX <= ap.x + W + margin && wsY >= ap.y - margin && wsY <= ap.y + H + margin) {
          return { slideId: slides[i]!.id, slideIdx: i }
        }
      }
      let bestIdx = 0, bestDist = Infinity
      for (let i = 0; i < slides.length; i++) {
        const ap = artboardPositions[i]!
        const d = Math.hypot(wsX - (ap.x + W / 2), wsY - (ap.y + H / 2))
        if (d < bestDist) { bestDist = d; bestIdx = i }
      }
      return { slideId: slides[bestIdx]!.id, slideIdx: bestIdx }
    },
    [slides, artboardPositions, W, H],
  )

  /* ---- snapping during drag ---- */
  const handleDragMove = useCallback(
    (node: Konva.Image, item: PlacedMedia) => {
      const group = node.getParent()
      if (!group) return
      const groupX = group.x(), groupY = group.y()
      const itemWsX = groupX + node.x(), itemWsY = groupY + node.y()
      const bw = node.width() * node.scaleX(), bh = node.height() * node.scaleY()
      const itemWsCx = itemWsX + bw / 2, itemWsCy = itemWsY + bh / 2

      const target = getSlideAtPoint(itemWsCx, itemWsCy)
      if (!target) return

      const ap = artboardPositions[target.slideIdx]!
      const localX = itemWsX - ap.x, localY = itemWsY - ap.y

      const otherBoxes = items
        .filter((i) => i.slideId === target.slideId && i.id !== item.id)
        .map((i) => ({ x: i.x, y: i.y, width: i.width, height: i.height, rotation: i.rotation }))

      const result = snapPosition({
        stage: { width: W, height: H },
        self: { x: localX, y: localY, width: bw, height: bh, rotation: node.rotation() },
        others: otherBoxes,
        gridSize: snapGrid ? gridSize : null,
        marginPx, snapGrid, snapCenter, snapItems, snapMargins,
      })

      node.x(ap.x + result.x - groupX)
      node.y(ap.y + result.y - groupY)

      if (result.guides.length > 0) setActiveGuides({ slideIdx: target.slideIdx, guides: result.guides })
      else setActiveGuides(null)
    },
    [artboardPositions, getSlideAtPoint, items, W, H, gridSize, marginPx, snapGrid, snapCenter, snapItems, snapMargins],
  )

  const handleDragEnd = useCallback(
    (node: Konva.Image, item: PlacedMedia) => {
      setActiveGuides(null)
      const group = node.getParent()
      if (!group) return
      const groupX = group.x(), groupY = group.y()
      const bw = node.width() * node.scaleX(), bh = node.height() * node.scaleY()
      node.scaleX(1); node.scaleY(1)
      const itemWsCx = groupX + node.x() + bw / 2
      const itemWsCy = groupY + node.y() + bh / 2
      const target = getSlideAtPoint(itemWsCx, itemWsCy)
      if (!target) return
      const ap = artboardPositions[target.slideIdx]!
      const localX = groupX + node.x() - ap.x
      const localY = groupY + node.y() - ap.y
      if (target.slideId !== item.slideId) moveItemToSlide(item.id, target.slideId)
      updateItem(item.id, { x: localX, y: localY, width: bw, height: bh })
      node.x(localX); node.y(localY); node.width(bw); node.height(bh)
    },
    [artboardPositions, getSlideAtPoint, moveItemToSlide, updateItem],
  )

  /* ---- transformer sync ---- */
  useEffect(() => {
    const tr = trRef.current, stage = stageRef.current
    if (!tr || !stage) return
    if (!selectedId || cropItemId) { tr.nodes([]); tr.getLayer()?.batchDraw(); return }
    // Image nodes mount async (useHtmlMedia waits for onload), so the node
    // may not exist yet. Use an interval so it keeps retrying even for slow loads.
    const sel = stage.findOne(`#media-${selectedId}`)
    if (sel) {
      tr.nodes([sel])
      tr.getLayer()?.batchDraw()
      return
    }
    const interval = setInterval(() => {
      const sel = stage.findOne(`#media-${selectedId}`)
      if (sel) {
        tr.nodes([sel])
        tr.getLayer()?.batchDraw()
        clearInterval(interval)
      }
    }, 100)
    return () => clearInterval(interval)
  }, [selectedId, items, cropItemId])

  /* ---- pixel inspector ---- */
  const LOUPE_SRC = 11 // pixels sampled from artboard
  const LOUPE_PX = 8   // rendered size per pixel
  const LOUPE_SIZE = LOUPE_SRC * LOUPE_PX
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null)
  const [pixelInfo, setPixelInfo] = useState<{ x: number; y: number; color: string; screenX: number; screenY: number } | null>(null)
  const altDownRef = useRef(false)

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') { e.preventDefault(); altDownRef.current = true }
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') { altDownRef.current = false; setPixelInfo(null) }
    }
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    return () => { window.removeEventListener('keydown', onDown, true); window.removeEventListener('keyup', onUp, true) }
  }, [])

  const handlePixelInspect = useCallback((e: React.MouseEvent) => {
    if (!altDownRef.current || !stageRef.current || !wrapRef.current) {
      if (pixelInfo) setPixelInfo(null)
      return
    }
    const rect = wrapRef.current.getBoundingClientRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top
    const wsX = (screenX - panOffset.x) / zoom
    const wsY = (screenY - panOffset.y) / zoom
    for (let i = 0; i < slides.length; i++) {
      const ap = artboardPositions[i]!
      if (wsX >= ap.x && wsX <= ap.x + W && wsY >= ap.y && wsY <= ap.y + H) {
        const half = Math.floor(LOUPE_SRC / 2)
        const sx = Math.floor(wsX) - half
        const sy = Math.floor(wsY) - half
        const srcCanvas = stageRef.current.toCanvas({ x: sx, y: sy, width: LOUPE_SRC, height: LOUPE_SRC, pixelRatio: 1 })
        const srcCtx = srcCanvas.getContext('2d')
        if (srcCtx) {
          // Center pixel color
          const cp = srcCtx.getImageData(half, half, 1, 1).data
          const hex = '#' + [cp[0], cp[1], cp[2]].map((c) => (c ?? 0).toString(16).padStart(2, '0')).join('')
          // Draw magnified pixels onto loupe canvas
          const lc = loupeCanvasRef.current
          if (lc) {
            const lctx = lc.getContext('2d')
            if (lctx) {
              lctx.imageSmoothingEnabled = false
              lctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE)
              lctx.drawImage(srcCanvas, 0, 0, LOUPE_SRC, LOUPE_SRC, 0, 0, LOUPE_SIZE, LOUPE_SIZE)
              // Draw grid
              lctx.strokeStyle = 'rgba(255,255,255,0.12)'
              lctx.lineWidth = 0.5
              for (let gx = 0; gx <= LOUPE_SRC; gx++) {
                lctx.beginPath(); lctx.moveTo(gx * LOUPE_PX, 0); lctx.lineTo(gx * LOUPE_PX, LOUPE_SIZE); lctx.stroke()
              }
              for (let gy = 0; gy <= LOUPE_SRC; gy++) {
                lctx.beginPath(); lctx.moveTo(0, gy * LOUPE_PX); lctx.lineTo(LOUPE_SIZE, gy * LOUPE_PX); lctx.stroke()
              }
              // Highlight center pixel
              lctx.strokeStyle = '#fff'
              lctx.lineWidth = 1.5
              lctx.strokeRect(half * LOUPE_PX + 0.5, half * LOUPE_PX + 0.5, LOUPE_PX - 1, LOUPE_PX - 1)
            }
          }
          setPixelInfo({ x: Math.floor(wsX - ap.x), y: Math.floor(wsY - ap.y), color: hex, screenX, screenY })
        }
        return
      }
    }
    setPixelInfo(null)
  }, [zoom, panOffset, slides, artboardPositions, W, H, pixelInfo, LOUPE_SRC, LOUPE_PX, LOUPE_SIZE])

  /* ---- grid lines ---- */
  const gridLines = useMemo(() => {
    if (!showGrid || gridSize <= 0) return []
    const lines: [number, number, number, number][] = []
    for (let x = gridSize; x < W; x += gridSize) lines.push([x, 0, x, H])
    for (let y = gridSize; y < H; y += gridSize) lines.push([0, y, W, y])
    return lines
  }, [showGrid, gridSize, W, H])

  /* ---- export ---- */
  const exportSlidePng = useCallback(
    async (slideId: string) => {
      const stage = stageRef.current, gl = guidesLayerRef.current, sgl = snapGuidesLayerRef.current
      if (!stage) return null
      const idx = slides.findIndex((s) => s.id === slideId)
      if (idx < 0) return null
      const ap = artboardPositions[idx]!
      const ps = stage.scaleX(), pp = stage.position()
      stage.scale({ x: 1, y: 1 }); stage.position({ x: 0, y: 0 })
      if (gl) gl.hide(); if (sgl) sgl.hide()
      stage.draw()
      const blob = (await stage.toBlob({ x: ap.x, y: ap.y, width: W, height: H, pixelRatio: 1, mimeType: 'image/png', quality: 1 })) as Blob | null
      if (gl) gl.show(); if (sgl) sgl.show()
      stage.scale({ x: ps, y: ps }); stage.position(pp); stage.draw()
      return blob
    },
    [slides, artboardPositions, W, H],
  )

  /* ---- export slide as video (frame-by-frame seek → ffmpeg) ---- */
  const exportSlideVideo = useCallback(
    async (slideId: string, outputPath: string, fps = 30, onProgress?: (pct: number) => void): Promise<string | null> => {
      if (!window.electronAPI) return null
      const stage = stageRef.current, gl = guidesLayerRef.current, sgl = snapGuidesLayerRef.current
      if (!stage) return null
      const st = useCarouselStore.getState()
      const idx = st.slides.findIndex((s) => s.id === slideId)
      if (idx < 0) return null
      const ap = artboardPositions[idx]!

      // Find all video items in this slide
      const slideVideoItems = st.items.filter((i) => i.slideId === slideId && i.type === 'video')
      if (!slideVideoItems.length) return null

      // Get the video elements and determine max duration
      const videoEls: { item: PlacedMedia; el: HTMLVideoElement }[] = []
      let maxDuration = 0
      for (const vi of slideVideoItems) {
        const el = videoElements.get(vi.id)
        if (!el) continue
        videoEls.push({ item: vi, el })
        if (el.duration > maxDuration) maxDuration = el.duration
      }
      if (maxDuration <= 0 || !isFinite(maxDuration)) return null

      // Pause all videos and remember their state
      for (const { el } of videoEls) {
        el.pause()
        el.loop = false
      }

      const sessionId = crypto.randomUUID()
      const totalFrames = Math.ceil(maxDuration * fps)

      try {
        // Start ffmpeg session
        await window.electronAPI.startVideoEncode({
          sessionId,
          width: W,
          height: H,
          fps,
          duration: maxDuration,
          outputPath,
        })

        // Save & reset stage transform
        const ps = stage.scaleX(), pp = stage.position()
        stage.scale({ x: 1, y: 1 }); stage.position({ x: 0, y: 0 })
        if (gl) gl.hide(); if (sgl) sgl.hide()

        // Frame-by-frame capture
        for (let frame = 0; frame < totalFrames; frame++) {
          const time = frame / fps

          // Seek all videos to this time
          const seekPromises = videoEls.map(({ el }) => {
            return new Promise<void>((resolve) => {
              if (time >= el.duration) {
                // Video ended — seek to last frame
                el.currentTime = el.duration - 0.001
              } else {
                el.currentTime = time
              }
              const onSeeked = () => { el.removeEventListener('seeked', onSeeked); resolve() }
              el.addEventListener('seeked', onSeeked)
            })
          })
          await Promise.all(seekPromises)

          // Wait a frame for Konva to redraw with new video frame
          await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
          stage.draw()

          // Capture the artboard region as raw pixels
          const canvas = stage.toCanvas({
            x: ap.x, y: ap.y,
            width: W, height: H,
            pixelRatio: 1,
          })
          const ctx = canvas.getContext('2d')!
          const imageData = ctx.getImageData(0, 0, W, H)

          // Send RGBA data to ffmpeg
          await window.electronAPI.videoFrame({
            sessionId,
            frameData: new Uint8Array(imageData.data.buffer),
          })

          onProgress?.(((frame + 1) / totalFrames) * 100)
        }

        // Restore stage
        if (gl) gl.show(); if (sgl) sgl.show()
        stage.scale({ x: ps, y: ps }); stage.position(pp); stage.draw()

        // Finish encoding
        const result = await window.electronAPI.endVideoEncode({ sessionId })
        return result
      } catch (err) {
        console.error('Video export failed:', err)
        return null
      } finally {
        // Restore video playback
        for (const { el } of videoEls) {
          el.loop = true
          el.play().catch(() => {})
        }
      }
    },
    [artboardPositions, W, H],
  )

  useImperativeHandle(ref, () => ({
    exportSlidePng,
    exportSlideVideo,
    fitToScreen,
    applyCrop: () => { cropApplyRef.current?.() },
  }), [exportSlidePng, exportSlideVideo, fitToScreen])

  /* ---- render ---- */
  return (
    <div
      ref={wrapRef}
      className="editor-stage-wrap"
      style={{ width: maxViewWidth, height: maxViewHeight, overflow: 'hidden', position: 'relative' }}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => { onPointerMove(e); handlePixelInspect(e) }}
      onPointerUp={onPointerUp}
    >
      {/* Pixel inspector tooltip with magnifier */}
      <canvas
        ref={loupeCanvasRef}
        width={LOUPE_SIZE}
        height={LOUPE_SIZE}
        style={{ display: 'none' }}
      />
      {pixelInfo && (
        <div style={{
          position: 'absolute',
          left: pixelInfo.screenX + 20,
          top: pixelInfo.screenY + 20,
          zIndex: 20,
          pointerEvents: 'none',
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(18,18,24,0.95)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 8,
          overflow: 'hidden',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        }}>
          <canvas
            width={LOUPE_SIZE}
            height={LOUPE_SIZE}
            style={{ width: LOUPE_SIZE, height: LOUPE_SIZE, display: 'block' }}
            ref={(el) => {
              if (!el || !loupeCanvasRef.current) return
              const ctx = el.getContext('2d')
              if (ctx) {
                ctx.imageSmoothingEnabled = false
                ctx.drawImage(loupeCanvasRef.current, 0, 0)
              }
            }}
          />
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 8px',
          }}>
            <div style={{
              width: 14, height: 14, borderRadius: 3,
              background: pixelInfo.color,
              border: '1px solid rgba(255,255,255,0.25)',
              flexShrink: 0,
            }} />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#fff' }}>
              {pixelInfo.color}
            </span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'rgba(255,255,255,0.4)', marginLeft: 'auto' }}>
              {pixelInfo.x},{pixelInfo.y}
            </span>
          </div>
        </div>
      )}

      {/* Zoom controls */}
      <div style={{ position: 'absolute', bottom: 10, right: 12, zIndex: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
        <button type="button" className="btn btn--ghost btn--sm" onClick={fitToScreen} title="Fit to screen" style={{ fontSize: '0.8rem', padding: '5px 10px' }}>
          Fit
        </button>
        <span style={{ fontSize: '0.8rem', color: 'var(--text)', opacity: 0.6, fontFamily: 'var(--mono)', minWidth: 48, textAlign: 'right' }}>
          {Math.round(zoom * 100)}%
        </span>
      </div>

      {/* HTML overlay: slide labels, color pickers, + buttons — SCREEN space */}
      <div
        style={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: isReordering ? 'auto' : 'none' }}
        onMouseMove={(e) => {
          if (!reorderDragRef.current) return
          const rect = wrapRef.current?.getBoundingClientRect()
          if (!rect) return
          const mx = e.clientX - rect.left
          // Find which gap (or end) the mouse is closest to for insertion
          let bestTarget: string | null = null
          let bestDist = Infinity
          for (let j = 0; j < slides.length; j++) {
            if (slides[j]!.id === reorderDragRef.current) continue
            const ap = artboardPositions[j]!
            const sx = ap.x * zoom + panOffset.x
            const cx = sx + (W * zoom) / 2
            const dist = Math.abs(mx - cx)
            if (dist < bestDist) { bestDist = dist; bestTarget = slides[j]!.id }
          }
          setReorderDropTarget(bestTarget)
        }}
        onMouseUp={() => {
          if (reorderDragRef.current && reorderDropTarget) {
            reorderSlides(reorderDragRef.current, reorderDropTarget)
          }
          reorderDragRef.current = null
          setIsReordering(false)
          setReorderDropTarget(null)
          document.body.style.cursor = ''
        }}
      >
        {slides.map((slide, i) => {
          const ap = artboardPositions[i]!
          const screenX = ap.x * zoom + panOffset.x
          const screenY = ap.y * zoom + panOffset.y
          const screenW = W * zoom
          const screenH = H * zoom
          const isDropTarget = reorderDropTarget === slide.id
          const isDragged = isReordering && reorderDragRef.current === slide.id

          return (
            <div key={slide.id}>
              {/* Slide label — mousedown to start reorder */}
              <div
                className="artboard-label"
                onMouseDown={(e) => {
                  if (e.button !== 0) return
                  e.stopPropagation()
                  reorderDragRef.current = slide.id
                  setIsReordering(true)
                  document.body.style.cursor = 'grabbing'
                }}
                style={{
                  position: 'absolute',
                  left: screenX,
                  top: screenY - 26,
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: 'system-ui, sans-serif',
                  color: isDragged ? 'var(--accent)' : isDropTarget ? 'var(--accent)' : 'rgba(255,255,255,0.7)',
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                  cursor: isReordering ? 'grabbing' : 'grab',
                  pointerEvents: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: isDragged ? 'rgba(124,108,240,0.2)' : 'transparent',
                  transition: 'color 0.15s, background 0.15s',
                  opacity: isDragged ? 0.7 : 1,
                }}
              >
                <span>Slide {i + 1}</span>
                {slides.length > 1 && (
                  <button
                    type="button"
                    className="artboard-remove-btn"
                    title="Remove slide"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); removeSlide(slide.id) }}
                    style={{
                      background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)',
                      cursor: 'pointer', fontSize: 13, padding: '0 4px', lineHeight: 1,
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Drop indicator line — left edge of drop target */}
              {isDropTarget && (
                <div style={{
                  position: 'absolute',
                  left: screenX - 3,
                  top: screenY - 30,
                  width: 3,
                  height: screenH + 38,
                  background: 'var(--accent)',
                  borderRadius: 2,
                  pointerEvents: 'none',
                  boxShadow: '0 0 8px rgba(124,108,240,0.5)',
                }} />
              )}

              {/* Dragged slide outline overlay */}
              {isDragged && (
                <div style={{
                  position: 'absolute',
                  left: screenX,
                  top: screenY,
                  width: screenW,
                  height: screenH,
                  border: '2px dashed var(--accent)',
                  borderRadius: 4,
                  pointerEvents: 'none',
                  opacity: 0.5,
                }} />
              )}

              {/* Background color picker — below artboard */}
              <div
                style={{
                  position: 'absolute',
                  left: screenX,
                  top: screenY + screenH + 8,
                  pointerEvents: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <input
                  type="color"
                  value={slide.bgColor || '#ffffff'}
                  onChange={(e) => setSlideBgColor(slide.id, e.target.value)}
                  title="Slide background color"
                  style={{
                    width: 22, height: 22,
                    border: '1.5px solid rgba(255,255,255,0.2)',
                    borderRadius: 4,
                    padding: 0,
                    cursor: 'pointer',
                    background: 'transparent',
                  }}
                />
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--mono)' }}>
                  {slide.bgColor || '#ffffff'}
                </span>
              </div>

              {/* + button AFTER this artboard */}
              <button
                type="button"
                className="artboard-add-btn"
                title="Add slide"
                onClick={(e) => { e.stopPropagation(); addSlide(i) }}
                style={{
                  position: 'absolute',
                  left: screenX + screenW + (ARTBOARD_GAP * zoom) / 2,
                  top: screenY + screenH / 2,
                  transform: 'translate(-50%, -50%)',
                  pointerEvents: 'auto',
                  width: 28, height: 28, borderRadius: '50%',
                  border: '1.5px solid rgba(255,255,255,0.2)',
                  background: 'rgba(30,30,40,0.85)',
                  color: 'rgba(255,255,255,0.5)',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'border-color 0.15s, color 0.15s, background 0.15s',
                }}
                onMouseEnter={(e) => {
                  const b = e.currentTarget
                  b.style.borderColor = '#3b82f6'
                  b.style.color = '#fff'
                  b.style.background = '#3b82f6'
                }}
                onMouseLeave={(e) => {
                  const b = e.currentTarget
                  b.style.borderColor = 'rgba(255,255,255,0.2)'
                  b.style.color = 'rgba(255,255,255,0.5)'
                  b.style.background = 'rgba(30,30,40,0.85)'
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                  <rect x="4.5" y="0" width="1" height="10" />
                  <rect x="0" y="4.5" width="10" height="1" />
                </svg>
              </button>
            </div>
          )
        })}

        {/* Contextual toolbar for selected item */}
        {selectedId && (() => {
          const sel = items.find((i) => i.id === selectedId)
          if (!sel) return null
          const sIdx = slides.findIndex((sv) => sv.id === sel.slideId)
          if (sIdx < 0) return null
          const sap = artboardPositions[sIdx]!
          let topY = sel.y, cx = sel.x + sel.width / 2
          if (sel.id === cropItemId && sel.cropW > 0) {
            const sc = sel.width / sel.cropW
            topY = Math.min(sel.y, sel.y - sel.cropY * sc)
            cx = sel.x - sel.cropX * sc + (sel.naturalWidth * sc) / 2
          }
          const stx = (sap.x + cx) * zoom + panOffset.x
          const sty = (sap.y + topY) * zoom + panOffset.y

          const btnBase: React.CSSProperties = {
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 28, border: 'none', borderRadius: 5,
            background: 'transparent', color: 'rgba(255,255,255,0.7)',
            cursor: 'pointer', transition: 'background 0.12s, color 0.12s',
          }

          return (
            <div
              style={{
                position: 'absolute',
                left: stx,
                top: sty - 42,
                transform: 'translateX(-50%)',
                pointerEvents: 'auto',
                zIndex: 2,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                padding: '3px 4px',
                background: 'rgba(30,30,40,0.95)',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
                backdropFilter: 'blur(12px)',
                whiteSpace: 'nowrap',
              }}
            >
              {!cropItemId ? (
                <>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setCropMode(selectedId) }}
                    title="Crop image"
                    style={btnBase}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#fff' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.7)' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M4.5 1v10.5H15" />
                      <path d="M11.5 15V4.5H1" />
                    </svg>
                  </button>
                  {sel.cropW > 0 && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); resetCropAction(selectedId) }}
                      title="Reset crop"
                      style={btnBase}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#fff' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.7)' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="1 4 1 10 7 10" />
                        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                      </svg>
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); cropApplyRef.current?.() }}
                    title="Apply crop (Enter)"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '4px 10px', border: 'none', borderRadius: 5,
                      background: 'var(--accent)', color: '#fff',
                      cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      transition: 'filter 0.12s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.15)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.filter = '' }}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 6l3 3 5-5" />
                    </svg>
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setCropMode(null) }}
                    title="Cancel (Esc)"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '4px 10px', border: 'none', borderRadius: 5,
                      background: 'transparent', color: 'rgba(255,255,255,0.6)',
                      cursor: 'pointer', fontSize: 12, fontWeight: 500,
                      transition: 'background 0.12s, color 0.12s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#fff' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)' }}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          )
        })()}

        {/* If no slides, show a single + button */}
        {slides.length === 0 && (
          <button
            type="button"
            onClick={() => addSlide()}
            style={{
              position: 'absolute',
              left: (PASTEBOARD_PAD + W / 2) * zoom + panOffset.x,
              top: (PASTEBOARD_PAD + H / 2) * zoom + panOffset.y,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'auto',
              width: 40, height: 40, borderRadius: '50%',
              border: '2px solid var(--accent)', background: 'var(--accent-dim)',
              color: '#fff', fontSize: 24, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            +
          </button>
        )}
      </div>

      {/* Konva canvas — absolutely positioned so it doesn't affect layout */}
      <div
        style={{
          position: 'absolute', top: 0, left: 0,
          width: wsW, height: wsH,
          transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
          transformOrigin: '0 0', willChange: 'transform',
        }}
      >
        <Stage
          ref={stageRef}
          width={wsW} height={wsH}
          onMouseDown={(e) => { if (spaceDownRef.current || cropItemId) return; if (e.target === e.target.getStage()) setSelected(null) }}
          onTouchStart={(e) => { if (e.target === e.target.getStage()) setSelected(null) }}
        >
          {/* Guides layer */}
          <Layer ref={guidesLayerRef} listening={false}>
            <Rect x={0} y={0} width={wsW} height={wsH} fill={PASTEBOARD_COLOR} />
            {slides.map((slide, i) => {
              const ap = artboardPositions[i]!
              return (
                <Group key={slide.id} x={ap.x} y={ap.y}>
                  <Rect x={0} y={0} width={W} height={H} fill={slide.bgColor || '#ffffff'} />
                  <Rect x={0} y={0} width={W} height={H} stroke="rgba(255,255,255,0.12)" strokeWidth={1.5} />
                  {false && marginPct > 0 && (
                    <Rect
                      x={marginPx} y={marginPx}
                      width={W - 2 * marginPx} height={H - 2 * marginPx}
                      stroke="rgba(255,200,120,0.45)" strokeWidth={1.5} dash={[8, 6]}
                    />
                  )}
                  {gridLines.map((pts, j) => (
                    <Line key={j} points={pts} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
                  ))}
                  {showCenterGuides && (
                    <>
                      <Line points={[W / 2, 0, W / 2, H]} stroke="rgba(120,180,255,0.3)" strokeWidth={1} />
                      <Line points={[0, H / 2, W, H / 2]} stroke="rgba(120,180,255,0.3)" strokeWidth={1} />
                    </>
                  )}
                </Group>
              )
            })}
          </Layer>

          {/* Content layer */}
          <Layer>
            {slides.map((slide, i) => {
              const ap = artboardPositions[i]!
              const slideItems = items.filter((it) => it.slideId === slide.id)
              return (
                <Group key={slide.id} x={ap.x} y={ap.y}>
                  <Rect
                    x={0} y={0} width={W} height={H} fill="transparent"
                    onClick={(e) => { e.cancelBubble = true; setSelected(null); useCarouselStore.getState().setActiveSlide(slide.id) }}
                  />
                  {slideItems.map((item) => (
                    <MediaItemView
                      key={item.id} item={item}
                      isCropping={item.id === cropItemId}
                      onSelect={() => { useCarouselStore.getState().setActiveSlide(slide.id); setSelected(item.id) }}
                      onChange={(patch) => updateItem(item.id, patch)}
                      onDragMove={(node) => handleDragMove(node, item)}
                      onDragEnd={(node) => handleDragEnd(node, item)}
                    />
                  ))}
                  {cropItemId && slideItems.find((it) => it.id === cropItemId) && (
                    <CropOverlay
                      item={slideItems.find((it) => it.id === cropItemId)!}
                      zoom={zoom}
                      onRegisterApply={(fn) => { cropApplyRef.current = fn }}
                    />
                  )}
                  {/* Upscale indicators — red dashed border when image exceeds natural size */}
                  {slideItems.map((item) => {
                    const up = item.naturalWidth > 0 && item.naturalHeight > 0 &&
                      (item.width > item.naturalWidth * 1.01 || item.height > item.naturalHeight * 1.01)
                    if (!up) return null
                    return (
                      <Rect
                        key={`upscale-${item.id}`}
                        x={item.x} y={item.y}
                        width={item.width} height={item.height}
                        rotation={item.rotation}
                        stroke="#ff3333" strokeWidth={2.5} dash={[10, 6]}
                        listening={false}
                      />
                    )
                  })}
                </Group>
              )
            })}
            <Transformer
              ref={trRef}
              boundBoxFunc={(o, n) => (n.width < 12 || n.height < 12 ? o : n)}
              rotateEnabled
              anchorSize={Math.max(8, 10 / zoom)}
              anchorStrokeWidth={Math.max(1, 1.5 / zoom)}
              borderStrokeWidth={Math.max(1, 1.5 / zoom)}
              anchorCornerRadius={Math.max(1, 2 / zoom)}
              rotateAnchorOffset={Math.max(20, 30 / zoom)}
              enabledAnchors={['top-left','top-center','top-right','middle-right','middle-left','bottom-left','bottom-center','bottom-right']}
            />
          </Layer>

          {/* Snap guides */}
          <Layer ref={snapGuidesLayerRef} listening={false}>
            {activeGuides?.guides.map((g, i) => {
              const ap = artboardPositions[activeGuides.slideIdx]
              if (!ap) return null
              const isCenter =
                (g.orientation === 'vertical' && Math.abs(g.pos - W / 2) < 1) ||
                (g.orientation === 'horizontal' && Math.abs(g.pos - H / 2) < 1)
              const color = isCenter ? GUIDE_COLOR_CENTER : GUIDE_COLOR
              return g.orientation === 'vertical' ? (
                <Line key={`sg-${i}`} points={[ap.x + g.pos, ap.y + g.from, ap.x + g.pos, ap.y + g.to]} stroke={color} strokeWidth={Math.max(1.5, 2 / zoom)} dash={[Math.max(6, 8 / zoom), Math.max(4, 5 / zoom)]} />
              ) : (
                <Line key={`sg-${i}`} points={[ap.x + g.from, ap.y + g.pos, ap.x + g.to, ap.y + g.pos]} stroke={color} strokeWidth={Math.max(1.5, 2 / zoom)} dash={[Math.max(6, 8 / zoom), Math.max(4, 5 / zoom)]} />
              )
            })}
          </Layer>
        </Stage>
      </div>
    </div>
  )
})

export default EditorStage
