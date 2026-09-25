/**
 * ORACLE RUNNER (read-only, orchestrator-owned): executes normalize.yaml against the public API.
 * Skipped while the package reports IMPLEMENTATION = 'stub'.
 */
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { IMPLEMENTATION, looseKey, normalize } from '../src/index'

interface NormalizeCase {
  id: string
  input: string
  normalized: string
  loose: string
  note: string
}

const cases = parse(readFileSync(new URL('./normalize.yaml', import.meta.url), 'utf8')) as NormalizeCase[]

describe('normalize oracle', () => {
  it('has 136 cases with unique ids', () => {
    expect(cases).toHaveLength(136)
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length)
  })

  describe.runIf(IMPLEMENTATION === 'real')('cases', () => {
    it.each(cases)('$id: $note', (c) => {
      expect(normalize(c.input)).toBe(c.normalized)
      expect(looseKey(c.input)).toBe(c.loose)
    })
  })
})
