/**
 * Letter-level facts: joining behavior, contextual forms (§1.3), same-sound groups (§1.6, §7.1)
 * and number words (§1.5 step 5).
 */
import { ZWJ } from './normalize'

/** The 32 letters of the Persian alphabet, in dictionary order. */
export const ALPHABET: readonly string[] = [
  'ا', 'ب', 'پ', 'ت', 'ث', 'ج', 'چ', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'ژ', 'س', 'ش',
  'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ک', 'گ', 'ل', 'م', 'ن', 'و', 'ه', 'ی',
]

/** Letters that never connect to the following letter. */
export const NON_CONNECTORS: ReadonlySet<string> = new Set(['ا', 'آ', 'د', 'ذ', 'ر', 'ز', 'ژ', 'و', 'أ', 'إ', 'ؤ', 'ء', 'ة', 'ۀ', 'ە'])

/** Contextual letter forms rendered with ZWJ (§1.3). Non-connectors have no initial/medial joining. */
export function letterForms(letter: string): { isolated: string; initial: string; medial: string; final: string } {
  const joins = !NON_CONNECTORS.has(letter)
  return {
    isolated: letter,
    initial: joins ? letter + ZWJ : letter,
    medial: joins ? ZWJ + letter + ZWJ : ZWJ + letter,
    final: ZWJ + letter,
  }
}

/** Groups of letters that sound the same (grader `spelling` verdict). First = representative. */
export const SAME_SOUND_GROUPS: readonly (readonly string[])[] = [
  ['ز', 'ذ', 'ض', 'ظ'],
  ['س', 'ص', 'ث'],
  ['ت', 'ط'],
  ['ه', 'ح'],
  ['غ', 'ق'],
]

const SOUND_REP: ReadonlyMap<string, string> = new Map(SAME_SOUND_GROUPS.flatMap((g) => g.map((ch) => [ch, g[0]!] as const)))

export function sameSoundGroup(ch: string): readonly string[] | null {
  return SAME_SOUND_GROUPS.find((g) => g.includes(ch)) ?? null
}

/** True when two letters are different members of one same-sound group. */
export function isSameSound(a: string, b: string): boolean {
  return a !== b && SOUND_REP.has(a) && SOUND_REP.get(a) === SOUND_REP.get(b)
}

/** Replaces every letter by its same-sound group's representative (صد and سد share a key). */
export function soundKey(word: string): string {
  let out = ''
  for (const ch of word) out += SOUND_REP.get(ch) ?? ch
  return out
}

/**
 * One-word Persian number words (formal and common colloquial spellings) → value. Multi-word
 * numbers (بیست و یک) are several tokens and are not merged.
 */
export const PERSIAN_NUMBER_WORDS: ReadonlyMap<string, number> = new Map([
  ['صفر', 0],
  ['یک', 1],
  ['دو', 2],
  ['سه', 3],
  ['چهار', 4],
  ['پنج', 5],
  ['شش', 6],
  ['شیش', 6],
  ['هفت', 7],
  ['هشت', 8],
  ['نه', 9],
  ['ده', 10],
  ['یازده', 11],
  ['دوازده', 12],
  ['سیزده', 13],
  ['چهارده', 14],
  ['پانزده', 15],
  ['پونزده', 15],
  ['شانزده', 16],
  ['شونزده', 16],
  ['هفده', 17],
  ['هیفده', 17],
  ['هجده', 18],
  ['هیجده', 18],
  ['نوزده', 19],
  ['بیست', 20],
  ['سی', 30],
  ['چهل', 40],
  ['پنجاه', 50],
  ['شصت', 60],
  ['هفتاد', 70],
  ['هشتاد', 80],
  ['نود', 90],
  ['صد', 100],
  ['یکصد', 100],
  ['دویست', 200],
  ['سیصد', 300],
  ['چهارصد', 400],
  ['پانصد', 500],
  ['پونصد', 500],
  ['ششصد', 600],
  ['هفتصد', 700],
  ['هشتصد', 800],
  ['نهصد', 900],
  ['هزار', 1000],
])

/** The value of a digit string or a one-word Persian number word (loose key form), else null. */
export function persianNumberValue(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token)
  return PERSIAN_NUMBER_WORDS.get(token) ?? null
}
