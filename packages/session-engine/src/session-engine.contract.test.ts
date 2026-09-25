import { describe, expect, it } from 'vitest'
import { Challenge, DEFAULT_APP_CONFIG } from '@zaboon/contracts'
import type { CompiledSentence, Lexeme } from '@zaboon/content-schema'
import { compile } from '@zaboon/grader'
import { generateSession, rebuildChallenges, seededRandom, type ContentView } from './index'

const prov = { author: 'test' }
const lx = (id: string, fa: string, en: string): Lexeme => ({
  id, fa, translit: id, pos: 'noun', glosses: [en], introducedIn: 'u01-test', status: 'approved', provenance: prov,
})
const sent = (id: string, fa: string, en: string): CompiledSentence => ({
  id, fa, translit: id, tokens: [{ surface: fa, translit: id }], en, unit: 'u01-test', status: 'approved', provenance: prov,
  graphs: { en: compile([en], { lang: 'en' }), fa: compile([fa], { lang: 'fa' }) },
})

const content: ContentView = {
  manifest: {} as ContentView['manifest'],
  unit: {
    schema: 1,
    unit: {
      id: 'u01-test', title: 'T', register: 'colloquial', color: 'firouzeh', characters: [], status: 'approved', provenance: prov,
      levels: [{
        id: 'u01-l1', kind: 'lesson', lessons: 1,
        spec: {
          focus: { lexemes: [], sentences: [], letters: [], chats: [] }, mix: 'standard', pinnedOnly: true,
          pinned: [
            { type: 'select_translation', items: ['s_a'] },
            { type: 'translate_bank', items: ['s_a'], direction: 'fa_en' },
            { type: 'translate_bank', items: ['s_b'], direction: 'en_fa' },
            { type: 'translate_type', items: ['s_c'], direction: 'fa_en' },
            { type: 'match_pairs', items: ['lx_a', 'lx_b', 'lx_c'] },
          ],
        },
      }],
    },
    lexemes: [], sentences: [], chats: [],
  },
  letters: { schema: 1, track: { letters: [], lessons: [] } as never, lexemes: [] },
  characters: { schema: 1, characters: [] },
  knownLexemes: [lx('lx_a', 'آب', 'water'), lx('lx_b', 'نون', 'bread'), lx('lx_c', 'چای', 'tea')],
  knownSentences: [sent('s_a', 'سلام', 'hello'), sent('s_b', 'آب', 'water'), sent('s_c', 'چای', 'tea')],
  mediaUrl: (r) => `/media/${r}`,
}

const input = {
  content, kind: 'lesson' as const, levelId: 'u01-l1', lessonIndex: 0, seed: 'seed-1', now: new Date('2026-09-25T00:00:00Z'),
  config: DEFAULT_APP_CONFIG, learner: { lexemeCards: {}, letterCards: {}, mistakes: [], exposures: {} },
}

describe('@zaboon/session-engine contract', () => {
  it('produces schema-valid challenges with matching refs', () => {
    const s = generateSession(input)
    expect(s.challenges).toHaveLength(s.refs.length)
    s.challenges.forEach((c, i) => {
      expect(() => Challenge.parse(c)).not.toThrow()
      expect(c.index).toBe(i)
    })
  })
  it('is deterministic for the same seed and rebuildable from refs', () => {
    const a = generateSession(input)
    const b = generateSession(input)
    expect(b.challenges).toEqual(a.challenges)
    expect(rebuildChallenges(a.refs, content)).toEqual(a.challenges)
  })
  it('seededRandom is deterministic', () => {
    const r1 = seededRandom('x')
    const r2 = seededRandom('x')
    expect([r1(), r1()]).toEqual([r2(), r2()])
  })
})
