/**
 * Token-level comparison (docs/LEARNING-ENGINE.md §7.1, as pinned by oracles/golden.yaml):
 * how an answer token relates to the expected DAG token, both already in key form.
 */
import { persianNumberValue, soundKey } from '@zaboon/farsi'
import { englishNumberValue } from './english'
import { alefFold, editDistance, lenientFold, type Lang, typoLimit } from './keys'

/** exact < spelling < typo < wrong (the order is the severity used for the verdict). */
export type TokenMatch = 'exact' | 'spelling' | 'typo' | 'wrong'

/**
 * Persian:
 * - equal keys, or equal numbers (۳ = سه), are exact;
 * - adding or removing the negative prefix ن is wrong (never a typo): detected when one token starts
 *   with ن, the other does not, and stripping the ن brings them closer;
 * - one or more same-sound letter swaps (ز ذ ض ظ / س ص ث / ت ط / ه ح / غ ق) and nothing else is
 *   spelling, at any length;
 * - آ/ا confusion alone is a typo at any length;
 * - otherwise ≤1 edit (4+ letters) or ≤2 (8+) is a typo, where same-sound swaps and آ/ا are free;
 * - a spelling or typo whose result is a lexicon word is wrong.
 *
 * English: exact (or equal number: 7 = seven), typo by the same length rule, lexicon hit = wrong.
 */
export function classifyToken(answer: string, expected: string, lang: Lang, lexicon: ReadonlySet<string>): TokenMatch {
  if (answer === expected) return 'exact'
  const numberValue = lang === 'fa' ? persianNumberValue : englishNumberValue
  const av = numberValue(answer)
  if (av !== null && av === numberValue(expected)) return 'exact'
  if (lang === 'fa') return classifyPersian(answer, expected, lexicon)
  const d = editDistance(answer, expected, typoLimit(expected))
  if (d > typoLimit(expected)) return 'wrong'
  return lexicon.has(answer) ? 'wrong' : 'typo'
}

function classifyPersian(answer: string, expected: string, lexicon: ReadonlySet<string>): TokenMatch {
  if (isNegationFlip(answer, expected)) return 'wrong'
  let match: TokenMatch = 'wrong'
  if (soundKey(answer) === soundKey(expected)) match = 'spelling'
  else if (alefFold(answer) === alefFold(expected)) match = 'typo'
  else {
    const limit = typoLimit(expected)
    if (limit > 0 && editDistance(lenientFold(answer), lenientFold(expected), limit) <= limit) match = 'typo'
  }
  if (match !== 'wrong' && lexicon.has(answer)) return 'wrong'
  return match
}

/** نمی\u200Cخوام vs می\u200Cخوام, ندارم vs دارم: the meaning flips although it is one edit. */
function isNegationFlip(answer: string, expected: string): boolean {
  const na = answer.startsWith('ن')
  if (na === expected.startsWith('ن')) return false
  const a = na ? answer.slice(1) : answer
  const e = na ? expected : expected.slice(1)
  return editDistance(a, e, 3) < editDistance(answer, expected, 3)
}
