/**
 * QA: IDOR and privacy of the Wave 3 reads. The leaderboard shows only the caller's cohort through
 * public profile fields (checked on the raw JSON: no user id, email, timezone or private setting),
 * guests get 403, and /api/quests, /api/shop and /api/practice only ever reflect the caller.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, type Harness, type Json, type TestUser } from '../api/harness'
import { api, grantCoins, lesson, read } from '../engagement/helpers'
import { ensureProfile, uuid } from './support'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h?.close()
})

const now = '2034-09-13T12:00:00.000Z'
const ON = { leagues: true, quests: true, shop: true, practiceHub: true }

async function named(name: string, email: string): Promise<TestUser> {
  const m = await h.member(email)
  await ensureProfile(h, m, now)
  const res = await h.call(api.updateProfile, {
    method: 'PATCH',
    path: '/api/profile',
    user: m,
    now,
    body: { displayName: name },
  })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return m
}

describe('GET /api/leaderboard', () => {
  it('lists only the caller cohort, with public fields only (raw JSON)', async () => {
    const alice = await named('Alice QA', `alice-${uuid()}@zaboon.test`)
    const bob = await named('Bob QA', `bob-${uuid()}@zaboon.test`)
    // Carol plays at another tier, so she is in another cohort the same week.
    const carol = await named('Carol QA', `carol-${uuid()}@zaboon.test`)
    await h.sql`INSERT INTO public.user_league (user_id, tier) VALUES (${carol.id}, 'tala')`
    for (const u of [alice, bob, carol]) await lesson(h, u, { now, flags: ON })

    const res = await read(h, api.leaderboard, '/api/leaderboard', alice, { now, flags: ON })
    expect(res.status).toBe(200)
    const raw = JSON.stringify(res.body)
    for (const u of [alice, bob, carol]) {
      expect(raw).not.toContain(u.id)
      expect(raw).not.toContain(u.email!)
    }
    expect(raw).not.toContain('Carol QA')
    expect(raw).not.toMatch(/timezone|settings|email|userId|user_id|"id"/)
    expect(res.body.members.map((m: Json) => m.displayName).sort()).toEqual(['Alice QA', 'Bob QA'])
    for (const m of res.body.members)
      expect(Object.keys(m).sort()).toEqual(
        ['avatar', 'displayName', 'isMe', 'rank', 'username', 'weeklyXp', 'zone'].sort(),
      )
    expect(res.body.members.filter((m: Json) => m.isMe)).toEqual([
      expect.objectContaining({ displayName: 'Alice QA' }),
    ])
    const own = await read(h, api.leaderboard, '/api/leaderboard', carol, { now, flags: ON })
    expect(own.body.members.map((m: Json) => m.displayName)).toEqual(['Carol QA'])
  })

  it('a guest gets 403, with the flag on or off', async () => {
    const g = await h.guest()
    await lesson(h, g, { now, flags: ON })
    for (const flags of [ON, { leagues: false }]) {
      const res = await read(h, api.leaderboard, '/api/leaderboard', g, { now, flags })
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('forbidden')
    }
  })
})

describe('quests, shop and practice reflect only the caller', () => {
  it("another learner's progress, coins, freezes and mistakes never show up", async () => {
    const alice = await h.guest()
    await ensureProfile(h, alice, now)
    await grantCoins(h, alice.id, 777, uuid())
    await lesson(h, alice, { now, flags: ON, wrong: [0] })
    const bob = await h.guest()
    await ensureProfile(h, bob, now)

    const reads = async (u: TestUser) => ({
      quests: (await read(h, api.quests, '/api/quests', u, { now, flags: ON })).body,
      shop: (await read(h, api.shop, '/api/shop', u, { now, flags: ON })).body,
      practice: (await read(h, api.practice, '/api/practice', u, { now, flags: ON })).body,
    })
    const b = await reads(bob)
    expect(b.shop.coins).toBe(0)
    expect(b.quests.quests.every((q: Json) => q.progress === 0)).toBe(true)
    const mistakes = b.practice.modes.find((m: Json) => m.mode === 'mistakes')
    expect(mistakes).toMatchObject({ available: false, count: 0 })
    expect(JSON.stringify(b)).not.toContain(alice.id)

    const a = await reads(alice)
    expect(a.shop.coins).toBeGreaterThanOrEqual(777)
    expect(a.quests.quests.some((q: Json) => q.progress > 0)).toBe(true)
    expect(a.practice.modes.find((m: Json) => m.mode === 'mistakes')).toMatchObject({
      available: true,
    })
    // Bob's reads did not change after Alice's activity; and his own lesson moves only his.
    await lesson(h, bob, { now, flags: ON })
    expect((await reads(alice)).shop.coins).toBe(a.shop.coins)
  })
})
