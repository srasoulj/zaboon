/** Time travel with x-test-now: streaks across local days and heart regeneration. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, finish, get, play, start, wrongEvent } from './flows'
import { createHarness, type Harness } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h?.close()
})

const at = (date: string, time = '12:00:00') => `${date}T${time}Z`

describe('streaks (UTC learner)', () => {
  it('day 2 extends, a missed day consumes the signup freeze, a longer gap breaks it', async () => {
    const alice = await h.guest()
    const d1 = await play(h, alice, { now: at('2031-03-01') })
    expect(d1.streak).toMatchObject({ current: 1, extendedToday: true, freezes: 1 })

    const sameDay = await play(h, alice, { now: at('2031-03-01', '18:00:00') })
    expect(sameDay.streak).toMatchObject({ current: 1, extendedToday: false })

    const d2 = await play(h, alice, { now: at('2031-03-02') })
    expect(d2.streak).toMatchObject({ current: 2, extendedToday: true, status: 'extended' })

    // Day 3 missed: the next morning the streak is "frozen" (a freeze will cover it)…
    const home = await get(h, api.home, '/api/home', alice, at('2031-03-04', '08:00:00'))
    expect(home.body.streak).toMatchObject({ current: 2, status: 'frozen', freezesNeeded: 1 })
    // …and the next lesson consumes the freeze.
    const d4 = await play(h, alice, { now: at('2031-03-04') })
    expect(d4.streak).toMatchObject({ current: 3, freezes: 0, frozenDates: ['2031-03-03'] })
    const [frozen] = await h.sql`
      SELECT freeze_used FROM daily_activity WHERE user_id = ${alice.id} AND local_date = '2031-03-03'`
    expect(frozen!.freeze_used).toBe(true)

    // At risk the day after, broken once two days are missed without freezes.
    expect((await get(h, api.home, '/api/home', alice, at('2031-03-05'))).body.streak.status).toBe(
      'at_risk',
    )
    const broken = await get(h, api.home, '/api/home', alice, at('2031-03-07'))
    expect(broken.body.streak).toMatchObject({ current: 0, status: 'broken' })
    const d7 = await play(h, alice, { now: at('2031-03-07') })
    expect(d7.streak).toMatchObject({ current: 1, extendedToday: true })
    const profile = await get(h, api.profile, '/api/profile', alice, at('2031-03-07'))
    expect(profile.body.stats).toMatchObject({ streakCurrent: 1, streakLongest: 3 })
  })

  it("counts a late request for the day the lesson was finished, in the session's timezone", async () => {
    const alice = await h.guest()
    // Started 23:50 in Tehran (UTC+3:30), finished 23:55, the request lands after local midnight.
    const s = await start(h, alice, { tz: 'Asia/Tehran', now: '2031-03-10T20:20:00Z' })
    const r = await finish(h, alice, s, {
      completedAt: '2031-03-10T20:25:00Z',
      now: '2031-03-10T20:40:00Z',
    })
    expect(r.localDate).toBe('2031-03-10')
    // A client clock in the future never counts for a later day.
    const s2 = await start(h, alice, { tz: 'Asia/Tehran', now: '2031-03-11T08:00:00Z' })
    const r2 = await finish(h, alice, s2, {
      completedAt: '2031-03-15T08:00:00Z',
      now: '2031-03-11T08:05:00Z',
    })
    expect(r2.localDate).toBe('2031-03-11')
    expect(r2.durationMs).toBe(5 * 60_000)
  })
})

describe('hearts', () => {
  it('regenerate lazily, one every regenMinutes, up to the max', async () => {
    const alice = await h.guest()
    const t0 = new Date('2031-04-01T10:00:00Z')
    const s = await start(h, alice, { now: t0 })
    for (let seq = 0; seq < 3; seq++) await wrongEvent(h, alice, s.sessionId, seq, { now: t0 })
    const lives = async (hours: number) =>
      (await get(h, api.home, '/api/home', alice, new Date(t0.getTime() + hours * 3_600_000))).body
        .lives
    expect(await lives(0)).toMatchObject({
      count: 2,
      nextRegenAt: '2031-04-01T14:00:00.000Z',
    })
    expect((await lives(3.9)).count).toBe(2)
    expect((await lives(4)).count).toBe(3)
    expect((await lives(8.5)).count).toBe(4)
    expect(await lives(100)).toMatchObject({ count: 5, nextRegenAt: null })
  })
})
