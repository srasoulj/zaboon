/**
 * Scores a letter trace on the client (LEARNING-ENGINE §6, `letter_trace`). Pure: the renderer
 * rasterizes the guide glyph (glyph.ts) and collects pointer strokes in the same pixel space.
 *
 * - coverage = share of the glyph's skeleton (its centre line) that lies within `tolerance` px of
 *   a stroke: did the learner go everywhere the letter goes?
 * - precision = share of the stroke's points (resampled every pixel) that lie inside the glyph
 *   dilated by `tolerance` px: did the learner stay on the letter?
 *
 * The server re-grades the two numbers against the same thresholds (`gradeResponse`).
 */
import { TRACE_MIN_COVERAGE, TRACE_MIN_PRECISION } from '@zaboon/session-engine'

export interface Point {
  x: number
  y: number
}

/** A binary raster: `data[y * width + x]` is 1 inside the glyph. */
export interface Mask {
  width: number
  height: number
  data: Uint8Array
}

export interface TraceScore {
  coverage: number
  precision: number
}

/** Tolerance as a share of the canvas side: generous enough for a finger on a phone. */
export const TRACE_TOLERANCE = 0.06

/** Chamfer 3-4 distance transform: distance (px) from every pixel to the nearest set pixel. */
export function distanceTransform(mask: Mask): Float32Array {
  const { width: w, height: h, data } = mask
  const INF = 1e9
  const d = new Float32Array(w * h)
  for (let i = 0; i < d.length; i++) d[i] = data[i] ? 0 : INF
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? INF : d[y * w + x]!)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (d[i] === 0) continue
      d[i] = Math.min(
        d[i]!,
        at(x - 1, y) + 3,
        at(x, y - 1) + 3,
        at(x - 1, y - 1) + 4,
        at(x + 1, y - 1) + 4,
      )
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (d[i] === 0) continue
      d[i] = Math.min(
        d[i]!,
        at(x + 1, y) + 3,
        at(x, y + 1) + 3,
        at(x + 1, y + 1) + 4,
        at(x - 1, y + 1) + 4,
      )
    }
  for (let i = 0; i < d.length; i++) d[i] = d[i]! / 3
  return d
}

/** Zhang–Suen thinning: the one-pixel-wide centre line of the glyph. */
export function skeleton(mask: Mask): Mask {
  const { width: w, height: h } = mask
  const img = Uint8Array.from(mask.data)
  const px = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img[y * w + x]!)
  for (let changed = true; changed;) {
    changed = false
    for (const step of [0, 1]) {
      const clear: number[] = []
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (!img[y * w + x]) continue
          // Neighbours clockwise from north: p2..p9.
          const n = [
            px(x, y - 1),
            px(x + 1, y - 1),
            px(x + 1, y),
            px(x + 1, y + 1),
            px(x, y + 1),
            px(x - 1, y + 1),
            px(x - 1, y),
            px(x - 1, y - 1),
          ]
          const b = n.reduce((s, v) => s + v, 0)
          if (b < 2 || b > 6) continue
          let a = 0
          for (let k = 0; k < 8; k++) if (n[k] === 0 && n[(k + 1) % 8] === 1) a++
          if (a !== 1) continue
          const [p2, , p4, , p6, , p8] = n
          if (
            step === 0
              ? p2! * p4! * p6! !== 0 || p4! * p6! * p8! !== 0
              : p2! * p4! * p8! !== 0 || p2! * p6! * p8! !== 0
          )
            continue
          clear.push(y * w + x)
        }
      for (const i of clear) img[i] = 0
      if (clear.length > 0) changed = true
    }
  }
  return { width: w, height: h, data: img }
}

/** Stroke points resampled so consecutive points are at most 1 px apart (taps count as points). */
export function resample(strokes: readonly (readonly Point[])[]): Point[] {
  const out: Point[] = []
  for (const stroke of strokes) {
    stroke.forEach((p, i) => {
      const prev = stroke[i - 1]
      if (prev) {
        const steps = Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y))
        for (let s = 1; s < steps; s++)
          out.push({
            x: prev.x + ((p.x - prev.x) * s) / steps,
            y: prev.y + ((p.y - prev.y) * s) / steps,
          })
      }
      out.push(p)
    })
  }
  return out
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

/** Coverage and precision of `strokes` against `glyph` (both 0 for an empty glyph or no strokes). */
export function scoreTrace(
  glyph: Mask,
  strokes: readonly (readonly Point[])[],
  tolerance = TRACE_TOLERANCE * Math.max(glyph.width, glyph.height),
): TraceScore {
  const { width: w, height: h } = glyph
  const points = resample(strokes).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  const spine = skeleton(glyph)
  const spineCount = spine.data.reduce((s, v) => s + v, 0)
  if (points.length === 0 || spineCount === 0) return { coverage: 0, precision: 0 }

  // Precision: stroke points within `tolerance` of the glyph.
  const toGlyph = distanceTransform(glyph)
  const cell = (p: Point) => {
    const x = Math.round(p.x)
    const y = Math.round(p.y)
    return x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x
  }
  const inside = points.filter((p) => {
    const i = cell(p)
    return i >= 0 && toGlyph[i]! <= tolerance
  }).length

  // Coverage: skeleton pixels within `tolerance` of the stroke.
  const ink = new Uint8Array(w * h)
  for (const p of points) {
    const i = cell(p)
    if (i >= 0) ink[i] = 1
  }
  const toInk = distanceTransform({ width: w, height: h, data: ink })
  let covered = 0
  for (let i = 0; i < spine.data.length; i++) if (spine.data[i] && toInk[i]! <= tolerance) covered++

  return { coverage: round3(covered / spineCount), precision: round3(inside / points.length) }
}

/** Whether a score passes (the server re-grades with the same thresholds). */
export function tracePasses(score: TraceScore): boolean {
  return score.coverage >= TRACE_MIN_COVERAGE && score.precision >= TRACE_MIN_PRECISION
}
