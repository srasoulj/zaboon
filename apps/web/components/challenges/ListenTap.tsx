'use client'
import type { ChallengeOf } from '@zaboon/contracts'
import type { ChallengeRendererProps } from '@/lib/challenge-registry'
import { WordBank } from './WordBank'
import { ChallengeFrame, FaInline, ListenButtons, useAutoplay } from './shared'

type Props = ChallengeRendererProps<ChallengeOf<'listen_tap'>>

/** Tap the words you hear: big speaker + turtle (0.7×), Persian tiles; transcript after CHECK. */
export function ListenTap(props: Props) {
  const { challenge, display, audio, phase } = props
  useAutoplay(audio, challenge.audio.normal, display.sound && phase === 'answering')
  return (
    <ChallengeFrame type={challenge.type} display={display} heading="Tap what you hear">
      <ListenButtons audio={audio} media={challenge.audio} />
      {phase === 'feedback' && (
        <div role="group" aria-label="Transcript">
          <FaInline dto={challenge.transcript} display={display} size="lg" />
        </div>
      )}
      <WordBank {...props} words={challenge.bank} lang="fa" />
    </ChallengeFrame>
  )
}
