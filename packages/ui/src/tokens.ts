/**
 * Typed access to `tokens.json` (docs/DESIGN-SYSTEM.md §4). The JSON file is the source of truth;
 * this module only reshapes it for TypeScript consumers (components, the CSS generator, tests).
 */
import rawTokens from '../tokens.json'

interface TokenValue<T> {
  $value: T
}

export const BRAND_NAMES = ['firouzeh', 'zaferan', 'lajvard', 'anar', 'bademjan', 'pesteh'] as const
export type BrandName = (typeof BRAND_NAMES)[number]

export const SEMANTIC_NAMES = [
  'bg',
  'surface',
  'line',
  'ink',
  'stone',
  'mist',
  'correct-bg',
  'correct-fg',
  'wrong-bg',
  'wrong-fg',
  'selected-bg',
  'selected-border',
] as const
export type SemanticName = (typeof SEMANTIC_NAMES)[number]

export type ThemeName = 'light' | 'dark'

export interface BrandColor {
  '500': string
  '600': string
  '100': string
  label: string
  /** When true, the label may only be used as WCAG large text on the 500 fill (§4.1). */
  labelLargeOnly: boolean
}

export interface DesignTokens {
  brand: Record<BrandName, BrandColor>
  theme: Record<ThemeName, Record<SemanticName, string>>
  radius: Record<'button' | 'tile' | 'card' | 'pill', string>
  lip: Record<'button' | 'card' | 'border', string>
  font: {
    latin: string
    persian: string
    displayPersian: string
    persianScale: number
    persianLineHeight: number
    buttonSize: string
    buttonWeight: number
    bodySize: string
  }
  motion: Record<'tap' | 'tileFly' | 'feedbackSpring', string>
  path: { nodeSize: string; offsets: readonly number[] }
  breakpoint: Record<'tablet' | 'desktop', string>
}

type Json = typeof rawTokens

function v<T>(t: TokenValue<T>): T {
  return t.$value
}

function brand(json: Json, name: BrandName): BrandColor {
  const b = json.color.brand[name]
  return {
    '500': v(b['500']),
    '600': v(b['600']),
    '100': v(b['100']),
    label: v(b.label),
    labelLargeOnly: v(b.labelLargeOnly),
  }
}

function theme(json: Json, name: ThemeName): Record<SemanticName, string> {
  const t = json.color[name] as Record<SemanticName, TokenValue<string>>
  return Object.fromEntries(SEMANTIC_NAMES.map((n) => [n, v(t[n])])) as Record<SemanticName, string>
}

/** Parses the W3C-format JSON into a typed, flat structure. Exported for tests. */
export function parseTokens(json: Json): DesignTokens {
  return {
    brand: Object.fromEntries(BRAND_NAMES.map((n) => [n, brand(json, n)])) as Record<BrandName, BrandColor>,
    theme: { light: theme(json, 'light'), dark: theme(json, 'dark') },
    radius: {
      button: v(json.radius.button),
      tile: v(json.radius.tile),
      card: v(json.radius.card),
      pill: v(json.radius.pill),
    },
    lip: { button: v(json.lip.button), card: v(json.lip.card), border: v(json.lip.border) },
    font: {
      latin: v(json.font.latin),
      persian: v(json.font.persian),
      displayPersian: v(json.font['display-persian']),
      persianScale: v(json.font['persian-scale']),
      persianLineHeight: v(json.font['persian-line-height']),
      buttonSize: v(json.font['button-size']),
      buttonWeight: v(json.font['button-weight']),
      bodySize: v(json.font['body-size']),
    },
    motion: {
      tap: v(json.motion.tap),
      tileFly: v(json.motion['tile-fly']),
      feedbackSpring: v(json.motion['feedback-spring']),
    },
    path: { nodeSize: v(json.path['node-size']), offsets: v(json.path.offsets) },
    breakpoint: { tablet: v(json.breakpoint.tablet), desktop: v(json.breakpoint.desktop) },
  }
}

export const tokens: DesignTokens = parseTokens(rawTokens)

/** `"250ms"` → 250. */
export function ms(duration: string): number {
  const m = /^(\d+(?:\.\d+)?)ms$/.exec(duration)
  if (!m) throw new Error(`Not a millisecond duration: ${duration}`)
  return Number(m[1])
}

/** `"70px"` → 70. */
export function px(length: string): number {
  const m = /^(\d+(?:\.\d+)?)px$/.exec(length)
  if (!m) throw new Error(`Not a pixel length: ${length}`)
  return Number(m[1])
}
