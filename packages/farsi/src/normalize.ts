/**
 * The normalization pipeline (docs/LEARNING-ENGINE.md §1.5, pinned by oracles/normalize.yaml).
 *
 * One ordered, versioned pipeline runs on learner answers at runtime and on answer keys at build
 * time. `normalize` is the strict form (what the learner wrote, minus noise; ZWNJ kept);
 * `looseKey` is the comparison key (spelling folds, no ZWNJ, affixes joined).
 *
 * Bump `NORMALIZER_VERSION` in index.ts whenever the output of either function changes.
 */
import { HAZM_TRANSLATION_DST, HAZM_TRANSLATION_SRC } from './hazm'

export const ZWNJ = '\u200C'
export const ZWJ = '\u200D'

/** Whole-token prefixes the loose key joins to the next token (می\u200Cخوام = می خوام = میخوام). */
export const LOOSE_PREFIXES: ReadonlySet<string> = new Set(['می', 'نمی'])
/** Whole-token suffixes the loose key joins to the previous token (pinned list, oracle header). */
export const LOOSE_SUFFIXES: ReadonlySet<string> = new Set([
  'ها',
  'های',
  'ی',
  'ای',
  'تر',
  'ترین',
  'ام',
  'ات',
  'اش',
  'مان',
  'تان',
  'شان',
])

/** Punctuation removed by step 7 (the pinned list). */
export const STRIPPED_PUNCTUATION = '،؛؟«».!?,;:'

// --- step 2: letter map -------------------------------------------------------------------------

/**
 * Letter map: ي/ى → ی and ك → ک, plus Hazm's table of rarer Arabic/Urdu letter variants
 * (ھ ہ ۃ ڪ ٹ …) limited to the Arabic blocks. Letters the oracle keeps in the strict form (ە, and
 * everything Hazm does not list, such as ة ۀ أ إ ٱ) are left for the loose key.
 */
const LETTER_MAP: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>()
  const src = [...HAZM_TRANSLATION_SRC]
  const dst = [...HAZM_TRANSLATION_DST]
  src.forEach((ch, i) => {
    const cp = ch.codePointAt(0)!
    const to = dst[i]!
    // Arabic (0600–06FF), Arabic Supplement (0750–077F) and Extended-A (08A0–08FF) only;
    // presentation forms are handled by NFKC below, quotes and spaces by later steps.
    const inBlock =
      (cp >= 0x0600 && cp <= 0x06ff) ||
      (cp >= 0x0750 && cp <= 0x077f) ||
      (cp >= 0x08a0 && cp <= 0x08ff)
    if (!inBlock || ch === 'ە' || ch === to) return
    if (!map.has(ch)) map.set(ch, to)
  })
  map.set('ي', 'ی')
  map.set('ى', 'ی')
  map.set('ك', 'ک')
  return map
})()

const LETTER_MAP_RE = new RegExp(`[${[...LETTER_MAP.keys()].join('')}]`, 'g')

// --- step 4: invisible characters and diacritics ------------------------------------------------

/**
 * Bidi controls (U+200E/F, U+202A–E, U+2066–9, and the Arabic letter mark U+061C), BOM, ZWSP, ZWJ,
 * word joiner U+2060, soft hyphen, tatweel, diacritics U+064B–U+0652 and superscript alef U+0670.
 * Removed before whitespace is collapsed, so a BOM inside a word never becomes a space (n038).
 */
// Each code point is stripped on its own; the class is not meant to match joined sequences.
const STRIP_RE =
  // eslint-disable-next-line no-misleading-character-class
  /[\u200B\u200D\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\u061C\uFEFF\u00AD\u0640\u064B-\u0652\u0670]/g

/** Arabic presentation forms (copied from old PDFs): folded to base letters with NFKC. */
const PRESENTATION_FORMS_RE = /[\uFB50-\uFDFF\uFE70-\uFEFE]/g

const PUNCTUATION_RE = new RegExp(`[${STRIPPED_PUNCTUATION.replace(/[.?]/g, '\\$&')}]`, 'g')

// --- step 5: digits -----------------------------------------------------------------------------

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'

/** Persian and Arabic-Indic digits → ASCII, one by one (a leading zero is kept). */
export function toAsciiDigits(text: string): string {
  return text.replace(/[۰-۹٠-٩]/g, (d) => {
    const i = FA_DIGITS.indexOf(d)
    return String(i >= 0 ? i : AR_DIGITS.indexOf(d))
  })
}

/** ASCII digits → Persian digits (display). */
export function toPersianDigits(text: string): string {
  return text.replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]!)
}

// --- the strict form ----------------------------------------------------------------------------

/**
 * Strict normalization (§1.5 steps 1, 2, 4, 5, 6 without the loose part, and 7):
 *
 * 1. NFC (first: mapping letters before NFC would break a decomposed ئ); presentation forms → NFKC.
 * 2. Letter map (ي/ى → ی, ك → ک, and Hazm's rarer variants).
 * 4. Strip bidi controls, BOM, ZWSP, ZWJ, tatweel and diacritics.
 * 5. Persian and Arabic-Indic digits → ASCII.
 * 7. Strip the punctuation ، ؛ ؟ « » . ! ? , ; : (before whitespace is collapsed: «خوبی ؟» → «خوبی»).
 * 6. Every Unicode space (NBSP included) → one ASCII space; runs collapsed; trimmed. ZWNJ is kept,
 *    but ZWNJ runs collapse to one and a ZWNJ next to a space or at either end is dropped.
 *
 * No case folding (the grader lowercases English itself). Idempotent.
 */
export function normalize(text: string): string {
  const letters = text
    .normalize('NFC')
    .replace(PRESENTATION_FORMS_RE, (ch) => ch.normalize('NFKC'))
    .replace(LETTER_MAP_RE, (ch) => LETTER_MAP.get(ch)!)
    // Stripping a mark can bring a base letter and a hamza/madda together: compose them again.
    .replace(STRIP_RE, '')
    .normalize('NFC')
  return toAsciiDigits(letters)
    .replace(PUNCTUATION_RE, '')
    .replace(/\u200C+/g, ZWNJ)
    .replace(/\u200C(?=\s|$)|(?<=^|\s)\u200C/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// --- the loose key ------------------------------------------------------------------------------

/**
 * Loose comparison key (§1.5 steps 3 and 6), computed from the strict form:
 *
 * - ە/ة → ه; ۀ and ه\u0654 → ه;
 * - a word-final written ezāfe ه\u200Cی → ه (the indefinite ه\u200Cای and a non-final ه\u200Cی such as ه\u200Cیم are
 *   kept). The same ezāfe typed with a space (خونه ی من) folds too: see `joinAffixes`;
 * - أ/إ/ٱ → ا (آ is never folded: mixing up آ and ا is a grader typo);
 * - ئی → یی (پائیز = پاییز);
 * - every ZWNJ removed;
 * - the space after a whole-token prefix می/نمی and before a whole-token suffix
 *   (ها های ی ای تر ترین ام ات اش مان تان شان) removed.
 *
 * English is untouched apart from the strict-form steps.
 */
export function looseKey(text: string): string {
  // One pass can create a new whole-token prefix (م + the suffix ی = می) that another pass would
  // join to the next token (م ی ا → می ا → میا), so passes repeat until nothing changes: the key is
  // idempotent by construction. Every pass only joins tokens or folds characters one way, so this
  // ends quickly (the bound is a safety net).
  let key = loosePass(text)
  for (let i = 0; i <= key.length; i++) {
    const next = loosePass(key)
    if (next === key) break
    key = next
  }
  return key
}

function loosePass(text: string): string {
  const folded = normalize(text)
    .replace(/[ەةۀ]/g, 'ه')
    .replace(/ه\u0654/g, 'ه')
    .replace(/ه\u200Cی(?= |$)/g, 'ه')
    .replace(/[أإٱ]/g, 'ا')
    .replaceAll(ZWNJ, '')
  // After joining, so that a suffix ی joined to a final ئ folds too.
  return joinAffixes(folded).replace(/ئ+(?=ی)/g, (m) => 'ی'.repeat(m.length))
}

/** Joins whole-token prefixes to the next token and whole-token suffixes to the previous one. */
function joinAffixes(text: string): string {
  if (!text) return text
  const tokens = text.split(' ')
  const out: string[] = []
  let glueNext = false
  for (const tok of tokens) {
    const prev = out.length - 1
    if (prev >= 0 && (glueNext || LOOSE_SUFFIXES.has(tok))) {
      // An ezāfe ی typed as its own word after a final ه folds like ه\u200Cی (خونه ی من = خونه من).
      if (!glueNext && tok === 'ی' && out[prev]!.endsWith('ه')) {
        glueNext = false
        continue
      }
      out[prev] += tok
    } else out.push(tok)
    glueNext = LOOSE_PREFIXES.has(tok)
  }
  return out.join(' ')
}

/** Whitespace tokenization of the strict form; a ZWNJ compound stays one token. */
export function tokenize(text: string): string[] {
  const n = normalize(text)
  return n.length ? n.split(' ') : []
}

/** Tokens of the loose key (affixes already joined). */
export function looseTokens(text: string): string[] {
  const k = looseKey(text)
  return k.length ? k.split(' ') : []
}
