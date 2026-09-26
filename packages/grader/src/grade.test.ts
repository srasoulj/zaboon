import { describe, expect, it } from 'vitest'
import type { AnswerGraph } from '@zaboon/content-schema'
import {
  classifyToken,
  compile,
  editDistance,
  englishKeyTokens,
  englishNumberValue,
  grade,
  GRADER_VERSION,
  MAX_CELLS,
} from './index'

const Z = '‌'
const fa = (accept: string[], opts: Partial<Parameters<typeof compile>[1]> = {}) =>
  compile(accept, { lang: 'fa', ...opts })
const en = (accept: string[]) => compile(accept, { lang: 'en' })
const typed = { lang: 'fa', mode: 'typed' } as const
const typedEn = { lang: 'en', mode: 'typed' } as const

describe('grade: closest solution and diff', () => {
  it('marks whole words ok / typo / spelling / wrong / missing / extra', () => {
    const g = en(['I want some water please'])
    const r = grade(g, 'I wamt sume milk extra', typedEn)
    expect(r.verdict).toBe('wrong')
    expect(r.diff).toEqual([
      { text: 'I', status: 'ok' },
      { text: 'want', status: 'typo' },
      { text: 'some', status: 'typo' },
      { text: 'water', status: 'wrong' },
      { text: 'please', status: 'wrong' },
    ])
    const missing = grade(g, 'I want water please', typedEn)
    expect(missing.diff.find((d) => d.text === 'some')?.status).toBe('missing')
    const extra = grade(g, 'I want some cold water please', typedEn)
    expect(extra.diff).toContainEqual({ text: 'cold', status: 'extra' })
  })

  it('reports spelling per word', () => {
    const r = grade(fa(['سلام، حالت چطوره؟']), 'صلام حالت چطوره', typed)
    expect(r.verdict).toBe('spelling')
    expect(r.diff.map((d) => d.status)).toEqual(['spelling', 'ok', 'ok'])
    expect(r.closestSolution).toBe('سلام، حالت چطوره؟')
  })

  it('renders the closest solution in the register the learner used', () => {
    const g = fa([`من کتابا رو می${Z}خوام`], { formal: `من کتاب${Z}ها را می${Z}خواهم` })
    // Wrong last word: the tie between registers is broken by the learner's formal کتاب‌ها and را.
    expect(grade(g, 'من کتاب‌ها را نان', typed).closestSolution).toBe(
      `من کتاب${Z}ها را می${Z}خواهم`,
    )
    expect(grade(g, 'من کتابا رو نان', typed).closestSolution).toBe(`من کتابا رو می${Z}خوام`)
  })

  it('bank mode is exact membership and shows leniency as wrong', () => {
    const g = fa(['سلام'])
    const r = grade(g, ['صلام'], { lang: 'fa', mode: 'bank' })
    expect(r.verdict).toBe('wrong')
    expect(r.diff).toEqual([{ text: 'سلام', status: 'wrong' }])
    expect(grade(g, ['صلام'], { lang: 'fa', mode: 'bank', lexicon: [] }).graderVersion).toBe(
      GRADER_VERSION,
    )
  })

  it('grades an empty answer wrong with the canonical solution', () => {
    const r = grade(fa(['سلام']), '   ', typed)
    expect(r).toMatchObject({
      verdict: 'wrong',
      closestSolution: 'سلام',
      diff: [{ text: 'سلام', status: 'missing' }],
    })
  })
})

describe('grade: Persian rules', () => {
  it('never treats negation as a typo, with or without a space or ZWNJ', () => {
    const g = fa(['من نمی‌دونم'])
    for (const a of ['من میدونم', 'من می دونم', 'من می‌دونم'])
      expect(grade(g, a, typed).verdict, a).toBe('wrong')
    expect(grade(fa(['ندارم']), 'دارم', typed).verdict).toBe('wrong')
    // A genuine first-letter typo on a word starting with ن is still a typo.
    expect(grade(fa(['نارنجی']), 'مارنجی', typed).verdict).toBe('typo')
  })

  it('accepts digits for number words and number words for digits', () => {
    expect(grade(fa(['سه تا چای']), '۳ تا چای', typed).verdict).toBe('correct')
    expect(grade(fa(['۳ تا چای']), 'سه تا چای', typed).verdict).toBe('correct')
    expect(grade(fa(['ثه تا']), 'سه تا', typed).verdict).toBe('spelling')
  })

  it('treats several same-sound swaps in one word as spelling (decision)', () => {
    expect(grade(fa(['حیاط']), 'هیات', typed).verdict).toBe('spelling')
  })

  it('allows a same-sound swap plus one edit as a typo on 4+ letter words', () => {
    expect(grade(fa(['خداحافظ']), 'خداهافضز', typed).verdict).toBe('typo')
  })

  it('counts an adjacent transposition as one edit (decision)', () => {
    expect(grade(fa(['ممنون']), 'ممنوون', typed).verdict).toBe('typo')
    expect(grade(en(['water']), 'wtaer', typedEn).verdict).toBe('typo')
  })

  it('uses the expected token to set the typo limit (decision)', () => {
    // 3-letter expected token: no typo even though the answer has 4 letters.
    expect(grade(en(['tea']), 'teas', typedEn).verdict).toBe('wrong')
    expect(grade(en(['teas']), 'tea', typedEn).verdict).toBe('typo')
  })

  it('folds an ezāfe ی typed with a space (decision)', () => {
    expect(grade(fa([`خونه${Z}ی من`]), 'خونه ی من', typed).verdict).toBe('correct')
  })
})

describe('grade: English rules', () => {
  it('expands contractions and maps UK spellings', () => {
    expect(
      englishKeyTokens(
        "I’d say it's what’s-up? They're here, we've gone, she'll go, isn't it, won't",
      ),
    ).toEqual([
      'i',
      'would',
      'say',
      'it',
      'is',
      'what’s-up'.replace('’', "'"),
      'they',
      'are',
      'here',
      'we',
      'have',
      'gone',
      'she',
      'will',
      'go',
      'is',
      'not',
      'it',
      'will',
      'not',
    ])
    expect(englishKeyTokens('My favourite colours')).toEqual(['my', 'favorite', 'colors'])
    expect(englishKeyTokens("Sara's book")).toEqual(["sara's", 'book'])
    expect(englishKeyTokens('"Hello" - (world)…')).toEqual(['hello', 'world'])
  })

  it('compares number words and digits, keeping typos inside number words', () => {
    expect(englishNumberValue('twenty-one')).toBe(21)
    expect(englishNumberValue('seven')).toBe(7)
    expect(englishNumberValue('07')).toBe(7)
    expect(englishNumberValue('sevens')).toBeNull()
    expect(grade(en(['I have twenty-one books']), 'I have 21 books', typedEn).verdict).toBe(
      'correct',
    )
    expect(grade(en(['I am seventeen']), 'I am seventen', typedEn).verdict).toBe('typo')
  })
})

describe('classifyToken and editDistance', () => {
  it('classifies Persian tokens', () => {
    const none = new Set<string>()
    expect(classifyToken('صد', 'سد', 'fa', none)).toBe('spelling')
    expect(classifyToken('صد', 'سد', 'fa', new Set(['صد']))).toBe('wrong')
    expect(classifyToken('اب', 'آب', 'fa', none)).toBe('typo')
    expect(classifyToken('شه', 'سه', 'fa', none)).toBe('wrong')
  })

  it('computes OSA distances with an early exit', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3)
    expect(editDistance('ab', 'ba')).toBe(1)
    expect(editDistance('abcdef', 'a', 2)).toBe(3)
    expect(editDistance('', 'abc')).toBe(3)
  })
})

describe('grade: guards', () => {
  it('rejects a cyclic graph', () => {
    const g: AnswerGraph = {
      v: 1,
      start: 0,
      accept: [2],
      edges: [
        { from: 0, to: 1, t: 'a' },
        { from: 1, to: 0, t: 'b' },
        { from: 1, to: 2, t: 'c' },
      ],
    }
    expect(() => grade(g, 'a c', typedEn)).toThrow(/cycle/)
  })

  it('falls back to exact membership on a huge graph', () => {
    const words = 60_000
    const edges = Array.from({ length: words }, (_, i) => ({ from: i, to: i + 1, t: `w${i}` }))
    edges.push({ from: 0, to: words, t: 'short' })
    const g: AnswerGraph = { v: 1, start: 0, accept: [words], edges }
    const answer = Array.from({ length: Math.ceil(MAX_CELLS / words) + 1 }, () => 'x').join(' ')
    const r = grade(g, answer, typedEn)
    expect(r.verdict).toBe('wrong')
    expect(r.closestSolution.startsWith('w0 w1')).toBe(true)
    expect(grade(g, 'short', typedEn).verdict).toBe('correct')
  })
})
