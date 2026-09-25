/**
 * @zaboon/farsi: Persian text layer (docs/LEARNING-ENGINE.md §1).
 *
 * Wave 0 STUB with naive-but-working behavior. Owner: ws-farsi-grader, who replaces the
 * internals with the full 7-step pipeline (§1.5) and must pass packages/farsi/oracles/*.yaml.
 * The public API below is the contract; keep signatures stable.
 */

/** 'stub' until the owning workstream lands the real implementation; oracle tests run when 'real'. */
export const IMPLEMENTATION: 'stub' | 'real' = 'stub'
/** Bumped whenever normalization output changes (part of the grader version). */
export const NORMALIZER_VERSION = 1

export const ZWNJ = '‌'
export const ZWJ = '‍'

/** Letters that never connect to the following letter. */
export const NON_CONNECTORS: ReadonlySet<string> = new Set(['ا', 'آ', 'د', 'ذ', 'ر', 'ز', 'ژ', 'و'])

/** Groups of letters that sound the same (grader `spelling` verdict). */
export const SAME_SOUND_GROUPS: readonly (readonly string[])[] = [
  ['ز', 'ذ', 'ض', 'ظ'],
  ['س', 'ص', 'ث'],
  ['ت', 'ط'],
  ['ه', 'ح'],
  ['غ', 'ق'],
]

/** Strict normalization (§1.5 steps 1–7, ZWNJ kept). Stub: NFC + whitespace + basic letter map. */
export function normalize(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[،؛؟«».!?,;:]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Loose comparison key (§1.5 step 6): no ZWNJ, no spaces next to known affixes. Stub: drops ZWNJ and spaces. */
export function looseKey(text: string): string {
  return normalize(text).replaceAll(ZWNJ, '').replace(/\s+/g, ' ')
}

/** Whitespace tokenization of normalized text; a ZWNJ compound stays one token. */
export function tokenize(text: string): string[] {
  const n = normalize(text)
  return n.length ? n.split(' ') : []
}

export function isPersian(text: string): boolean {
  return /[؀-ۿ]/.test(text)
}

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'

export function toAsciiDigits(text: string): string {
  return text.replace(/[۰-۹٠-٩]/g, (d) => {
    const i = FA_DIGITS.indexOf(d)
    return String(i >= 0 ? i : AR_DIGITS.indexOf(d))
  })
}

export function toPersianDigits(text: string): string {
  return text.replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]!)
}

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

export function sameSoundGroup(ch: string): readonly string[] | null {
  return SAME_SOUND_GROUPS.find((g) => g.includes(ch)) ?? null
}

/** Physical-key maps for the in-app keyboard (P2). Keys are KeyboardEvent.code values. */
export interface KeyboardLayout {
  id: 'standard' | 'phonetic'
  keys: Readonly<Record<string, { base: string; shift?: string; variants?: readonly string[] }>>
}
export const KEYBOARD_LAYOUTS: Readonly<Record<'standard' | 'phonetic', KeyboardLayout>> = {
  standard: { id: 'standard', keys: {} },
  phonetic: { id: 'phonetic', keys: {} },
}
