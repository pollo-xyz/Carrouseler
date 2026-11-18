import { describe, it, expect } from 'vitest'
import {
  accentWords, effectOf, glowShadow, hasMotion, isRest, loopSeconds, mergeEffects, parseAccents,
  parseEffects, poseAt, toggleAccentWord,
  type EffectItem,
} from './effects'

const text = (over: Partial<EffectItem> = {}): EffectItem => ({ type: 'text', text: 'One\nTwo\nThree', ...over })
const ctx = { slideH: 1350 }

describe('accent words', () => {
  it('strips paired markers and records where the accents are', () => {
    const a = parseAccents('Every *currency*. And *two words* here')
    expect(a.clean).toBe('Every currency. And two words here')
    expect(a.ranges.map(([s, e]) => a.clean.slice(s, e))).toEqual(['currency', 'two words'])
  })

  it('leaves lone and spaced asterisks alone', () => {
    expect(parseAccents('5 * 3 = 15 *terms apply').clean).toBe('5 * 3 = 15 *terms apply')
    expect(parseAccents('a * b * c').ranges).toEqual([])
    expect(parseAccents('line *one\ntwo* end').ranges).toEqual([])
  })

  it('toggles a word and merges neighbours on a line', () => {
    expect(toggleAccentWord('Every hold counts', 1)).toBe('Every *hold* counts')
    expect(toggleAccentWord('Every *hold* counts', 2)).toBe('Every *hold counts*')
    expect(toggleAccentWord('Every *hold counts*', 1)).toBe('Every hold *counts*')
    expect(toggleAccentWord('one\ntwo', 0)).toBe('*one*\ntwo')
    expect(toggleAccentWord('*one*\ntwo', 1)).toBe('*one*\n*two*')
    expect(accentWords('a *b c* d').map((w) => w.accent)).toEqual([false, true, true, false])
  })
})

describe('poses', () => {
  it('is at rest with no effects, and after an entrance has finished', () => {
    expect(isRest(poseAt(text(), 2, ctx))).toBe(true)
    const rising = text({ animIn: 'rise', animDelay: 1 })
    expect(poseAt(rising, 0.5, ctx).opacity).toBe(0)
    expect(poseAt(rising, 1.25, ctx).dy).toBeGreaterThan(0)
    expect(isRest(poseAt(rising, 1.5, ctx))).toBe(true)
  })

  it('ignores effects that are off or do not apply to the item', () => {
    expect(effectOf(text({ effects: { pulse: { on: false } } }), 'pulse')).toBeNull()
    expect(effectOf({ type: 'image', effects: { reveal: { on: true } } }, 'reveal')).toBeNull()
    expect(effectOf({ type: 'shape', shapeKind: 'rect', effects: { travel: { on: true } } }, 'travel')).toBeNull()
    expect(effectOf({ type: 'shape', shapeKind: 'cursor', effects: { travel: { on: true } } }, 'travel')).not.toBeNull()
  })

  it('pulses in beats that honour delay and repeat', () => {
    const item: EffectItem = { type: 'shape', effects: { pulse: { on: true, delay: 1, every: 2 } } }
    expect(poseAt(item, 0.5, ctx).scale).toBe(1)
    expect(poseAt(item, 1.35, ctx).scale).toBeGreaterThan(1.02)
    expect(poseAt(item, 2.5, ctx).scale).toBe(1)
    expect(poseAt(item, 3.35, ctx).scale).toBeCloseTo(poseAt(item, 1.35, ctx).scale, 6)
  })

  it('shows a flashing layer only for its spell', () => {
    const ring: EffectItem = { type: 'shape', effects: { flash: { on: true, delay: 2 } } }
    expect(poseAt(ring, 1, ctx).opacity).toBe(0)
    expect(poseAt(ring, 2.8, ctx).opacity).toBe(1)
    expect(poseAt(ring, 4, ctx).opacity).toBe(0)
  })

  it('lights one accent at a time, in order', () => {
    const item = text({ effects: { highlight: { on: true } } })
    const at = (t: number) => poseAt(item, t, { ...ctx, accents: 3 }).accents!
    expect(at(0.6)).toEqual([1, 0, 0])
    expect(at(1.8)).toEqual([0, 1, 0])
    expect(at(3.0)).toEqual([0, 0, 1])
    expect(at(4.2)).toEqual([1, 0, 0])
    expect(poseAt(item, 1, ctx).accents).toBeNull() // no accent words: nothing to do
  })

  it('reveals paragraphs from dim, each later than the last', () => {
    const item = text({ effects: { reveal: { on: true, strength: 0.6 } } })
    const start = poseAt(item, 0, { ...ctx, paragraphs: 3 }).lines!
    expect(start.map((v) => +v.toFixed(2))).toEqual([0.4, 0.4, 0.4])
    const mid = poseAt(item, 0.9, { ...ctx, paragraphs: 3 }).lines!
    expect(mid[0]).toBe(1)
    expect(mid[1]).toBeGreaterThan(0.4)
    expect(mid[2]).toBeCloseTo(0.4, 6)
    expect(poseAt(item, 5, { ...ctx, paragraphs: 3 }).lines).toEqual([1, 1, 1])
  })

  it('brings a pointer in from its offset, then clicks', () => {
    const cursor: EffectItem = { type: 'shape', shapeKind: 'cursor', effects: { travel: { on: true, delay: 0.5, dx: -200, dy: 100 } } }
    expect(poseAt(cursor, 0.2, ctx).opacity).toBe(0)
    const start = poseAt(cursor, 0.5, ctx)
    expect([start.dx, start.dy]).toEqual([-200, 100])
    const landed = poseAt(cursor, 1.5, ctx)
    expect([landed.dx, landed.dy, landed.opacity]).toEqual([0, 0, 1])
    expect(landed.ripple).toBeGreaterThan(0)
    expect(poseAt(cursor, 3, ctx).ripple).toBeNull()
  })
})

describe('what counts as motion', () => {
  it('a steady glow is a look, not motion', () => {
    const steady: EffectItem = { type: 'shape', strokeColor: '#ff9900', effects: { glow: { on: true } } }
    expect(hasMotion(steady)).toBe(false)
    expect(glowShadow(steady)?.color).toBe('#ff9900')
    expect(isRest(poseAt(steady, 1, ctx))).toBe(true)
    expect(hasMotion({ ...steady, effects: { glow: { on: true, breathe: true } } })).toBe(true)
    expect(loopSeconds([steady])).toBe(0)
  })

  it('loops for six seconds, or longer when something needs it', () => {
    expect(loopSeconds([{ type: 'image', effects: { shimmer: { on: true } } }])).toBe(6)
    const slow = text({ text: 'a\nb\nc\nd\ne\nf\ng\nh', effects: { reveal: { on: true, speed: 0.5, delay: 2 } } })
    expect(loopSeconds([slow])).toBeGreaterThan(6)
  })
})

describe('effects from outside the app', () => {
  const shape: EffectItem = { type: 'shape', shapeKind: 'rect' }
  it('accepts settings, true, and null', () => {
    const parsed = parseEffects({ glow: { strength: 0.4, breathe: true }, pulse: true, drift: null }, shape)
    expect(parsed).toEqual({ glow: { on: true, strength: 0.4, breathe: true }, pulse: { on: true }, drift: null })
    expect(mergeEffects({ drift: { on: true }, shimmer: { on: true } }, parsed)).toEqual({
      shimmer: { on: true }, glow: { on: true, strength: 0.4, breathe: true }, pulse: { on: true },
    })
    expect(mergeEffects({ glow: { on: true } }, { glow: null })).toBeUndefined()
  })
  it('says what is wrong', () => {
    expect(() => parseEffects({ sparkle: {} }, shape)).toThrow(/not an effect/)
    expect(() => parseEffects({ glow: { strenght: 1 } }, shape)).toThrow(/not an effect setting/)
    expect(() => parseEffects({ glow: { strength: '1' } }, shape)).toThrow(/must be a number/)
    expect(() => parseEffects({ reveal: {} }, shape)).toThrow(/does not apply to rect shapes/)
    expect(() => parseEffects([], shape)).toThrow(/must be an object/)
  })
})
