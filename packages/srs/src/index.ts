/**
 * @zaboon/srs: FSRS spaced repetition via ts-fsrs (ADR 0006, LEARNING-ENGINE §8).
 *
 * Wave 0 STUB API (ratingFor and strengthBars are final; newCard/review/retrievability are naive).
 * Owner: ws-engine, who wires ts-fsrs and must pass packages/srs/oracles/ratings.yaml.
 */
import type { FsrsCard, SrsRating } from '@zaboon/contracts'

export const IMPLEMENTATION: 'stub' | 'real' = 'stub'

export interface ItemOutcome {
  /** Wrong attempts for this item in the session. */
  wrongAttempts: number
  /** Slowest correct answer time (ms). */
  maxMs: number
  hinted: boolean
}

/** Session outcome → FSRS rating (LEARNING-ENGINE §8). Final. */
export function ratingFor(outcome: ItemOutcome, slowMs: number): SrsRating {
  if (outcome.wrongAttempts > 0) return 'again'
  if (outcome.hinted || outcome.maxMs > slowMs) return 'hard'
  return 'good'
}

export function newCard(now: Date): FsrsCard {
  return {
    due: now.toISOString(),
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    lastReview: null,
  }
}

/** Applies one review. Stub: fixed intervals; the real version delegates to ts-fsrs. */
export function review(card: FsrsCard, rating: SrsRating, now: Date): FsrsCard {
  const days = { again: 0, hard: 1, good: 3, easy: 7 }[rating]
  return {
    ...card,
    due: new Date(now.getTime() + days * 86_400_000).toISOString(),
    reps: card.reps + 1,
    lapses: card.lapses + (rating === 'again' ? 1 : 0),
    scheduledDays: days,
    state: rating === 'again' ? 3 : 2,
    lastReview: now.toISOString(),
  }
}

/** Probability of recall now (0..1). Stub: 1 before due, decaying after. */
export function retrievability(card: FsrsCard, now: Date): number {
  if (card.lastReview === null) return 0
  const overdueDays = (now.getTime() - new Date(card.due).getTime()) / 86_400_000
  return overdueDays <= 0 ? 1 : Math.max(0, 1 - overdueDays / 30)
}

/** Retrievability → 0–4 strength bars using ascending thresholds (e.g. [0.5, 0.75, 0.9]). Final. */
export function strengthBars(r: number, thresholds: readonly number[]): 0 | 1 | 2 | 3 | 4 {
  if (r <= 0) return 0
  const above = thresholds.filter((t) => r >= t).length
  return (1 + above) as 1 | 2 | 3 | 4
}
