import { describe, it, expect } from 'vitest'
import { snapPosition, snapResize, type SnapOptions, type SnapResizeOptions } from './snapping'

const STAGE = { width: 1000, height: 800 }

function opts(overrides: Partial<SnapOptions>): SnapOptions {
  return {
    stage: STAGE,
    self: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
    others: [],
    gridSize: null,
    marginPx: 0,
    snapGrid: false,
    snapCenter: false,
    snapItems: false,
    snapMargins: false,
    ...overrides,
  }
}

describe('snapPosition', () => {
  it('returns the input position when nothing is close enough', () => {
    const r = snapPosition(opts({
      snapCenter: true,
      self: { x: 300, y: 300, width: 100, height: 100, rotation: 0 },
    }))
    expect(r.x).toBe(300)
    expect(r.y).toBe(300)
    expect(r.guides).toHaveLength(0)
  })

  it('snaps the item center to the artboard center within threshold', () => {
    // Centered position would be x=450 (1000/2 - 50). Start 10px off.
    const r = snapPosition(opts({
      snapCenter: true,
      self: { x: 460, y: 360, width: 100, height: 100, rotation: 0 },
    }))
    expect(r.x).toBe(450)
    expect(r.y).toBe(350)
    const vertical = r.guides.find((g) => g.orientation === 'vertical')!
    expect(vertical.pos).toBe(500)
  })

  it('does not snap 17px away (just outside the 16px threshold)', () => {
    const r = snapPosition(opts({
      snapCenter: true,
      self: { x: 467, y: 300, width: 100, height: 100, rotation: 0 },
    }))
    expect(r.x).toBe(467)
  })

  it('snaps to artboard edges', () => {
    const r = snapPosition(opts({
      snapCenter: true,
      self: { x: 5, y: 790 - 95, width: 100, height: 100, rotation: 0 },
    }))
    expect(r.x).toBe(0) // left edge
    expect(r.y).toBe(700) // bottom edge (800 - 100)
  })

  it('snaps to margins when enabled', () => {
    const r = snapPosition(opts({
      snapMargins: true,
      marginPx: 40,
      self: { x: 45, y: 50, width: 100, height: 100, rotation: 0 },
    }))
    expect(r.x).toBe(40)
    expect(r.y).toBe(40)
  })

  it('snaps edges and centers to other items and extends guides to cover them', () => {
    const other = { x: 200, y: 500, width: 100, height: 100, rotation: 0 }
    // Self's left edge 8px from other's left edge
    const r = snapPosition(opts({
      snapItems: true,
      others: [other],
      self: { x: 208, y: 100, width: 50, height: 50, rotation: 0 },
    }))
    expect(r.x).toBe(200)
    const guide = r.guides.find((g) => g.orientation === 'vertical')!
    expect(guide.pos).toBe(200)
    // Guide spans from self (y=100) down to include the other item (y=600)
    expect(guide.from).toBeLessThanOrEqual(100)
    expect(guide.to).toBeGreaterThanOrEqual(600)
  })

  it('picks the nearest candidate when several match', () => {
    const r = snapPosition(opts({
      snapItems: true,
      others: [
        { x: 195, y: 0, width: 10, height: 10, rotation: 0 },  // left edge at 195, 5px away
        { x: 210, y: 0, width: 10, height: 10, rotation: 0 },  // left edge at 210, 10px away
      ],
      self: { x: 200, y: 400, width: 50, height: 50, rotation: 0 },
    }))
    expect(r.x).toBe(195)
  })

  it('snaps to the grid without emitting a guide line', () => {
    const r = snapPosition(opts({
      snapGrid: true,
      gridSize: 50,
      self: { x: 96, y: 203, width: 100, height: 100, rotation: 0 },
    }))
    expect(r.x).toBe(100)
    expect(r.y).toBe(200)
    expect(r.guides).toHaveLength(0)
  })
})

function resizeOpts(overrides: Partial<SnapResizeOptions>): SnapResizeOptions {
  return {
    stage: STAGE,
    oldBox: { x: 100, y: 100, width: 200, height: 200 },
    newBox: { x: 100, y: 100, width: 200, height: 200 },
    others: [],
    marginPx: 0,
    snapItems: false,
    snapCenter: false,
    snapMargins: false,
    ...overrides,
  }
}

describe('snapResize', () => {
  it('snaps a moving right edge to another item edge', () => {
    const r = snapResize(resizeOpts({
      snapItems: true,
      others: [{ x: 395, y: 0, width: 100, height: 100 }],
      newBox: { x: 100, y: 100, width: 290, height: 200 }, // right edge at 390, 5px from 395
    }))
    expect(r.width).toBe(295)
    expect(r.x).toBe(100)
    expect(r.guides).toHaveLength(1)
  })

  it('snaps a moving left edge, adjusting x and width together', () => {
    const r = snapResize(resizeOpts({
      snapCenter: true,
      newBox: { x: 6, y: 100, width: 294, height: 200 }, // left edge 6px from artboard edge 0
    }))
    expect(r.x).toBe(0)
    expect(r.width).toBe(300)
  })

  it('leaves untouched edges alone', () => {
    // Only bottom edge moved; left/right/top must not snap even if near lines
    const r = snapResize(resizeOpts({
      snapCenter: true,
      oldBox: { x: 3, y: 3, width: 200, height: 200 },
      newBox: { x: 3, y: 3, width: 200, height: 300 },
    }))
    expect(r.x).toBe(3)
    expect(r.y).toBe(3)
  })

  it('refuses snaps that would collapse the box below 12px', () => {
    const r = snapResize(resizeOpts({
      snapCenter: true,
      oldBox: { x: 0, y: 0, width: 20, height: 200 },
      newBox: { x: 0, y: 0, width: 8, height: 200 }, // right edge at 8, would snap to 0 → width 0
    }))
    expect(r.width).toBe(8)
    expect(r.guides).toHaveLength(0)
  })

  it('snaps the bottom edge to margins', () => {
    const r = snapResize(resizeOpts({
      snapMargins: true,
      marginPx: 50,
      newBox: { x: 100, y: 100, width: 200, height: 645 }, // bottom at 745, 5px from 750
    }))
    expect(r.height).toBe(650)
  })
})
