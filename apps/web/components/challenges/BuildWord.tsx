'use client'
import type { ChallengeOf } from '@zaboon/contracts'
import { Button3D } from '@zaboon/ui'
import clsx from 'clsx'
import { useState, type KeyboardEvent } from 'react'
import type { ChallengeRendererProps } from '@/lib/challenge-registry'
import {
  AudioButton,
  ChallengeFrame,
  gradedState,
  idsForValues,
  playMedia,
  styles,
  tilesValue,
} from './shared'

type Props = ChallengeRendererProps<ChallengeOf<'build_word'>>

/**
 * Assemble letter tiles into a word and watch them join: the placed letters are rendered as ONE
 * text run (never one element per letter), so the browser shapes them into the connected word.
 * Tapping a placed tile in the bank takes it back out; Backspace or "Remove last letter" undoes.
 */
export function BuildWord(props: Props) {
  const { challenge, display, audio, phase, response, onResponse } = props
  const { target, tiles } = challenge
  const locked = phase !== 'answering'
  const [placed, setPlaced] = useState<number[]>(() =>
    idsForValues(tiles, tilesValue(response)).map((id) => Number(id.slice(1))),
  )
  const word = placed.map((i) => tiles[i]).join('')
  const graded = gradedState(phase, props.verdict)

  const update = (next: number[]) => {
    if (locked) return
    setPlaced(next)
    onResponse(next.length > 0 ? { kind: 'tiles', value: next.map((i) => tiles[i]!) } : null)
  }
  const toggle = (i: number) =>
    update(placed.includes(i) ? placed.filter((p) => p !== i) : [...placed, i])
  const undo = () => update(placed.slice(0, -1))
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Backspace' && placed.length > 0 && !locked) {
      e.preventDefault()
      undo()
    }
  }

  return (
    <ChallengeFrame
      type={challenge.type}
      display={display}
      heading={
        <>
          Build the word for “<span lang="en">{target.en}</span>”
        </>
      }
    >
      <div className={styles.target}>
        {target.audio?.normal !== undefined && (
          <AudioButton onPlay={() => playMedia(audio, target.audio)} />
        )}
        {display.transliteration && <span lang="fa-Latn">{target.translit}</span>}
      </div>
      <div onKeyDown={onKeyDown}>
        <div className={styles.assembled} data-state={graded} aria-live="polite">
          {word.length > 0 ? (
            <span className={styles.assembledWord} lang="fa" dir="rtl" data-testid="assembled-word">
              {word}
            </span>
          ) : (
            <span className={styles.assembledEmpty}>Tap the letters in order</span>
          )}
        </div>
        <div role="group" aria-label="Letters" className={styles.letterBank} dir="rtl">
          {tiles.map((letter, i) => (
            <button
              key={i}
              type="button"
              className={clsx('card-3d zb-tile', styles.letterTile)}
              lang="fa"
              dir="rtl"
              aria-pressed={placed.includes(i)}
              aria-disabled={locked || undefined}
              onClick={() => {
                if (!locked) toggle(i)
              }}
            >
              {letter}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.buildActions}>
        <Button3D
          variant={placed.length > 0 && !locked ? 'ghost' : 'locked'}
          onClick={undo}
          aria-label="Remove last letter"
        >
          Undo
        </Button3D>
      </div>
    </ChallengeFrame>
  )
}
