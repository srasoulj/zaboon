/**
 * QA: time travel with `x-test-now` for quests and leagues (ARCHITECTURE §6, §10.6).
 * - Quests reset at the profile timezone's local midnight, also across DST changes (New York's
 *   23-hour spring-forward day; Santiago, where the midnight of the change doesn't exist), and a
 *   lesson completed just before midnight counts for that day.
 * - League XP lands in the week that contains `ctx.now`.
 * - The rollover cron promotes and demotes exactly as the leaderboard zones said, pays once, and
 *   answers 401 without its secret or with a wrong one.
 * This file uses a private database, so its rollover can close any week it likes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dateInZone } from '@zaboon/game-rules'
import { createHarness, type Harness, type Json, type TestUser } from '../api/harness'
import {
  api,
  coinsOf,
  completeRaw,
  cronAuth,
  lesson,
  read,
  startLesson,
  useCronSecret,
} from '../engagement/helpers'
import { ensureProfile } from './support'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
  useCronSecret()
})
afterAll(async () => {
  await h?.close()
})

const nextDate = (d: string) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

const quests = async (user: TestUser, now: string) => {
  const res = await read(h, api.quests, '/api/quests', user, { now, flags: { quests: true } })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as {
    date: string
    resetsAt: string
    quests: { id: string; progress: number; completed: boolean }[]
  }
}

describe('quests reset at the local midnight of the profile timezone', () => {
  const cases = [
    {
      tz: 'America/New_York',
      // Sat 2033-03-12 23:58 EST → the lesson; the next day (Mar 13) is 23 hours long.
      startedAt: '2033-03-13T04:58:00.000Z',
      completedAt: '2033-03-13T04:59:30.000Z',
      committedAt: '2033-03-13T05:00:30.000Z',
      day: '2033-03-12',
      reset: '2033-03-13T05:00:00.000Z',
      nextReset: '2033-03-14T04:00:00.000Z',
    },
    {
      tz: 'America/Santiago',
      // Sat 2033-09-03 23:58 -04 → the lesson; the clocks then jump from 24:00 to 01:00 -03.
      startedAt: '2033-09-04T03:58:00.000Z',
      completedAt: '2033-09-04T03:59:30.000Z',
      committedAt: '2033-09-04T04:00:30.000Z',
      day: '2033-09-03',
      reset: '2033-09-04T04:00:00.000Z',
      nextReset: '2033-09-05T03:00:00.000Z',
    },
  ]
  for (const c of cases) {
    it(`${c.tz}: a lesson finished at 23:59 counts for that day; the next day starts fresh`, async () => {
      const u = await h.guest()
      const flags = { quests: true }
      const s = await startLesson(h, u, { now: c.startedAt, tz: c.tz, flags })
      // The request lands after midnight; completedAt (clamped to [start, now]) is before it.
      const res = await completeRaw(h, u, s, {
        now: c.committedAt,
        completedAt: c.completedAt,
        flags,
      })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(res.body.localDate).toBe(c.day)
      const counted = (res.body.quests as { progress: number }[]).reduce(
        (n, q) => n + q.progress,
        0,
      )
      // A perfect lesson moves at least one of the three quests (only 2 metrics ignore lessons).
      expect(counted).toBeGreaterThan(0)

      const before = await quests(u, new Date(Date.parse(c.reset) - 1).toISOString())
      expect(before.date).toBe(c.day)
      expect(before.resetsAt).toBe(c.reset)
      expect(before.quests.map((q) => q.progress)).toEqual(
        (res.body.quests as { progress: number }[]).map((q) => q.progress),
      )

      const after = await quests(u, c.reset)
      expect(after.date).toBe(nextDate(c.day))
      expect(after.resetsAt).toBe(c.nextReset)
      expect(after.quests.every((q) => q.progress === 0 && !q.completed)).toBe(true)
      // resetsAt is exactly the first instant of the next local date.
      for (const q of [before, after]) {
        expect(dateInZone(new Date(Date.parse(q.resetsAt) - 1), c.tz)).toBe(q.date)
        expect(dateInZone(new Date(q.resetsAt), c.tz)).toBe(nextDate(q.date))
      }
    })
  }

  it('two learners in different timezones see different days at the same instant', async () => {
    const at = '2033-03-13T04:30:00.000Z' // 23:30 in New York, 01:30 (+1 day) in Santiago
    const ny = await h.guest()
    const cl = await h.guest()
    await lesson(h, ny, { now: at, tz: 'America/New_York', flags: { quests: true } })
    await lesson(h, cl, { now: at, tz: 'America/Santiago', flags: { quests: true } })
    expect((await quests(ny, at)).date).toBe('2033-03-12')
    expect((await quests(cl, at)).date).toBe('2033-03-13')
  })
})

describe('league XP lands in the week that contains ctx.now', () => {
  const board = (u: TestUser, now: string) =>
    read(h, api.leaderboard, '/api/leaderboard', u, { now, flags: { leagues: true } })

  it('the last millisecond of Sunday is the old week; a request after Monday 00:00 is the new one', async () => {
    const flags = { leagues: true }
    const late = await h.member()
    await ensureProfile(h, late)
    const r1 = await lesson(h, late, { now: '2034-01-15T23:59:59.999Z', flags })
    expect(r1.league).toMatchObject({ joinedNow: true, weeklyXp: 15 })
    expect((await board(late, '2034-01-15T12:00:00.000Z')).body).toMatchObject({
      joined: true,
      week: { startsAt: '2034-01-09T00:00:00.000Z' },
    })
    expect((await board(late, '2034-01-16T00:00:00.000Z')).body.joined).toBe(false)

    // Completed (completedAt) on Sunday, committed on Monday: the XP is Monday's week's, while
    // the day it counts for (streak, daily goal, quests) is still Sunday.
    const monday = await h.member()
    const s = await startLesson(h, monday, { now: '2034-01-15T23:58:00.000Z', flags })
    const r2 = await completeRaw(h, monday, s, {
      now: '2034-01-16T00:00:30.000Z',
      completedAt: '2034-01-15T23:59:30.000Z',
      flags,
    })
    expect(r2.status, JSON.stringify(r2.body)).toBe(200)
    expect(r2.body).toMatchObject({ localDate: '2034-01-15', league: { joinedNow: true } })
    expect((await board(monday, '2034-01-15T23:59:00.000Z')).body.joined).toBe(false)
    expect((await board(monday, '2034-01-16T00:01:00.000Z')).body).toMatchObject({
      joined: true,
      week: { startsAt: '2034-01-16T00:00:00.000Z', endsAt: '2034-01-23T00:00:00.000Z' },
      members: [expect.objectContaining({ isMe: true, weeklyXp: 15 })],
    })
  })
})

describe('the rollover cron', () => {
  const week = { startsAt: '2035-02-05T00:00:00.000Z', endsAt: '2035-02-12T00:00:00.000Z' }
  const during = '2035-02-07T12:00:00.000Z'
  const after = '2035-02-12T00:05:00.000Z'
  const flags = { leagues: true, shop: true }
  const rollover = (headers: Record<string, string>) =>
    h.call(api.rollover, { path: '/api/cron/league-rollover', now: after, headers })

  it('answers 401 without the secret or with a wrong one, and closes nothing', async () => {
    expect((await rollover({})).status).toBe(401)
    expect((await rollover({ authorization: 'Bearer not-the-secret' })).status).toBe(401)
    expect((await rollover({ authorization: cronAuth.authorization.slice(7) })).status).toBe(401)
  })

  it('promotes and demotes exactly as the board showed, and pays each learner once', async () => {
    // Five members of the second tier (noqreh): 2 promote (ceil(5/4)), 1 demotes (floor(5/5)).
    const members: TestUser[] = []
    for (let i = 0; i < 5; i++) {
      const m = await h.member()
      await ensureProfile(h, m)
      await h.sql`INSERT INTO public.user_league (user_id, tier) VALUES (${m.id}, 'noqreh')`
      members.push(m)
    }
    // Different weekly XP: member i plays i + 1 lessons (15 XP each).
    for (const [i, m] of members.entries())
      for (let n = 0; n <= i; n++) await lesson(h, m, { now: during, flags })

    const zones = new Map<string, Json>()
    for (const m of members) {
      const b = await read(h, api.leaderboard, '/api/leaderboard', m, { now: during, flags })
      expect(b.body).toMatchObject({ tier: 'noqreh', promoteCount: 2, demoteCount: 1 })
      expect(b.body.members).toHaveLength(5)
      zones.set(
        m.id,
        b.body.members.find((x: Json) => x.isMe),
      )
    }
    expect(members.map((m) => zones.get(m.id).zone)).toEqual([
      'demote',
      'stay',
      'stay',
      'promote',
      'promote',
    ])
    const wallets = await Promise.all(members.map((m) => coinsOf(h, m.id)))

    const first = await rollover(cronAuth)
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    expect(first.body.closed).toContainEqual({
      week,
      cohorts: 1,
      members: 5,
      promoted: 2,
      demoted: 1,
    })
    const second = await rollover(cronAuth)
    expect(second.status).toBe(200)
    expect(second.body.closed).toEqual([])

    const reward = [30, 20, 10, 0, 0]
    const newTier = { promote: 'tala', stay: 'noqreh', demote: 'mes' } as const
    for (const [i, m] of members.entries()) {
      const z = zones.get(m.id)
      const next = await read(h, api.leaderboard, '/api/leaderboard', m, { now: after, flags })
      const tier = newTier[z.zone as keyof typeof newTier]
      expect(next.body).toMatchObject({
        tier,
        joined: false,
        lastResult: { week, tier: 'noqreh', rank: z.rank, outcome: z.zone, newTier: tier },
      })
      const coins = reward[z.rank - 1]!
      expect(next.body.lastResult.coins).toBe(coins)
      const w = await coinsOf(h, m.id)
      expect(w.wallet, `member ${i}`).toBe(wallets[i]!.wallet + coins)
      expect(w.ledger).toBe(w.wallet)
    }
    const [grants] = await h.sql`
      SELECT count(*)::int AS n FROM public.coin_ledger
      WHERE reason = 'league' AND ref = ${week.startsAt}`
    expect(grants!.n).toBe(3)
  })
})
