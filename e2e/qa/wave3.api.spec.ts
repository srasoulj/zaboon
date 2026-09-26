/**
 * Wave 3 over HTTP against the running app: the weekly rollover through its Vercel Cron route
 * (cronHeaders()) for a PAST week promotes and demotes as the leaderboard zones said and pays
 * coins exactly once; the cron without its header or with a wrong secret answers 401.
 *
 * Isolation: the local database is shared and never reset, and every rollover closes EVERY week
 * that has ended, so another spec's rollover may close this spec's week at any moment. The week
 * comes from randomPastWeek(), and nothing here asserts WHICH run closed it: only its outcome
 * (lastResult, tiers, coins), which is the same whoever closes it. If a concurrent rollover closes
 * the week before every member has joined, the setup is retried in a fresh week.
 */
import type { APIRequestContext } from '@playwright/test'
import { cronHeaders, expect, flagsHeader, test } from '../fixtures'
import { randomPastWeek } from '../engagement/helpers'
import { newGuest, signInEmail, uniqueEmail } from '../pages/helpers'
import { call, type Body, type User } from './support'
import { apiUser, onboard10, playOn, readOn, setTier } from './wave3-support'

const LEAGUES = { leagues: true }
const WITH_SHOP = { leagues: true, shop: true }

type Week = Awaited<ReturnType<typeof randomPastWeek>>

/** Five noqreh members who each joined `week`, member i with i + 1 lessons of XP. */
async function cohort(request: APIRequestContext): Promise<{ week: Week; members: User[] }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const week = await randomPastWeek()
    const members: User[] = []
    for (let i = 0; i < 5; i++) {
      const u = apiUser(await signInEmail(request, uniqueEmail()))
      await onboard10(request, u, week.now)
      await setTier(u.id, 'noqreh')
      members.push(u)
    }
    // Every lesson must land in the week: a closed week takes no XP, which shows as a weekly XP
    // that didn't grow (then the zones would not follow the lesson counts: start over).
    let intact = true
    for (const [i, m] of members.entries())
      for (let n = 0; n <= i; n++) {
        const r = await playOn(request, m, LEAGUES, { now: week.now })
        if ((r.league as { weeklyXp: number }).weeklyXp !== 15 * (n + 1)) intact = false
      }
    if (intact) return { week, members }
  }
  throw new Error('another rollover closed three fresh weeks during setup')
}

const rollover = (request: APIRequestContext, headers: Record<string, string>) =>
  request.get('/api/cron/league-rollover', { headers })

test('the cron answers 401 without its secret or with a wrong one', async ({ request }) => {
  expect((await rollover(request, {})).status()).toBe(401)
  expect((await rollover(request, { authorization: 'Bearer wrong-secret' })).status()).toBe(401)
  const bearer = cronHeaders().authorization!
  expect((await rollover(request, { authorization: bearer.replace('Bearer ', '') })).status()).toBe(
    401,
  )
})

test('a past week rolls over through the cron: promotions, demotions, coins paid once', async ({
  request,
}) => {
  const { week, members } = await cohort(request)
  // What the board says the rollover will do, per member (and nothing private in the raw JSON).
  const zones: Body[] = []
  for (const m of members) {
    const board = await readOn(request, m, '/api/leaderboard', week.now, LEAGUES)
    expect(board).toMatchObject({ tier: 'noqreh', joined: true, promoteCount: 2, demoteCount: 1 })
    expect(board.members).toHaveLength(5)
    const raw = JSON.stringify(board)
    for (const other of members) expect(raw).not.toContain(other.id)
    zones.push((board.members as Body[]).find((x) => x.isMe)!)
  }
  expect(zones.map((z) => z.zone)).toEqual(['demote', 'stay', 'stay', 'promote', 'promote'])
  const before = await Promise.all(
    members.map(async (m) => (await readOn(request, m, '/api/shop', week.now, WITH_SHOP)).coins),
  )

  // At the real clock, like Vercel Cron (the cron bucket's rate limit runs on the request clock).
  const first = await rollover(request, cronHeaders())
  expect(first.status(), await first.text()).toBe(200)
  const second = await rollover(request, cronHeaders())
  expect(second.status()).toBe(200)
  // Whoever closed it, this week is closed by now and is never closed again.
  const again = (await second.json()) as { closed: { week: { startsAt: string } }[] }
  expect(again.closed.map((c) => c.week.startsAt)).not.toContain(week.startsAt)

  const reward = [30, 20, 10, 0, 0]
  const newTier = { promote: 'tala', stay: 'noqreh', demote: 'mes' } as Record<string, string>
  const paid: number[] = []
  for (const [i, m] of members.entries()) {
    const z = zones[i]!
    const next = await readOn(request, m, '/api/leaderboard', week.after, LEAGUES)
    expect(next).toMatchObject({
      tier: newTier[z.zone as string],
      lastResult: {
        week: { startsAt: week.startsAt, endsAt: week.endsAt },
        tier: 'noqreh',
        rank: z.rank,
        outcome: z.zone,
        newTier: newTier[z.zone as string],
        coins: reward[(z.rank as number) - 1],
      },
    })
    const coins = (await readOn(request, m, '/api/shop', week.after, WITH_SHOP)).coins as number
    expect(coins, `member ${i}`).toBe((before[i] as number) + reward[(z.rank as number) - 1]!)
    paid.push(coins)
  }
  // A third run (another spec's or this one's) pays nothing more.
  expect((await rollover(request, cronHeaders())).status()).toBe(200)
  for (const [i, m] of members.entries())
    expect((await readOn(request, m, '/api/shop', week.after, WITH_SHOP)).coins).toBe(paid[i])
})

test('a guest gets 403 from the leaderboard; the engagement reads need their flags', async ({
  request,
}) => {
  const g = apiUser(await newGuest(request))
  const on = flagsHeader({ leagues: true, quests: true, shop: true, practiceHub: true })
  expect((await call(request, g, '/api/leaderboard', { headers: on })).status).toBe(403)
  for (const path of ['/api/quests', '/api/shop', '/api/practice']) {
    expect((await call(request, g, path, { headers: on })).status, path).toBe(200)
    expect((await call(request, g, path)).status, path).toBe(404)
  }
})
