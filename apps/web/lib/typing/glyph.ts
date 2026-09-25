/**
 * The letter_trace guide: a letter form drawn with the app's Persian font on a square canvas, and
 * the same drawing as a binary mask for the scorer (trace.ts). Both use `layoutGlyph`, so the
 * guide the learner sees and the mask they are scored against are the same pixels.
 */
import type { Mask, Point } from './trace'

/** Side of the trace canvas in canvas pixels (CSS scales it; strokes are mapped back). */
export const TRACE_CANVAS_SIZE = 240
/** The glyph's ink box fills this share of the canvas side. */
const FILL = 0.62

export interface GlyphLayout {
  font: string
  x: number
  y: number
}

/** The app's Persian font stack as the browser resolved it (Vazirmatn via next/font). */
export function persianFontFamily(el: Element | null): string {
  const fromVar =
    el && typeof getComputedStyle === 'function'
      ? getComputedStyle(el).getPropertyValue('--font-persian').trim()
      : ''
  return fromVar || 'Vazirmatn, sans-serif'
}

/** Font size and origin that center the glyph's ink box on the canvas, filling `FILL` of it. */
export function layoutGlyph(
  ctx: CanvasRenderingContext2D,
  text: string,
  family: string,
): GlyphLayout {
  const size = TRACE_CANVAS_SIZE
  const probe = 100
  ctx.font = `500 ${probe}px ${family}`
  ctx.direction = 'rtl'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const m = ctx.measureText(text)
  const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight
  const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
  const scale = w > 0 && h > 0 ? (size * FILL) / Math.max(w, h) : 1
  const px = probe * scale
  const left = m.actualBoundingBoxLeft * scale
  const right = m.actualBoundingBoxRight * scale
  const ascent = m.actualBoundingBoxAscent * scale
  const descent = m.actualBoundingBoxDescent * scale
  return {
    font: `500 ${px}px ${family}`,
    x: (size - (left + right)) / 2 + left,
    y: (size - (ascent + descent)) / 2 + ascent,
  }
}

/** Draws `text` at `layout` in `color`. */
export function drawGlyph(
  ctx: CanvasRenderingContext2D,
  text: string,
  layout: GlyphLayout,
  color: string,
): void {
  ctx.font = layout.font
  ctx.direction = 'rtl'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = color
  ctx.fillText(text, layout.x, layout.y)
}

/** A 2D context, or null where the browser has none (jsdom, a lost context). */
function context2d(canvas: HTMLCanvasElement, readBack = false): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d', readBack ? { willReadFrequently: true } : undefined)
  } catch {
    return null
  }
}

export interface TraceColors {
  guide: string
  ink: string
}

/** Paints the visible trace canvas: the guide glyph, then the learner's strokes on top. */
export function paintTrace(
  canvas: HTMLCanvasElement,
  text: string,
  family: string,
  strokes: readonly (readonly Point[])[],
  colors: TraceColors,
): void {
  const ctx = context2d(canvas)
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  drawGlyph(ctx, text, layoutGlyph(ctx, text, family), colors.guide)
  ctx.strokeStyle = colors.ink
  ctx.fillStyle = colors.ink
  ctx.lineWidth = TRACE_CANVAS_SIZE * 0.035
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const stroke of strokes) {
    const [first, ...rest] = stroke
    if (!first) continue
    if (rest.length === 0) {
      ctx.beginPath()
      ctx.arc(first.x, first.y, ctx.lineWidth / 2, 0, 2 * Math.PI)
      ctx.fill()
      continue
    }
    ctx.beginPath()
    ctx.moveTo(first.x, first.y)
    for (const p of rest) ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }
}

/** The glyph as a mask (null where the browser has no 2D canvas, e.g. jsdom). */
export function rasterizeGlyph(text: string, family: string): Mask | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = TRACE_CANVAS_SIZE
  canvas.height = TRACE_CANVAS_SIZE
  const ctx = context2d(canvas, true)
  if (!ctx) return null
  drawGlyph(ctx, text, layoutGlyph(ctx, text, family), '#000')
  const { data } = ctx.getImageData(0, 0, TRACE_CANVAS_SIZE, TRACE_CANVAS_SIZE)
  const mask = new Uint8Array(TRACE_CANVAS_SIZE * TRACE_CANVAS_SIZE)
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3]! >= 128 ? 1 : 0
  return { width: TRACE_CANVAS_SIZE, height: TRACE_CANVAS_SIZE, data: mask }
}

/** Waits (briefly) for the Persian font, so the guide is never drawn in a fallback font. */
export async function persianFontReady(family: string, text: string): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return
  try {
    await Promise.race([
      document.fonts.load(`500 48px ${family}`, text),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ])
  } catch {
    // An unknown family: draw with whatever the browser has.
  }
}
