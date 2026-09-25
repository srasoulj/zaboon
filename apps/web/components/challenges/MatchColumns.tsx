'use client'
import { ChoiceCard, useDigitShortcuts } from '@zaboon/ui'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ChallengeRendererProps } from '@/lib/challenge-registry'
import { seededOrder, styles, useReducedMotion } from './shared'

export type Side = 'left' | 'right'

export interface MatchItem {
  content: ReactNode
  /** Accessible name when the visible content alone is ambiguous. */
  label?: string
  lang: 'fa' | 'en'
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
  /** Called when a left item is tapped (e.g. to say the Persian word). */
  onTapLeft?: (index: number) => void
}

const SHAKE_MS = 400

/**
 * Two columns of tap-to-match buttons. A correct pair locks and fades; a wrong pair shakes (not
 * under reduced motion) and calls `onMismatch()`. When every pair is matched the renderer reports
 * `{kind:'pairs'}` (each pair as [i, i]) and, once the player holds that draft, calls `onSubmit()`.
 * Digits 1–9 tap the buttons in reading order (left column first).
 */
export function MatchColumns({
  left,
  right,
  seed,
  leftLabel,
  rightLabel,
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
  const leftOrder = useState(() => seededOrder(count, `${seed}:l`))[0]
  const rightOrder = useState(() => seededOrder(count, `${seed}:r`))[0]

  useEffect(() => {
    if (shake === null) return
    const t = setTimeout(() => setShake(null), SHAKE_MS)
    return () => clearTimeout(t)
  }, [shake])

  const complete = matched.length === count
  const submitted = useRef(false)
  const draftComplete = response?.kind === 'pairs' && response.value.length === count
  useEffect(() => {
    if (!complete || !draftComplete || locked || submitted.current) return
    submitted.current = true
    onSubmit()
  }, [complete, draftComplete, locked, onSubmit])

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
      if (next.length === count)
        onResponse({ kind: 'pairs', value: next.map((i) => [i, i] as [number, number]) })
    } else {
      setShake({ left: l, right: r })
      onMismatch()
    }
  }

  const buttons: { side: Side; index: number }[] = [
    ...leftOrder.map((index) => ({ side: 'left' as const, index })),
    ...rightOrder.map((index) => ({ side: 'right' as const, index })),
  ]
  useDigitShortcuts(
    Math.min(buttons.length, 9),
    (n) => tap(buttons[n - 1]!.side, buttons[n - 1]!.index),
    !locked,
  )

  const column = (
    side: Side,
    order: readonly number[],
    items: readonly MatchItem[],
    label: string,
    offset: number,
  ) => (
    <div
      role="group"
      aria-label={label}
      className={styles.column}
      dir={items[0]?.lang === 'fa' ? 'rtl' : 'ltr'}
    >
      {order.map((index, k) => {
        const item = items[index]!
        const isMatched = matched.includes(index)
        const isShaking = shake !== null && shake[side] === index
        return (
          <ChoiceCard
            key={index}
            index={offset + k + 1}
            className={styles.pair}
            selected={selected?.side === side && selected.index === index}
            state={isShaking ? 'wrong' : undefined}
            disabled={isMatched}
            aria-disabled={locked || undefined}
            aria-label={item.label}
            lang={item.lang}
            dir={item.lang === 'fa' ? 'rtl' : 'ltr'}
            data-matched={isMatched}
            data-shake={isShaking && !reduced}
            data-reduced={reduced}
            onSelect={() => tap(side, index)}
          >
            {item.content}
          </ChoiceCard>
        )
      })}
    </div>
  )

  return (
    <div className={styles.columns}>
      {column('left', leftOrder, left, leftLabel, 0)}
      {column('right', rightOrder, right, rightLabel, count)}
    </div>
  )
}
