/**
 * Server-side re-grading of one response. Walking-skeleton version: replaced by
 * `@zaboon/session-engine`'s `gradeResponse` (shared with the lesson player) when ws-engine lands.
 */
import type { Challenge, ChallengeResponse, Verdict } from '@zaboon/contracts'
import { normalize } from '@zaboon/farsi'
import { grade } from '@zaboon/grader'

function pairsCorrect(count: number, pairs: readonly (readonly [number, number])[]): boolean {
  if (pairs.length !== count) return false
  const seen = new Set<number>()
  for (const [left, right] of pairs) {
    if (left !== right || left < 0 || left >= count || seen.has(left)) return false
    seen.add(left)
  }
  return true
}

export function regrade(challenge: Challenge, response: ChallengeResponse): Verdict {
  if (response.kind === 'skip') return 'skipped'
  switch (challenge.type) {
    case 'select_image':
    case 'select_translation':
    case 'cloze_choice':
    case 'complete_chat':
    case 'letter_sound':
    case 'read_word':
      return response.kind === 'choice' && response.value === challenge.answer ? 'correct' : 'wrong'
    case 'translate_bank':
      return response.kind === 'tiles'
        ? grade(challenge.graph, response.value, { lang: challenge.answerLang, mode: 'bank' })
            .verdict
        : 'wrong'
    case 'listen_tap':
      return response.kind === 'tiles'
        ? grade(challenge.graph, response.value, { lang: 'fa', mode: 'bank' }).verdict
        : 'wrong'
    case 'translate_type':
      return response.kind === 'text'
        ? grade(challenge.graph, response.value, { lang: challenge.answerLang, mode: 'typed' })
            .verdict
        : 'wrong'
    case 'match_pairs':
    case 'letter_forms':
      return response.kind === 'pairs' && pairsCorrect(challenge.pairs.length, response.value)
        ? 'correct'
        : 'wrong'
    case 'letter_intro':
      return response.kind === 'none' ? 'correct' : 'wrong'
    case 'build_word':
      return response.kind === 'tiles' &&
        normalize(response.value.join('')) === normalize(challenge.answer.join(''))
        ? 'correct'
        : 'wrong'
    default:
      return 'wrong'
  }
}
