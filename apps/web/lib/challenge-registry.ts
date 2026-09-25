/**
 * Challenge renderer registry (orchestrator-owned). The lesson player (ws-player) renders
 * `rendererFor(challenge.type)`; ws-renderers implements one component per MVP type in
 * `components/challenges/` and exports them as `renderers` (typed by `RendererMap`).
 *
 * Division of labour: the PLAYER owns the flow (CHECK/CONTINUE footer, grading with
 * `gradeResponse`, feedback bar, hearts, re-queue, audio preloading, keyboard shortcuts for
 * CHECK/SKIP). A RENDERER owns one challenge's prompt + answer UI and reports the learner's
 * answer as a `ChallengeResponse` draft; it never grades and never talks to the API.
 *
 * Wave 3 (P2, ws-typing): renderers for `listen_type`, `cloze_type` and `letter_trace` are optional
 * entries of the map (`rendererFor` returns null for a type without one, and the player offers to
 * skip it). Typed Persian `translate_type` (direction en_fa, `answerLang: 'fa'`) has no entry of
 * its own: the `translate_type` renderer handles both answer languages. Typed Persian inputs show
 * the in-app PersianKeyboard when `display.persianKeyboard` is true, in `display.keyboardLayout`.
 */
import type { ComponentType } from 'react'
import type {
  Challenge,
  ChallengeOf,
  ChallengeResponse,
  MVP_CHALLENGE_TYPES,
  Settings,
  Verdict,
} from '@zaboon/contracts'
import { renderers } from '@/components/challenges'

export type MvpChallengeType = (typeof MVP_CHALLENGE_TYPES)[number]
/** P2 types a renderer may be registered for (Wave 3); see the header comment. */
export type P2ChallengeType = 'listen_type' | 'cloze_type' | 'letter_trace'

export interface ChallengeDisplay {
  /** Show romanization under Persian (Settings.transliteration resolved for this item). */
  transliteration: boolean
  /** Show vowel marks (faVocalized) where available. */
  vowelMarks: boolean
  /** Sound effects and auto-play audio allowed. */
  sound: boolean
  reducedMotion: boolean
  /** P2: the learner's layout for typed Persian (Settings.keyboardLayout); absent = 'standard'. */
  keyboardLayout?: Settings['keyboardLayout']
  /** P2 (flags.persianKeyboard): show the in-app PersianKeyboard for typed Persian; absent = off. */
  persianKeyboard?: boolean
}

export interface ChallengeAudio {
  /** Plays a (preloaded) media URL; `slow` picks the 0.7× turtle clip when the challenge has one. */
  play(url: string, opts?: { slow?: boolean }): void
  stop(): void
  /** 0..1 mouth openness for character lip-sync while audio plays (from the envelope JSON). */
  mouthOpen(): number
}

export interface ChallengeRendererProps<C extends Challenge = Challenge> {
  challenge: C
  /** The learner's current answer draft, or null while nothing is selected/typed. */
  response: ChallengeResponse | null
  /** Report a new draft (null clears it). CHECK is enabled while the draft is non-null. */
  onResponse(response: ChallengeResponse | null): void
  /** Ask the player to CHECK now (e.g. Enter in a text field, or all pairs matched). */
  onSubmit(): void
  /** `feedback` after CHECK: the renderer locks input and may highlight right/wrong choices. */
  phase: 'answering' | 'feedback'
  /** The graded verdict during `feedback`, else null. */
  verdict: Verdict | null
  display: ChallengeDisplay
  audio: ChallengeAudio
  /** A wrong tap in a matching challenge (match_pairs, letter_forms): the player records a heart loss. */
  onMismatch(): void
}

export type ChallengeRenderer<C extends Challenge = Challenge> = ComponentType<
  ChallengeRendererProps<C>
>

export type RendererMap = { [T in MvpChallengeType]: ChallengeRenderer<ChallengeOf<T>> } & {
  [T in P2ChallengeType]?: ChallengeRenderer<ChallengeOf<T>>
}

/** The renderer for a challenge type, or null for types without one (later phases). */
export function rendererFor<T extends Challenge['type']>(
  type: T,
): ChallengeRenderer<ChallengeOf<T>> | null {
  return (
    ((renderers as Partial<Record<Challenge['type'], unknown>>)[type] as
      ChallengeRenderer<ChallengeOf<T>> | undefined) ?? null
  )
}
