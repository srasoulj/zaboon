/**
 * @zaboon/farsi: Persian text layer (docs/LEARNING-ENGINE.md §1). Pure TypeScript, no DOM.
 *
 * - normalize.ts: the versioned normalization pipeline (§1.5): `normalize`, `looseKey`, tokenizer,
 *   digits;
 * - letters.ts: letter forms, same-sound groups, number words;
 * - keyboard.ts: the `standard` (ISIRI 9147) and `phonetic` in-app keyboard layouts (§1.4);
 * - hazm.ts: tables ported from Hazm (MIT).
 *
 * The oracle packages/farsi/oracles/normalize.yaml is the executable specification.
 */

/** 'stub' until the owning workstream lands the real implementation; oracle tests run when 'real'. */
export const IMPLEMENTATION: 'stub' | 'real' = 'real'
/**
 * Bumped whenever normalization output changes (part of the grader version).
 * 1: Wave 0 stub. 2: full §1.5 pipeline.
 */
export const NORMALIZER_VERSION = 2

export {
  LOOSE_PREFIXES,
  LOOSE_SUFFIXES,
  STRIPPED_PUNCTUATION,
  ZWJ,
  ZWNJ,
  looseKey,
  looseTokens,
  normalize,
  toAsciiDigits,
  toPersianDigits,
  tokenize,
} from './normalize'
export {
  ALPHABET,
  NON_CONNECTORS,
  PERSIAN_NUMBER_WORDS,
  SAME_SOUND_GROUPS,
  isSameSound,
  letterForms,
  persianNumberValue,
  sameSoundGroup,
  soundKey,
} from './letters'
export { HALF_SPACE_CODE, KEYBOARD_LAYOUTS, keyChar, type KeyDef, type KeyboardLayout } from './keyboard'
export { HAZM_AFFIX_SPACING_PATTERNS, HAZM_DIACRITICS, HAZM_SUFFIXES, HAZM_TRANSLATION_DST, HAZM_TRANSLATION_SRC } from './hazm'

/** True when the text contains a character from the Arabic block (Persian script). */
export function isPersian(text: string): boolean {
  return /[\u0600-ۿ]/.test(text)
}
