'use client'
import { ChoiceCard } from '@zaboon/ui'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ChallengeRendererProps } from '@/lib/challenge-registry'
import { modalOpen, seededOrder, styles, useReducedMotion } from './shared'

export type Side = 'left' | 'right'

export interface MatchItem {
  /** What the card shows; Persian parts carry their own lang="fa" dir="rtl" (the card stays English). */
  content: ReactNode
}

export interface MatchColumnsProps extends Pick<
  ChallengeRendererProps,
  'response' | 'onResponse' | 'onSubmit' | 'onMismatch' | 'phase' | 'display'
> {
  /** Pair i is (left[i], right[i]); the columns are shown in a deterministic shuffled order. */
  left: readonly MatchItem[]
  right: readonly MatchItem[]
  /** Seed for the display order (stable per challenge). */
  seed: string
  leftLabel: string
  rightLabel: string
  /** Visual direction of each column (a Persian column is RTL). */
  leftDir: 'rtl' | 'ltr'
  rightDir: 'rtl' | 'ltr'
  /** Called when a left item is tapped (e.g. to say the Persian word). */
  onTapLeft?: (index: number) => void
}

const SHAKE_MS = 400
/** Gap between clearing the live region and setting its new text. */
const ANNOUNCE_DELAY_MS = 50

/** The shortcut key of the k-th card in reading order: 1–9, then 0 for the tenth. */
export function shortcutKey(k: number): string | undefined {
  if (k < 9) return String(k + 1)
  if (k === 9) return '0'
  return undefined
}

function digitOf(e: KeyboardEvent): number | null {
  const m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code)
  if (m) return Number(m[1])
  return /^[0-9]$/.test(e.key) ? Number(e.key) : null
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

/**
 * Two columns of tap-to-match buttons. A correct pair locks (aria-disabled, so focus stays put)
 * and fades; a wrong pair shakes (not under reduced motion) and calls `onMismatch()`. Both are
 * announced in a polite live region. When every pair is matched the renderer reports
 * `{kind:'pairs'}` (each pair as [i, i]) and, once the player echoes that draft back, calls
 * `onSubmit()`. Every card has a shortcut: 1–9 then 0, in reading order (left column first);
 * shortcuts are ignored while a modal dialog is open.
 */
export function MatchColumns({
  left,
  right,
  seed,
  leftLabel,
  rightLabel,
  leftDir,
  rightDir,
  onTapLeft,
  response,
  onResponse,
  onSubmit,
  onMismatch,
  phase,
  display,
}: MatchColumnsProps) {
  const count = left.length
  const reduced = useReducedMotion(display)
  const locked = phase !== 'answering'
  const [matched, setMatched] = useState<number[]>(() =>
    response?.kind === 'pairs' ? response.value.filter(([l, r]) => l === r).map(([l]) => l) : [],
  )
  const [selected, setSelected] = useState<{ side: Side; index: number } | null>(null)
  const [shake, setShake] = useState<{ left: number; right: number } | null>(null)
  // The live region's text: `queued` is shown one tick after the region was cleared, so a message
  // identical to the previous one (a second mismatch) is still a change screen readers announce.
  const [announcement, setAnnouncement] = useState('')
  const [queued, setQueued] = useState<{ text: string } | null>(null)
  useEffect(() => {
    if (queued === null) return
    const t = setTimeout(() => setAnnouncement(queued.text), ANNOUNCE_DELAY_MS)
    return () => clearTimeout(t)
  }, [queued])
  const announce = (text: string) => {
    setAnnouncement('')
    setQueued({ text })
  }
  const leftOrder = useState(() => seededOrder(count, `${seed}:l`))[0]
  const rightOrder = useState(() => seededOrder(count, `${seed}:r`))[0]

  useEffect(() => {
    if (shake === null) return
    const t = setTimeout(() => setShake(null), SHAKE_MS)
    return () => clearTimeout(t)
  }, [shake])

  // Complete means the PLAYER holds the full draft (it drops drafts while e.g. a dialog is open).
  const submitted = useRef(false)
  const draftComplete = response?.kind === 'pairs' && response.value.length === count
  useEffect(() => {
    if (!draftComplete || locked || submitted.current) return
    submitted.current = true
    onSubmit()
  }, [draftComplete, locked, onSubmit])

  const tap = (side: Side, index: number) => {
    if (locked || matched.includes(index)) return
    if (side === 'left') onTapLeft?.(index)
    if (selected === null || selected.side === side) {
      setSelected(selected?.side === side && selected.index === index ? null : { side, index })
      return
    }
    const l = side === 'left' ? index : selected.index
    const r = side === 'right' ? index : selected.index
    setSelected(null)
    if (l === r) {
      const next = [...matched, l]
      setMatched(next)
      announce(
        next.length === count
          ? 'All pairs matched.'
          : `Matched. ${next.length} of ${count} pairs done.`,
      )
      if (next.length === count)
        onResponse({ kind: 'pairs', value: next.map((i) => [i, i] as [number, number]) })
    } else {
      setShake({ left: l, right: r })
      announce('Not a match. Try again.')
      onMismatch()
    }
  }

  const buttons: { side: Side; index: number }[] = [
    ...leftOrder.map((index) => ({ side: 'left' as const, index })),
    ...rightOrder.map((index) => ({ side: 'right' as const, index })),
  ]
  const tapRef = useRef({ tap, buttons })
  useEffect(() => {
    tapRef.current = { tap, buttons }
  })
  useEffect(() => {
    if (locked) return
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return
      if (modalOpen()) return
      const d = digitOf(e)
      if (d === null) return
      const k = d === 0 ? 9 : d - 1
      const target = tapRef.current.buttons[k]
      if (!target) return
      e.preventDefault()
      tapRef.current.tap(target.side, target.index)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [locked])

  const column = (
    side: Side,
    order: readonly number[],
    items: readonly MatchItem[],
    label: string,
    dir: 'rtl' | 'ltr',
    offset: number,
  ) => (
    <div role="group" aria-label={label} className={styles.column} dir={dir}>
      {order.map((index, k) => {
        const item = items[index]!
        const isMatched = matched.includes(index)
        const isShaking = shake !== null && shake[side] === index
        const key = shortcutKey(offset + k)
        // The kit's ChoiceCard shows hints 1–9; the tenth card gets its "0" hint here.
        const kitIndex = key !== undefined && key !== '0' ? Number(key) : undefined
        return (
          <ChoiceCard
            key={index}
            {...(kitIndex === undefined ? {} : { index: kitIndex })}
            aria-keyshortcuts={key}
            className={styles.pair}
            selected={selected?.side === side && selected.index === index}
            state={isShaking ? 'wrong' : undefined}
            aria-disabled={locked || isMatched || undefined}
            data-matched={isMatched}
            data-shake={isShaking && !reduced}
            data-reduced={reduced}
            onSelect={() => tap(side, index)}
          >
            {key === '0' && (
              <kbd className={`zb-choice__hint ${styles.hintZero}`} aria-hidden="true">
                0
              </kbd>
            )}
            {item.content}
          </ChoiceCard>
        )
      })}
    </div>
  )

  return (
    <>
      <div className={styles.columns}>
        {column('left', leftOrder, left, leftLabel, leftDir, 0)}
        {column('right', rightOrder, right, rightLabel, rightDir, count)}
      </div>
      <p role="status" className={styles.srOnly} data-testid="match-status">
        {announcement}
      </p>
    </>
  )
}
