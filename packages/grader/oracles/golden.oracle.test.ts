/**
 * ORACLE RUNNER (read-only, orchestrator-owned): executes golden.yaml against the public API.
 * Skipped while the package reports IMPLEMENTATION = 'stub'. Field reference: README.md.
 */
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { looseKey } from '@zaboon/farsi'
import { compile, grade, IMPLEMENTATION, type Lang, type Verdict } from '../src/index'

interface GoldenCase {
  id: string
  lang: Lang
  mode: 'typed' | 'bank'
  accept: string[]
  formal?: string
  pronounDrop?: boolean
  variants?: string[][]
  lexicon?: string[]
  answer: string
  expect: Verdict
  closest?: string
  note: string
}

const cases = parse(readFileSync(new URL('./golden.yaml', import.meta.url), 'utf8')) as GoldenCase[]

const CONTRACTIONS: [RegExp, string][] = [
  [/\bi'm\b/g, 'i am'],
  [/\byou're\b/g, 'you are'],
  [/\bit's\b/g, 'it is'],
  [/\bwhat's\b/g, 'what is'],
  [/\bdon't\b/g, 'do not'],
  [/\bcan't\b/g, 'can not'],
  [/\bcannot\b/g, 'can not'],
  [/\bi'd\b/g, 'i would'],
]

/** Comparison key for `closest` (README): looseKey for Persian; a lenient English key. */
function closestKey(text: string, lang: Lang): string {
  if (lang === 'fa') return looseKey(text)
  let t = text.toLowerCase().replace(/[’‘ʼ]/g, "'")
  t = t.replace(/[.,!?;:"]/g, ' ')
  for (const [re, to] of CONTRACTIONS) t = t.replace(re, to)
  return t.replace(/\s+/g, ' ').trim()
}

describe('grader golden oracle', () => {
  it('has 320 cases with unique ids', () => {
    expect(cases).toHaveLength(320)
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length)
  })

  describe.runIf(IMPLEMENTATION === 'real')('cases', () => {
    it.each(cases)('$id [$lang/$mode] $note', (c) => {
      const graph = compile(c.accept, {
        lang: c.lang,
        ...(c.formal === undefined ? {} : { formal: c.formal }),
        ...(c.pronounDrop === undefined ? {} : { pronounDrop: c.pronounDrop }),
        ...(c.variants === undefined ? {} : { variants: c.variants }),
      })
      const answer = c.mode === 'bank' ? c.answer.split(' ') : c.answer
      const result = grade(graph, answer, { lang: c.lang, mode: c.mode, ...(c.lexicon ? { lexicon: c.lexicon } : {}) })
      expect(result.verdict).toBe(c.expect)
      if (c.closest !== undefined) expect(closestKey(result.closestSolution, c.lang)).toBe(closestKey(c.closest, c.lang))
    })
  })
})
