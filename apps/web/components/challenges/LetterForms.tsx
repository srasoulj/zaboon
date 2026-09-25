'use client'
import type { ChallengeOf } from '@zaboon/contracts'
import type { ChallengeRendererProps } from '@/lib/challenge-registry'
import { MatchColumns } from './MatchColumns'
import { ChallengeFrame, styles } from './shared'

type Props = ChallengeRendererProps<ChallengeOf<'letter_forms'>>

const ZWJ = '‍'

/** Which contextual form a ZWJ-marked string is (start/middle/end), for its accessible name. */
export function formPosition(form: string): 'start' | 'middle' | 'end' | 'alone' {
  const before = form.startsWith(ZWJ)
  const after = form.endsWith(ZWJ)
  if (before && after) return 'middle'
  if (after) return 'start'
  if (before) return 'end'
  return 'alone'
}

/** Match each letter's isolated form to one of its joined forms (each shown as ONE text run). */
export function LetterForms(props: Props) {
  const { challenge, display } = props
  const { pairs } = challenge
  const item = (text: string, named: boolean) => ({
    lang: 'fa' as const,
    ...(named ? { label: `${text.replaceAll(ZWJ, '')}, ${formPosition(text)} form` } : {}),
    content: (
      <span className={styles.pairForm} lang="fa" dir="rtl">
        {text}
      </span>
    ),
  })
  return (
    <ChallengeFrame
      type={challenge.type}
      display={display}
      heading="Match the letter to its joined form"
    >
      <MatchColumns
        {...props}
        seed={`${challenge.index}:${pairs.map((p) => p.right).join('|')}`}
        leftLabel="Letters"
        rightLabel="Joined forms"
        left={pairs.map((p) => item(p.left, false))}
        right={pairs.map((p) => item(p.right, true))}
      />
    </ChallengeFrame>
  )
}
