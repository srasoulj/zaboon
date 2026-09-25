'use client'
import type { ChallengeOf } from '@zaboon/contracts'
import { Character, CHARACTER_NAMES, SpeechBubble, type CharacterName } from '@zaboon/ui'
import { useEffect, useState } from 'react'
import type { ChallengeAudio, ChallengeRendererProps } from '@/lib/challenge-registry'
import { ChoiceList } from './ChoiceList'
import {
  ChallengeFrame,
  FaInline,
  FaPrompt,
  gradedState,
  styles,
  useAutoplay,
  useChoice,
  useReducedMotion,
} from './shared'

type Props = ChallengeRendererProps<ChallengeOf<'complete_chat'>>

function characterFor(id: string): CharacterName {
  return (CHARACTER_NAMES as readonly string[]).includes(id) ? (id as CharacterName) : 'hodhod'
}

/** Polls the player's lip-sync envelope each frame (static mouth under reduced motion). */
function useMouth(audio: ChallengeAudio, enabled: boolean): number {
  const [mouth, setMouth] = useState(0)
  useEffect(() => {
    if (!enabled || typeof requestAnimationFrame !== 'function') return
    let frame = 0
    let last = 0
    const tick = () => {
      const next = Math.round(audio.mouthOpen() * 10) / 10
      if (next !== last) {
        last = next
        setMouth(next)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [audio, enabled])
  return enabled ? mouth : 0
}

/** Pick the best reply to a character: the speaker + speech bubble, then reply cards. */
export function CompleteChat(props: Props) {
  const { challenge, display, audio, phase } = props
  const choice = useChoice(props, challenge.choices.length, challenge.answer)
  const reduced = useReducedMotion(display)
  const mouth = useMouth(audio, !reduced)
  useAutoplay(audio, challenge.prompt.audio?.normal, display.sound && phase === 'answering')
  const name = characterFor(challenge.speaker.id)
  const graded = gradedState(phase, props.verdict)
  const mood = graded === 'correct' ? 'happy' : graded === 'wrong' ? 'sad' : 'idle'
  return (
    <ChallengeFrame type={challenge.type} display={display} heading="Complete the chat">
      <div className={styles.speaker}>
        <Character
          name={name}
          mood={mood}
          mouthOpen={mouth}
          size={112}
          label={challenge.speaker.name}
        />
        <SpeechBubble tail="start">
          <FaPrompt
            dto={challenge.prompt}
            display={display}
            audio={audio}
            size="md"
            label={`${challenge.speaker.name} says`}
          />
        </SpeechBubble>
      </div>
      <ChoiceList
        label="Replies"
        control={choice}
        options={challenge.choices.map((c, i) => (
          <FaInline key={i} dto={c} display={display} />
        ))}
      />
    </ChallengeFrame>
  )
}
