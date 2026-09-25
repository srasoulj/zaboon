import { TRACE_MIN_COVERAGE, TRACE_MIN_PRECISION } from '@zaboon/session-engine'
import { describe, expect, it } from 'vitest'
import {
  distanceTransform,
  resample,
  scoreTrace,
  skeleton,
  tracePasses,
  type Mask,
  type Point,
} from './trace'

const SIZE = 200

/** A synthetic glyph: every pixel for which `inside` holds. */
function mask(inside: (x: number, y: number) => boolean, size = SIZE): Mask {
  const data = new Uint8Array(size * size)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) data[y * size + x] = inside(x, y) ? 1 : 0
  return { width: size, height: size, data }
}

// A ring (think ه or و's loop) 16 px thick around radius 60, and a bowl with a dot below (ب).
const ring = mask((x, y) => Math.abs(Math.hypot(x - 100, y - 100) - 60) <= 8)
const be = mask((x, y) => {
  const bowl = y >= 100 && Math.abs(Math.hypot(x - 100, y - 100) - 60) <= 7
  const dot = Math.hypot(x - 100, y - 185) <= 7
  return bowl || dot
})

/** Points along a circular arc (angles in radians, y down), `jitter` px of deterministic noise. */
function arc(cx: number, cy: number, r: number, from: number, to: number, jitter = 0): Point[] {
  const n = 120
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = from + ((to - from) * i) / n
    const wobble = jitter * Math.sin(i * 1.7)
    return { x: cx + (r + wobble) * Math.cos(t), y: cy + (r + wobble) * Math.sin(t) }
  })
}

/** A zigzag across the whole canvas: what a child's scribble looks like. */
const scribble: Point[] = Array.from({ length: 30 }, (_, i) => ({
  x: i % 2 === 0 ? 5 : SIZE - 5,
  y: 5 + i * 6.3,
}))

describe('trace scoring helpers', () => {
  it('distanceTransform: 0 on the glyph, growing away from it', () => {
    const dot = mask((x, y) => x === 10 && y === 10, 21)
    const d = distanceTransform(dot)
    expect(d[10 * 21 + 10]).toBe(0)
    expect(d[10 * 21 + 13]).toBeCloseTo(3, 5)
    expect(d[13 * 21 + 13]!).toBeGreaterThan(3.9)
    expect(d[13 * 21 + 13]!).toBeLessThan(4.5)
  })

  it('skeleton thins a thick bar to (about) its centre line', () => {
    const bar = mask((x, y) => x >= 20 && x < 180 && y >= 90 && y < 110)
    const s = skeleton(bar)
    const ys = new Set<number>()
    let count = 0
    s.data.forEach((v, i) => {
      if (!v) return
      count++
      ys.add(Math.floor(i / SIZE))
    })
    expect(count).toBeGreaterThan(120)
    expect(count).toBeLessThan(200)
    for (const y of ys) expect(Math.abs(y - 99.5)).toBeLessThan(11)
  })

  it('resample fills gaps so every pixel of a stroke counts', () => {
    const pts = resample([
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [{ x: 50, y: 50 }],
    ])
    expect(pts).toHaveLength(12)
    expect(pts.slice(0, 11).every((p, i) => p.x === i && p.y === 0)).toBe(true)
  })
})

describe('scoreTrace', () => {
  it('a clean trace passes', () => {
    const s = scoreTrace(ring, [arc(100, 100, 60, 0, 2 * Math.PI)])
    expect(s.coverage).toBeGreaterThan(0.95)
    expect(s.precision).toBeGreaterThan(0.95)
    expect(tracePasses(s)).toBe(true)
  })

  it('a wobbly but faithful finger trace passes', () => {
    const s = scoreTrace(ring, [arc(100, 100, 60, 0, 2 * Math.PI, 10)])
    expect(tracePasses(s)).toBe(true)
  })

  it('several strokes count together (bowl, then the dot)', () => {
    const bowl = arc(100, 100, 60, 0, Math.PI)
    expect(tracePasses(scoreTrace(be, [bowl]))).toBe(true)
    const withDot = scoreTrace(be, [bowl, [{ x: 100, y: 185 }]])
    expect(withDot.coverage).toBeGreaterThanOrEqual(scoreTrace(be, [bowl]).coverage)
    expect(tracePasses(withDot)).toBe(true)
  })

  it('half a letter fails on coverage', () => {
    const s = scoreTrace(ring, [arc(100, 100, 60, 0, Math.PI)])
    expect(s.precision).toBeGreaterThan(0.95)
    expect(s.coverage).toBeLessThan(TRACE_MIN_COVERAGE)
    expect(tracePasses(s)).toBe(false)
  })

  it('a scribble across the canvas fails on precision', () => {
    const s = scoreTrace(ring, [scribble])
    expect(s.precision).toBeLessThan(TRACE_MIN_PRECISION)
    expect(tracePasses(s)).toBe(false)
  })

  it('another shape fails', () => {
    const line = [
      { x: 10, y: 100 },
      { x: 190, y: 100 },
    ]
    expect(tracePasses(scoreTrace(ring, [line]))).toBe(false)
  })

  it('an empty canvas, a stroke off the canvas and an empty glyph score 0', () => {
    expect(scoreTrace(ring, [])).toEqual({ coverage: 0, precision: 0 })
    expect(scoreTrace(ring, [[]])).toEqual({ coverage: 0, precision: 0 })
    expect(scoreTrace(ring, [[{ x: -50, y: -50 }]]).precision).toBe(0)
    expect(
      scoreTrace(
        mask(() => false),
        [arc(100, 100, 60, 0, 6)],
      ),
    ).toEqual({ coverage: 0, precision: 0 })
  })

  it('scores stay within 0..1 (the contract bounds)', () => {
    for (const strokes of [[scribble], [arc(100, 100, 60, 0, 7, 30)], [arc(100, 100, 60, 0, 1)]]) {
      const s = scoreTrace(ring, strokes)
      for (const v of [s.coverage, s.precision]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })
})
