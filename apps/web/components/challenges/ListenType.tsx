'use client'
import type { ChallengeOf } from '@zaboon/contracts'
import { useState } from 'react'
import type { ChallengeRendererProps } from '@/lib/challenge-registry'
import { PersianField } from './PersianField'
import {
  ChallengeFrame,
  FaInline,
  Labelled,
  ListenButtons,
  gradedState,
  useAutoplay,
} from './shared'

type Props = ChallengeRendererProps<ChallengeOf<'listen_type'>>

/**
 * Type what you hear (P2): the big speaker and turtle of listen_tap, then a typed Persian answer
 * (`PersianField`). The transcript is shown after CHECK (DESIGN-SYSTEM §8).
 */
export function ListenType(props: Props) {
  const { challenge, display, audio, phase, response, onResponse, onSubmit } = props
  const [text, setText] = useState(() => (response?.kind === 'text' ? response.value : ''))
  const locked = phase !== 'answering'
  useAutoplay(audio, challenge.audio.normal, display.sound && phase === 'answering')

  const change = (value: string) => {
    setText(value)
    onResponse(value.trim().length > 0 ? { kind: 'text', value } : null)
  }
  return (
    <ChallengeFrame type={challenge.type} display={display} heading="Type what you hear">
      <ListenButtons audio={audio} media={challenge.audio} />
      {phase === 'feedback' && (
        <Labelled label="Transcript">
          <FaInline dto={challenge.transcript} display={display} size="lg" />
        </Labelled>
      )}
      <PersianField
        value={text}
        onChange={change}
        onEnter={() => {
          if (text.trim().length > 0) onSubmit()
        }}
        locked={locked}
        display={display}
        label="What you hear, in Persian"
        state={gradedState(phase, props.verdict)}
      />
    </ChallengeFrame>
  )
}
