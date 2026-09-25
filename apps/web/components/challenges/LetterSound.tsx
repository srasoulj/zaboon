'use client'
import type { ChallengeOf } from '@zaboon/contracts'
import { FaText } from '@zaboon/ui'
import type { ChallengeRendererProps } from '@/lib/challenge-registry'
import { ChoiceList } from './ChoiceList'
import {
  AudioButton,
  ChallengeFrame,
  Labelled,
  ListenButtons,
  styles,
  useAutoplay,
  useChoice,
} from './shared'

type Props = ChallengeRendererProps<ChallengeOf<'letter_sound'>>

/**
 * letter_to_sound: "What sound does this letter make?" (the letter, sound choices).
 * sound_to_letter: "Which letter makes this sound?" (speaker + turtle, letter choices).
 */
export function LetterSound(props: Props) {
  const { challenge, display, audio, phase } = props
  const { letter } = challenge
  const choice = useChoice(props, challenge.choices.length, challenge.answer)
  const toSound = challenge.mode === 'letter_to_sound'
  const media = letter.audio === undefined ? undefined : { normal: letter.audio }
  useAutoplay(audio, letter.audio, !toSound && display.sound && phase === 'answering')
  return (
    <ChallengeFrame
      type={challenge.type}
      display={display}
      heading={toSound ? 'What sound does this letter make?' : 'Which letter makes this sound?'}
    >
      {toSound ? (
        <div className={styles.readWord}>
          <Labelled label="Letter">
            <FaText as="p" text={letter.letter} className={styles.bigLetter} />
          </Labelled>
          {/* Hearing the letter is the answer, so its audio is offered after CHECK only. */}
          {media && phase === 'feedback' && (
            <AudioButton onPlay={() => audio.play(media.normal)} label="Play the letter" />
          )}
        </div>
      ) : (
        <ListenButtons audio={audio} media={media} />
      )}
      <ChoiceList
        control={choice}
        options={challenge.choices.map((c) =>
          toSound ? (
            <span key={c} lang="fa-Latn" className={styles.choiceLatin}>
              {c}
            </span>
          ) : (
            <FaText key={c} text={c} size="xl" />
          ),
        )}
      />
    </ChallengeFrame>
  )
}
