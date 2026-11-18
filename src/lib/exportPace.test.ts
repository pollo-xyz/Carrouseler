import { describe, expect, it } from 'vitest'
import { MIN_RATE, fittingRate, nextRate, rateAfterMiss } from './exportPace'

const at60 = 1000 / 60
const at30 = 1000 / 30

describe('fittingRate', () => {
  it('stays real time when a capture fits easily', () => {
    expect(fittingRate(5, at30)).toBe(1)
  })
  it('slows down so a capture fits inside one frame, with headroom', () => {
    const r = fittingRate(50, at60)
    // 50 ms of capture must cover at most r × 50 ms … of video, under a frame.
    expect(50 * r).toBeLessThan(at60)
    expect(r).toBeGreaterThan(0.15)
  })
  it('never goes below the slowest rate the browser accepts', () => {
    expect(fittingRate(5000, at60)).toBe(MIN_RATE)
  })
  it('treats an unknown cost as real time', () => {
    expect(fittingRate(0, at30)).toBe(1)
    expect(fittingRate(NaN, at30)).toBe(1)
  })
})

describe('nextRate', () => {
  it('drops straight to the fitting rate', () => {
    expect(nextRate(1, 80, at60)).toBe(fittingRate(80, at60))
  })
  it('climbs by at most a quarter per step', () => {
    expect(nextRate(0.2, 1, at60)).toBeCloseTo(0.25)
  })
  it('holds steady inside the dead band', () => {
    const r = fittingRate(40, at60)
    expect(nextRate(r * 0.95, 40, at60)).toBe(r * 0.95)
  })
})

describe('rateAfterMiss', () => {
  it('slows by more than the slots that went by', () => {
    expect(rateAfterMiss(1, 3)).toBeLessThan(1 / 3)
  })
  it('respects the floor', () => {
    expect(rateAfterMiss(MIN_RATE, 10)).toBe(MIN_RATE)
  })
})
