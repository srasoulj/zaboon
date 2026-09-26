import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Every CSS-animated component must stop under both the OS setting and the in-app toggle
// (<html data-motion="reduce">, set by MotionPreferenceProvider). Confetti is gated in JS instead.
const css = readFileSync(new URL('./components.css', import.meta.url), 'utf8')
const JS_GATED = ['.zb-confetti__piece']

/** The animated element (last class of the selector) of each rule that starts a CSS animation. */
function animatedClasses(source: string): string[] {
  const out = new Set<string>()
  for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/\banimation(-name)?\s*:\s*(?!none)/.test(m[2]!)) continue
    for (const sel of m[1]!.split(',')) {
      const classes = [...sel.matchAll(/\.zb-[\w-]+/g)].map((c) => c[0])
      if (classes.length) out.add(classes[classes.length - 1]!)
    }
  }
  return [...out].filter((c) => !JS_GATED.includes(c))
}

/** Covered directly, or through a `.block *` rule for BEM elements such as `.zb-char__body`. */
function covers(block: string, cls: string): boolean {
  const root = cls.split('__')[0]!.replace(/--[\w-]+$/, '')
  return (
    new RegExp(`${cls.replace(/[.-]/g, '\\$&')}(?![\\w-])`).test(block) ||
    block.includes(`${root} *`)
  )
}

function reduceBlock(kind: 'media' | 'attr'): string {
  if (kind === 'media') {
    const start = css.indexOf('@media (prefers-reduced-motion: reduce)')
    return css.slice(start, css.indexOf("[data-motion='reduce']", start))
  }
  const m = /\[data-motion='reduce'\] :is\(([^)]*(?:\([^)]*\))?[^)]*)\) \{\s*animation: none;/.exec(
    css,
  )
  return m ? m[1]! : ''
}

describe('reduced motion stops every CSS animation', () => {
  const animated = animatedClasses(css)

  it('finds the animated components', () => {
    for (const c of [
      '.zb-node__start',
      '.zb-feedback',
      '.zb-progress__badge',
      '.zb-toast',
      '.zb-btn__spinner',
      '.zb-char',
    ]) {
      expect(animated.some((a) => a.startsWith(c))).toBe(true)
    }
  })

  it.each(['media', 'attr'] as const)('%s block covers each of them', (kind) => {
    const block = reduceBlock(kind)
    expect(block.length).toBeGreaterThan(0)
    for (const c of animated)
      expect(covers(block, c), `${c} missing from the ${kind} reduce rule`).toBe(true)
  })
})
