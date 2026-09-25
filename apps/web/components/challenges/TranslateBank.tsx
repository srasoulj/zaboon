'use client'
import type { ChallengeOf } from '@zaboon/contracts'
import { Character, SpeechBubble } from '@zaboon/ui'
import type { ReactNode } from 'react'
import type { ChallengeDisplay, ChallengeRendererProps } from '@/lib/challenge-registry'
import { WordBank } from './WordBank'
import { ChallengeFrame, FaPrompt, styles, useAutoplay } from './shared'

type Props = ChallengeRendererProps<ChallengeOf<'translate_bank'>>
type Prompt = ChallengeOf<'translate_bank'>['prompt']

/** The prompt of a translation challenge: the mascot with the sentence in a speech bubble. */
export function TranslationPrompt({
  prompt,
  display,
  audio,
}: {
  prompt: Prompt
  display: ChallengeDisplay
  audio: Props['audio']
}): ReactNode {
  return (
    <div className={styles.speaker}>
      <Character name="hodhod" size={96} decorative />
      <SpeechBubble tail="start">
        {prompt.fa ? (
          <FaPrompt dto={prompt.fa} display={display} audio={audio} size="md" label="Prompt" />
        ) : prompt.lang === 'fa' ? (
          <FaPrompt
            dto={{ fa: prompt.text, translit: '' }}
            display={display}
            audio={audio}
            size="md"
            label="Prompt"
          />
        ) : (
          <p className={styles.promptText} lang="en">
            {prompt.text}
          </p>
        )}
      </SpeechBubble>
    </div>
  )
}

export function translateHeading(answerLang: 'fa' | 'en'): string {
  return answerLang === 'en' ? 'Write this in English' : 'Write this in Persian'
}

/** Build the translation from whole-word tiles (fa→en or en→fa). */
export function TranslateBank(props: Props) {
  const { challenge, display, audio } = props
  useAutoplay(
    audio,
    challenge.prompt.fa?.audio?.normal,
    display.sound && props.phase === 'answering',
  )
  return (
    <ChallengeFrame
      type={challenge.type}
      display={display}
      heading={translateHeading(challenge.answerLang)}
    >
      <TranslationPrompt prompt={challenge.prompt} display={display} audio={audio} />
      <WordBank {...props} words={challenge.bank} lang={challenge.answerLang} />
    </ChallengeFrame>
  )
}
