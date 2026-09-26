/**
 * ChallengeRef.variant packs the choices a ref must carry to rebuild exactly (the contract has no
 * dedicated fields for them): bit 0 = isNew (NEW WORD badge), the remaining bits = a type-specific
 * option. `variant` is omitted when it would be 0, so hand-pinned refs stay verbatim.
 *
 *   letter_sound  option 0 = letter_to_sound, 1 = sound_to_letter
 *   read_word     option 0 = ask translit,     1 = ask meaning
 *   cloze_choice  option 0 = engine picks the blank, n = blank the token at index n - 1
 *   cloze_type    the same as cloze_choice
 *   letter_trace  option 0 = isolated, 1 = initial, 2 = medial, 3 = final (TRACE_FORMS); a
 *                 non-connector builds only 0 and 3
 */
export interface Variant {
  isNew: boolean
  option: number
}

export function decodeVariant(variant: number | undefined): Variant {
  const v = variant ?? 0
  return { isNew: (v & 1) === 1, option: Math.floor(v / 2) }
}

export function encodeVariant(v: Partial<Variant>): number | undefined {
  const n = (v.option ?? 0) * 2 + (v.isNew ? 1 : 0)
  return n === 0 ? undefined : n
}
