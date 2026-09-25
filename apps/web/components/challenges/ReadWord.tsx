'use client'
import type { ChallengeOf } from '@zaboon/contracts'
import { FaText } from '@zaboon/ui'
import type { ChallengeRendererProps } from '@/lib/challenge-registry'
import { ChoiceList } from './ChoiceList'
import { AudioButton, ChallengeFrame, playMedia, styles, useChoice } from './shared'

type Props = ChallengeRendererProps<ChallengeOf<'read_word'>>

/**
 * Read a short word and pick its transliteration or meaning. Transliteration is never shown under
 * the word here (it would give the answer away), and the audio stays behind the button.
 */
export function ReadWord(props: Props) {
  const { challenge, display, audio } = props
  const { word } = challenge
  const choice = useChoice(props, challenge.choices.length, challenge.answer)
  const translit = challenge.ask === 'translit'
  const shown = display.vowelMarks && word.faVocalized ? word.faVocalized : word.fa
  return (
    <ChallengeFrame
      type={challenge.type}
      display={display}
      heading={translit ? 'How do you read this word?' : 'What does this word mean?'}
    >
      <div className={styles.readWord}>
        <FaText
          as="p"
          text={shown}
          vowels={display.vowelMarks}
          className={styles.bigLetter}
          aria-label="Word"
        />
        {/* Hearing the word gives away its reading, so the speaker is offered after CHECK only. */}
        {props.phase === 'feedback' && word.audio?.normal !== undefined && (
          <AudioButton onPlay={() => playMedia(audio, word.audio)} />
        )}
      </div>
      <ChoiceList
        control={choice}
        options={challenge.choices.map((c) => (
          <span key={c} lang={translit ? 'fa-Latn' : 'en'} className={styles.choiceLatin}>
            {c}
          </span>
        ))}
      />
    </ChallengeFrame>
  )
}
