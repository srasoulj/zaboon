/**
 * Builds `src/styles.css` from the design tokens (docs/DESIGN-SYSTEM.md §4) plus the hand-written
 * component stylesheet `src/components.css`. Pure function so a unit test can assert that the
 * committed file is up to date; `scripts/build-tokens.ts` writes it.
 *
 * Output layout:
 *  1. a Tailwind v4 `@theme` block (utilities such as `bg-firouzeh-500`, `text-ink`, `rounded-card`);
 *  2. plain custom properties on `:root` (light) so the variables exist even where Tailwind tree-shakes
 *     unused theme values, plus dark mode via `prefers-color-scheme` and a `[data-theme]` override;
 *  3. the 3D recipe (`.btn-3d`, `.card-3d`) exactly per §4.3;
 *  4. the component styles.
 */
import { BRAND_NAMES, SEMANTIC_NAMES, type DesignTokens, type ThemeName } from './tokens'

const HEADER = `/* GENERATED FILE: do not edit by hand.
   Source: packages/ui/tokens.json + packages/ui/src/components.css
   Regenerate: pnpm --filter @zaboon/ui tokens (a unit test fails when this file is stale). */`

type Decl = readonly [name: string, value: string | number]

function block(selector: string, decls: readonly Decl[], indent = ''): string {
  const body = decls.map(([n, val]) => `${indent}  ${n}: ${val};`).join('\n')
  return `${indent}${selector} {\n${body}\n${indent}}`
}

function brandDecls(t: DesignTokens): Decl[] {
  return BRAND_NAMES.flatMap((name) => {
    const b = t.brand[name]
    return [
      [`--color-${name}-100`, b['100']],
      [`--color-${name}-500`, b['500']],
      [`--color-${name}-600`, b['600']],
      [`--color-${name}-label`, b.label],
    ] as Decl[]
  })
}

function semanticDecls(t: DesignTokens, theme: ThemeName): Decl[] {
  return SEMANTIC_NAMES.map((n) => [`--color-${n}`, t.theme[theme][n]] as Decl)
}

function fontDecls(t: DesignTokens): Decl[] {
  return [
    ['--font-latin', t.font.latin],
    ['--font-persian', t.font.persian],
    ['--font-display-persian', t.font.displayPersian],
  ]
}

function radiusDecls(t: DesignTokens): Decl[] {
  return [
    ['--radius-button', t.radius.button],
    ['--radius-tile', t.radius.tile],
    ['--radius-card', t.radius.card],
    ['--radius-pill', t.radius.pill],
  ]
}

function themeBlock(t: DesignTokens): string {
  return block('@theme', [
    // Tokens, not hex codes (§1 principle 5): drop Tailwind's default palette so only tokens exist.
    ['--color-*', 'initial'],
    ['--color-white', '#ffffff'],
    ['--color-black', '#000000'],
    ...brandDecls(t),
    ...semanticDecls(t, 'light'),
    ...radiusDecls(t),
    ...fontDecls(t),
    ['--text-body', t.font.bodySize],
    ['--text-button', t.font.buttonSize],
    ['--text-button--font-weight', t.font.buttonWeight],
    ['--text-button--line-height', 1],
    ['--breakpoint-tablet', t.breakpoint.tablet],
    ['--breakpoint-desktop', t.breakpoint.desktop],
  ])
}

function rootBlock(t: DesignTokens): string {
  return block(':root', [
    ['color-scheme', 'light'],
    ...brandDecls(t),
    ...semanticDecls(t, 'light'),
    ...radiusDecls(t),
    ['--lip-button', t.lip.button],
    ['--lip-card', t.lip.card],
    ['--lip-border', t.lip.border],
    ...fontDecls(t),
    ['--font-persian-scale', t.font.persianScale],
    ['--font-persian-line-height', t.font.persianLineHeight],
    ['--font-button-size', t.font.buttonSize],
    ['--font-button-weight', t.font.buttonWeight],
    ['--font-body-size', t.font.bodySize],
    ['--motion-tap', t.motion.tap],
    ['--motion-tile-fly', t.motion.tileFly],
    ['--motion-feedback-spring', t.motion.feedbackSpring],
    ['--path-node-size', t.path.nodeSize],
    ...t.path.offsets.map((o, i) => [`--path-offset-${i}`, `${o}px`] as Decl),
  ])
}

function themeOverrides(t: DesignTokens): string {
  const light: Decl[] = [['color-scheme', 'light'], ...semanticDecls(t, 'light')]
  const dark: Decl[] = [['color-scheme', 'dark'], ...semanticDecls(t, 'dark')]
  return [
    '@media (prefers-color-scheme: dark) {',
    block(':root:not([data-theme="light"])', dark, '  '),
    '}',
    '',
    '/* Explicit override, also usable on any subtree (e.g. a light/dark gallery panel). */',
    block('[data-theme="light"]', light),
    '',
    block('[data-theme="dark"]', dark),
  ].join('\n')
}

/** The 3D recipe, verbatim from DESIGN-SYSTEM §4.3 with the literals replaced by their tokens. */
const RECIPE = `/* The 3D recipe (DESIGN-SYSTEM §4.3). */
@layer components {
  /* Filled button: primary, secondary, danger… */
  .btn-3d {
    --fill: var(--color-firouzeh-500);
    --lip: var(--color-firouzeh-600);
    --label: var(--color-firouzeh-label);
    background: var(--fill);
    color: var(--label);
    border-radius: var(--radius-button);
    box-shadow: 0 var(--lip-button) 0 var(--lip);
    font: var(--font-button-weight) var(--font-button-size) / 1 var(--font-latin);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    transition:
      transform var(--motion-tap) ease-out,
      box-shadow var(--motion-tap) ease-out;
  }
  .btn-3d:active {
    transform: translateY(var(--lip-button));
    box-shadow: 0 0 0 var(--lip);
  }
  .btn-3d:disabled {
    --fill: var(--color-line);
    --lip: var(--color-mist);
    --label: var(--color-stone);
  }

  /* Outline card and tile: choices, word tiles, match pairs */
  .card-3d {
    background: var(--color-bg);
    border: var(--lip-border) solid var(--color-line);
    border-bottom-width: var(--lip-card);
    border-radius: var(--radius-card);
  }
  .card-3d:active {
    transform: translateY(2px);
    border-bottom-width: 2px;
  }
  .card-3d[aria-pressed='true'] {
    border-color: var(--color-selected-border);
    background: var(--color-selected-bg);
  }
}`

export function buildStylesCss(t: DesignTokens, componentsCss: string): string {
  return [
    HEADER,
    '',
    themeBlock(t),
    '',
    rootBlock(t),
    '',
    themeOverrides(t),
    '',
    RECIPE,
    '',
    componentsCss.trim(),
    '',
  ].join('\n')
}
