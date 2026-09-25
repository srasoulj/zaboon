/** The renderer registry seam (orchestrator-owned): MVP types required, Wave 3 types optional. */
import { describe, expect, it } from 'vitest'
import { MVP_CHALLENGE_TYPES, type ChallengeOf } from '@zaboon/contracts'
import { renderers } from '@/components/challenges'
import {
  rendererFor,
  type ChallengeDisplay,
  type ChallengeRenderer,
  type P2ChallengeType,
  type RendererMap,
} from './challenge-registry'

describe('challenge registry', () => {
  it('has a renderer for every MVP type', () => {
    for (const t of MVP_CHALLENGE_TYPES) expect(rendererFor(t), t).not.toBeNull()
  })

  it('never has one for types outside the MVP and Wave 3 (speak, story)', () => {
    expect(rendererFor('speak')).toBeNull()
    expect(rendererFor('story')).toBeNull()
  })

  it('takes optional Wave 3 renderers (listen_type, cloze_type, letter_trace)', () => {
    const Trace: ChallengeRenderer<ChallengeOf<'letter_trace'>> = () => null
    const ListenType: ChallengeRenderer<ChallengeOf<'listen_type'>> = () => null
    const map: RendererMap = { ...renderers, letter_trace: Trace, listen_type: ListenType }
    expect(map.letter_trace).toBe(Trace)
    expect(map.cloze_type).toBeUndefined()
    const p2: P2ChallengeType[] = ['listen_type', 'cloze_type', 'letter_trace']
    expect(p2).toHaveLength(3)
    // @ts-expect-error speak is not a Wave 3 renderer slot
    const notP2: RendererMap = { ...renderers, speak: Trace }
    expect(notP2).toBeTruthy()
  })

  it('display carries the typed-Persian keyboard settings as optional fields', () => {
    const mvp: ChallengeDisplay = {
      transliteration: true,
      vowelMarks: false,
      sound: true,
      reducedMotion: false,
    }
    const typed: ChallengeDisplay = { ...mvp, keyboardLayout: 'phonetic', persianKeyboard: true }
    expect(typed.keyboardLayout).toBe('phonetic')
    expect(mvp.persianKeyboard).toBeUndefined()
  })
})
