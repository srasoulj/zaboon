/**
 * Grading one learner response against one built challenge. Used by BOTH the lesson player
 * (instant feedback, offline) and the server (re-grading on /complete), so the per-type rules live
 * in exactly one place. Never throws: a response that does not fit the challenge is `wrong`.
 */
import type { AnswerGraph, Challenge, ChallengeResponse, Verdict } from '@zaboon/contracts'
import { normalize } from '@zaboon/farsi'
import { grade } from '@zaboon/grader'
import type { DiffToken } from '@zaboon/grader'

export interface GradeContext {
  /** Other course words (the grader's spelling/typo rule rejects a swap that lands on one). */
  lexicon?: readonly string[]
}

export interface ResponseGrade {
  verdict: Verdict
  closestSolution?: string
  diff?: DiffToken[]
}

/**
 * letter_trace pass thresholds (the client's scorer reports both scores, apps/web/lib/typing).
 * Tuned on synthetic strokes: a careful trace of the guide scores ~0.9/0.95, a trace that follows
 * the letter loosely ~0.75/0.7, a scribble across the canvas stays well under 0.5 precision.
 */
export const TRACE_MIN_COVERAGE = 0.7
export const TRACE_MIN_PRECISION = 0.6

const WRONG: ResponseGrade = { verdict: 'wrong' }
const verdictOf = (ok: boolean): ResponseGrade => ({ verdict: ok ? 'correct' : 'wrong' })

function typed(
  graph: AnswerGraph,
  text: string,
  lang: 'en' | 'fa',
  ctx: GradeContext,
): ResponseGrade {
  const r = grade(graph, text, {
    lang,
    mode: 'typed',
    ...(ctx.lexicon ? { lexicon: ctx.lexicon } : {}),
  })
  return { verdict: r.verdict, closestSolution: r.closestSolution, diff: r.diff }
}

function bank(graph: AnswerGraph, tiles: readonly string[], lang: 'en' | 'fa'): ResponseGrade {
  const r = grade(graph, tiles, { lang, mode: 'bank' })
  return { verdict: r.verdict, closestSolution: r.closestSolution, diff: r.diff }
}

/** Every pair matched exactly once, each to itself ([i, i]) in the challenge's pair order. */
function pairsCorrect(count: number, matches: readonly (readonly [number, number])[]): boolean {
  if (matches.length !== count) return false
  const seen = new Set<number>()
  for (const [l, r] of matches) {
    if (l !== r || l < 0 || l >= count || seen.has(l)) return false
    seen.add(l)
  }
  return seen.size === count
}

/** Grades a response (LEARNING-ENGINE §6–§7). */
export function gradeResponse(
  challenge: Challenge,
  response: ChallengeResponse,
  ctx: GradeContext = {},
): ResponseGrade {
  if (response.kind === 'skip') return { verdict: 'skipped' }
  try {
    switch (challenge.type) {
      case 'select_image':
      case 'select_translation':
      case 'cloze_choice':
      case 'complete_chat':
      case 'letter_sound':
      case 'read_word':
        return response.kind === 'choice' ? verdictOf(response.value === challenge.answer) : WRONG
      case 'translate_bank':
        return response.kind === 'tiles'
          ? bank(challenge.graph, response.value, challenge.answerLang)
          : WRONG
      case 'listen_tap':
        return response.kind === 'tiles' ? bank(challenge.graph, response.value, 'fa') : WRONG
      case 'build_word':
        return response.kind === 'tiles'
          ? verdictOf(normalize(response.value.join('')) === normalize(challenge.answer.join('')))
          : WRONG
      case 'translate_type':
        return response.kind === 'text'
          ? typed(challenge.graph, response.value, challenge.answerLang, ctx)
          : WRONG
      case 'listen_type':
      case 'cloze_type':
        return response.kind === 'text' ? typed(challenge.graph, response.value, 'fa', ctx) : WRONG
      case 'speak':
        return response.kind === 'audio'
          ? typed(challenge.graph, response.transcript, 'fa', ctx)
          : WRONG
      case 'match_pairs':
      case 'letter_forms':
        return response.kind === 'pairs'
          ? verdictOf(pairsCorrect(challenge.pairs.length, response.value))
          : WRONG
      case 'letter_intro':
        return response.kind === 'none' ? { verdict: 'correct' } : WRONG
      case 'letter_trace':
        // "Can't trace now" (declined) grades correct: it costs no heart and is not re-queued
        // (trade-off: it counts as a clean review of the letter).
        if (response.kind !== 'trace') return WRONG
        if (response.declined === true) return { verdict: 'correct' }
        return verdictOf(
          response.coverage >= TRACE_MIN_COVERAGE && response.precision >= TRACE_MIN_PRECISION,
        )
      case 'story':
        return WRONG // graded elsewhere; never throw
    }
  } catch {
    return WRONG // malformed graph or response: never throw
  }
}
