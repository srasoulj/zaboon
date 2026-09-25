/**
 * The Persian alphabet for the SEO pages (/alphabet, /alphabet/[letter]): 32 letters in dictionary
 * order, built on @zaboon/farsi (the letters, their joining behavior and contextual forms), with
 * names, sounds and one example word each. Names, transliteration and IPA follow
 * content/fa-en/letters.yaml where the two overlap (a unit test keeps them in step).
 */
import { ALPHABET, NON_CONNECTORS, letterForms } from '@zaboon/farsi'

export interface LetterForms {
  isolated: string
  initial: string
  medial: string
  final: string
}

export interface AlphabetLetter {
  /** URL slug: /alphabet/<slug>. */
  slug: string
  letter: string
  /** 1–32, dictionary order. */
  order: number
  /** Romanized name (with ā for the long a, like the course). */
  name: string
  translit: string
  ipa: string
  /** How to say it, for English speakers. */
  sound: string
  /** False for the seven letters that never join the next letter (ا د ذ ر ز ژ و). */
  connects: boolean
  /** The four contextual forms, shaped with ZWJ (render each as one unbroken string). */
  forms: LetterForms
  /** Letters that share this letter's sound (spelled differently). */
  sameSoundAs: readonly string[]
  example: { fa: string; translit: string; en: string }
}

type Row = Omit<AlphabetLetter, 'letter' | 'order' | 'connects' | 'forms' | 'sameSoundAs'>

// One row per ALPHABET entry, same order.
const ROWS: readonly Row[] = [
  {
    slug: 'alef',
    name: 'alef',
    translit: 'ā/a',
    ipa: 'ɒː/æ',
    sound: 'A long "ā" as in "father"; at the start of a word it also carries a short vowel.',
    example: { fa: 'اسب', translit: 'asb', en: 'horse' },
  },
  {
    slug: 'be',
    name: 'be',
    translit: 'b',
    ipa: 'b',
    sound: 'Like the "b" in "book".',
    example: { fa: 'بابا', translit: 'bābā', en: 'dad' },
  },
  {
    slug: 'pe',
    name: 'pe',
    translit: 'p',
    ipa: 'p',
    sound: 'Like the "p" in "pen". One of the four letters Persian added to the Arabic script.',
    example: { fa: 'پدر', translit: 'pedar', en: 'father' },
  },
  {
    slug: 'te',
    name: 'te',
    translit: 't',
    ipa: 't',
    sound: 'Like the "t" in "tea".',
    example: { fa: 'توت', translit: 'tut', en: 'mulberry' },
  },
  {
    slug: 'se',
    name: 'se',
    translit: 's',
    ipa: 's',
    sound: 'Like the "s" in "sun" (Persian says it as s, not th).',
    example: { fa: 'ثانیه', translit: 'sāniye', en: 'second' },
  },
  {
    slug: 'jim',
    name: 'jim',
    translit: 'j',
    ipa: 'dʒ',
    sound: 'Like the "j" in "jam".',
    example: { fa: 'جوان', translit: 'javān', en: 'young' },
  },
  {
    slug: 'che',
    name: 'che',
    translit: 'ch',
    ipa: 'tʃ',
    sound: 'Like the "ch" in "chair". A Persian addition to the Arabic script.',
    example: { fa: 'چای', translit: 'chāy', en: 'tea' },
  },
  {
    slug: 'he-jimi',
    name: 'he (jimi)',
    translit: 'h',
    ipa: 'h',
    sound: 'Like the "h" in "hat". Sounds the same as the other he (ه).',
    example: { fa: 'حال', translit: 'hāl', en: 'mood, how you are' },
  },
  {
    slug: 'khe',
    name: 'khe',
    translit: 'kh',
    ipa: 'x',
    sound: 'A rasping sound at the back of the throat, like the "ch" in Scottish "loch".',
    example: { fa: 'خانه', translit: 'khāne', en: 'house' },
  },
  {
    slug: 'dal',
    name: 'dāl',
    translit: 'd',
    ipa: 'd',
    sound: 'Like the "d" in "door".',
    example: { fa: 'در', translit: 'dar', en: 'door' },
  },
  {
    slug: 'zal',
    name: 'zāl',
    translit: 'z',
    ipa: 'z',
    sound: 'Like the "z" in "zoo" (Persian says it as z, not th).',
    example: { fa: 'ذرت', translit: 'zorrat', en: 'corn' },
  },
  {
    slug: 're',
    name: 're',
    translit: 'r',
    ipa: 'r',
    sound: 'A tapped or lightly rolled "r", as in Spanish "pero".',
    example: { fa: 'روز', translit: 'ruz', en: 'day' },
  },
  {
    slug: 'ze',
    name: 'ze',
    translit: 'z',
    ipa: 'z',
    sound: 'Like the "z" in "zoo". The letter on the Zaboon badge.',
    example: { fa: 'زبان', translit: 'zabān', en: 'language; tongue' },
  },
  {
    slug: 'zhe',
    name: 'zhe',
    translit: 'zh',
    ipa: 'ʒ',
    sound: 'Like the "s" in "measure". A Persian addition to the Arabic script.',
    example: { fa: 'ژاله', translit: 'zhāle', en: 'dew' },
  },
  {
    slug: 'sin',
    name: 'sin',
    translit: 's',
    ipa: 's',
    sound: 'Like the "s" in "sun".',
    example: { fa: 'سلام', translit: 'salām', en: 'hello' },
  },
  {
    slug: 'shin',
    name: 'shin',
    translit: 'sh',
    ipa: 'ʃ',
    sound: 'Like the "sh" in "ship".',
    example: { fa: 'شب', translit: 'shab', en: 'night' },
  },
  {
    slug: 'sad',
    name: 'sād',
    translit: 's',
    ipa: 's',
    sound: 'Like the "s" in "sun"; spelled differently from sin (س).',
    example: { fa: 'صبح', translit: 'sobh', en: 'morning' },
  },
  {
    slug: 'zad',
    name: 'zād',
    translit: 'z',
    ipa: 'z',
    sound: 'Like the "z" in "zoo"; spelled differently from ze (ز).',
    example: { fa: 'ضعیف', translit: "za'if", en: 'weak' },
  },
  {
    slug: 'ta',
    name: 'tā',
    translit: 't',
    ipa: 't',
    sound: 'Like the "t" in "tea"; spelled differently from te (ت).',
    example: { fa: 'طلا', translit: 'talā', en: 'gold' },
  },
  {
    slug: 'za',
    name: 'zā',
    translit: 'z',
    ipa: 'z',
    sound: 'Like the "z" in "zoo"; spelled differently from ze (ز).',
    example: { fa: 'ظهر', translit: 'zohr', en: 'noon' },
  },
  {
    slug: 'eyn',
    name: 'eyn',
    translit: "'",
    ipa: 'ʔ',
    sound: 'A short catch in the throat, like the break in "uh-oh"; often silent between vowels.',
    example: { fa: 'عشق', translit: 'eshq', en: 'love' },
  },
  {
    slug: 'gheyn',
    name: 'gheyn',
    translit: 'gh',
    ipa: 'ɢ/ɣ',
    sound: 'A deep, throaty "g" (like a French r). Sounds the same as qāf (ق).',
    example: { fa: 'غذا', translit: 'ghazā', en: 'food' },
  },
  {
    slug: 'fe',
    name: 'fe',
    translit: 'f',
    ipa: 'f',
    sound: 'Like the "f" in "fun".',
    example: { fa: 'فردا', translit: 'fardā', en: 'tomorrow' },
  },
  {
    slug: 'qaf',
    name: 'qāf',
    translit: 'q',
    ipa: 'ɢ/ɣ',
    sound: 'A deep, throaty "g", the same sound as gheyn (غ).',
    example: { fa: 'قند', translit: 'qand', en: 'sugar cube' },
  },
  {
    slug: 'kaf',
    name: 'kāf',
    translit: 'k',
    ipa: 'k',
    sound: 'Like the "k" in "kite".',
    example: { fa: 'کتاب', translit: 'ketāb', en: 'book' },
  },
  {
    slug: 'gaf',
    name: 'gāf',
    translit: 'g',
    ipa: 'g',
    sound: 'Like the "g" in "go". A Persian addition to the Arabic script.',
    example: { fa: 'گل', translit: 'gol', en: 'flower' },
  },
  {
    slug: 'lam',
    name: 'lām',
    translit: 'l',
    ipa: 'l',
    sound: 'Like the "l" in "lemon".',
    example: { fa: 'لب', translit: 'lab', en: 'lip' },
  },
  {
    slug: 'mim',
    name: 'mim',
    translit: 'm',
    ipa: 'm',
    sound: 'Like the "m" in "moon".',
    example: { fa: 'مادر', translit: 'mādar', en: 'mother' },
  },
  {
    slug: 'nun',
    name: 'nun',
    translit: 'n',
    ipa: 'n',
    sound: 'Like the "n" in "no".',
    example: { fa: 'نان', translit: 'nān', en: 'bread' },
  },
  {
    slug: 'vav',
    name: 'vāv',
    translit: 'v/u',
    ipa: 'v/uː',
    sound: 'A "v" as in "van", or the long vowel "u" as in "moon".',
    example: { fa: 'ورزش', translit: 'varzesh', en: 'sport' },
  },
  {
    slug: 'he',
    name: 'he',
    translit: 'h',
    ipa: 'h',
    sound: 'Like the "h" in "hat"; at the end of a word it often stands for a short "e".',
    example: { fa: 'هفت', translit: 'haft', en: 'seven' },
  },
  {
    slug: 'ye',
    name: 'ye',
    translit: 'y/i',
    ipa: 'j/iː',
    sound: 'A "y" as in "yes", or the long vowel "i" as in "machine".',
    example: { fa: 'یک', translit: 'yek', en: 'one' },
  },
]

/** Letters that are pronounced alike (the grader's same-sound groups, plus ه/ح and غ/ق). */
const SAME_SOUND: readonly (readonly string[])[] = [
  ['ز', 'ذ', 'ض', 'ظ'],
  ['س', 'ص', 'ث'],
  ['ت', 'ط'],
  ['ه', 'ح'],
  ['غ', 'ق'],
]

function buildAlphabet(): readonly AlphabetLetter[] {
  if (ROWS.length !== ALPHABET.length)
    throw new Error(`alphabet table has ${ROWS.length} rows for ${ALPHABET.length} letters`)
  return ALPHABET.map((letter, i) => {
    const row = ROWS[i]!
    const group = SAME_SOUND.find((g) => g.includes(letter)) ?? []
    return {
      ...row,
      letter,
      order: i + 1,
      connects: !NON_CONNECTORS.has(letter),
      forms: letterForms(letter),
      sameSoundAs: group.filter((l) => l !== letter),
    }
  })
}

export const PERSIAN_ALPHABET: readonly AlphabetLetter[] = buildAlphabet()

export function letterBySlug(slug: string): AlphabetLetter | undefined {
  return PERSIAN_ALPHABET.find((l) => l.slug === slug)
}

export function letterByChar(letter: string): AlphabetLetter | undefined {
  return PERSIAN_ALPHABET.find((l) => l.letter === letter)
}

/** The previous and next letter (wrapping), for the letter page's navigation. */
export function neighbors(slug: string): { prev: AlphabetLetter; next: AlphabetLetter } | null {
  const i = PERSIAN_ALPHABET.findIndex((l) => l.slug === slug)
  if (i < 0) return null
  const n = PERSIAN_ALPHABET.length
  return { prev: PERSIAN_ALPHABET[(i - 1 + n) % n]!, next: PERSIAN_ALPHABET[(i + 1) % n]! }
}
