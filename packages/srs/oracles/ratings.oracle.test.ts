/**
 * Oracle runner for @zaboon/srs: executes ratings.yaml (read-only) against the public API. The case
 * count is always checked; the cases run once IMPLEMENTATION is 'real'.
 *
 * ratingFor rates one pre-aggregated ItemOutcome, so the per-item aggregation the oracle pins
 * (group a session's attempts by item, ignore `skipped`, passing verdicts count as correct, an item
 * with only skipped attempts gets null) is caller glue below. The rating itself comes from the package.
 */
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_CONFIG as cfg, PASSING_VERDICTS } from '@zaboon/contracts'
import type { SrsRating, Verdict } from '@zaboon/contracts'
import { IMPLEMENTATION, ratingFor } from '../src/index'
import type { ItemOutcome } from '../src/index'

interface Attempt {
  item: string
  verdict: Verdict
  ms: number
  hinted: boolean
}
interface RatingCase {
  id: string
  rule: 'rating'
  note: string
  input: { attempts: Attempt[] }
  expected: { ratings: Record<string, SrsRating | null> }
}

function loadCases(url: URL): RatingCase[] {
  const data: unknown = parse(readFileSync(url, 'utf8'))
  if (!Array.isArray(data)) throw new Error(`${url.pathname}: expected a YAML list of cases`)
  return data as RatingCase[]
}

/** A session's attempts -> one ItemOutcome per item, or null when every attempt was skipped. */
function outcomesByItem(attempts: readonly Attempt[]): Map<string, ItemOutcome | null> {
  const byItem = new Map<string, Attempt[]>()
  for (const a of attempts) byItem.set(a.item, [...(byItem.get(a.item) ?? []), a])
  const outcomes = new Map<string, ItemOutcome | null>()
  for (const [item, all] of byItem) {
    const rated = all.filter((a) => a.verdict !== 'skipped') // skipped answers are not rated
    const passing = rated.filter((a) => PASSING_VERDICTS.includes(a.verdict))
    outcomes.set(
      item,
      rated.length === 0
        ? null
        : {
            wrongAttempts: rated.length - passing.length,
            maxMs: Math.max(0, ...passing.map((a) => a.ms)),
            hinted: rated.some((a) => a.hinted),
          },
    )
  }
  return outcomes
}

const cases = loadCases(new URL('./ratings.yaml', import.meta.url))

describe('oracles/ratings.yaml', () => {
  it('has 16 cases', () => {
    expect(cases).toHaveLength(16)
  })
  describe.runIf(IMPLEMENTATION === 'real')('cases', () => {
    it.each(cases)('$id', (c) => {
      expect(c.rule).toBe('rating')
      const ratings = Object.fromEntries(
        [...outcomesByItem(c.input.attempts)].map(([item, outcome]) => [
          item,
          outcome === null ? null : ratingFor(outcome, cfg.srs.slowMs),
        ]),
      )
      expect(ratings).toEqual(c.expected.ratings)
    })
  })
})
