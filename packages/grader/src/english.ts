/**
 * English answer normalization (docs/LEARNING-ENGINE.md §3.2 merge 5, §7.1): lowercase, typographic
 * apostrophes read as `'`, punctuation stripped, contractions expanded, UK spellings mapped to US.
 * Number words and digits are compared as equal by the grader (`englishNumberValue`), not rewritten,
 * so a typo inside a number word is still a typo.
 */
import { normalize } from '@zaboon/farsi'

/** ’ ‘ ʼ (U+2019, U+2018, U+02BC), plus the backtick and acute accent phones sometimes produce. */
const APOSTROPHES = /[’‘ʼ`´]/g
/** Punctuation beyond the normalizer's list that never changes an English answer. */
const EXTRA_PUNCTUATION = /["“”()[\]{}…—–]/g

/** Contractions with an irregular expansion. */
const SPECIAL_CONTRACTIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ["won't", ['will', 'not']],
  ["can't", ['can', 'not']],
  ['cannot', ['can', 'not']],
  ["shan't", ['shall', 'not']],
  ["let's", ['let', 'us']],
  ["i'm", ['i', 'am']],
])

/** Words whose `'s` means "is" (elsewhere `'s` is a possessive and stays). */
const S_IS: ReadonlySet<string> = new Set([
  'it', 'he', 'she', 'that', 'what', 'where', 'who', 'there', 'here', 'how', 'when', 'why', 'this',
])

/** Expands one lowercase token: `don't` → `do not`, `I'd` → `i would`, `it's` → `it is`. */
export function expandContraction(tok: string): readonly string[] {
  const special = SPECIAL_CONTRACTIONS.get(tok)
  if (special) return special
  let m = /^(.+)n't$/.exec(tok)
  if (m) return [m[1]!, 'not']
  m = /^(.+)'(re|ve|ll|d)$/.exec(tok)
  if (m) return [m[1]!, { re: 'are', ve: 'have', ll: 'will', d: 'would' }[m[2] as 're' | 've' | 'll' | 'd']]
  m = /^(.+)'s$/.exec(tok)
  if (m && S_IS.has(m[1]!)) return [m[1]!, 'is']
  return [tok]
}

/** UK → US spellings (lowercase). A plural `s` is handled by `usSpelling`. */
const UK_TO_US: ReadonlyMap<string, string> = new Map([
  ['colour', 'color'],
  ['colourful', 'colorful'],
  ['favourite', 'favorite'],
  ['favour', 'favor'],
  ['flavour', 'flavor'],
  ['honour', 'honor'],
  ['humour', 'humor'],
  ['labour', 'labor'],
  ['harbour', 'harbor'],
  ['rumour', 'rumor'],
  ['neighbour', 'neighbor'],
  ['neighbourhood', 'neighborhood'],
  ['behaviour', 'behavior'],
  ['centre', 'center'],
  ['theatre', 'theater'],
  ['metre', 'meter'],
  ['kilometre', 'kilometer'],
  ['litre', 'liter'],
  ['grey', 'gray'],
  ['travelling', 'traveling'],
  ['travelled', 'traveled'],
  ['traveller', 'traveler'],
  ['cancelled', 'canceled'],
  ['jewellery', 'jewelry'],
  ['programme', 'program'],
  ['practise', 'practice'],
  ['licence', 'license'],
  ['defence', 'defense'],
  ['offence', 'offense'],
  ['catalogue', 'catalog'],
  ['analyse', 'analyze'],
  ['organise', 'organize'],
  ['organised', 'organized'],
  ['realise', 'realize'],
  ['realised', 'realized'],
  ['recognise', 'recognize'],
  ['apologise', 'apologize'],
  ['pyjamas', 'pajamas'],
  ['aeroplane', 'airplane'],
  ['moustache', 'mustache'],
  ['cosy', 'cozy'],
  ['enrol', 'enroll'],
  ['fulfil', 'fulfill'],
])

export function usSpelling(word: string): string {
  const direct = UK_TO_US.get(word)
  if (direct) return direct
  if (word.endsWith('s')) {
    const stem = UK_TO_US.get(word.slice(0, -1))
    if (stem) return `${stem}s`
  }
  return word
}

/** Comparison tokens of an English text (answer or pattern token). */
export function englishKeyTokens(text: string): string[] {
  const t = normalize(text.replace(APOSTROPHES, "'")).toLowerCase().replace(EXTRA_PUNCTUATION, ' ')
  const out: string[] = []
  for (const raw of t.split(/\s+/)) {
    const tok = raw.replace(/^'+|'+$/g, '')
    if (!tok || /^-+$/.test(tok)) continue
    for (const w of expandContraction(tok)) out.push(usSpelling(w))
  }
  return out
}

const UNITS: readonly string[] = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
]
const TENS: readonly string[] = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** The value of a digit string or a one-token English number word (`seven`, `twenty-one`), else null. */
export function englishNumberValue(tok: string): number | null {
  if (/^\d+$/.test(tok)) return Number(tok)
  const unit = UNITS.indexOf(tok)
  if (unit >= 0) return unit
  const ten = TENS.indexOf(tok)
  if (ten >= 2) return ten * 10
  const m = /^([a-z]+)-([a-z]+)$/.exec(tok)
  if (m) {
    const t = TENS.indexOf(m[1]!)
    const u = UNITS.indexOf(m[2]!)
    if (t >= 2 && u >= 1 && u <= 9) return t * 10 + u
  }
  if (tok === 'hundred') return 100
  if (tok === 'thousand') return 1000
  return null
}
