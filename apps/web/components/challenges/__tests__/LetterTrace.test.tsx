import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Glyph from '@/lib/typing/glyph'
import type { Mask, Point } from '@/lib/typing/trace'
import { fixture, renderChallenge, tabTo } from '../testing'

const SIZE = 240
/** jsdom has no canvas: the guide glyph is a synthetic ring (the real one is Vazirmatn's ب). */
const ring: Mask = (() => {
  const data = new Uint8Array(SIZE * SIZE)
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++)
      data[y * SIZE + x] = Math.abs(Math.hypot(x - 120, y - 120) - 70) <= 9 ? 1 : 0
  return { width: SIZE, height: SIZE, data }
})()

const paintTrace = vi.fn()
vi.mock('@/lib/typing/glyph', async (importOriginal) => ({
  ...(await importOriginal<typeof Glyph>()),
  rasterizeGlyph: () => ring,
  paintTrace: (...args: unknown[]) => paintTrace(...args),
  persianFontReady: () => Promise.resolve(),
}))

const c = fixture('letter_trace')
const canvas = () => screen.getByTestId('trace-canvas')

beforeEach(() => {
  paintTrace.mockClear()
  // The canvas is laid out at 1:1 CSS pixels here, so client coordinates are canvas pixels.
  HTMLCanvasElement.prototype.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: SIZE,
      height: SIZE,
      right: SIZE,
      bottom: SIZE,
      x: 0,
      y: 0,
    }) as DOMRect
})

/** One pointer stroke through `points`. */
function stroke(points: readonly Point[], pointerId = 1) {
  const [first, ...rest] = points
  fireEvent.pointerDown(canvas(), {
    pointerId,
    clientX: first!.x,
    clientY: first!.y,
    pointerType: 'touch',
  })
  for (const p of rest) fireEvent.pointerMove(canvas(), { pointerId, clientX: p.x, clientY: p.y })
  const last = points.at(-1)!
  fireEvent.pointerUp(canvas(), { pointerId, clientX: last.x, clientY: last.y })
}
const arc = (from: number, to: number): Point[] =>
  Array.from({ length: 90 }, (_, i) => {
    const t = from + ((to - from) * i) / 89
    return { x: 120 + 70 * Math.cos(t), y: 120 + 70 * Math.sin(t) }
  })

describe('letter_trace', () => {
  it('shows the letter, its form and a labelled pointer canvas', async () => {
    renderChallenge(c)
    expect(screen.getByRole('heading', { name: 'Trace the letter' })).toBeInTheDocument()
    expect(screen.getByText(c.letter.letter).closest('[lang]')).toHaveAttribute('lang', 'fa')
    expect(screen.getByText(`${c.letter.name}, on its own`)).toHaveAttribute('lang', 'en')
    expect(screen.getByRole('img', { name: /^Tracing area: the letter be/ })).toBe(canvas())
    expect(canvas().className).toMatch(/traceCanvas/)
    // The guide is painted with the letter form once the font is ready.
    await act(() => Promise.resolve())
    expect(paintTrace).toHaveBeenCalled()
    expect(paintTrace.mock.lastCall?.[1]).toBe(c.letter.forms.isolated)
  })

  it('a clean trace reports passing scores and grades correct', () => {
    const h = renderChallenge(c)
    stroke(arc(0, Math.PI))
    stroke(arc(Math.PI, 2 * Math.PI), 2)
    const r = h.last()
    expect(r).toMatchObject({ kind: 'trace' })
    expect(r).not.toHaveProperty('declined')
    expect(h.verdict()).toBe('correct')
    expect(canvas()).toHaveAttribute('data-strokes', '2')
  })

  it('half a letter grades wrong', () => {
    const h = renderChallenge(c)
    stroke(arc(0, Math.PI))
    expect(h.verdict()).toBe('wrong')
  })

  it('a scribble grades wrong', () => {
    const h = renderChallenge(c)
    stroke(Array.from({ length: 30 }, (_, i) => ({ x: i % 2 ? 5 : 235, y: 5 + i * 7.5 })))
    expect(h.verdict()).toBe('wrong')
  })

  it('Clear starts over and clears the draft', async () => {
    const h = renderChallenge(c)
    const clear = screen.getByRole('button', { name: 'Clear' })
    stroke(arc(0, 2 * Math.PI))
    expect(h.last()).not.toBeNull()
    await h.user.click(clear)
    expect(h.last()).toBeNull()
    expect(canvas()).toHaveAttribute('data-strokes', '0')
  })

  it('"Can\'t trace now" reports a declined trace and submits it (it grades correct)', async () => {
    const h = renderChallenge(c)
    await h.user.click(screen.getByRole('button', { name: "Can't trace now" }))
    expect(h.last()).toEqual({ kind: 'trace', coverage: 0, precision: 0, declined: true })
    expect(h.verdict()).toBe('correct')
    expect(h.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('keyboard-only: Tab to "Can\'t trace now" and press Enter', async () => {
    const h = renderChallenge(c)
    await tabTo(h.user, screen.getByRole('button', { name: "Can't trace now" }))
    await h.user.keyboard('{Enter}')
    expect(h.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('locks in feedback: strokes and buttons do nothing', async () => {
    const h = renderChallenge(c)
    stroke(arc(0, 2 * Math.PI))
    h.check()
    const before = h.onResponse.mock.calls.length
    stroke(arc(0, 1))
    await h.user.click(screen.getByRole('button', { name: 'Clear' }))
    await h.user.click(screen.getByRole('button', { name: "Can't trace now" }))
    expect(h.onResponse.mock.calls.length).toBe(before)
    expect(h.onSubmit).not.toHaveBeenCalled()
    expect(canvas()).toHaveAttribute('data-strokes', '1')
  })
})
