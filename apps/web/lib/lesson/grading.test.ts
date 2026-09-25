/** Local grading for the P2 types: the session lexicon, typed Persian verdicts, solutions. */
import { Challenge, type ChallengeOf } from '@zaboon/contracts'
import { describe, expect, it } from 'vitest'
import recorded from '@/components/challenges/fixtures/fixture-challenges.json'
import { gradeAttempt, sessionLexicon, solutionFor } from './grading'

const FIXTURES = (recorded as unknown[]).map((c) => Challenge.parse(c))
const p2 = <T extends 'translate_type' | 'listen_type' | 'cloze_type' | 'letter_trace'>(t: T) =>
  FIXTURES.find(
    (c) => c.type === t && (c.type !== 'translate_type' || c.answerLang === 'fa'),
  ) as ChallengeOf<T>
const typed = p2('translate_type')
const listen = p2('listen_type')
const cloze = p2('cloze_type')
const trace = p2('letter_trace')

describe('sessionLexicon', () => {
  it('includes the Persian words of typed answers, transcripts and cloze sentences', () => {
    const words = sessionLexicon([typed, listen, cloze, trace])
    for (const w of ['نون', 'چای', 'من']) expect(words).toContain(w)
    expect(words.every((w) => !/\s/.test(w))).toBe(true)
  })
})

describe('gradeAttempt (typed Persian)', () => {
  it('passes a typo unless it lands on another session word', () => {
    // The fixture blanks the verb of «من سیب می‌خوام»; «می‌خوای» is one letter off.
    expect(cloze.before.map((t) => t.surface)).toEqual(['من', 'سیب'])
    expect(gradeAttempt(cloze, { kind: 'text', value: 'می‌خوای' }, []).verdict).toBe('typo')
    expect(gradeAttempt(cloze, { kind: 'text', value: 'می‌خوای' }, ['می‌خوای']).verdict).toBe(
      'wrong',
    )
    expect(gradeAttempt(cloze, { kind: 'text', value: 'میخوام' }, []).verdict).toBe('correct')
  })

  it('grades a trace by its scores', () => {
    expect(gradeAttempt(trace, { kind: 'trace', coverage: 1, precision: 1 }, []).verdict).toBe(
      'correct',
    )
    expect(gradeAttempt(trace, { kind: 'trace', coverage: 0.1, precision: 1 }, []).verdict).toBe(
      'wrong',
    )
  })
})

describe('solutionFor', () => {
  it('typed Persian shows the closest accepted Persian answer', () => {
    const g = gradeAttempt(typed, { kind: 'text', value: 'نون' }, [])
    expect(solutionFor(typed, g)).toEqual({ text: g.closestSolution, lang: 'fa' })
    expect(solutionFor(listen, null)?.lang).toBe('fa')
  })

  it('cloze_type shows the whole sentence with the blank filled, whole words only', () => {
    const s = solutionFor(cloze, null)!
    expect(s.lang).toBe('fa')
    expect(s.text.split(' ')).toEqual([
      ...cloze.before.map((t) => t.surface),
      expect.any(String),
      ...cloze.after.map((t) => t.surface),
    ])
    const g = gradeAttempt(cloze, { kind: 'text', value: 'نون' }, [])
    expect(solutionFor(cloze, g)!.text).toContain(g.closestSolution!)
  })

  it('a trace has no solution line', () => {
    expect(solutionFor(trace, null)).toBeNull()
  })
})
