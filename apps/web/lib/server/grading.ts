/**
 * Server-side re-grading: `gradeResponse` from @zaboon/session-engine, the same function the lesson
 * player uses, so the per-type rules exist once (LEARNING-ENGINE §7.3).
 */
import type { Challenge, ChallengeResponse, Verdict } from '@zaboon/contracts'
import { gradeResponse, type ContentView } from '@zaboon/session-engine'

/** The course words a typed Persian answer may not be "corrected" into (spelling/typo rule). */
export function gradingLexicon(view: ContentView): string[] {
  return [
    ...new Set(view.knownLexemes.flatMap((l) => (l.faFormal ? [l.fa, l.faFormal] : [l.fa]))),
  ]
}

export function serverVerdict(
  challenge: Challenge,
  response: ChallengeResponse,
  lexicon?: readonly string[],
): Verdict {
  return gradeResponse(challenge, response, lexicon ? { lexicon } : {}).verdict
}
