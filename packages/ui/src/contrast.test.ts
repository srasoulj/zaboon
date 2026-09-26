import { describe, expect, it } from 'vitest'
import {
  aaMinimum,
  contrastRatio,
  FOCUS_RING_SURFACES,
  focusRingContrast,
  relativeLuminance,
  resolveColor,
  TEXT_PAIRS,
} from './contrast'
import { BRAND_NAMES, tokens, type ThemeName } from './tokens'

describe('contrast math (WCAG 2.2)', () => {
  it('matches the reference extremes', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10)
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 10)
  })

  it('is symmetric', () => {
    expect(contrastRatio('#0E9F99', '#FFFFFF')).toBeCloseTo(contrastRatio('#FFFFFF', '#0E9F99'), 10)
  })

  it('agrees with the ratios quoted in DESIGN-SYSTEM §4.1 (one decimal)', () => {
    expect(contrastRatio('#FFFFFF', '#0E9F99')).toBeCloseTo(3.3, 1)
    expect(contrastRatio('#FFFFFF', '#2D5BD7')).toBeCloseTo(5.8, 0)
    expect(contrastRatio('#FFFFFF', '#E5484D')).toBeCloseTo(3.9, 0)
  })

  it('uses 3:1 for large text and 4.5:1 otherwise', () => {
    expect(aaMinimum(true)).toBe(3)
    expect(aaMinimum(false)).toBe(4.5)
  })
})

describe('every text/background pair passes WCAG AA', () => {
  const themes: ThemeName[] = ['light', 'dark']
  for (const theme of themes) {
    for (const pair of TEXT_PAIRS) {
      it(`${theme}: ${pair.use}`, () => {
        const fg = resolveColor(pair.fg, theme)
        const bg = resolveColor(pair.bg, theme)
        const ratio = contrastRatio(fg, bg)
        expect(ratio, `${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          aaMinimum(pair.large),
        )
      })
    }
  }

  it('covers every brand fill, honoring labelLargeOnly', () => {
    for (const brand of BRAND_NAMES) {
      const pair = TEXT_PAIRS.find(
        (p) => 'brand' in p.bg && p.bg.brand === brand && p.bg.shade === '500',
      )
      expect(pair, brand).toBeDefined()
      expect(pair!.large).toBe(tokens.brand[brand].labelLargeOnly)
    }
  })

  it('never uses a large-only label as normal text', () => {
    const largeOnly = BRAND_NAMES.filter((b) => tokens.brand[b].labelLargeOnly)
    expect(largeOnly.sort()).toEqual(['anar', 'firouzeh'])
    for (const p of TEXT_PAIRS) {
      if ('brand' in p.fg && p.fg.shade === 'label' && largeOnly.includes(p.fg.brand))
        expect(p.large).toBe(true)
    }
  })
})

describe('the focus ring is visible on every surface (WCAG 1.4.11, ≥3:1)', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const { use, surface } of FOCUS_RING_SURFACES) {
      it(`${theme}: ${use}`, () => {
        const { between, vsSurface } = focusRingContrast(surface, theme)
        expect(between, 'ink band vs bg halo').toBeGreaterThanOrEqual(3)
        expect(vsSurface, `ring vs ${resolveColor(surface, theme)}`).toBeGreaterThanOrEqual(3)
      })
    }
  }

  it('covers the surfaces the review measured (brand banners, feedback bars, surface)', () => {
    const uses = FOCUS_RING_SURFACES.map((f) => f.use).join('\n')
    for (const b of ['lajvard', 'anar', 'firouzeh', 'pesteh'])
      expect(uses).toContain(`${b}-500 fill`)
    expect(uses).toContain('correct feedback bar')
    expect(uses).toContain('wrong feedback bar')
    expect(uses).toContain('surface (')
  })
})

describe('styles.css focus ring', () => {
  it('uses the ink band and bg halo (not a single brand colour)', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
    expect(css).toContain('outline: 3px solid var(--color-ink);')
    expect(css).toMatch(
      /--zb-ring-halo: 0 0 0 calc\(var\(--zb-ring-offset\) \+ 6px\) var\(--color-bg\);/,
    )
    expect(css).not.toContain('outline: 3px solid var(--color-lajvard-500)')
  })
})
