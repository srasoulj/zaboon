'use client'
import type { ChallengeOf } from '@zaboon/contracts'
import { Button3D, FaText } from '@zaboon/ui'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { ChallengeRendererProps } from '@/lib/challenge-registry'
import {
  TRACE_CANVAS_SIZE,
  paintTrace,
  persianFontFamily,
  persianFontReady,
  rasterizeGlyph,
} from '@/lib/typing/glyph'
import { scoreTrace, type Mask, type Point } from '@/lib/typing/trace'
import { ChallengeFrame, gradedState, styles } from './shared'

type Props = ChallengeRendererProps<ChallengeOf<'letter_trace'>>

const FORM_NAMES = {
  isolated: 'on its own',
  initial: 'at the start of a word',
  medial: 'in the middle of a word',
  final: 'at the end of a word',
} as const

/** A theme color token as the browser resolved it (canvas needs concrete colors). */
function token(el: Element, name: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback
}

/**
 * Trace the letter (P2): the letter form is drawn with the app's Persian font as a guide on a
 * pointer canvas (Pointer Events, `touch-action: none`), and every finished stroke re-scores the
 * whole trace on the client (lib/typing/trace.ts). The draft is `{kind: 'trace', coverage,
 * precision}`; the server re-grades those scores with the same thresholds.
 *
 * "Can't trace now" reports a declined trace and submits it (it grades correct: no heart lost),
 * which is also the path for learners who can't use a pointer. Clear starts over.
 */
export function LetterTrace(props: Props) {
  const { challenge, display, phase, response, onResponse, onSubmit } = props
  const { letter, form } = challenge
  const text = letter.forms[form]
  const locked = phase !== 'answering'
  const canvas = useRef<HTMLCanvasElement>(null)
  const strokes = useRef<Point[][]>([])
  const drawing = useRef<number | null>(null)
  const mask = useRef<Mask | null>(null)
  const family = useRef('Vazirmatn, sans-serif')
  const [count, setCount] = useState(0)
  const state = gradedState(phase, props.verdict)

  const paint = () => {
    const el = canvas.current
    if (!el) return
    const ink =
      state === 'correct'
        ? token(el, '--color-correct-fg', '#2f7d32')
        : state === 'wrong'
          ? token(el, '--color-wrong-fg', '#c62828')
          : token(el, '--color-ink', '#2f2f2f')
    paintTrace(el, text, family.current, strokes.current, {
      guide: token(el, '--color-line', '#e5e5e5'),
      ink,
    })
  }

  // The guide is drawn (and rasterized for scoring) once the Persian font has loaded.
  useEffect(() => {
    let live = true
    const el = canvas.current
    family.current = persianFontFamily(el)
    void persianFontReady(family.current, text).then(() => {
      if (!live) return
      mask.current = rasterizeGlyph(text, family.current)
      paint()
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paint reads refs; redraws below
  }, [text])

  // Redraw on feedback (the strokes take the verdict's color).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- paint reads refs and `state`
  useEffect(paint, [state])

  // A declined trace submits itself once the player holds it (like MatchColumns' last pair).
  const submitted = useRef(false)
  const declined = response?.kind === 'trace' && response.declined === true
  useEffect(() => {
    if (!declined || locked || submitted.current) return
    submitted.current = true
    onSubmit()
  }, [declined, locked, onSubmit])

  const toCanvas = (e: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect()
    const sx = rect.width > 0 ? TRACE_CANVAS_SIZE / rect.width : 1
    const sy = rect.height > 0 ? TRACE_CANVAS_SIZE / rect.height : 1
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy }
  }

  const report = () => {
    const glyph = mask.current ?? rasterizeGlyph(text, family.current)
    mask.current = glyph
    if (!glyph) return
    const score = scoreTrace(glyph, strokes.current)
    onResponse({ kind: 'trace', coverage: score.coverage, precision: score.precision })
  }

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (locked || drawing.current !== null || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Synthetic or already-released pointers can't be captured; drawing still works.
    }
    drawing.current = e.pointerId
    strokes.current = [...strokes.current, [toCanvas(e)]]
    paint()
  }
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (drawing.current !== e.pointerId) return
    strokes.current.at(-1)!.push(toCanvas(e))
    paint()
  }
  const endStroke = (e: PointerEvent<HTMLCanvasElement>) => {
    if (drawing.current !== e.pointerId) return
    drawing.current = null
    setCount(strokes.current.length)
    report()
  }

  const clear = () => {
    if (locked) return
    strokes.current = []
    setCount(0)
    onResponse(null)
    paint()
  }
  const decline = () => {
    if (locked) return
    onResponse({ kind: 'trace', coverage: 0, precision: 0, declined: true })
  }

  return (
    <ChallengeFrame type={challenge.type} display={display} heading="Trace the letter">
      <p className={styles.traceCaption}>
        <FaText text={letter.letter} size="lg" />{' '}
        <span lang="en">
          {letter.name}, {FORM_NAMES[form]}
        </span>
      </p>
      <div className={styles.traceArea} data-state={state}>
        <canvas
          ref={canvas}
          className={styles.traceCanvas}
          width={TRACE_CANVAS_SIZE}
          height={TRACE_CANVAS_SIZE}
          role="img"
          aria-label={`Tracing area: the letter ${letter.name}, ${FORM_NAMES[form]}. Draw over it.`}
          data-testid="trace-canvas"
          data-strokes={count}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onLostPointerCapture={endStroke}
        />
      </div>
      <div className={styles.buildActions}>
        <Button3D variant={count > 0 && !locked ? 'ghost' : 'locked'} onClick={clear}>
          Clear
        </Button3D>
        <Button3D variant={locked ? 'locked' : 'ghost'} onClick={decline}>
          Can't trace now
        </Button3D>
      </div>
    </ChallengeFrame>
  )
}
