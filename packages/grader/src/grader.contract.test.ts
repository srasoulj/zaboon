// Contract tests: MUST pass for both the Wave 0 stub and the real implementation.
import { describe, expect, it } from 'vitest'
import { AnswerGraph } from '@zaboon/content-schema'
import { accepts, canonical, compile, enumerate, grade, GRADER_VERSION } from './index'

describe('@zaboon/grader contract', () => {
  const en = compile(["[I want/I'd like] [some/] water"], { lang: 'en' })

  it('compiles to a valid serialized AnswerGraph', () => {
    expect(() => AnswerGraph.parse(en)).not.toThrow()
  })

  it('enumerates alternatives and optional groups', () => {
    const all = enumerate(en)
    expect(all).toContain('I want water')
    expect(all).toContain("I'd like some water")
    expect(all).toHaveLength(4)
    expect(canonical(en)).toBe('I want some water')
  })

  it('grades exact answers correct (case and punctuation insensitive for English)', () => {
    const r = grade(en, 'i want water.', { lang: 'en', mode: 'typed' })
    expect(r.verdict).toBe('correct')
    expect(r.graderVersion).toBe(GRADER_VERSION)
  })

  it('grades wrong answers wrong and returns a closest solution', () => {
    const r = grade(en, 'I want bread', { lang: 'en', mode: 'typed' })
    expect(r.verdict).toBe('wrong')
    expect(r.closestSolution.length).toBeGreaterThan(0)
    expect(r.diff.length).toBeGreaterThan(0)
  })

  it('accepts word-bank tiles for Persian, ignoring ZWNJ differences', () => {
    const fa = compile(['من آب می‌خوام'], { lang: 'fa' })
    expect(accepts(fa, ['من', 'آب', 'می‌خوام'], 'fa')).toBe(true)
    expect(accepts(fa, ['آب', 'من', 'می‌خوام'], 'fa')).toBe(false)
  })

  it('merges the formal register for Persian', () => {
    const fa = compile(['من آب می‌خوام'], { lang: 'fa', formal: 'من آب می‌خواهم' })
    expect(grade(fa, 'من آب می‌خواهم', { lang: 'fa', mode: 'typed' }).verdict).toBe('correct')
  })

  it('rejects malformed patterns', () => {
    expect(() => compile(['[a/b'], { lang: 'en' })).toThrow()
    expect(() => compile([], { lang: 'en' })).toThrow()
  })
})
