// Property and performance tests for the grader.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { accepts, canonical, compile, enumerate, grade } from './index'

const FA_WORDS = ['من', 'تو', 'آب', 'نون', 'می‌خوام', 'نمی‌دونم', 'کتاب‌ها', 'رو', 'خونه‌ی', 'خسته‌ام', 'صد', 'تومن', 'چای', 'لطفاً', 'سلام،', 'حالت', 'چطوره؟', 'یه', 'قهوه', 'بزرگ‌تر', 'اینو', 'دوست', 'دارم', 'خوب', 'ما']
const EN_WORDS = ['I', "I'm", 'you', "don't", 'want', 'some', 'water,', 'please.', 'Hello', 'My', 'name', 'is', 'Sara', 'two', 'seven', 'colour', 'tea', "it's", 'very', 'hot!', 'the']

/** A pattern: words and `[a/b/]` groups over a word list. */
const pattern = (words: readonly string[]) =>
  fc
    .array(
      fc.oneof(
        { weight: 3, arbitrary: fc.constantFrom(...words) },
        {
          weight: 1,
          arbitrary: fc
            .tuple(fc.array(fc.constantFrom(...words), { minLength: 1, maxLength: 2 }), fc.constantFrom(...words), fc.boolean())
            .map(([a, b, optional]) => `[${a.join(' ')}/${b}${optional ? '/' : ''}]`),
        },
      ),
      { minLength: 1, maxLength: 7 },
    )
    .map((parts) => parts.join(' '))

describe('grader properties', () => {
  it('grade(compile([p]), canonical) is always correct (Persian)', () => {
    fc.assert(
      fc.property(pattern(FA_WORDS), fc.boolean(), (p, drop) => {
        const g = compile([p], { lang: 'fa', pronounDrop: drop })
        const c = canonical(g)
        expect(grade(g, c, { lang: 'fa', mode: 'typed' }).verdict).toBe('correct')
        expect(grade(g, c.split(' ').filter(Boolean), { lang: 'fa', mode: 'bank' }).verdict).toBe('correct')
      }),
      { numRuns: 400 },
    )
  })

  it('grade(compile([p]), canonical) is always correct (English)', () => {
    fc.assert(
      fc.property(pattern(EN_WORDS), (p) => {
        const g = compile([p], { lang: 'en' })
        expect(grade(g, canonical(g), { lang: 'en', mode: 'typed' }).verdict).toBe('correct')
      }),
      { numRuns: 400 },
    )
  })

  it('every enumerated answer is accepted, and the closest solution of a correct answer is accepted', () => {
    fc.assert(
      fc.property(pattern(FA_WORDS), fc.constantFrom(undefined, 'من آب می‌خواهم', 'ما چای می‌خوریم'), (p, formal) => {
        const g = compile([p], { lang: 'fa', ...(formal ? { formal } : {}), variants: [['می‌خوام', 'می‌خام'], ['اینو', 'این رو']] })
        for (const a of enumerate(g, 30)) {
          const r = grade(g, a, { lang: 'fa', mode: 'typed' })
          expect(r.verdict).toBe('correct')
          expect(accepts(g, r.closestSolution, 'fa')).toBe(true)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('verdicts are never better than correct for noise, and the diff never drops solution words', () => {
    fc.assert(
      fc.property(pattern(EN_WORDS), fc.array(fc.constantFrom(...EN_WORDS, 'xyz', 'watr'), { maxLength: 8 }), (p, words) => {
        const g = compile([p], { lang: 'en' })
        const r = grade(g, words.join(' '), { lang: 'en', mode: 'typed' })
        const solutionWords = r.diff.filter((d) => d.status !== 'extra').map((d) => d.text)
        expect(solutionWords.join(' ')).toBe(r.closestSolution)
      }),
      { numRuns: 300 },
    )
  })
})

describe('grader performance', () => {
  it('grades a typical sentence in under 5 ms', () => {
    const g = compile([`[من/ما] [کتابا/کتاب‌ها] رو [خیلی/] دوست [دارم/داریم]`], {
      lang: 'fa',
      formal: 'من کتاب‌ها را خیلی دوست دارم',
      variants: [['کتابا', 'کتاب‌ها'], ['دوست دارم', 'دوس دارم']],
    })
    const answers = ['کتابا رو خیلی دوس دارم', 'من کتاب ها را دوست دارم', 'ما کطابا رو خیلی دوست داریم', 'من نون می‌خوام خیلی زیاد', 'کتاب']
    for (const a of answers) grade(g, a, { lang: 'fa', mode: 'typed' }) // warm up
    const runs = 200
    const t0 = performance.now()
    for (let i = 0; i < runs; i++) grade(g, answers[i % answers.length]!, { lang: 'fa', mode: 'typed', lexicon: ['کباب', 'سد'] })
    const perGrade = (performance.now() - t0) / runs
    expect(perGrade).toBeLessThan(5)
  })

  it('compiles a fresh graph and grades a first answer in under 50 ms (cold)', () => {
    const t0 = performance.now()
    const g = compile(["[I want/I'd like] [some/] water, please"], { lang: 'en' })
    grade(g, 'I would like sum water please', { lang: 'en', mode: 'typed' })
    expect(performance.now() - t0).toBeLessThan(50) // includes one-time key graph construction and JIT
  })
})
