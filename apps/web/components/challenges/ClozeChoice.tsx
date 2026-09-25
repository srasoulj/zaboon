'use client'
import type { ChallengeOf } from '@zaboon/contracts'
import { FaText } from '@zaboon/ui'
import clsx from 'clsx'
import type { ChallengeRendererProps } from '@/lib/challenge-registry'
import { ChoiceList } from './ChoiceList'
import { ChallengeFrame, Labelled, styles, useChoice } from './shared'

type Props = ChallengeRendererProps<ChallengeOf<'cloze_choice'>>

/**
 * Fill the blank: the Persian sentence with a gap (the gap is its own element BETWEEN whole
 * words, so no word is ever split), the English translation, and whole-word choices.
 */
export function ClozeChoice(props: Props) {
  const { challenge, display } = props
  const choice = useChoice(props, challenge.choices.length, challenge.answer)
  const filled = choice.selected === null ? null : challenge.choices[choice.selected]
  const translit = display.transliteration
  return (
    <ChallengeFrame type={challenge.type} display={display} heading="Fill in the blank">
      <div>
        <Labelled label="Sentence">
          <div className={styles.cloze} lang="fa" dir="rtl">
            {challenge.before.length > 0 && (
              <FaText
                tokens={challenge.before}
                translit={translit}
                vowels={display.vowelMarks}
                size="lg"
              />
            )}
            <span
              className={clsx(styles.blank, filled != null && styles.blankFilled)}
              data-testid="cloze-blank"
            >
              {filled ?? (
                <span className={styles.srOnly} lang="en">
                  blank
                </span>
              )}
            </span>
            {challenge.after.length > 0 && (
              <FaText
                tokens={challenge.after}
                translit={translit}
                vowels={display.vowelMarks}
                size="lg"
              />
            )}
          </div>
        </Labelled>
        <p className={styles.clozeTranslation} lang="en">
          {challenge.translation}
        </p>
      </div>
      <ChoiceList
        control={choice}
        options={challenge.choices.map((c) => (
          <FaText key={c} text={c} vowels={display.vowelMarks} />
        ))}
      />
    </ChallengeFrame>
  )
}
