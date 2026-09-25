'use client'
import type { ChallengeOf } from '@zaboon/contracts'
import type { ChallengeRendererProps } from '@/lib/challenge-registry'
import { ChoiceList } from './ChoiceList'
import { ChallengeFrame, FaPrompt, styles, useAutoplay, useChoice } from './shared'

type Props = ChallengeRendererProps<ChallengeOf<'select_image'>>

/** Pick the picture for a Persian word: a 2×2 grid of image cards with number hints. */
export function SelectImage(props: Props) {
  const { challenge, display, audio } = props
  const choice = useChoice(props, challenge.choices.length, challenge.answer)
  useAutoplay(audio, challenge.prompt.audio?.normal, display.sound && props.phase === 'answering')
  return (
    <ChallengeFrame type={challenge.type} display={display} heading="Select the correct image">
      <FaPrompt dto={challenge.prompt} display={display} audio={audio} size="xl" label="Word" />
      <ChoiceList
        control={choice}
        options={challenge.choices.map((c) => (
          <span key={c.lexeme} lang="en">
            {c.label}
          </span>
        ))}
        media={challenge.choices.map((c) => (
          // The label names the card; the picture is decorative for screen readers. crossOrigin asks
          // for a CORS response (not an opaque one) so the service worker can cache it offline.
          // eslint-disable-next-line @next/next/no-img-element -- content SVGs, sized by CSS
          <img
            key={c.lexeme}
            className={styles.image}
            src={c.image}
            alt=""
            crossOrigin="anonymous"
            draggable={false}
          />
        ))}
      />
    </ChallengeFrame>
  )
}
