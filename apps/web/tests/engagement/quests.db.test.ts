/** Daily quests: progress and auto-claim inside /complete, GET /api/quests (flags.quests), coins. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_APP_CONFIG as cfg } from '@zaboon/contracts'
import { dailyQuests } from '@zaboon/game-rules'
import { createHarness, type Harness, type TestUser } from '../api/harness'
import { api, coinsOf, completeRaw, lesson, read, startLesson } from './helpers'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
  await h.setFlags({ quests: true })
})
afterAll(async () => {
  await h?.close()
})

const quests = (user: TestUser, now: string) => read(h, api.quests, '/api/quests', user, { now })

/** The quest a fresh fixture lesson (15 XP, perfect) completes on its own, if any, for this user/date. */
function lessonCompletes(userId: string, date: string): string[] {
  return dailyQuests(userId, date, cfg)
    .filter(
      (q) =>
        (q.metric === 'xp' && q.target <= 15) ||
        (q.metric === 'lessons' && q.target <= 1) ||
        (q.metric === 'perfect_sessions' && q.target <= 1),
    )
    .map((q) => q.templateId)
}

async function userWith(
  pred: (userId: string) => boolean,
  make = () => h.guest(),
): Promise<TestUser> {
  for (let i = 0; i < 50; i++) {
    const u = await make()
    if (pred(u.id)) return u
  }
  throw new Error('no suitable user in 50 tries')
}

describe('quests', () => {
  it('GET /api/quests: today in the profile timezone, resets at the next local midnight', async () => {
    const alice = await h.guest()
    // Before any session the profile timezone is UTC.
    const utc = await quests(alice, '2031-05-07T22:30:00.000Z')
    expect(utc.status).toBe(200)
    expect(utc.body).toMatchObject({ date: '2031-05-07', resetsAt: '2031-05-08T00:00:00.000Z' })
    expect(utc.body.quests).toHaveLength(3)
    expect(utc.body.quests.map((q: { id: string }) => q.id)).toEqual(
      dailyQuests(alice.id, '2031-05-07', cfg).map((q) => q.templateId),
    )
    for (const q of utc.body.quests)
      expect(q).toMatchObject({ progress: 0, completed: false, reward: cfg.quests.rewardCoins })
    // A session in Tehran moves the profile's timezone: 22:30 UTC is already the next day there.
    await lesson(h, alice, { now: '2031-05-07T22:30:00.000Z', tz: 'Asia/Tehran' })
    const teh = await quests(alice, '2031-05-07T22:30:00.000Z')
    expect(teh.body).toMatchObject({ date: '2031-05-08', resetsAt: '2031-05-08T20:30:00.000Z' })
  })

  it('a session advances the day quests and auto-claims completed ones once, paying coins', async () => {
    const date = '2031-05-07'
    const alice = await userWith((id) => lessonCompletes(id, date).length > 0)
    const now = `${date}T10:00:00.000Z`
    const s = await startLesson(h, alice, { now })
    const done = await completeRaw(h, alice, s, { now })
    expect(done.status).toBe(200)
    const completes = lessonCompletes(alice.id, date)
    const just = done.body.quests.filter((q: { justCompleted: boolean }) => q.justCompleted)
    expect(just.map((q: { id: string }) => q.id).sort()).toEqual([...completes].sort())
    const earned = completes.length * cfg.quests.rewardCoins
    expect(done.body.coins).toEqual({ earned, total: earned })
    expect(await coinsOf(h, alice.id)).toEqual({ wallet: earned, ledger: earned })

    // A replay returns the stored result and pays nothing again.
    const replay = await completeRaw(h, alice, s, { now })
    expect(replay.body).toEqual(done.body)
    expect(await coinsOf(h, alice.id)).toEqual({ wallet: earned, ledger: earned })

    // A second lesson the same day: the claimed quests never pay again.
    const second = await lesson(h, alice, { now: `${date}T11:00:00.000Z` })
    for (const id of completes) {
      const q = second.quests.find((x: { id: string }) => x.id === id)
      expect(q).toMatchObject({ completed: true, justCompleted: false })
    }
    const claimed = await h.sql`
      SELECT quest_id, claimed FROM user_quests WHERE user_id = ${alice.id} AND local_date = ${date} AND claimed`
    const paid =
      await h.sql`SELECT ref FROM coin_ledger WHERE user_id = ${alice.id} AND reason = 'quest'`
    expect(paid.map((r) => r.ref).sort()).toEqual(
      claimed.map((r) => `${date}:${r.quest_id}`).sort(),
    )
    const total = await coinsOf(h, alice.id)
    expect(total.wallet).toBe(total.ledger)
    expect(second.coins.total).toBe(total.wallet)

    // Home and GET /api/quests agree with the stored progress.
    const home = await read(h, api.home, '/api/home', alice, { now: `${date}T12:00:00.000Z` })
    expect(home.body.coins).toBe(total.wallet)
    const q = await quests(alice, `${date}T12:00:00.000Z`)
    expect(home.body.quests).toEqual(q.body.quests)
  })

  it('a flagged session advances nothing and pays nothing', async () => {
    const date = '2031-05-07'
    const bob = await userWith((id) => lessonCompletes(id, date).length > 0)
    const r = await lesson(h, bob, { now: `${date}T10:00:00.000Z`, ms: 100 })
    expect(
      r.quests.every(
        (q: { progress: number; justCompleted: boolean }) => q.progress === 0 && !q.justCompleted,
      ),
    ).toBe(true)
    expect(r.coins).toEqual({ earned: 0, total: 0 })
    const [n] = await h.sql`SELECT count(*)::int AS n FROM user_quests WHERE user_id = ${bob.id}`
    expect(n!.n).toBe(0)
  })

  it('quests are per local date: across midnight in two timezones each day pays once', async () => {
    for (const tz of ['America/Los_Angeles', 'Asia/Tehran']) {
      const u = await h.member()
      // 23:50 and 00:10 local on consecutive local dates.
      const times =
        tz === 'America/Los_Angeles'
          ? ['2031-05-08T06:50:00.000Z', '2031-05-08T07:10:00.000Z']
          : ['2031-05-07T20:20:00.000Z', '2031-05-07T20:40:00.000Z']
      const [d1, d2] = ['2031-05-07', '2031-05-08']
      const r1 = await lesson(h, u, { now: times[0]!, tz })
      const r2 = await lesson(h, u, { now: times[1]!, tz })
      expect([r1.localDate, r2.localDate]).toEqual([d1, d2])
      const rows = await h.sql`
        SELECT local_date::text AS d, quest_id, progress, claimed FROM user_quests WHERE user_id = ${u.id} ORDER BY 1, 2`
      expect(new Set(rows.map((r) => r.d))).toEqual(new Set([d1, d2]))
      const paid =
        await h.sql`SELECT ref FROM coin_ledger WHERE user_id = ${u.id} AND reason = 'quest' ORDER BY ref`
      const expected = [
        ...lessonCompletes(u.id, d1).map((id) => `${d1}:${id}`),
        ...lessonCompletes(u.id, d2).map((id) => `${d2}:${id}`),
      ].sort()
      expect(paid.map((r) => r.ref)).toEqual(expected)
      expect(r2.coins.total).toBe(expected.length * cfg.quests.rewardCoins)
      // After midnight the quests route shows the new day's quests.
      const q = await quests(u, times[1]!)
      expect(q.body.date).toBe(d2)
    }
  })

  it('a completedAt before midnight counts for the earlier day, even when the request lands after it', async () => {
    const u = await h.member()
    const s = await startLesson(h, u, { now: '2031-05-07T23:50:00.000Z' })
    const r = await completeRaw(h, u, s, {
      now: '2031-05-08T00:10:00.000Z',
      completedAt: '2031-05-07T23:55:00.000Z',
    })
    expect(r.body.localDate).toBe('2031-05-07')
    const rows =
      await h.sql`SELECT DISTINCT local_date::text AS d FROM user_quests WHERE user_id = ${u.id}`
    expect(rows.map((x) => x.d)).toEqual(['2031-05-07'])
  })
})
