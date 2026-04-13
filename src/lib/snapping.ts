import type { Size } from './presets'

export interface Box {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

/** A visual guide line to render while dragging. */
export interface GuideLine {
  orientation: 'vertical' | 'horizontal'
  /** Position along the perpendicular axis (x for vertical, y for horizontal). */
  pos: number
  /** Start of the line along its axis. */
  from: number
  /** End of the line along its axis. */
  to: number
}

export interface SnapResult {
  x: number
  y: number
  guides: GuideLine[]
}

/** Snap threshold in artboard pixels. */
const THRESH = 16

interface Candidate {
  /** The snapped position for the item's edge/center. */
  snappedItemPos: number
  /** Position of the guide line itself (in artboard coords). */
  guidePos: number
  /** Label for debugging. */
  type: string
}

export interface SnapOptions {
  stage: Size
  self: Box
  others: Box[]
  gridSize: number | null
  marginPx: number
  snapGrid: boolean
  snapCenter: boolean
  snapItems: boolean
  snapMargins: boolean
}

/**
 * Calculate snapped position and visual guides for an axis-aligned box.
 * Returns the snapped (x, y) plus guide lines to render.
 */
export function snapPosition(opts: SnapOptions): SnapResult {
  const { width: W, height: H } = opts.stage
  const { width: bw, height: bh } = opts.self
  let { x, y } = opts.self

  // We track candidates for left, center-x, right of the box (and top, center-y, bottom)
  const xCandidates: Candidate[] = []
  const yCandidates: Candidate[] = []

  /* ---- Artboard center ---- */
  if (opts.snapCenter) {
    // Snap item center to artboard center
    xCandidates.push({
      snappedItemPos: W / 2 - bw / 2,
      guidePos: W / 2,
      type: 'center',
    })
    yCandidates.push({
      snappedItemPos: H / 2 - bh / 2,
      guidePos: H / 2,
      type: 'center',
    })
  }

  /* ---- Margins ---- */
  if (opts.snapMargins && opts.marginPx > 0) {
    const m = opts.marginPx
    // Left edge to left margin
    xCandidates.push({ snappedItemPos: m, guidePos: m, type: 'margin-l' })
    // Right edge to right margin
    xCandidates.push({ snappedItemPos: W - m - bw, guidePos: W - m, type: 'margin-r' })
    // Top edge to top margin
    yCandidates.push({ snappedItemPos: m, guidePos: m, type: 'margin-t' })
    // Bottom edge to bottom margin
    yCandidates.push({ snappedItemPos: H - m - bh, guidePos: H - m, type: 'margin-b' })
  }

  /* ---- Artboard edges ---- */
  if (opts.snapCenter) {
    // Snap to artboard edges (0 and W/H)
    xCandidates.push({ snappedItemPos: 0, guidePos: 0, type: 'edge-l' })
    xCandidates.push({ snappedItemPos: W - bw, guidePos: W, type: 'edge-r' })
    yCandidates.push({ snappedItemPos: 0, guidePos: 0, type: 'edge-t' })
    yCandidates.push({ snappedItemPos: H - bh, guidePos: H, type: 'edge-b' })
  }

  /* ---- Other items ---- */
  if (opts.snapItems) {
    for (const o of opts.others) {
      const oLeft = o.x
      const oRight = o.x + o.width
      const oCx = o.x + o.width / 2
      const oTop = o.y
      const oBottom = o.y + o.height
      const oCy = o.y + o.height / 2

      // Snap left edge of self to left/right/center of other
      xCandidates.push({ snappedItemPos: oLeft, guidePos: oLeft, type: 'item-ll' })
      xCandidates.push({ snappedItemPos: oRight, guidePos: oRight, type: 'item-lr' })
      // Snap right edge of self to left/right of other
      xCandidates.push({ snappedItemPos: oLeft - bw, guidePos: oLeft, type: 'item-rl' })
      xCandidates.push({ snappedItemPos: oRight - bw, guidePos: oRight, type: 'item-rr' })
      // Snap center of self to center of other
      xCandidates.push({ snappedItemPos: oCx - bw / 2, guidePos: oCx, type: 'item-cx' })

      // Same for Y axis
      yCandidates.push({ snappedItemPos: oTop, guidePos: oTop, type: 'item-tt' })
      yCandidates.push({ snappedItemPos: oBottom, guidePos: oBottom, type: 'item-tb' })
      yCandidates.push({ snappedItemPos: oTop - bh, guidePos: oTop, type: 'item-bt' })
      yCandidates.push({ snappedItemPos: oBottom - bh, guidePos: oBottom, type: 'item-bb' })
      yCandidates.push({ snappedItemPos: oCy - bh / 2, guidePos: oCy, type: 'item-cy' })
    }
  }

  /* ---- Grid ---- */
  if (opts.snapGrid && opts.gridSize && opts.gridSize > 0) {
    const g = opts.gridSize
    // Snap left edge to grid
    const nearestGx = Math.round(x / g) * g
    if (Math.abs(nearestGx - x) <= THRESH) {
      xCandidates.push({ snappedItemPos: nearestGx, guidePos: nearestGx, type: 'grid' })
    }
    const nearestGy = Math.round(y / g) * g
    if (Math.abs(nearestGy - y) <= THRESH) {
      yCandidates.push({ snappedItemPos: nearestGy, guidePos: nearestGy, type: 'grid' })
    }
  }

  /* ---- Find best snap for each axis ---- */
  const guides: GuideLine[] = []

  let bestXDist = THRESH + 1
  let bestX = x
  let bestXGuide: Candidate | null = null

  for (const c of xCandidates) {
    const d = Math.abs(x - c.snappedItemPos)
    if (d < bestXDist && d <= THRESH) {
      bestXDist = d
      bestX = c.snappedItemPos
      bestXGuide = c
    }
  }

  let bestYDist = THRESH + 1
  let bestY = y
  let bestYGuide: Candidate | null = null

  for (const c of yCandidates) {
    const d = Math.abs(y - c.snappedItemPos)
    if (d < bestYDist && d <= THRESH) {
      bestYDist = d
      bestY = c.snappedItemPos
      bestYGuide = c
    }
  }

  x = bestX
  y = bestY

  /* ---- Build guide lines ---- */
  if (bestXGuide && bestXGuide.type !== 'grid') {
    // Vertical guide at guidePos, spanning relevant range
    const selfTop = y
    const selfBottom = y + bh
    let from = Math.min(selfTop, 0)
    let to = Math.max(selfBottom, H)

    // If snapping to another item, extend guide to include that item
    if (bestXGuide.type.startsWith('item')) {
      for (const o of opts.others) {
        if (
          Math.abs(o.x - bestXGuide.guidePos) < 1 ||
          Math.abs(o.x + o.width - bestXGuide.guidePos) < 1 ||
          Math.abs(o.x + o.width / 2 - bestXGuide.guidePos) < 1
        ) {
          from = Math.min(from, o.y)
          to = Math.max(to, o.y + o.height)
        }
      }
    }

    guides.push({
      orientation: 'vertical',
      pos: bestXGuide.guidePos,
      from,
      to,
    })
  }

  if (bestYGuide && bestYGuide.type !== 'grid') {
    const selfLeft = x
    const selfRight = x + bw
    let from = Math.min(selfLeft, 0)
    let to = Math.max(selfRight, W)

    if (bestYGuide.type.startsWith('item')) {
      for (const o of opts.others) {
        if (
          Math.abs(o.y - bestYGuide.guidePos) < 1 ||
          Math.abs(o.y + o.height - bestYGuide.guidePos) < 1 ||
          Math.abs(o.y + o.height / 2 - bestYGuide.guidePos) < 1
        ) {
          from = Math.min(from, o.x)
          to = Math.max(to, o.x + o.width)
        }
      }
    }

    guides.push({
      orientation: 'horizontal',
      pos: bestYGuide.guidePos,
      from,
      to,
    })
  }

  return { x, y, guides }
}
