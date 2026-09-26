/** Quest-def drift, GET /api/practice, and guest → member merge keeping coins and quests. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_APP_CONFIG } from '@zaboon/contracts'
import { QUEST_TEMPLATES } from '@zaboon/game-rules'
import { createHarness, type Harness } from '../api/harness'
import { ALL_ON, api, coinsOf, grantCoins, lesson, read } from './helpers'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h?.close()
})

const now = '2031-05-07T12:00:00.000Z'

describe('quest_defs drift', () => {
  it('the seeded quest_defs rows equal QUEST_TEMPLATES', async () => {
    const rows =
      await h.sql`SELECT id, template, target, reward FROM quest_defs WHERE active ORDER BY id`
    const expected = QUEST_TEMPLATES.map((t) => ({
      id: t.id,
      template: t.metric,
      target: t.target,
      reward: DEFAULT_APP_CONFIG.quests.rewardCoins,
    })).sort((a, b) => a.id.localeCompare(b.id))
    expect(rows.map((r) => ({ ...r }))).toEqual(expected)
  })
})

describe('GET /api/practice', () => {
  it('lists the modes with availability and counts (open mistakes, due words)', async () => {
    const u = await h.guest()
    const fresh = await read(h, api.practice, '/api/practice', u, {
      now,
      flags: { practiceHub: true },
    })
    expect(fresh.status).toBe(200)
    expect(fresh.body).toEqual({
      courseId: 'fa-en',
      modes: [
        { mode: 'mixed', available: true, count: 0 },
        { mode: 'mistakes', available: false, count: 0 },
        // fa-en has no audio yet, so a listening drill has nothing to play.
        { mode: 'listening', available: false, count: null },
        { mode: 'typing', available: false, count: null },
      ],
    })
    await lesson(h, u, { now, wrong: [0] })
    const later = await read(h, api.practice, '/api/practice', u, {
      now: '2031-05-20T12:00:00.000Z',
      flags: { practiceHub: true, persianKeyboard: true },
    })
    expect(later.body.courseId).toBe('fixture')
    const byMode = Object.fromEntries(later.body.modes.map((m: { mode: string }) => [m.mode, m]))
    expect(byMode.mistakes.available).toBe(true)
    expect(byMode.mistakes.count).toBeGreaterThan(0)
    expect(byMode.mixed.count).toBeGreaterThan(0)
    expect(byMode.typing.available).toBe(true)
  })

  it('a practice session with a hub mode completes like any practice session', async () => {
    const u = await h.guest()
    await lesson(h, u, { now })
    const r = await lesson(h, u, {
      now,
      kind: 'practice',
      mode: 'mistakes',
      flags: { practiceHub: true },
    })
    expect(r.kind).toBe('practice')
  })
})

describe('guest → member merge', () => {
  it('keeps coins (ledger = balance) and quest progress', async () => {
    const guest = await h.guest()
    await grantCoins(h, guest.id, 40, 'merge-test')
    await lesson(h, guest, { now, flags: ALL_ON })
    const guestCoins = await coinsOf(h, guest.id)
    const guestQuests = await h.sql`
      SELECT local_date::text AS d, quest_id, progress, claimed FROM user_quests WHERE user_id = ${guest.id} ORDER BY 2`
    expect(guestQuests.length).toBeGreaterThan(0)

    const member = await h.member()
    await grantCoins(h, member.id, 5, 'member-grant')
    const res = await h.call(api.merge, {
      path: '/api/account/merge',
      user: member,
      now,
      flags: ALL_ON,
      body: { guestToken: guest.token },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const merged = await coinsOf(h, member.id)
    expect(merged).toEqual({ wallet: guestCoins.wallet + 5, ledger: guestCoins.ledger + 5 })
    expect(res.body.home.coins).toBe(merged.wallet)
    const memberQuests = await h.sql`
      SELECT local_date::text AS d, quest_id, progress, claimed FROM user_quests WHERE user_id = ${member.id} ORDER BY 2`
    expect(memberQuests.map((r) => ({ ...r }))).toEqual(guestQuests.map((r) => ({ ...r })))
  })

  it('keeps wallet = ledger and the guest net coins when their quest credits overlap', async () => {
    const guest = await h.guest()
    const member = await h.member()
    await lesson(h, guest, { now })
    await lesson(h, member, { now })
    const ledger = async (userId: string, rows: [number, string, string][]) => {
      for (const [amount, reason, ref] of rows)
        await h.sql`INSERT INTO coin_ledger (user_id, amount, reason, ref) VALUES (${userId}, ${amount}, ${reason}, ${ref})`
      const [sum] =
        await h.sql`SELECT coalesce(sum(amount), 0)::int AS n FROM coin_ledger WHERE user_id = ${userId}`
      await h.sql`INSERT INTO wallet (user_id, coins) VALUES (${userId}, ${sum!.n})
                  ON CONFLICT (user_id) DO UPDATE SET coins = excluded.coins`
    }
    // Both claimed the same quest on the same day; the guest also earned 100 and spent it.
    await ledger(guest.id, [
      [10, 'quest', '2031-05-07:xp_20'],
      [100, 'test_grant', 'g'],
      [-100, 'streak_freeze', crypto.randomUUID()],
    ])
    await ledger(member.id, [[10, 'quest', '2031-05-07:xp_20']])
    const guestNet = (await coinsOf(h, guest.id)).ledger
    expect(guestNet).toBe(10)

    const res = await h.call(api.merge, {
      path: '/api/account/merge',
      user: member,
      now,
      body: { guestToken: guest.token },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(await coinsOf(h, member.id)).toEqual({ wallet: 10 + guestNet, ledger: 10 + guestNet })
    const [balancing] =
      await h.sql`SELECT amount FROM coin_ledger WHERE user_id = ${member.id} AND reason = 'merge'`
    expect(balancing!.amount).toBe(10)
    // The guest's purchase moved with its purchaseId.
    const [bought] =
      await h.sql`SELECT count(*)::int AS n FROM coin_ledger WHERE user_id = ${member.id} AND reason = 'streak_freeze'`
    expect(bought!.n).toBe(1)
  })
})
