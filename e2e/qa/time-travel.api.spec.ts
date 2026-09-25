/**
 * Time travel with `x-test-now` (local auth mode; ARCHITECTURE §6, §15): streaks across local days,
 * freezes, a broken streak, heart regeneration and session expiry, against the running app.
 * Every test uses a fresh learner, so fixed dates never collide.
 */
import { expect, test } from '@playwright/test'
import {
  call,
  expectEnvelope,
  finish,
  finishRaw,
  guest,
  play,
  plusHours,
  read200,
  start,
  wrongEvent,
} from './support'

const at = (date: string, time = '12:00:00') => `${date}T${time}Z`

test.describe('streak', () => {
  test('lessons on two consecutive days make a 2-day streak; a second lesson the same day adds nothing', async ({
    request,
  }) => {
    const alice = await guest(request)
    expect(await play(request, alice, { now: at('2033-05-01') })).toMatchObject({
      streak: { current: 1, extendedToday: true },
    })
    expect(
      await play(request, alice, { kind: 'practice', now: at('2033-05-01', '20:00:00') }),
    ).toMatchObject({
      streak: { current: 1, extendedToday: false },
    })
    expect(await play(request, alice, { kind: 'practice', now: at('2033-05-02') })).toMatchObject({
      localDate: '2033-05-02',
      streak: { current: 2, extendedToday: true, status: 'extended' },
    })
    const home = await read200(request, alice, '/api/home', at('2033-05-02', '23:00:00'))
    expect(home.streak).toMatchObject({ current: 2, status: 'extended' })
    // The next day it is still 2, waiting for today's lesson.
    const next = await read200(request, alice, '/api/home', at('2033-05-03', '09:00:00'))
    expect(next.streak).toMatchObject({ current: 2, status: 'at_risk' })
  })

  test('a missed day uses the signup freeze; reads never consume it', async ({ request }) => {
    const alice = await guest(request)
    await play(request, alice, { now: at('2033-06-01') })
    await play(request, alice, { kind: 'practice', now: at('2033-06-02') })
    // 2033-06-03 missed. Reading the home screen twice shows the pending freeze and writes nothing.
    for (let i = 0; i < 2; i++) {
      const home = await read200(request, alice, '/api/home', at('2033-06-04', '08:00:00'))
      expect(home.streak).toMatchObject({
        current: 2,
        status: 'frozen',
        freezes: 1,
        freezesNeeded: 1,
      })
    }
    const d4 = await play(request, alice, { kind: 'practice', now: at('2033-06-04') })
    expect(d4.streak).toMatchObject({
      current: 3,
      freezes: 0,
      extendedToday: true,
      frozenDates: ['2033-06-03'],
    })
  })

  test('two missed days without freezes break the streak; the next lesson starts over at 1', async ({
    request,
  }) => {
    const alice = await guest(request)
    await play(request, alice, { now: at('2033-07-01') })
    // Day 2 missed: the freeze covers it at the day-3 lesson.
    expect(
      (await play(request, alice, { kind: 'practice', now: at('2033-07-03') })).streak,
    ).toMatchObject({ current: 2, freezes: 0 })
    // Days 4 and 5 missed, no freezes left.
    const broken = await read200(request, alice, '/api/home', at('2033-07-06'))
    expect(broken.streak).toMatchObject({ current: 0, status: 'broken' })
    const again = await play(request, alice, { kind: 'practice', now: at('2033-07-06') })
    expect(again.streak).toMatchObject({ current: 1, extendedToday: true })
    const profile = await read200(request, alice, '/api/profile', at('2033-07-06'))
    expect(profile.stats).toMatchObject({ streakCurrent: 1, streakLongest: 2 })
  })

  test('a 7-day streak grants a freeze, up to the maximum of 2', async ({ request }) => {
    const alice = await guest(request)
    const streaks: unknown[] = []
    for (let day = 1; day <= 14; day++) {
      const date = `2033-08-${String(day).padStart(2, '0')}`
      const r = await play(request, alice, {
        ...(day === 1 ? {} : { kind: 'practice' as const }),
        now: at(date),
      })
      streaks.push(r.streak)
    }
    expect(streaks[5]).toMatchObject({ current: 6, freezes: 1, freezeGranted: false })
    expect(streaks[6]).toMatchObject({ current: 7, freezes: 2, freezeGranted: true })
    // Day 14 would grant another one, but 2 is the maximum.
    expect(streaks[13]).toMatchObject({ current: 14, freezes: 2 })
  })

  test("the day is the learner's local day, in the timezone captured at session start", async ({
    request,
  }) => {
    const alice = await guest(request)
    // 23:30 in Tehran (UTC+3:30) is 20:00 UTC; the request lands after local midnight.
    const s = await start(request, alice, { tz: 'Asia/Tehran', now: '2033-09-10T20:00:00Z' })
    const r = await finish(request, alice, s, {
      completedAt: '2033-09-10T20:25:00Z',
      now: '2033-09-10T20:45:00Z',
    })
    expect(r).toMatchObject({ localDate: '2033-09-10', durationMs: 25 * 60_000 })
  })
})

test.describe('hearts', () => {
  test('a wrong attempt costs a heart; hearts come back one per 4 hours, up to 5', async ({
    request,
  }) => {
    const alice = await guest(request)
    const t0 = '2033-10-01T10:00:00.000Z'
    const s = await start(request, alice, { now: t0 })
    for (let seq = 0; seq < 3; seq++)
      expect((await wrongEvent(request, alice, s.sessionId, seq, { now: t0 })).status).toBe(200)
    const lives = async (hours: number) =>
      (await read200(request, alice, '/api/home', plusHours(t0, hours))).lives
    expect(await lives(0)).toMatchObject({ count: 2, max: 5, nextRegenAt: plusHours(t0, 4) })
    expect(await lives(3.99)).toMatchObject({ count: 2 })
    expect(await lives(4)).toMatchObject({ count: 3, nextRegenAt: plusHours(t0, 8) })
    expect(await lives(12)).toMatchObject({ count: 5, nextRegenAt: null })
    expect(await lives(1000)).toMatchObject({ count: 5, nextRegenAt: null })
  })

  test('at zero hearts a lesson is refused until a heart regenerates; practice always works', async ({
    request,
  }) => {
    const alice = await guest(request)
    const t0 = '2033-11-01T10:00:00.000Z'
    const s = await start(request, alice, { now: t0 })
    for (let seq = 0; seq < 5; seq++)
      await wrongEvent(request, alice, s.sessionId, seq, { now: t0 })
    const refused = await call(request, alice, '/api/sessions', {
      now: plusHours(t0, 1),
      data: { courseId: 'fixture', kind: 'lesson', levelId: 'u01-s0', tz: 'UTC' },
    })
    expectEnvelope(refused, 409, 'out_of_lives')
    // Practice is allowed and earns a heart back.
    const practice = await play(request, alice, { kind: 'practice', now: plusHours(t0, 1) })
    expect(practice.lives).toMatchObject({ count: 1 })
    // Or wait for regeneration.
    const bob = await guest(request)
    const s2 = await start(request, bob, { now: t0 })
    for (let seq = 0; seq < 5; seq++) await wrongEvent(request, bob, s2.sessionId, seq, { now: t0 })
    await start(request, bob, { now: plusHours(t0, 4) })
  })
})

test.describe('session expiry', () => {
  test('a session older than 24 hours is gone for completion and events, for good', async ({
    request,
  }) => {
    const alice = await guest(request)
    const t0 = '2033-12-01T12:00:00.000Z'
    const s = await start(request, alice, { now: t0 })
    expect(s.expiresAt).toBe(plusHours(t0, 24))

    // Just before expiry it can still take events.
    expect(
      (await wrongEvent(request, alice, s.sessionId, 0, { now: plusHours(t0, 23.9) })).status,
    ).toBe(200)
    const late = plusHours(t0, 24.01)
    expectEnvelope(await finishRaw(request, alice, s, { now: late }), 410, 'gone')
    expectEnvelope(await wrongEvent(request, alice, s.sessionId, 1, { now: late }), 410, 'gone')
    // Once marked expired, an earlier clock doesn't bring it back.
    expectEnvelope(await finishRaw(request, alice, s, { now: plusHours(t0, 1) }), 410, 'gone')
    // Nothing was awarded, but the heart from the event before expiry stays spent.
    expect(await read200(request, alice, '/api/home', late)).toMatchObject({
      xpTotal: 0,
      streak: { current: 0 },
      lives: { count: 4 },
    })
  })
})
