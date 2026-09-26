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

  it('has a renderer for every Wave 3 type (listen_type, cloze_type, letter_trace)', () => {
    const wave3: P2ChallengeType[] = ['listen_type', 'cloze_type', 'letter_trace']
    for (const t of wave3) expect(rendererFor(t), t).not.toBeNull()
  })

  it('keeps the P2 slots (Waves 3 and 4) optional and closed to other types', () => {
    const {
      listen_type: _l,
      cloze_type: _c,
      letter_trace: _t,
      speak: _s,
      story: _st,
      ...mvp
    } = renderers
    const Speak: ChallengeRenderer<ChallengeOf<'speak'>> = () => null
    const map: RendererMap = { ...mvp, speak: Speak }
    expect(map.speak).toBe(Speak)
    expect(map.story).toBeUndefined()
    const p2: P2ChallengeType[] = ['listen_type', 'cloze_type', 'letter_trace', 'speak', 'story']
    expect(p2).toHaveLength(5)
    // @ts-expect-error roleplay is not a renderer slot
    const notP2: RendererMap = { ...mvp, roleplay: Speak }
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
