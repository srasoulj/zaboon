'use client'
import type { ChallengeOf, LetterInfo } from '@zaboon/contracts'
import { FaText } from '@zaboon/ui'
import { useEffect, useRef } from 'react'
import type { ChallengeRendererProps } from '@/lib/challenge-registry'
import { AudioButton, ChallengeFrame, FaInline, playMedia, styles } from './shared'

type Props = ChallengeRendererProps<ChallengeOf<'letter_intro'>>

const ZWJ = '‍'

export type FormPosition = 'isolated' | 'initial' | 'medial' | 'final'

/**
 * A contextual form as ONE string that really joins (LEARNING-ENGINE §1.3): initial = X+ZWJ,
 * medial = ZWJ+X+ZWJ, final = ZWJ+X (a non-joining letter only connects on its right). Content
 * forms already carry the ZWJs; this only adds them when missing.
 */
export function joinedForm(form: string, position: FormPosition, connects: boolean): string {
  if (position === 'isolated' || form.includes(ZWJ)) return form
  if (position === 'initial') return connects ? `${form}${ZWJ}` : form
  if (position === 'medial') return connects ? `${ZWJ}${form}${ZWJ}` : `${ZWJ}${form}`
  return `${ZWJ}${form}`
}

const POSITIONS: readonly FormPosition[] = ['isolated', 'initial', 'medial', 'final']
const POSITION_LABEL: Record<FormPosition, string> = {
  isolated: 'Alone',
  initial: 'Start',
  medial: 'Middle',
  final: 'End',
}

function LetterCard({ letter, onPlay }: { letter: LetterInfo; onPlay: (() => void) | null }) {
  return (
    <div className={styles.letterCard}>
      <FaText
        as="p"
        text={letter.letter}
        className={styles.bigLetter}
        aria-label={`The letter ${letter.name}`}
      />
      <p className={styles.letterName}>
        <span lang="fa-Latn">{letter.name}</span>
      </p>
      <p className={styles.letterSound}>
        Sounds like <span lang="fa-Latn">“{letter.translit}”</span>{' '}
        <span aria-hidden="true">/{letter.ipa}/</span>
      </p>
      {onPlay && <AudioButton onPlay={onPlay} label={`Play the letter ${letter.name}`} />}
      <div role="group" aria-label="Forms" className={styles.formsGroup}>
        <dl className={styles.forms}>
          {POSITIONS.map((p) => (
            <div key={p} className={styles.form}>
              <dt>{POSITION_LABEL[p]}</dt>
              <dd lang="fa" dir="rtl" data-form={p}>
                {joinedForm(letter.forms[p], p, letter.connects)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

/** Meet a letter: name, sound, its four joined forms and example words. Nothing to answer. */
export function LetterIntro(props: Props) {
  const { challenge, display, audio, response, onResponse } = props
  const { letter } = challenge
  // Nothing to answer: report the draft once on mount (CHECK is enabled right away).
  const reported = useRef(response?.kind === 'none')
  useEffect(() => {
    if (reported.current) return
    reported.current = true
    onResponse({ kind: 'none' })
  }, [onResponse])
  return (
    <ChallengeFrame type={challenge.type} display={display} heading="New letter">
      <LetterCard
        letter={letter}
        onPlay={letter.audio === undefined ? null : () => audio.play(letter.audio!)}
      />
      {challenge.examples.length > 0 && (
        <ul className={styles.examples} aria-label="Example words">
          {challenge.examples.map((ex) => (
            <li key={ex.fa} className={styles.example}>
              {ex.audio?.normal !== undefined && (
                <AudioButton
                  onPlay={() => playMedia(audio, ex.audio)}
                  label={`Play ${ex.translit}`}
                />
              )}
              <FaInline dto={ex} display={display} size="lg" />
              <span className={styles.exampleMeaning} lang="en">
                {ex.en}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ChallengeFrame>
  )
}
