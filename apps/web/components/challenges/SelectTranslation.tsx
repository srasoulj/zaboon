'use client'
import type { ChallengeOf } from '@zaboon/contracts'
import type { ChallengeRendererProps } from '@/lib/challenge-registry'
import { ChoiceList } from './ChoiceList'
import { ChallengeFrame, FaInline, FaPrompt, styles, useAutoplay, useChoice } from './shared'

type Props = ChallengeRendererProps<ChallengeOf<'select_translation'>>

/** Pick the meaning of a Persian sentence (fa→en) or the Persian for an English one (en→fa). */
export function SelectTranslation(props: Props) {
  const { challenge, display, audio } = props
  const { prompt } = challenge
  const choice = useChoice(props, challenge.choices.length, challenge.answer)
  useAutoplay(audio, prompt.fa?.audio?.normal, display.sound && props.phase === 'answering')
  return (
    <ChallengeFrame
      type={challenge.type}
      display={display}
      heading={
        challenge.direction === 'fa_en'
          ? 'Select the correct meaning'
          : 'Select the correct translation'
      }
    >
      {prompt.fa ? (
        <FaPrompt dto={prompt.fa} display={display} audio={audio} label="Prompt" />
      ) : prompt.lang === 'fa' ? (
        <FaPrompt
          dto={{ fa: prompt.text, translit: '' }}
          display={display}
          audio={audio}
          label="Prompt"
        />
      ) : (
        <p className={styles.promptText} lang="en">
          {prompt.text}
        </p>
      )}
      <ChoiceList
        control={choice}
        options={challenge.choices.map((c) =>
          c.fa ? (
            <FaInline dto={c.fa} display={display} />
          ) : c.lang === 'fa' ? (
            <FaInline dto={{ fa: c.text, translit: '' }} display={display} />
          ) : (
            <span lang="en">{c.text}</span>
          ),
        )}
      />
    </ChallengeFrame>
  )
}
