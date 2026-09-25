import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_CONFIG as cfg, FsrsCard } from '@zaboon/contracts'
import type { Verdict, SrsRating } from '@zaboon/contracts'
import {
  IMPLEMENTATION,
  isDue,
  newCard,
  outcomesByItem,
  ratingFor,
  ratingsByItem,
  retrievability,
  review,
  strengthBars,
} from './index'
import type { ItemAttempt } from './index'

const now = new Date('2026-09-25T12:00:00Z')
const DAY = 86_400_000

interface RatingCase {
  id: string
  input: { attempts: ItemAttempt[] }
  expected: { ratings: Record<string, SrsRating | null> }
}
const cases = parse(
  readFileSync(new URL('../oracles/ratings.yaml', import.meta.url), 'utf8'),
) as RatingCase[]

describe('srs', () => {
  it('is the real implementation', () => {
    expect(IMPLEMENTATION).toBe('real')
  })

  describe('ratingsByItem reproduces oracles/ratings.yaml without caller glue', () => {
    it.each(cases)('$id', (c) => {
      expect(Object.fromEntries(ratingsByItem(c.input.attempts, cfg.srs.slowMs))).toEqual(
        c.expected.ratings,
      )
    })
  })

  it('outcomesByItem aggregates per item in first-seen order', () => {
    const out = outcomesByItem([
      { item: 'b', verdict: 'wrong', ms: 100, hinted: false },
      { item: 'a', verdict: 'typo', ms: 3000, hinted: false },
      { item: 'b', verdict: 'correct', ms: 900, hinted: true },
      { item: 'a', verdict: 'correct', ms: 5000, hinted: false },
      { item: 'c', verdict: 'skipped', ms: 1, hinted: false },
    ])
    expect([...out.keys()]).toEqual(['b', 'a', 'c'])
    expect(out.get('a')).toEqual({ wrongAttempts: 0, maxMs: 5000, hinted: false })
    expect(out.get('b')).toEqual({ wrongAttempts: 1, maxMs: 900, hinted: true })
    expect(out.get('c')).toBeNull()
  })

  it('a skipped attempt never changes an outcome (property)', () => {
    const verdict = fc.constantFrom<Verdict>('correct', 'typo', 'spelling', 'wrong')
    const attempt = fc.record({
      item: fc.constantFrom('x', 'y'),
      verdict,
      ms: fc.nat(30_000),
      hinted: fc.boolean(),
    })
    fc.assert(
      fc.property(fc.array(attempt, { minLength: 1 }), fc.nat(10), (attempts, at) => {
        const skip: ItemAttempt = {
          item: attempts[0]!.item,
          verdict: 'skipped',
          ms: 99_999,
          hinted: true,
        }
        const withSkip = [...attempts.slice(0, at), skip, ...attempts.slice(at)]
        expect(outcomesByItem(withSkip)).toEqual(outcomesByItem(attempts))
      }),
    )
  })

  it('new cards are schema-valid, unseen and not due-for-review', () => {
    const c = FsrsCard.parse(newCard(now))
    expect(c.reps).toBe(0)
    expect(c.state).toBe(0)
    expect(c.lastReview).toBeNull()
    expect(retrievability(c, now)).toBe(0)
    expect(isDue(c, now)).toBe(false)
  })

  it('good pushes due further than hard, hard further than again', () => {
    const c0 = newCard(now)
    const due = (r: SrsRating) => new Date(review(c0, r, now).due).getTime()
    expect(due('again')).toBeLessThanOrEqual(due('hard'))
    expect(due('hard')).toBeLessThanOrEqual(due('good'))
    expect(due('good')).toBeLessThanOrEqual(due('easy'))
  })

  it('a card reviewed good repeatedly reaches the review state with growing intervals', () => {
    let c = newCard(now)
    let t = now
    const intervals: number[] = []
    for (let i = 0; i < 5; i++) {
      c = review(c, 'good', t)
      intervals.push(new Date(c.due).getTime() - t.getTime())
      t = new Date(c.due)
    }
    expect(c.state).toBe(2)
    expect(c.reps).toBe(5)
    expect(intervals.at(-1)!).toBeGreaterThan(intervals[1]!)
    expect(intervals.at(-1)!).toBeGreaterThan(2 * DAY)
  })

  it('again on a review card counts a lapse and relearns', () => {
    let c = newCard(now)
    let t = now
    for (let i = 0; i < 3; i++) {
      c = review(c, 'good', t)
      t = new Date(c.due)
    }
    const lapsed = review(c, 'again', t)
    expect(lapsed.lapses).toBe(c.lapses + 1)
    expect(lapsed.state).toBe(3)
  })

  it('retrievability decays over time and stays within [0, 1]', () => {
    const c = review(review(newCard(now), 'good', now), 'good', new Date(now.getTime() + DAY))
    const at = (days: number) => retrievability(c, new Date(now.getTime() + days * DAY))
    expect(at(1)).toBeGreaterThan(at(10))
    expect(at(10)).toBeGreaterThan(at(100))
    for (const d of [1, 5, 50, 5000]) {
      expect(at(d)).toBeGreaterThanOrEqual(0)
      expect(at(d)).toBeLessThanOrEqual(1)
    }
  })

  it('review is deterministic and always schema-valid (property)', () => {
    const rating = fc.constantFrom<SrsRating>('again', 'hard', 'good', 'easy')
    fc.assert(
      fc.property(
        fc.array(fc.tuple(rating, fc.integer({ min: 0, max: 60 * 24 * 90 })), { maxLength: 12 }),
        (steps) => {
          let a = newCard(now)
          let b = newCard(now)
          let t = now.getTime()
          for (const [r, minutes] of steps) {
            t += minutes * 60_000
            a = review(a, r, new Date(t))
            b = review(b, r, new Date(t))
            expect(() => FsrsCard.parse(a)).not.toThrow()
            const ret = retrievability(a, new Date(t))
            expect(ret).toBeGreaterThanOrEqual(0)
            expect(ret).toBeLessThanOrEqual(1)
          }
          expect(a).toEqual(b)
          expect(a.reps).toBe(steps.length)
        },
      ),
    )
  })

  it('ratingFor and strengthBars keep their final behavior', () => {
    expect(
      ratingFor({ wrongAttempts: 0, maxMs: cfg.srs.slowMs, hinted: false }, cfg.srs.slowMs),
    ).toBe('good')
    expect(strengthBars(0.9, cfg.srs.strengthBars)).toBe(4)
    expect(strengthBars(0.74, cfg.srs.strengthBars)).toBe(2)
  })
})
