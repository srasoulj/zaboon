import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildStylesCss } from './build-css'
import { BRAND_NAMES, ms, px, SEMANTIC_NAMES, tokens } from './tokens'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('tokens', () => {
  it('parses every brand color and both themes', () => {
    for (const b of BRAND_NAMES) expect(tokens.brand[b]['500']).toMatch(/^#[0-9A-F]{6}$/i)
    for (const n of SEMANTIC_NAMES) {
      expect(tokens.theme.light[n]).toMatch(/^#[0-9A-F]{6}$/i)
      expect(tokens.theme.dark[n]).toMatch(/^#[0-9A-F]{6}$/i)
    }
    expect(tokens.path.offsets).toEqual([0, -45, -70, -45, 0, 45, 70, 45])
  })

  it('parses durations and lengths', () => {
    expect(ms(tokens.motion.tileFly)).toBe(250)
    expect(px(tokens.path.nodeSize)).toBe(70)
    expect(() => ms('1s')).toThrow()
    expect(() => px('1rem')).toThrow()
  })
})

describe('styles.css', () => {
  const css = read('./styles.css')

  it('is up to date with tokens.json and components.css (run `pnpm --filter @zaboon/ui tokens`)', () => {
    expect(css).toBe(buildStylesCss(tokens, read('./components.css')))
  })

  it('keeps the variables globals.css relies on', () => {
    for (const v of ['--color-bg', '--color-ink', '--font-latin', '--font-persian']) {
      expect(css).toMatch(new RegExp(`^\\s+${v}: `, 'm'))
    }
  })

  it('has a Tailwind @theme block, dark mode via media query and a [data-theme] override', () => {
    expect(css).toContain('@theme {')
    expect(css).toContain('@media (prefers-color-scheme: dark)')
    expect(css).toContain(':root:not([data-theme="light"])')
    expect(css).toContain('[data-theme="dark"] {')
    expect(css).toContain('[data-theme="light"] {')
    expect(css).toContain(`--color-bg: ${tokens.theme.dark.bg};`)
  })

  it('contains the 3D recipe of DESIGN-SYSTEM §4.3', () => {
    expect(css).toContain('box-shadow: 0 var(--lip-button) 0 var(--lip);')
    expect(css).toContain('.btn-3d:active {')
    expect(css).toContain('.btn-3d:disabled {')
    expect(css).toContain(".card-3d[aria-pressed='true'] {")
    expect(css).toContain('--lip-button: 4px;')
    expect(css).toContain('--radius-button: 12px;')
  })

  it('exposes the path offsets from tokens', () => {
    tokens.path.offsets.forEach((o, i) => expect(css).toContain(`--path-offset-${i}: ${o}px;`))
  })
})
