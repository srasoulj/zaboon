'use client'
import type { ChallengeOf } from '@zaboon/contracts'
import { Character, CHARACTER_NAMES, SpeechBubble, type CharacterName } from '@zaboon/ui'
import { useEffect, useMemo, useState } from 'react'
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

/** Frames of a closed mouth after which a clip is considered over (≈0.75s; 2s before it starts). */
const QUIET_AFTER_SPEECH = 45
const QUIET_BEFORE_SPEECH = 120

/**
 * Lip-sync: wraps the audio service so every `play()` starts a requestAnimationFrame loop that
 * reads the player's envelope (`mouthOpen()`), and stops it once the mouth has stayed closed for
 * a while. Nothing polls while no clip is playing, and nothing runs under reduced motion.
 */
function useLipSync(
  audio: ChallengeAudio,
  enabled: boolean,
): { audio: ChallengeAudio; mouth: number } {
  const [mouth, setMouth] = useState(0)
  const [plays, setPlays] = useState(0)
  const wrapped = useMemo<ChallengeAudio>(
    () => ({
      play: (url, opts) => {
        if (opts) audio.play(url, opts)
        else audio.play(url)
        setPlays((n) => n + 1)
      },
      stop: () => {
        audio.stop()
        setPlays(0)
      },
      mouthOpen: () => audio.mouthOpen(),
    }),
    [audio],
  )
  useEffect(() => {
    if (!enabled || plays === 0 || typeof requestAnimationFrame !== 'function') return
    let frame = 0
    let last = -1
    let quiet = 0
    let spoke = false
    const tick = () => {
      const next = Math.round(audio.mouthOpen() * 10) / 10
      if (next !== last) {
        last = next
        setMouth(next)
      }
      if (next > 0) {
        spoke = true
        quiet = 0
      } else quiet += 1
      if (quiet >= (spoke ? QUIET_AFTER_SPEECH : QUIET_BEFORE_SPEECH)) return
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [audio, enabled, plays])
  return { audio: wrapped, mouth: enabled ? mouth : 0 }
}

/** Pick the best reply to a character: the speaker + speech bubble, then reply cards. */
export function CompleteChat(props: Props) {
  const { challenge, display, phase } = props
  const choice = useChoice(props, challenge.choices.length, challenge.answer)
  const reduced = useReducedMotion(display)
  const lip = useLipSync(props.audio, !reduced)
  const audio = lip.audio
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
          mouthOpen={lip.mouth}
          size={112}
          image={challenge.speaker.image}
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
