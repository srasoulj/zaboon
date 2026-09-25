/**
 * ARCHITECTURE §15: replaying POST /complete returns the identical result and awards XP once, and
 * concurrent completions for one learner lose nothing (per-user advisory lock). Against the
 * running app, through HTTP only.
 */
import { expect, test } from '@playwright/test'
import { call, finish, finishRaw, guest, read200, start, wrongEvent, type Body } from './support'

const xpOf = async (request: Parameters<typeof read200>[0], user: Parameters<typeof read200>[1]) =>
  (await read200(request, user, '/api/home')).xpTotal

test.describe('replaying /complete', () => {
  test('returns the identical result and awards XP, streak and level progress once', async ({
    request,
  }) => {
    const alice = await guest(request)
    const s = await start(request, alice)
    const first = await finish(request, alice, s)
    expect(first).toMatchObject({
      sessionId: s.sessionId,
      xp: { total: 15 },
      streak: { current: 1, extendedToday: true },
      level: { levelId: 'u01-s0', lessonsDone: 1, completed: true },
    })

    // The outbox may resend a completion many times (and much later).
    for (let i = 0; i < 3; i++) expect(await finish(request, alice, s)).toEqual(first)
    const later = await finish(request, alice, s, {
      now: new Date(Date.now() + 3_600_000).toISOString(),
    })
    expect(later).toEqual(first)

    const home = await read200(request, alice, '/api/home')
    expect(home).toMatchObject({ xpTotal: 15, streak: { current: 1 }, dailyGoal: { xp: 15 } })
    const path = await read200(request, alice, '/api/path')
    const levels = (path.sections as { units: { levels: Body[] }[] }[])[0]!.units[0]!.levels
    expect(levels.find((l) => l.id === 'u01-s0')).toMatchObject({ lessonsDone: 1 })
    const profile = await read200(request, alice, '/api/profile')
    expect(profile.stats).toMatchObject({ xpTotal: 15 })
  })

  test('a replay after the session would have expired still returns the stored result', async ({
    request,
  }) => {
    const alice = await guest(request)
    const s = await start(request, alice)
    const first = await finish(request, alice, s)
    const replay = await finish(request, alice, s, {
      now: new Date(Date.parse(s.expiresAt) + 3_600_000).toISOString(),
    })
    expect(replay).toEqual(first)
    expect(await xpOf(request, alice)).toBe(15)
  })

  test('hearts spent by events are not charged again when the completion is replayed', async ({
    request,
  }) => {
    const alice = await guest(request)
    const s = await start(request, alice)
    expect((await wrongEvent(request, alice, s.sessionId, 0)).status).toBe(200)
    const first = await finish(request, alice, s, { wrong: [0] })
    expect(first.lives).toMatchObject({ count: 4 })
    expect(await finish(request, alice, s, { wrong: [0] })).toEqual(first)
    expect((await read200(request, alice, '/api/home')).lives).toMatchObject({ count: 4 })
  })

  test('an event for a completed session is refused with 409', async ({ request }) => {
    const alice = await guest(request)
    const s = await start(request, alice)
    await finish(request, alice, s)
    const res = await wrongEvent(request, alice, s.sessionId, 99)
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ error: { code: 'conflict' } })
    expect((await read200(request, alice, '/api/home')).lives).toMatchObject({ count: 5 })
  })
})

test.describe('concurrent completions', () => {
  test('the same session completed in parallel: one commit, identical results', async ({
    request,
  }) => {
    const alice = await guest(request)
    const s = await start(request, alice)
    const results = await Promise.all(Array.from({ length: 8 }, () => finishRaw(request, alice, s)))
    expect(results.map((r) => r.status)).toEqual(results.map(() => 200))
    for (const r of results) expect(r.body).toEqual(results[0]!.body)
    expect(await xpOf(request, alice)).toBe(15)
  })

  test('different sessions completed in parallel all count', async ({ request }) => {
    const alice = await guest(request)
    // Practice is always unlocked and costs no hearts, so several can be open at once.
    const sessions = await Promise.all(
      Array.from({ length: 4 }, () => start(request, alice, { kind: 'practice' })),
    )
    const results = await Promise.all(sessions.map((s) => finishRaw(request, alice, s)))
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200])
    const totals = results.map((r) => (r.body.xp as { total: number }).total)
    expect(totals.every((t) => t > 0)).toBe(true)
    const sum = totals.reduce((a, b) => a + b, 0)
    expect(await xpOf(request, alice)).toBe(sum)
    // Every one counted for the same local day, and the day's XP is the sum.
    expect((await read200(request, alice, '/api/home')).dailyGoal).toMatchObject({ xp: sum })
  })

  test('a lesson and its wrong-answer events racing each other charge each heart once', async ({
    request,
  }) => {
    const alice = await guest(request)
    const s = await start(request, alice)
    // The player sends each wrong attempt as an event and later the completion; with a flaky
    // network the outbox can deliver them together and more than once.
    const events = [0, 0, 1, 1].map((seq) =>
      wrongEvent(request, alice, s.sessionId, seq, { index: seq }),
    )
    const completes = [0, 1].map(() => finishRaw(request, alice, s, { wrong: [0, 1] }))
    const [e, c] = [await Promise.all(events), await Promise.all(completes)]
    // Events may land after the commit (409); everything else succeeds.
    for (const r of e) expect([200, 409]).toContain(r.status)
    expect(c.map((r) => r.status)).toEqual([200, 200])
    expect(c[1]!.body).toEqual(c[0]!.body)
    expect((await read200(request, alice, '/api/home')).lives).toMatchObject({ count: 3 })
  })

  test('parallel reads while completing never see a half-written commit', async ({ request }) => {
    const alice = await guest(request)
    const s = await start(request, alice)
    const [done, ...homes] = await Promise.all([
      finishRaw(request, alice, s),
      ...Array.from({ length: 5 }, () => call(request, alice, '/api/home')),
    ])
    expect(done.status).toBe(200)
    for (const h of homes) {
      expect(h.status).toBe(200)
      // Either before (0 XP, no streak) or after (15 XP, streak 1): never XP without the streak.
      const snapshot = [h.body.xpTotal, (h.body.streak as { current: number }).current]
      expect([
        [0, 0],
        [15, 1],
      ]).toContainEqual(snapshot)
    }
  })
})
