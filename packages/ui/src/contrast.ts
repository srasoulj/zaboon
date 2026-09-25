/**
 * WCAG 2.2 contrast helpers and the registry of every text/background pair the kit renders.
 * `contrast.test.ts` checks each pair in both themes; a component that puts text on a new
 * background must add its pair here (DESIGN-SYSTEM §4.2: the test, not the table, is the gate).
 */
import { BRAND_NAMES, tokens, type BrandName, type DesignTokens, type SemanticName, type ThemeName } from './tokens'

function channel(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`Expected #rrggbb, got ${hex}`)
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** AA minimum: 4.5:1 for normal text, 3:1 for large text (≥18.66px bold or ≥24px regular). */
export function aaMinimum(large: boolean): number {
  return large ? 3 : 4.5
}

/** A color reference: a semantic token (resolved per theme) or a brand shade/label. */
export type ColorRef = { semantic: SemanticName } | { brand: BrandName; shade: '100' | '500' | '600' | 'label' }

export interface TextPair {
  /** Where the pair is used, for readable failures. */
  use: string
  fg: ColorRef
  bg: ColorRef
  /** Text is WCAG "large" (every such use in the kit is ≥19px/800 or ≥24px). */
  large: boolean
}

export function resolveColor(ref: ColorRef, theme: ThemeName, t: DesignTokens = tokens): string {
  return 'semantic' in ref ? t.theme[theme][ref.semantic] : t.brand[ref.brand][ref.shade]
}

const s = (semantic: SemanticName): ColorRef => ({ semantic })

// Not listed on purpose: stone on surface as normal text (4.4:1 in light): keep small secondary
// text on bg; on hover (surface) the ChoiceCard hint switches to ink.
const NEUTRAL_PAIRS: TextPair[] = [
  { use: 'body text', fg: s('ink'), bg: s('bg'), large: false },
  { use: 'body text on surfaces (info toast)', fg: s('ink'), bg: s('surface'), large: false },
  { use: 'secondary text (transliteration, captions)', fg: s('stone'), bg: s('bg'), large: false },
  { use: 'ChoiceCard 1–9 hint (14px/800) at rest', fg: s('stone'), bg: s('bg'), large: false },
  { use: 'ghost Button3D label on hover (surface)', fg: s('stone'), bg: s('surface'), large: true },
  { use: 'selected choice card / tile text and hint', fg: s('ink'), bg: s('selected-bg'), large: false },
  { use: 'ChoiceCard hint on hover, tiles on hover', fg: s('ink'), bg: s('surface'), large: false },
  { use: 'correct feedback bar and toast', fg: s('correct-fg'), bg: s('correct-bg'), large: false },
  { use: 'wrong feedback bar and toast', fg: s('wrong-fg'), bg: s('wrong-bg'), large: false },
  { use: 'ink text inside the correct feedback bar (solution)', fg: s('ink'), bg: s('correct-bg'), large: false },
  { use: 'ink text inside the wrong feedback bar (solution)', fg: s('ink'), bg: s('wrong-bg'), large: false },
  { use: 'locked / disabled Button3D label (19px/800)', fg: s('stone'), bg: s('line'), large: true },
  { use: 'ghost Button3D label (19px/800)', fg: s('stone'), bg: s('bg'), large: true },
  { use: 'START bubble on the path (19px/800)', fg: { brand: 'firouzeh', shade: '500' }, bg: s('bg'), large: true },
]

/** Filled buttons, unit banners, streak badge: each brand label on its 500 fill (§4.1). */
const BRAND_PAIRS: TextPair[] = BRAND_NAMES.map((brand) => ({
  use: `${brand} label on ${brand}-500 fill (Button3D, UnitBanner, badges)`,
  fg: { brand, shade: 'label' },
  bg: { brand, shade: '500' },
  large: tokens.brand[brand].labelLargeOnly,
}))

export const TEXT_PAIRS: readonly TextPair[] = [...NEUTRAL_PAIRS, ...BRAND_PAIRS]
