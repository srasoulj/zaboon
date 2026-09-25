/** With every engagement flag off the app behaves exactly as the MVP: no new fields, no P2 writes, 404s. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from '../api/harness'
import type { ALL_ON } from './helpers'
import { api, cronAuth, lesson, p2Rows, read, useCronSecret } from './helpers'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
  useCronSecret()
})
afterAll(async () => {
  await h?.close()
})

const now = '2031-05-07T12:00:00.000Z'

describe('engagement flags off', () => {
  it('home and the lesson result have no coins, league or quests; nothing P2 is written', async () => {
    for (const user of [await h.guest(), await h.member()]) {
      const result = await lesson(h, user, { now })
      expect(result.xp.total).toBe(15)
      expect(result).not.toHaveProperty('coins')
      expect(result).not.toHaveProperty('league')
      expect(result).not.toHaveProperty('quests')
      const home = await read(h, api.home, '/api/home', user, { now })
      expect(home.status).toBe(200)
      expect(home.body).not.toHaveProperty('coins')
      expect(home.body).not.toHaveProperty('league')
      expect(home.body).not.toHaveProperty('quests')
      expect(await p2Rows(h, user.id)).toEqual({
        wallet: 0,
        coin_ledger: 0,
        league_members: 0,
        user_league: 0,
        user_quests: 0,
      })
    }
    const [weeks] = await h.sql`SELECT count(*)::int AS n FROM public.league_weeks`
    expect(weeks!.n).toBe(0)
  })

  it('every P2 learner route answers 404 not_found', async () => {
    const member = await h.member()
    const guest = await h.guest()
    const purchaseId = crypto.randomUUID()
    const calls = [
      read(h, api.leaderboard, '/api/leaderboard', member),
      read(h, api.quests, '/api/quests', guest),
      read(h, api.shop, '/api/shop', guest),
      read(h, api.practice, '/api/practice', guest),
      h.call(api.purchase, {
        path: '/api/shop/purchase',
        user: guest,
        body: { item: 'streak_freeze', purchaseId },
      }),
      h.call(api.refill, { path: '/api/lives/refill', user: guest, body: { purchaseId } }),
    ]
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('not_found')
    }
  })

  it('each route follows its own flag', async () => {
    const member = await h.member()
    const only = (name: keyof typeof ALL_ON) => ({
      leagues: false,
      quests: false,
      shop: false,
      practiceHub: false,
      [name]: true,
    })
    expect(
      (await read(h, api.leaderboard, '/api/leaderboard', member, { flags: only('quests') }))
        .status,
    ).toBe(404)
    expect(
      (await read(h, api.leaderboard, '/api/leaderboard', member, { flags: only('leagues') }))
        .status,
    ).toBe(200)
    expect((await read(h, api.quests, '/api/quests', member, { flags: only('shop') })).status).toBe(
      404,
    )
    expect(
      (await read(h, api.quests, '/api/quests', member, { flags: only('quests') })).status,
    ).toBe(200)
    expect((await read(h, api.shop, '/api/shop', member, { flags: only('quests') })).status).toBe(
      404,
    )
    expect((await read(h, api.shop, '/api/shop', member, { flags: only('shop') })).status).toBe(200)
    expect(
      (await read(h, api.practice, '/api/practice', member, { flags: only('shop') })).status,
    ).toBe(404)
    expect(
      (await read(h, api.practice, '/api/practice', member, { flags: only('practiceHub') })).status,
    ).toBe(200)
  })

  it('home shows only the fields whose flag is on', async () => {
    const member = await h.member()
    const home = (flags: Record<string, boolean>) =>
      read(h, api.home, '/api/home', member, { now, flags }).then((r) => r.body)
    const shop = await home({ shop: true })
    expect(shop.coins).toBe(0)
    expect(shop).not.toHaveProperty('league')
    expect(shop).not.toHaveProperty('quests')
    const quests = await home({ quests: true })
    expect(quests.coins).toBe(0)
    expect(quests.quests).toHaveLength(3)
    expect(quests).not.toHaveProperty('league')
    const leagues = await home({ leagues: true })
    expect(leagues).not.toHaveProperty('coins')
    expect(leagues.league).toMatchObject({ tier: 'mes', joined: false, rank: null, weeklyXp: 0 })
    // Reads never write.
    expect(await p2Rows(h, member.id)).toMatchObject({
      wallet: 0,
      user_quests: 0,
      league_members: 0,
    })
  })

  it('the rollover cron needs its secret and has nothing to close', async () => {
    const res = await read(h, api.rollover, '/api/cron/league-rollover', null, { now })
    expect(res.status).toBe(401)
    const ok = await read(h, api.rollover, '/api/cron/league-rollover', null, {
      now,
      headers: cronAuth,
    })
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({
      closed: [],
      current: { startsAt: '2031-05-05T00:00:00.000Z', endsAt: '2031-05-12T00:00:00.000Z' },
    })
  })
})
