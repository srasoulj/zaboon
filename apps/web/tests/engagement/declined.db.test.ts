/**
 * A declined attempt ("Can't trace now": `{kind:'trace', declined: true}`) passes for hearts and
 * re-queue but is not a review: /complete applies no SRS rating from it and never resolves an open
 * mistake with it. A real passing trace does both.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ChallengeResponse } from '@zaboon/contracts'
import { TRACE_MIN_COVERAGE, TRACE_MIN_PRECISION } from '@zaboon/session-engine'
import { api, finish, play, type StartedSession } from '../api/flows'
import { createHarness, type Harness, type TestUser } from '../api/harness'
import { canonicalTokens } from '../api/play'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h?.close()
})

const FLAGS = { persianKeyboard: true, letterTrace: true }

/** A guest at the fixture's u01-t1 (typed Persian + a letter_trace of l_be). */
async function reachT1(): Promise<TestUser> {
  const u = await h.guest()
  await play(h, u)
  await play(h, u, { levelId: 'u01-l1' })
  await play(h, u, { levelId: 'u01-l2' })
  await play(h, u, { kind: 'practice', levelId: 'u01-p1' })
  await play(h, u, { kind: 'unit_review', levelId: 'u01-r1' })
  return u
}

async function startT1(u: TestUser): Promise<StartedSession> {
  const res = await h.call(api.createSession, {
    path: '/api/sessions',
    user: u,
    flags: FLAGS,
    body: { courseId: 'fixture', kind: 'lesson', levelId: 'u01-t1', tz: 'UTC' },
  })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as StartedSession
}

function answers(s: StartedSession, trace: ChallengeResponse) {
  return s.challenges.map((c, i) => ({
    index: c.index,
    attemptSeq: i,
    response:
      c.type === 'letter_trace'
        ? trace
        : ({
            kind: 'text',
            value: canonicalTokens(
              (c as { graph: Parameters<typeof canonicalTokens>[0] }).graph,
            ).join(' '),
          } as const),
    verdict: 'correct' as const,
    ms: 2500,
    hinted: false,
  }))
}

async function letterState(u: TestUser) {
  const [card] =
    await h.sql`SELECT reps, last_review FROM letter_memory WHERE user_id = ${u.id} AND letter_id = 'l_be'`
  const [mistake] =
    await h.sql`SELECT resolved_at FROM mistakes WHERE user_id = ${u.id} AND item_ref = 'letter:l_be'`
  return {
    reps: card ? Number(card.reps) : 0,
    lastReview: card?.last_review ?? null,
    resolved: mistake?.resolved_at ?? null,
  }
}

describe('declined attempts', () => {
  it('pass, but apply no SRS review and resolve no mistake; a real trace does both', async () => {
    const declined = { kind: 'trace', coverage: 0, precision: 0, declined: true } as const
    const good = {
      kind: 'trace',
      coverage: TRACE_MIN_COVERAGE + 0.1,
      precision: TRACE_MIN_PRECISION + 0.1,
    } as const
    const results: Record<string, Awaited<ReturnType<typeof letterState>>> = {}
    for (const [name, trace] of [
      ['declined', declined],
      ['traced', good],
    ] as const) {
      const u = await reachT1()
      await h.sql`INSERT INTO mistakes (user_id, item_ref, last_wrong_at)
                  VALUES (${u.id}, 'letter:l_be', '2026-01-01T00:00:00Z')`
      const before = await letterState(u)
      const s = await startT1(u)
      expect(s.challenges.map((c) => c.type)).toContain('letter_trace')
      const result = await finish(h, u, s, { answers: answers(s, trace) })
      expect(result).toMatchObject({ accuracy: 1, perfect: true })
      expect(result.lives).toMatchObject({ count: 5 })
      const after = await letterState(u)
      if (name === 'declined') {
        expect(after).toEqual(before)
        expect(after.resolved).toBeNull()
      }
      results[name] = after
    }
    expect(results.traced!.resolved).not.toBeNull()
    expect(results.traced!.reps).toBeGreaterThan(0)
  })
})
