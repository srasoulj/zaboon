'use client'
import type { ChallengeOf } from '@zaboon/contracts'
import type { ChallengeRendererProps } from '@/lib/challenge-registry'
import { FORM_LABEL, type FormPosition } from './LetterIntro'
import { MatchColumns, type MatchItem } from './MatchColumns'
import { ChallengeFrame, styles } from './shared'

type Props = ChallengeRendererProps<ChallengeOf<'letter_forms'>>

const ZWJ = '‍'
const POSITIONS: readonly string[] = ['isolated', 'initial', 'medial', 'final']

/** Which contextual form a ZWJ-marked string is (start/middle/end), for its accessible name. */
export function formPosition(form: string): 'start' | 'middle' | 'end' | 'alone' {
  const before = form.startsWith(ZWJ)
  const after = form.endsWith(ZWJ)
  if (before && after) return 'middle'
  if (after) return 'start'
  if (before) return 'end'
  return 'alone'
}

/**
 * Two shapes, depending on what the builder made:
 * - several letters: match each isolated letter to one of its joined forms;
 * - one letter: match each position name (Alone/Start/Middle/End, English) to its shape.
 * Every shape is ONE Persian text run, so it joins exactly as it would in a word.
 */
export function LetterForms(props: Props) {
  const { challenge, display } = props
  const { pairs } = challenge
  const byPosition = pairs.every((p) => POSITIONS.includes(p.left))
  const shape = (text: string, position?: string): MatchItem => ({
    content: (
      <>
        <span className={styles.pairForm} lang="fa" dir="rtl">
          {text}
        </span>
        {position !== undefined && <span className={styles.srOnly}>, {position} form</span>}
      </>
    ),
  })
  const positionName = (left: string): MatchItem => ({
    content: <span className={styles.choiceLatin}>{FORM_LABEL[left as FormPosition]}</span>,
  })
  return (
    <ChallengeFrame
      type={challenge.type}
      display={display}
      heading={
        byPosition ? 'Match each position to its shape' : 'Match the letter to its joined form'
      }
    >
      <MatchColumns
        {...props}
        seed={`${challenge.index}:${pairs.map((p) => p.right).join('|')}`}
        leftLabel={byPosition ? 'Positions' : 'Letters'}
        rightLabel={byPosition ? 'Shapes' : 'Joined forms'}
        leftDir={byPosition ? 'ltr' : 'rtl'}
        rightDir="rtl"
        left={pairs.map((p) => (byPosition ? positionName(p.left) : shape(p.left)))}
        // By position, naming a shape's position would give the answer away.
        right={pairs.map((p) =>
          byPosition ? shape(p.right) : shape(p.right, formPosition(p.right)),
        )}
      />
    </ChallengeFrame>
  )
}
