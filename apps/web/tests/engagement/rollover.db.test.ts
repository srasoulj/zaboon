/** GET /api/cron/league-rollover: ranks, outcomes, tiers and reward coins; idempotent; missed weeks. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, type Harness, type TestUser } from '../api/harness'
import { api, coinsOf, cronAuth, lesson, read, useCronSecret } from './helpers'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
  await h.setFlags({ leagues: true })
  useCronSecret()
})
afterAll(async () => {
  await h?.close()
})

const rollover = (now: string, headers: Record<string, string> = cronAuth) =>
  read(h, api.rollover, '/api/cron/league-rollover', null, { now, headers })

/** `n` members who joined the week of `now` in `tier`, with the given weekly XP (index order). */
async function cohort(now: string, tier: string, xp: number[]): Promise<TestUser[]> {
  const users: TestUser[] = []
  for (const x of xp) {
    const u = await h.member()
    if (tier !== 'mes')
      await h.sql`INSERT INTO user_league (user_id, tier) VALUES (${u.id}, ${tier})`
    await lesson(h, u, { now })
    await h.sql`UPDATE league_members SET weekly_xp = ${x} WHERE user_id = ${u.id}`
    users.push(u)
  }
  return users
}

async function standing(u: TestUser, startsAt: string) {
  const [row] = await h.sql`
    SELECT m.final_rank, m.outcome, (SELECT tier FROM user_league WHERE user_id = m.user_id) AS tier
    FROM league_members m JOIN league_weeks w ON w.id = m.week_id
    WHERE m.user_id = ${u.id} AND w.starts_at = ${startsAt}`
  return row
}

describe('league rollover', () => {
  it('needs the cron secret', async () => {
    expect((await rollover('2031-05-12T00:00:05.000Z', {})).status).toBe(401)
    expect(
      (await rollover('2031-05-12T00:00:05.000Z', { authorization: 'Bearer nope' })).status,
    ).toBe(401)
  })

  it('closes the ended week: ranks, promotions/demotions, tiers and reward coins, once', async () => {
    const wed = '2031-05-07T12:00:00.000Z'
    const startsAt = '2031-05-05T00:00:00.000Z'
    const mes = await cohort(wed, 'mes', [50, 40, 30, 20, 10, 5])
    const tala = await cohort(wed, 'tala', [100, 90, 80, 70, 60, 50, 40, 30, 20, 10])

    // Before the week ends nothing closes (a manual run on Sunday night).
    const early = await rollover('2031-05-11T23:59:59.000Z')
    expect(early.body.closed).toEqual([])

    const res = await rollover('2031-05-12T00:00:05.000Z')
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body).toEqual({
      closed: [
        {
          week: { startsAt, endsAt: '2031-05-12T00:00:00.000Z' },
          cohorts: 2,
          members: 16,
          // mes: ceil(6/4) = 2 up, none down; tala: ceil(10/4) = 3 up, floor(10/5) = 2 down.
          promoted: 5,
          demoted: 2,
        },
      ],
      current: { startsAt: '2031-05-12T00:00:00.000Z', endsAt: '2031-05-19T00:00:00.000Z' },
    })
    expect(await standing(mes[0]!, startsAt)).toEqual({
      final_rank: 1,
      outcome: 'promote',
      tier: 'noqreh',
    })
    expect(await standing(mes[2]!, startsAt)).toEqual({
      final_rank: 3,
      outcome: 'stay',
      tier: 'mes',
    })
    expect(await standing(mes[5]!, startsAt)).toEqual({
      final_rank: 6,
      outcome: 'stay',
      tier: 'mes',
    })
    expect(await standing(tala[2]!, startsAt)).toEqual({
      final_rank: 3,
      outcome: 'promote',
      tier: 'firouzeh',
    })
    expect(await standing(tala[5]!, startsAt)).toEqual({
      final_rank: 6,
      outcome: 'stay',
      tier: 'tala',
    })
    expect(await standing(tala[9]!, startsAt)).toEqual({
      final_rank: 10,
      outcome: 'demote',
      tier: 'noqreh',
    })

    // Reward coins: 30 / 20 / 10 for ranks 1-3 of each cohort, ledger = balance.
    const coins = async (u: TestUser) => (await coinsOf(h, u.id)).wallet
    expect([
      await coins(mes[0]!),
      await coins(mes[1]!),
      await coins(mes[2]!),
      await coins(mes[3]!),
    ]).toEqual([30, 20, 10, 0])
    expect(await coins(tala[0]!)).toBe(30)
    for (const u of [...mes, ...tala]) {
      const c = await coinsOf(h, u.id)
      expect(c.wallet).toBe(c.ledger)
    }
    const [closed] = await h.sql`SELECT closed_at FROM league_weeks WHERE starts_at = ${startsAt}`
    expect(closed!.closed_at).not.toBeNull()

    // Idempotent: a second run closes nothing and pays nothing again.
    const again = await rollover('2031-05-12T00:01:00.000Z')
    expect(again.body.closed).toEqual([])
    expect(await coins(mes[0]!)).toBe(30)

    // The next week's leaderboard shows last week's result and the new tier.
    const board = await read(h, api.leaderboard, '/api/leaderboard', mes[0]!, {
      now: '2031-05-13T12:00:00.000Z',
    })
    expect(board.body).toMatchObject({
      tier: 'noqreh',
      joined: false,
      lastResult: {
        week: { startsAt, endsAt: '2031-05-12T00:00:00.000Z' },
        tier: 'mes',
        rank: 1,
        outcome: 'promote',
        newTier: 'noqreh',
        coins: 30,
      },
    })
    // Their first XP of the new week places them in a noqreh cohort.
    const next = await lesson(h, mes[0]!, { now: '2031-05-13T12:00:00.000Z' })
    expect(next.league).toMatchObject({ tier: 'noqreh', joinedNow: true })
  })

  it('a closed week never receives XP', async () => {
    const startsAt = '2031-07-07T00:00:00.000Z'
    const u = (await cohort('2031-07-09T12:00:00.000Z', 'mes', [5]))[0]!
    await rollover('2031-07-14T00:00:05.000Z')
    const weeklyXp = async () => {
      const [row] = await h.sql`
        SELECT m.weekly_xp FROM league_members m JOIN league_weeks w ON w.id = m.week_id
        WHERE m.user_id = ${u.id} AND w.starts_at = ${startsAt}`
      return row!.weekly_xp as number
    }
    expect(await weeklyXp()).toBe(5)
    // A commit whose clock is still in the closed week (a late request) earns XP but no league XP.
    const late = await lesson(h, u, { now: '2031-07-13T23:00:00.000Z' })
    expect(late.xp.total).toBeGreaterThan(0)
    expect(await weeklyXp()).toBe(5)
    // Nor can a new learner join the closed week.
    const v = await h.member()
    const r = await lesson(h, v, { now: '2031-07-13T23:00:00.000Z' })
    expect(r.league).toMatchObject({ rank: null, joinedNow: false })
    const [n] = await h.sql`SELECT count(*)::int AS n FROM league_members WHERE user_id = ${v.id}`
    expect(n!.n).toBe(0)
  })

  it('closes missed weeks oldest first, and two runs at once close each week once', async () => {
    const w1 = await cohort('2031-06-04T12:00:00.000Z', 'mes', [30, 20])
    const w2 = await cohort('2031-06-11T12:00:00.000Z', 'mes', [10, 40])
    const now = '2031-06-20T09:00:00.000Z'
    const [a, b] = await Promise.all([rollover(now), rollover(now)])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    const closed = [...a.body.closed, ...b.body.closed].map(
      (c: { week: { startsAt: string } }) => c.week.startsAt,
    )
    // Each missed week is closed by exactly one of the two runs.
    for (const w of ['2031-06-02T00:00:00.000Z', '2031-06-09T00:00:00.000Z'])
      expect(closed.filter((x) => x === w)).toHaveLength(1)
    expect(new Set(closed).size).toBe(closed.length)
    // One run closes them in order (oldest first).
    for (const r of [a, b]) {
      const s = r.body.closed.map((c: { week: { startsAt: string } }) => c.week.startsAt)
      expect(s).toEqual([...s].sort())
    }
    // Rewards paid once per week.
    expect((await coinsOf(h, w1[0]!.id)).wallet).toBe(30)
    expect((await coinsOf(h, w2[1]!.id)).wallet).toBe(30)
    expect((await coinsOf(h, w2[0]!.id)).wallet).toBe(20)
    const [open] =
      await h.sql`SELECT count(*)::int AS n FROM league_weeks WHERE closed_at IS NULL AND ends_at <= ${now}`
    expect(open!.n).toBe(0)
  })
})
