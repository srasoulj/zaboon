import { describe, expect, it } from 'vitest'
import { aaMinimum, contrastRatio, relativeLuminance, resolveColor, TEXT_PAIRS } from './contrast'
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
        expect(ratio, `${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(aaMinimum(pair.large))
      })
    }
  }

  it('covers every brand fill, honoring labelLargeOnly', () => {
    for (const brand of BRAND_NAMES) {
      const pair = TEXT_PAIRS.find((p) => 'brand' in p.bg && p.bg.brand === brand && p.bg.shade === '500')
      expect(pair, brand).toBeDefined()
      expect(pair!.large).toBe(tokens.brand[brand].labelLargeOnly)
    }
  })

  it('never uses a large-only label as normal text', () => {
    const largeOnly = BRAND_NAMES.filter((b) => tokens.brand[b].labelLargeOnly)
    expect(largeOnly.sort()).toEqual(['anar', 'firouzeh'])
    for (const p of TEXT_PAIRS) {
      if ('brand' in p.fg && p.fg.shade === 'label' && largeOnly.includes(p.fg.brand)) expect(p.large).toBe(true)
    }
  })
})
