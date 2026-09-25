/**
 * Comparison keys: the form in which answer tokens and DAG tokens are compared (§1.5, §3.2).
 * Persian: the loose key (affixes joined, spelling folds, no ZWNJ). English: lowercase, contractions
 * expanded, US spelling. One text can yield several key tokens (`I'd` → `i would`) or none (`؟`).
 */
import { looseTokens, soundKey } from '@zaboon/farsi'
import { englishKeyTokens } from './english'

export type Lang = 'fa' | 'en'

export function keyTokens(text: string, lang: Lang): string[] {
  return lang === 'fa' ? looseTokens(text) : englishKeyTokens(text)
}

/** Persian subject pronouns that may be dropped sentence-initially (§3.2 merge 3), as loose keys. */
export const DROPPABLE_PRONOUNS: ReadonlySet<string> = new Set(
  ['من', 'تو', 'او', 'ما', 'شما', 'آنها', 'آن\u200Cها', 'اون', 'اونا', 'اونها', 'اون\u200Cها'].flatMap((p) => looseTokens(p)),
)

/** The letters of a key token, for the typo length rule (code points; keys carry no ZWNJ). */
export function letterCount(tok: string): number {
  return [...tok].length
}

/** Maximum typo edits for an expected token: ≤1 at 4+ letters, ≤2 at 8+, none below 4 (§7.1). */
export function typoLimit(expected: string): number {
  const n = letterCount(expected)
  return n >= 8 ? 2 : n >= 4 ? 1 : 0
}

/** آ read as ا, used for the madda typo that applies at any length. */
export function alefFold(tok: string): string {
  return tok.replaceAll('آ', 'ا')
}

/** Same-sound and madda folds together: the key under which only "spelling" differences vanish. */
export function lenientFold(tok: string): string {
  return soundKey(alefFold(tok))
}

/**
 * Optimal-string-alignment distance (Levenshtein + adjacent transposition), stopping early once
 * the distance must exceed `max` (then returns max + 1).
 */
export function editDistance(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
  const s = [...a]
  const t = [...b]
  if (Math.abs(s.length - t.length) > max) return max + 1
  const n = t.length
  let prev2 = new Array<number>(n + 1).fill(0)
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  let cur = new Array<number>(n + 1).fill(0)
  for (let i = 1; i <= s.length; i++) {
    cur[0] = i
    let rowMin = cur[0]
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost)
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) v = Math.min(v, prev2[j - 2]! + 1)
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    ;[prev2, prev, cur] = [prev, cur, prev2]
  }
  return Math.min(prev[n]!, max + 1)
}
