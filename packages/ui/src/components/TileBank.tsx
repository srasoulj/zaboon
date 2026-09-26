'use client'
import clsx from 'clsx'
import { LayoutGroup, motion } from 'motion/react'
import { useEffect, useId, useRef, type KeyboardEvent, type Ref } from 'react'
import { usePrefersReducedMotion } from '../motion-preference'
import { ms, tokens } from '../tokens'

export type TileLang = 'fa' | 'en'

export interface Tile {
  /** Stable id, unique within the bank (the same word can appear twice). */
  id: string
  /** A whole word (a ZWNJ compound such as می‌خوام is one tile). */
  text: string
  lang: TileLang
}

export interface WordTileProps {
  text: string
  lang: TileLang
  onClick?: () => void
  disabled?: boolean
  /** Graded state; purely visual here (the feedback bar carries the text). */
  state?: 'correct' | 'wrong' | undefined
  /** motion shared-layout id so the tile flies between bank and answer line. */
  layoutId?: string
  'aria-label'?: string
  ref?: Ref<HTMLButtonElement>
}

const FLY = { duration: ms(tokens.motion.tileFly) / 1000, ease: [0.2, 0.8, 0.2, 1] as const }

/** A whole-word tile: one button, one text node, `white-space: nowrap` (CLAUDE.md rule 5). */
export function WordTile({
  text,
  lang,
  onClick,
  disabled,
  state,
  layoutId,
  ref,
  ...rest
}: WordTileProps) {
  const reduce = usePrefersReducedMotion()
  return (
    <motion.button
      ref={ref}
      type="button"
      layoutId={layoutId}
      transition={reduce ? { duration: 0 } : FLY}
      className={clsx('card-3d zb-tile', state && `zb-tile--${state}`)}
      lang={lang}
      dir={lang === 'fa' ? 'rtl' : 'ltr'}
      disabled={disabled}
      data-state={state}
      onClick={onClick}
      aria-label={rest['aria-label']}
    >
      {text}
    </motion.button>
  )
}

/** The grey slot a tile leaves in the bank; keeps the tile's width so the bank never reflows. */
export function TilePlaceholder({ text, lang }: { text: string; lang: TileLang }) {
  return (
    <span
      className="zb-tile zb-tile--placeholder"
      aria-hidden="true"
      lang={lang}
      dir={lang === 'fa' ? 'rtl' : 'ltr'}
    >
      <span className="zb-tile__ghost">{text}</span>
    </span>
  )
}

/** The bank tile to focus after `movedId` left the bank: the next one, else the previous one. */
export function nextBankFocus(
  tiles: readonly Tile[],
  answer: readonly string[],
  movedId: string,
): string | null {
  const inAnswer = new Set(answer)
  const idx = tiles.findIndex((t) => t.id === movedId)
  const after = tiles.slice(idx + 1).find((t) => !inAnswer.has(t.id))
  const before = [...tiles.slice(0, Math.max(idx, 0))].reverse().find((t) => !inAnswer.has(t.id))
  const target = after ?? before
  return target ? `bank:${target.id}` : null
}

export interface TileBankProps {
  tiles: readonly Tile[]
  /** Ids of tiles on the answer line, in order (controlled). */
  answer: readonly string[]
  onChange: (answer: string[]) => void
  /** Direction of the answer line, from the challenge's answer language. Explicit: never "auto". */
  dir: 'rtl' | 'ltr'
  disabled?: boolean
  /** Graded state shown on the answer tiles. */
  state?: 'correct' | 'wrong' | undefined
  answerLabel?: string
  bankLabel?: string
  className?: string
}

/**
 * Word bank → answer line. Tapping a bank tile appends it to the answer; tapping an answer tile
 * sends it back. Tiles fly with a shared-layout animation (≈250ms, instant under reduced motion)
 * and leave a grey placeholder in the bank. Backspace on the answer line removes the last tile.
 * Keyboard focus follows the move: to the next bank tile after adding (the last answer tile once
 * the bank is empty), to the neighbouring answer tile after removing (the returned bank tile once
 * the answer line is empty).
 */
export function TileBank({
  tiles,
  answer,
  onChange,
  dir,
  disabled = false,
  state,
  answerLabel = 'Your answer',
  bankLabel = 'Word bank',
  className,
}: TileBankProps) {
  const uid = useId()
  const byId = new Map(tiles.map((t) => [t.id, t]))
  const used = new Set(answer)
  const answerTiles = answer.map((id) => byId.get(id)).filter((t): t is Tile => t !== undefined)
  const layoutId = (id: string) => `${uid}-tile-${id}`

  // Moving a tile unmounts the focused button, so focus is placed explicitly after the parent
  // re-renders with the new answer (only when focus was inside this bank to begin with).
  const rootRef = useRef<HTMLDivElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const pendingFocus = useRef<string | null>(null)
  const setButton = (key: string) => (el: HTMLButtonElement | null) => {
    if (el) buttons.current.set(key, el)
    else buttons.current.delete(key)
  }
  useEffect(() => {
    const key = pendingFocus.current
    if (key === null) return
    const el = buttons.current.get(key)
    if (el) {
      pendingFocus.current = null
      el.focus({ preventScroll: true })
    }
  })
  const hadFocus = () => rootRef.current?.contains(document.activeElement) ?? false

  const move = (next: string[], focusKey: string | null) => {
    if (hadFocus()) pendingFocus.current = focusKey
    onChange(next)
  }
  const add = (id: string) => {
    if (disabled || used.has(id)) return
    const next = [...answer, id]
    move(next, nextBankFocus(tiles, next, id) ?? `answer:${id}`)
  }
  const remove = (id: string) => {
    if (disabled) return
    const next = answer.filter((a) => a !== id)
    const at = Math.min(answer.indexOf(id), next.length - 1)
    move(next, at >= 0 ? `answer:${next[at]}` : `bank:${id}`)
  }
  const onAnswerKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Backspace' && answer.length > 0 && !disabled) {
      e.preventDefault()
      const last = answer[answer.length - 1]!
      const next = answer.slice(0, -1)
      move(next, next.length > 0 ? `answer:${next[next.length - 1]}` : `bank:${last}`)
    }
  }

  return (
    <LayoutGroup id={uid}>
      <div className={clsx('zb-tilebank', className)} ref={rootRef}>
        <div
          role="group"
          aria-label={answerLabel}
          className="zb-tilebank__answer"
          dir={dir}
          data-state={state}
          onKeyDown={onAnswerKey}
        >
          {answerTiles.map((t) => (
            <WordTile
              key={t.id}
              ref={setButton(`answer:${t.id}`)}
              layoutId={layoutId(t.id)}
              text={t.text}
              lang={t.lang}
              state={state}
              disabled={disabled}
              onClick={() => remove(t.id)}
            />
          ))}
        </div>
        <div role="group" aria-label={bankLabel} className="zb-tilebank__bank" dir={dir}>
          {tiles.map((t) =>
            used.has(t.id) ? (
              <TilePlaceholder key={t.id} text={t.text} lang={t.lang} />
            ) : (
              <WordTile
                key={t.id}
                ref={setButton(`bank:${t.id}`)}
                layoutId={layoutId(t.id)}
                text={t.text}
                lang={t.lang}
                disabled={disabled}
                onClick={() => add(t.id)}
              />
            ),
          )}
        </div>
      </div>
    </LayoutGroup>
  )
}
