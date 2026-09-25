'use client'
import type { ChallengeOf } from '@zaboon/contracts'
import type { ChallengeRendererProps } from '@/lib/challenge-registry'
import { MatchColumns } from './MatchColumns'
import { ChallengeFrame, FaInline, playMedia } from './shared'

type Props = ChallengeRendererProps<ChallengeOf<'match_pairs'>>

/** Match Persian words to their English meanings (tapping a Persian word says it). */
export function MatchPairs(props: Props) {
  const { challenge, display, audio } = props
  const { pairs } = challenge
  return (
    <ChallengeFrame type={challenge.type} display={display} heading="Select the matching pairs">
      <MatchColumns
        {...props}
        seed={`${challenge.index}:${pairs.map((p) => p.en).join('|')}`}
        leftLabel="Persian"
        rightLabel="English"
        left={pairs.map((p) => ({
          lang: 'fa',
          content: <FaInline dto={p.fa} display={display} />,
        }))}
        right={pairs.map((p) => ({ lang: 'en', content: p.en }))}
        onTapLeft={(i) => {
          if (display.sound) playMedia(audio, pairs[i]!.fa.audio)
        }}
      />
    </ChallengeFrame>
  )
}
