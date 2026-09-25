/** gradeResponse on the fixture course: every MVP type, mismatched response kinds and skips. */
import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_CONFIG as cfg } from '@zaboon/contracts'
import type { Challenge, ChallengeOf, ChallengeResponse } from '@zaboon/contracts'
import { acceptedTokenKeys, wordKey } from './content'
import { buildChallenge, generateSession, gradeResponse } from './index'
import { loadCourse } from './test-support/load-course'

const fx = loadCourse('fixtures').view('u01-fixture')
const learner = { lexemeCards: {}, letterCards: {}, mistakes: [], exposures: {} }
const session = (levelId: string) =>
  generateSession({
    content: fx,
    kind: 'lesson',
    levelId,
    lessonIndex: 0,
    learner,
    seed: 'g',
    now: new Date('2026-09-25T00:00:00Z'),
    config: cfg,
  })
const all = [...session('u01-l1').challenges, ...session('u01-l2').challenges]
const find = <T extends Challenge['type']>(t: T, n = 0) =>
  all.filter((c) => c.type === t)[n] as ChallengeOf<T>

const RESPONSES: ChallengeResponse[] = [
  { kind: 'choice', value: 0 },
  { kind: 'text', value: 'hello' },
  { kind: 'tiles', value: ['a', 'b'] },
  { kind: 'pairs', value: [[0, 0]] },
  { kind: 'none' },
  { kind: 'audio', transcript: 'سلام' },
]
const KIND_FOR: Record<string, ChallengeResponse['kind']> = {
  select_image: 'choice',
  select_translation: 'choice',
  cloze_choice: 'choice',
  complete_chat: 'choice',
  letter_sound: 'choice',
  read_word: 'choice',
  translate_bank: 'tiles',
  listen_tap: 'tiles',
  build_word: 'tiles',
  translate_type: 'text',
  match_pairs: 'pairs',
  letter_forms: 'pairs',
  letter_intro: 'none',
}

describe('gradeResponse', () => {
  it('covers all 13 MVP types in the fixture lessons', () => {
    expect(new Set(all.map((c) => c.type)).size).toBe(13)
  })

  it('skip is skipped for every type', () => {
    for (const c of all) expect(gradeResponse(c, { kind: 'skip' })).toEqual({ verdict: 'skipped' })
  })

  it('a response kind that does not fit the type is wrong, never a throw', () => {
    for (const c of all) {
      for (const r of RESPONSES) {
        if (r.kind === KIND_FOR[c.type]) continue
        expect(gradeResponse(c, r).verdict).toBe('wrong')
      }
    }
  })

  it('choice types: the answer index is correct, others and out-of-range are wrong', () => {
    for (const type of [
      'select_image',
      'select_translation',
      'cloze_choice',
      'complete_chat',
      'letter_sound',
      'read_word',
    ] as const) {
      const c = find(type)
      expect(gradeResponse(c, { kind: 'choice', value: c.answer }).verdict).toBe('correct')
      expect(
        gradeResponse(c, { kind: 'choice', value: (c.answer + 1) % c.choices.length }).verdict,
      ).toBe('wrong')
      expect(gradeResponse(c, { kind: 'choice', value: 99 }).verdict).toBe('wrong')
    }
  })

  it('translate_bank (both directions) and listen_tap grade tiles by DAG membership', () => {
    const fromBank = (
      c: ChallengeOf<'translate_bank'> | ChallengeOf<'listen_tap'>,
      lang: 'en' | 'fa',
      order: string[],
    ) => {
      const keys = acceptedTokenKeys(c.graph, lang)
      return order.filter((w) => c.bank.includes(w) && keys.has(wordKey(w, lang)))
    }
    const en = find('translate_bank', 0)
    expect(
      gradeResponse(en, { kind: 'tiles', value: fromBank(en, 'en', ['I', 'want', 'water']) })
        .verdict,
    ).toBe('correct')
    expect(gradeResponse(en, { kind: 'tiles', value: ['water', 'I', 'want'] }).verdict).toBe(
      'wrong',
    )
    const fa = find('translate_bank', 1)
    expect(fa.answerLang).toBe('fa')
    expect(gradeResponse(fa, { kind: 'tiles', value: ['نون', 'می‌خوام'] }).verdict).toBe('correct')
    expect(gradeResponse(fa, { kind: 'tiles', value: ['می‌خوام', 'نون'] }).verdict).toBe('wrong')
    const lt = find('listen_tap')
    const r = gradeResponse(lt, { kind: 'tiles', value: ['چای', 'می‌خوای'] })
    expect(r.verdict).toBe('correct')
    expect(r.closestSolution).toBeDefined()
    expect(gradeResponse(lt, { kind: 'tiles', value: ['چای'] }).verdict).toBe('wrong')
  })

  it('build_word compares the joined letters after normalization', () => {
    const c = find('build_word')
    expect(gradeResponse(c, { kind: 'tiles', value: ['س', 'ی', 'ب'] }).verdict).toBe('correct')
    expect(gradeResponse(c, { kind: 'tiles', value: ['س', 'ي', 'ب'] }).verdict).toBe('correct') // Arabic yeh normalizes
    expect(gradeResponse(c, { kind: 'tiles', value: ['ب', 'ی', 'س'] }).verdict).toBe('wrong')
  })

  it('translate_type grades typed text and returns closestSolution + diff', () => {
    const c = find('translate_type')
    const ok = gradeResponse(c, { kind: 'text', value: 'Mom is good' })
    expect(ok.verdict).toBe('correct')
    expect(ok.diff).toBeDefined()
    const bad = gradeResponse(c, { kind: 'text', value: 'Dad is bad' }, { lexicon: ['بد'] })
    expect(bad.verdict).toBe('wrong')
    expect(typeof bad.closestSolution).toBe('string')
  })

  it('pairs: correct iff every pair is matched exactly once to itself', () => {
    for (const c of [find('match_pairs'), find('letter_forms')]) {
      const n = c.pairs.length
      const ident = Array.from({ length: n }, (_, i) => [i, i] as [number, number])
      expect(gradeResponse(c, { kind: 'pairs', value: ident }).verdict).toBe('correct')
      expect(gradeResponse(c, { kind: 'pairs', value: [...ident].reverse() }).verdict).toBe(
        'correct',
      )
      expect(gradeResponse(c, { kind: 'pairs', value: ident.slice(1) }).verdict).toBe('wrong')
      expect(gradeResponse(c, { kind: 'pairs', value: [...ident, [0, 0]] }).verdict).toBe('wrong')
      expect(
        gradeResponse(c, { kind: 'pairs', value: [[0, 1], [1, 0], ...ident.slice(2)] }).verdict,
      ).toBe('wrong')
    }
  })

  it('letter_intro with none is correct', () => {
    expect(gradeResponse(find('letter_intro'), { kind: 'none' })).toEqual({ verdict: 'correct' })
  })

  it('later-phase types: speak grades the transcript as typed Persian', () => {
    const base = buildChallenge(
      { type: 'translate_type', items: ['s_u01_0002'], direction: 'en_fa' },
      0,
      fx,
    ) as ChallengeOf<'translate_type'>
    const speak: Challenge = {
      index: 0,
      ref: { type: 'speak', items: ['s_u01_0002'] },
      isNew: false,
      type: 'speak',
      prompt: { fa: 'من آب می‌خوام', translit: 'man āb mikhām' },
      graph: base.graph,
    }
    expect(gradeResponse(speak, { kind: 'audio', transcript: 'من آب می‌خوام' }).verdict).toBe(
      'correct',
    )
    expect(gradeResponse(speak, { kind: 'text', value: 'من آب می‌خوام' }).verdict).toBe('wrong')
    const story: Challenge = {
      index: 0,
      ref: { type: 'story', items: ['s_u01_0002'] },
      isNew: false,
      type: 'story',
      storyId: 'x',
    }
    expect(gradeResponse(story, { kind: 'none' }).verdict).toBe('wrong')
  })
})
