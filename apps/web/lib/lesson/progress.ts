/**
 * Pure lesson progress: the challenge queue (wrong answers are re-queued at the end, Duolingo-style;
 * LEARNING-ENGINE §5), the attempt log sent to /complete, combo and hearts bookkeeping.
 * Every attempt gets its own attemptSeq, so a re-queued retry is a new attempt (ARCHITECTURE §6).
 */
import {
  MAX_ANSWER_MS,
  MAX_ANSWERS,
  PASSING_VERDICTS,
  type AnswerRecord,
  type ChallengeResponse,
  type LivesView,
  type SessionKind,
  type Verdict,
} from '@zaboon/contracts'

export interface Progress {
  /** Number of distinct challenges in the session. */
  total: number
  /** Challenge indexes still to pass; the head is the current challenge. */
  queue: number[]
  /** Every attempt so far, in attemptSeq order. */
  answers: AnswerRecord[]
  nextSeq: number
  /** Indexes answered correctly (each once). */
  passed: number[]
  /** Correct answers in a row (the progress bar's "N in a row"). */
  combo: number
  bestCombo: number
}

export const passes = (v: Verdict): boolean => PASSING_VERDICTS.includes(v)
/** A skip counts as a wrong attempt (Duolingo parity): it costs a heart and spoils a perfect lesson. */
export const countsAsWrong = (v: Verdict): boolean => v === 'wrong' || v === 'skipped'

/** The most attempts one /complete may carry (the contract's `answers` max length). */
export function maxAnswers(): number {
  return MAX_ANSWERS
}

export function initialProgress(challenges: readonly { index: number }[]): Progress {
  return {
    total: challenges.length,
    queue: challenges.map((c) => c.index),
    answers: [],
    nextSeq: 0,
    passed: [],
    combo: 0,
    bestCombo: 0,
  }
}

export function currentIndex(p: Progress): number | null {
  return p.queue[0] ?? null
}

export const isFinished = (p: Progress): boolean => p.queue.length === 0

/** 0..1: the share of challenges passed (re-queued ones don't count until they're right). */
export function progressValue(p: Progress): number {
  return p.total === 0 ? 1 : p.passed.length / p.total
}

export const clampMs = (ms: number): number =>
  Math.min(MAX_ANSWER_MS, Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0)))

/** Records a graded attempt at the head of the queue; wrong and skipped answers go to the back. */
export function recordAttempt(
  p: Progress,
  attempt: { index: number; response: ChallengeResponse; verdict: Verdict; ms: number },
): { progress: Progress; answer: AnswerRecord } {
  const answer: AnswerRecord = {
    index: attempt.index,
    attemptSeq: p.nextSeq,
    response: attempt.response,
    verdict: attempt.verdict,
    ms: clampMs(attempt.ms),
    hinted: false,
  }
  const rest =
    p.queue[0] === attempt.index ? p.queue.slice(1) : p.queue.filter((i) => i !== attempt.index)
  const ok = passes(attempt.verdict)
  const combo = ok ? p.combo + 1 : 0
  return {
    answer,
    progress: {
      ...p,
      queue: ok ? rest : [...rest, attempt.index],
      answers: [...p.answers, answer],
      nextSeq: p.nextSeq + 1,
      passed: ok && !p.passed.includes(attempt.index) ? [...p.passed, attempt.index] : p.passed,
      combo,
      bestCombo: Math.max(p.bestCombo, combo),
    },
  }
}

/**
 * A wrong tap inside a matching challenge (match_pairs, letter_forms): a wrong attempt that costs a
 * heart, but the learner stays on the challenge. The recorded response grades as wrong on the server
 * too (an empty pair list), so client and server agree.
 */
export function recordMismatch(
  p: Progress,
  index: number,
  ms: number,
): { progress: Progress; answer: AnswerRecord } {
  const answer: AnswerRecord = {
    index,
    attemptSeq: p.nextSeq,
    response: { kind: 'pairs', value: [] },
    verdict: 'wrong',
    ms: clampMs(ms),
    hinted: false,
  }
  return {
    answer,
    progress: { ...p, answers: [...p.answers, answer], nextSeq: p.nextSeq + 1, combo: 0 },
  }
}

export function wrongAttempts(p: Progress): number {
  return p.answers.filter((a) => countsAsWrong(a.verdict)).length
}

/** Challenges still queued that were never attempted (each needs at least one answer record). */
export function unattempted(p: Progress): number[] {
  const seen = new Set(p.answers.map((a) => a.index))
  return p.queue.filter((i) => !seen.has(i))
}

/**
 * True when one more attempt could push the answers past `cap` while still leaving a record for
 * every never-attempted challenge: the lesson has to end now (see finishEarly).
 */
export function mustFinish(p: Progress, cap: number): boolean {
  return p.queue.length > 0 && p.answers.length + unattempted(p).length >= cap
}

/**
 * Ends a lesson that reached the attempt cap: every never-attempted challenge is recorded as
 * skipped (the server needs an answer for each) and the queue is emptied.
 */
export function finishEarly(p: Progress): Progress {
  let next = p
  for (const index of unattempted(p))
    next = recordAttempt(next, {
      index,
      response: { kind: 'skip' },
      verdict: 'skipped',
      ms: 0,
    }).progress
  return { ...next, queue: [] }
}

/** First-try accuracy, as the server computes it. */
export function firstTryAccuracy(p: Progress): number {
  const first = new Map<number, Verdict>()
  for (const a of p.answers) if (!first.has(a.index)) first.set(a.index, a.verdict)
  if (p.total === 0) return 0
  return [...first.values()].filter(passes).length / p.total
}

// ------------------------------------------------------------------------------------------ hearts
/** Whether a wrong attempt costs a heart: never in practice, never with unlimited hearts. */
export function costsHeart(kind: SessionKind, lives: LivesView): boolean {
  return kind !== 'practice' && lives.policy === 'hearts'
}

export function loseHeart(lives: LivesView): LivesView {
  return { ...lives, count: Math.max(0, lives.count - 1) }
}

export function outOfHearts(kind: SessionKind, lives: LivesView): boolean {
  return costsHeart(kind, lives) && lives.count <= 0
}
