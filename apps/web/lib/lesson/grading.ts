/**
 * Local grading for instant feedback (LEARNING-ENGINE §7.3): the same `gradeResponse` the server
 * re-grades with, plus what the feedback bar shows as the correct solution.
 */
import type { Challenge, ChallengeResponse, FaTextDto, Lang } from '@zaboon/contracts'
import { canonical } from '@zaboon/grader'
import { gradeResponse, type ResponseGrade } from '@zaboon/session-engine'

/**
 * The Persian words the session itself carries. The server's lexicon is every known course word;
 * the client only has the session, which covers the words a typed answer is most likely to be
 * confused with. A wider lexicon only makes a verdict stricter, and the learner's verdict stands
 * within the grader window, so the difference is safe.
 */
export function sessionLexicon(challenges: readonly Challenge[]): string[] {
  const out = new Set<string>()
  const addFa = (t: FaTextDto | undefined) => {
    if (!t) return
    out.add(t.fa)
    if (t.faFormal) out.add(t.faFormal)
  }
  for (const c of challenges) {
    switch (c.type) {
      case 'select_image':
        addFa(c.prompt)
        break
      case 'select_translation':
        addFa(c.prompt.fa)
        for (const ch of c.choices) addFa(ch.fa)
        break
      case 'translate_bank':
        addFa(c.prompt.fa)
        if (c.answerLang === 'fa') for (const t of c.bank) out.add(t)
        break
      case 'translate_type':
        addFa(c.prompt.fa)
        if (c.answerLang === 'fa') for (const t of canonical(c.graph).split(' ')) out.add(t)
        break
      case 'listen_type':
        addFa(c.transcript)
        for (const t of c.transcript.tokens ?? []) out.add(t.surface)
        break
      case 'cloze_type':
        for (const t of [...c.before, ...c.after]) out.add(t.surface)
        break
      case 'match_pairs':
        for (const p of c.pairs) addFa(p.fa)
        break
      case 'listen_tap':
        addFa(c.transcript)
        for (const t of c.bank) out.add(t)
        break
      case 'complete_chat':
        addFa(c.prompt)
        for (const ch of c.choices) addFa(ch)
        break
      case 'read_word':
        addFa(c.word)
        break
      case 'build_word':
        addFa(c.target)
        break
      default:
        break
    }
  }
  // Only single words: the grader's lexicon rule compares tokens.
  return [...out].filter((w) => w.trim() !== '' && !/\s/.test(w.trim()))
}

export function gradeAttempt(
  challenge: Challenge,
  response: ChallengeResponse,
  lexicon: readonly string[],
): ResponseGrade {
  return gradeResponse(challenge, response, lexicon.length > 0 ? { lexicon } : {})
}

export interface Solution {
  text: string
  lang: Lang
}

const faOf = (t: FaTextDto): Solution => ({ text: t.fa, lang: 'fa' })

/** The correct answer to show after a wrong (or skipped) attempt; null when there's nothing to show. */
export function solutionFor(challenge: Challenge, grade: ResponseGrade | null): Solution | null {
  try {
    switch (challenge.type) {
      case 'select_image': {
        const c = challenge.choices[challenge.answer]
        return c ? { text: c.label, lang: 'en' } : null
      }
      case 'select_translation': {
        const c = challenge.choices[challenge.answer]
        if (!c) return null
        return c.fa ? faOf(c.fa) : { text: c.text, lang: c.lang }
      }
      case 'translate_bank':
      case 'translate_type':
        return {
          text: grade?.closestSolution || canonical(challenge.graph),
          lang: challenge.answerLang,
        }
      case 'listen_tap':
      case 'listen_type':
      case 'speak':
        return { text: grade?.closestSolution || canonical(challenge.graph), lang: 'fa' }
      case 'cloze_type': {
        // The whole sentence with the blank's closest accepted word (whole words only).
        const blank = grade?.closestSolution || canonical(challenge.graph)
        const words = [
          ...challenge.before.map((t) => t.surface),
          blank,
          ...challenge.after.map((t) => t.surface),
        ]
        return { text: words.join(' '), lang: 'fa' }
      }
      case 'cloze_choice': {
        const c = challenge.choices[challenge.answer]
        if (c === undefined) return null
        const words = [
          ...challenge.before.map((t) => t.surface),
          c,
          ...challenge.after.map((t) => t.surface),
        ]
        return { text: words.join(' '), lang: 'fa' }
      }
      case 'complete_chat': {
        const c = challenge.choices[challenge.answer]
        return c ? faOf(c) : null
      }
      case 'letter_sound': {
        const c = challenge.choices[challenge.answer]
        if (c === undefined) return null
        return { text: c, lang: challenge.mode === 'sound_to_letter' ? 'fa' : 'en' }
      }
      case 'read_word': {
        const c = challenge.choices[challenge.answer]
        return c === undefined ? null : { text: c, lang: 'en' }
      }
      case 'build_word':
        return { text: challenge.answer.join(''), lang: 'fa' }
      default:
        return null // matching and intro challenges have no single solution line
    }
  } catch {
    return null
  }
}
