/**
 * Regression tests for Wave 3 bugs found by QA (ws-qa-2). Each open bug is an `it.fails` test
 * linking its issue: it turns red when the fix lands, and then becomes a plain `it` (#54 is fixed).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from '../api/harness'
import { api, lesson } from '../engagement/helpers'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h?.close()
})

/** Cohorts of the week starting `startsAt`: their `size` counter and their real member count. */
const cohortsOf = (startsAt: string) => h.sql<{ size: number; members: number }[]>`
  SELECT c.size, (SELECT count(*)::int FROM public.league_members m WHERE m.cohort_id = c.id) AS members
  FROM public.league_cohorts c JOIN public.league_weeks w ON w.id = c.week_id
  WHERE w.starts_at = ${startsAt} ORDER BY c.id`

describe('leagues', () => {
  // https://github.com/srasoulj/zaboon/issues/54 (fixed: placement counts live members)
  it("a deleted member's seat is taken by the next learner (fullest open cohort)", async () => {
    const now = '2035-06-06T12:00:00.000Z'
    const startsAt = '2035-06-04T00:00:00.000Z'
    const flags = { leagues: true }
    const users = await Promise.all(Array.from({ length: 31 }, () => h.member()))
    for (const u of users.slice(0, 30)) await lesson(h, u, { now, flags })
    expect(await cohortsOf(startsAt)).toEqual([{ size: 30, members: 30 }])

    const del = await h.call(api.deleteAccount, {
      method: 'DELETE',
      path: '/api/account',
      user: users[5]!,
      now,
    })
    expect(del.status).toBe(200)
    await lesson(h, users[30]!, { now, flags })
    expect(await cohortsOf(startsAt)).toEqual([{ size: 30, members: 30 }])
  })
})
