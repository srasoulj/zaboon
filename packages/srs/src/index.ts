/**
 * @zaboon/srs: FSRS spaced repetition via ts-fsrs (FSRS-6; ADR 0006, LEARNING-ENGINE §8).
 *
 * Owner: ws-engine. Cards are stored field-for-field as the contracts' FsrsCard (camelCase); this
 * module converts to and from ts-fsrs' snake_case Card. Scheduling is deterministic: fuzz is off,
 * so the same card, rating and instant always produce the same next card (server re-runs agree).
 */
import { PASSING_VERDICTS } from '@zaboon/contracts'
import type { FsrsCard, SrsRating, Verdict } from '@zaboon/contracts'
import { createEmptyCard, fsrs, generatorParameters, Rating, State } from 'ts-fsrs'
import type { Card, Grade } from 'ts-fsrs'

export const IMPLEMENTATION: 'stub' | 'real' = 'real'

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

/** One graded attempt of a session, attributed to the item it exercised. */
export interface ItemAttempt {
  item: string
  verdict: Verdict
  ms: number
  hinted: boolean
}

/**
 * Aggregates a session's attempts into one ItemOutcome per item (oracles/ratings.yaml):
 * skipped attempts are ignored, passing verdicts (correct, typo, spelling) count as correct,
 * maxMs is the slowest passing attempt (0 when none passed), hinted is true if any rated attempt
 * was hinted, and an item whose attempts were all skipped maps to null (no SRS update).
 * Items keep first-seen order.
 */
export function outcomesByItem(attempts: readonly ItemAttempt[]): Map<string, ItemOutcome | null> {
  const byItem = new Map<string, ItemAttempt[]>()
  for (const a of attempts) {
    const list = byItem.get(a.item)
    if (list) list.push(a)
    else byItem.set(a.item, [a])
  }
  const out = new Map<string, ItemOutcome | null>()
  for (const [item, all] of byItem) {
    const rated = all.filter((a) => a.verdict !== 'skipped')
    if (rated.length === 0) {
      out.set(item, null)
      continue
    }
    const passing = rated.filter((a) => PASSING_VERDICTS.includes(a.verdict))
    out.set(item, {
      wrongAttempts: rated.length - passing.length,
      maxMs: passing.reduce((m, a) => Math.max(m, a.ms), 0),
      hinted: rated.some((a) => a.hinted),
    })
  }
  return out
}

/** outcomesByItem + ratingFor: the rating to apply per item, or null for "no update". */
export function ratingsByItem(
  attempts: readonly ItemAttempt[],
  slowMs: number,
): Map<string, SrsRating | null> {
  const out = new Map<string, SrsRating | null>()
  for (const [item, outcome] of outcomesByItem(attempts))
    out.set(item, outcome === null ? null : ratingFor(outcome, slowMs))
  return out
}

// ------------------------------------------------------------------------------------ scheduler
const scheduler = fsrs(generatorParameters({ enable_fuzz: false }))

const GRADES: Readonly<Record<SrsRating, Grade>> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
}

function toFsrs(card: FsrsCard): Card {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as State,
    ...(card.lastReview === null ? {} : { last_review: new Date(card.lastReview) }),
  }
}

function fromFsrs(card: Card): FsrsCard {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review ? card.last_review.toISOString() : null,
  }
}

/** A never-reviewed card, due now. */
export function newCard(now: Date): FsrsCard {
  return fromFsrs(createEmptyCard(now))
}

/** Applies one review (FSRS-6 via ts-fsrs). Pure: returns a new card. */
export function review(card: FsrsCard, rating: SrsRating, now: Date): FsrsCard {
  return fromFsrs(scheduler.next(toFsrs(card), now, GRADES[rating]).card)
}

/** Probability of recall now (0..1); 0 for a card that was never reviewed. */
export function retrievability(card: FsrsCard, now: Date): number {
  if (card.lastReview === null || card.state === State.New) return 0
  const r = scheduler.get_retrievability(toFsrs(card), now, false)
  return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0
}

/** True when the card has been reviewed and is due at `now`. */
export function isDue(card: FsrsCard, now: Date): boolean {
  return card.lastReview !== null && new Date(card.due).getTime() <= now.getTime()
}

/** Retrievability → 0–4 strength bars using ascending thresholds (e.g. [0.5, 0.75, 0.9]). Final. */
export function strengthBars(r: number, thresholds: readonly number[]): 0 | 1 | 2 | 3 | 4 {
  if (r <= 0) return 0
  const above = thresholds.filter((t) => r >= t).length
  return (1 + above) as 1 | 2 | 3 | 4
}
