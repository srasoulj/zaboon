/** gradeResponse on the fixture course: every MVP type, mismatched response kinds and skips. */
import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_CONFIG as cfg } from '@zaboon/contracts'
import type { Challenge, ChallengeOf, ChallengeResponse } from '@zaboon/contracts'
import { acceptedTokenKeys, wordKey } from './content'
import {
  TRACE_MIN_COVERAGE,
  TRACE_MIN_PRECISION,
  buildChallenge,
  encodeVariant,
  generateSession,
  gradeResponse,
} from './index'
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
  { kind: 'trace', coverage: 1, precision: 1 },
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

  describe('typed Persian (P2)', () => {
    const build = <T extends Challenge['type']>(ref: Parameters<typeof buildChallenge>[0]) =>
      buildChallenge(ref, 0, fx) as ChallengeOf<T>
    const enFa = build<'translate_type'>({
      type: 'translate_type',
      items: ['s_u01_0007'],
      direction: 'en_fa',
    })
    const listen = build<'listen_type'>({ type: 'listen_type', items: ['lx_ab'] })
    const cloze = build<'cloze_type'>({
      type: 'cloze_type',
      items: ['s_u01_0007'],
      variant: encodeVariant({ option: 2 }),
    })
    const text = (value: string) => ({ kind: 'text', value }) as const

    it('translate_type en→fa: exact, pronoun drop, register and ZWNJ-free spellings pass', () => {
      for (const v of ['من سیب می‌خوام', 'سیب می‌خوام', 'من سیب می‌خواهم', 'سیب میخوام'])
        expect(gradeResponse(enFa, text(v)).verdict, v).toBe('correct')
      expect(gradeResponse(enFa, text('من نون می‌خوام')).verdict).toBe('wrong')
      expect(gradeResponse(enFa, { kind: 'tiles', value: ['سیب', 'می‌خوام'] }).verdict).toBe(
        'wrong',
      )
    })

    it('a same-sound letter is a spelling verdict, unless it lands on a course word', () => {
      const r = gradeResponse(enFa, text('من ثیب می‌خوام'))
      expect(r.verdict).toBe('spelling')
      expect(r.diff?.some((d) => d.status === 'spelling')).toBe(true)
      expect(gradeResponse(cloze, text('ثیب')).verdict).toBe('spelling')
      expect(gradeResponse(cloze, text('ثیب'), { lexicon: ['ثیب'] }).verdict).toBe('wrong')
    })

    it('a missing madda is a typo; another word is wrong; negation is never a typo', () => {
      expect(gradeResponse(listen, text('آب')).verdict).toBe('correct')
      expect(gradeResponse(listen, text('اب')).verdict).toBe('typo')
      expect(gradeResponse(listen, text('نون')).verdict).toBe('wrong')
      expect(gradeResponse(enFa, text('من سیب نمی‌خوام')).verdict).toBe('wrong')
    })

    it('cloze_type grades the blank only, and never throws on odd input', () => {
      expect(gradeResponse(cloze, text('سیب')).verdict).toBe('correct')
      expect(gradeResponse(cloze, text(' سیب ')).verdict).toBe('correct')
      expect(gradeResponse(cloze, text('من سیب می‌خوام')).verdict).toBe('wrong')
      expect(gradeResponse(cloze, text('')).verdict).toBe('wrong')
      expect(gradeResponse(cloze, { kind: 'choice', value: 0 }).verdict).toBe('wrong')
    })
  })

  describe('letter_trace (P2)', () => {
    const trace = buildChallenge({ type: 'letter_trace', items: ['l_be'] }, 0, fx)
    const t = (coverage: number, precision: number, declined?: true) =>
      ({ kind: 'trace', coverage, precision, ...(declined ? { declined } : {}) }) as const

    it('exports sane thresholds', () => {
      expect(TRACE_MIN_COVERAGE).toBeGreaterThan(0.5)
      expect(TRACE_MIN_COVERAGE).toBeLessThan(1)
      expect(TRACE_MIN_PRECISION).toBeGreaterThan(0.5)
      expect(TRACE_MIN_PRECISION).toBeLessThan(1)
    })

    it('passes when both scores reach their thresholds', () => {
      expect(gradeResponse(trace, t(1, 1))).toEqual({ verdict: 'correct' })
      expect(gradeResponse(trace, t(TRACE_MIN_COVERAGE, TRACE_MIN_PRECISION)).verdict).toBe(
        'correct',
      )
      expect(gradeResponse(trace, t(TRACE_MIN_COVERAGE - 0.01, 1)).verdict).toBe('wrong')
      expect(gradeResponse(trace, t(1, TRACE_MIN_PRECISION - 0.01)).verdict).toBe('wrong')
      expect(gradeResponse(trace, t(0, 0)).verdict).toBe('wrong')
    })

    it('"Can\'t trace now" (declined) grades correct: no heart, no re-queue', () => {
      expect(gradeResponse(trace, t(0, 0, true))).toEqual({ verdict: 'correct' })
    })

    it('any other response kind is wrong (skip is skipped); a trace fits no other type', () => {
      for (const r of RESPONSES.filter((x) => x.kind !== 'trace'))
        expect(gradeResponse(trace, r).verdict).toBe('wrong')
      expect(gradeResponse(trace, { kind: 'skip' }).verdict).toBe('skipped')
      for (const c of all) expect(gradeResponse(c, t(1, 1, true)).verdict).toBe('wrong')
    })
  })
})
