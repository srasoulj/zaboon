import { describe, expect, it } from 'vitest'
import { FsrsCard } from '@zaboon/contracts'
import { newCard, ratingFor, retrievability, review, strengthBars } from './index'

const now = new Date('2026-09-25T12:00:00Z')

describe('@zaboon/srs contract', () => {
  it('maps outcomes to ratings', () => {
    expect(ratingFor({ wrongAttempts: 1, maxMs: 1000, hinted: false }, 12000)).toBe('again')
    expect(ratingFor({ wrongAttempts: 0, maxMs: 13000, hinted: false }, 12000)).toBe('hard')
    expect(ratingFor({ wrongAttempts: 0, maxMs: 1000, hinted: true }, 12000)).toBe('hard')
    expect(ratingFor({ wrongAttempts: 0, maxMs: 1000, hinted: false }, 12000)).toBe('good')
  })
  it('produces schema-valid cards and pushes due forward on good', () => {
    const c0 = FsrsCard.parse(newCard(now))
    const c1 = FsrsCard.parse(review(c0, 'good', now))
    expect(new Date(c1.due).getTime()).toBeGreaterThan(now.getTime())
    expect(c1.reps).toBe(1)
    expect(c1.lastReview).toBe(now.toISOString())
  })
  it('retrievability is within [0,1] and 0 for unseen cards', () => {
    expect(retrievability(newCard(now), now)).toBe(0)
    const r = retrievability(review(newCard(now), 'good', now), now)
    expect(r).toBeGreaterThanOrEqual(0)
    expect(r).toBeLessThanOrEqual(1)
  })
  it('maps retrievability to 0-4 strength bars', () => {
    const t = [0.5, 0.75, 0.9]
    expect(strengthBars(0, t)).toBe(0)
    expect(strengthBars(0.3, t)).toBe(1)
    expect(strengthBars(0.6, t)).toBe(2)
    expect(strengthBars(0.8, t)).toBe(3)
    expect(strengthBars(0.95, t)).toBe(4)
  })
})
