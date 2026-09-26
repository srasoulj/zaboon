import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { NotFoundError, repos, withSystem, withUser, withUserLock } from '../index'
import { createTestContext, type TestContext } from '../testing'

const { progress, state, sessions } = repos

let ctx: TestContext
let alice: string
let bob: string
let aliceSession: string
let bobSession: string

const baseSession = {
  courseId: 'fixture',
  levelId: 'u01-l1',
  kind: 'lesson' as const,
  contentVersion: 1,
  seed: 's',
  challengeRefs: [],
  tz: 'UTC',
  startedAt: '2026-09-25T10:00:00.000Z',
  expiresAt: '2026-09-26T10:00:00.000Z',
  graderVersion: 1,
}

beforeAll(async () => {
  ctx = await createTestContext()
  alice = await ctx.newUser()
  bob = await ctx.newUser()
  aliceSession = (
    await withUserLock(ctx.h.db, alice, (tx) => sessions.createSession(tx, alice, baseSession))
  ).id
  bobSession = (
    await withUserLock(ctx.h.db, bob, (tx) => sessions.createSession(tx, bob, baseSession))
  ).id
})
afterAll(() => ctx.close())

describe('xp_ledger', () => {
  const entry = (sessionId: string | null, reason: string, amount: number) => ({
    amount,
    reason,
    sessionId,
    occurredAt: '2026-09-25T10:05:00.000Z',
    localDate: '2026-09-25',
  })

  it('is idempotent on (session_id, reason)', async () => {
    const first = await withUserLock(ctx.h.db, alice, (tx) =>
      progress.appendXp(tx, alice, entry(aliceSession, 'session', 10)),
    )
    const replay = await withUserLock(ctx.h.db, alice, (tx) =>
      progress.appendXp(tx, alice, entry(aliceSession, 'session', 10)),
    )
    const bonus = await withUserLock(ctx.h.db, alice, (tx) =>
      progress.appendXp(tx, alice, entry(aliceSession, 'perfect', 5)),
    )
    expect([first.inserted, replay.inserted, bonus.inserted]).toEqual([true, false, true])
    expect(await withUser(ctx.h.db, alice, (tx) => progress.getXpTotal(tx, alice))).toBe(15)
    const list = await withUser(ctx.h.db, alice, (tx) =>
      progress.listXpLedger(tx, alice, { sessionId: aliceSession }),
    )
    expect(list.map((e) => [e.reason, e.amount, e.occurredAt])).toEqual([
      ['session', 10, '2026-09-25T10:05:00.000Z'],
      ['perfect', 5, '2026-09-25T10:05:00.000Z'],
    ])
  })

  it('allows several entries without a session', async () => {
    const u = await ctx.newUser()
    await withUserLock(ctx.h.db, u, async (tx) => {
      await progress.appendXp(tx, u, entry(null, 'bonus', 3))
      await progress.appendXp(tx, u, entry(null, 'bonus', 3))
    })
    expect(await withUser(ctx.h.db, u, (tx) => progress.getXpTotal(tx, u))).toBe(6)
    expect(
      await withUser(ctx.h.db, u, (tx) => progress.getXpSince(tx, u, '2026-09-25T10:00:00Z')),
    ).toBe(6)
    expect(
      await withUser(ctx.h.db, u, (tx) => progress.getXpSince(tx, u, '2026-09-25T11:00:00Z')),
    ).toBe(0)
  })

  it('is append-only for app_server, even in system scope', async () => {
    await expect(
      withSystem(ctx.h.db, (tx) => tx.execute(sql`UPDATE public.xp_ledger SET amount = 1000`)),
    ).rejects.toMatchObject({
      cause: { code: '42501' },
    })
    await expect(
      withSystem(ctx.h.db, (tx) => tx.execute(sql`DELETE FROM public.xp_ledger`)),
    ).rejects.toMatchObject({
      cause: { code: '42501' },
    })
  })

  it("cannot credit XP against another user's session", async () => {
    await expect(
      withUserLock(ctx.h.db, alice, (tx) =>
        progress.appendXp(tx, alice, entry(bobSession, 'session', 10)),
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      withUserLock(ctx.h.db, alice, (tx) =>
        progress.appendXp(tx, bob, entry(bobSession, 'session', 10)),
      ),
    ).rejects.toThrow()
    expect(await withUser(ctx.h.db, bob, (tx) => progress.getXpTotal(tx, bob))).toBe(0)
    expect(await withUser(ctx.h.db, alice, (tx) => progress.listXpLedger(tx, bob))).toEqual([])
  })
})

describe('daily_activity', () => {
  it('accumulates XP and sessions per local day; goal_met is sticky', async () => {
    const u = await ctx.newUser()
    await withUserLock(ctx.h.db, u, (tx) =>
      progress.addDailyActivity(tx, u, { localDate: '2026-09-24', xp: 10, goalMet: true }),
    )
    const d = await withUserLock(ctx.h.db, u, (tx) =>
      progress.addDailyActivity(tx, u, { localDate: '2026-09-24', xp: 15 }),
    )
    expect(d).toEqual({
      localDate: '2026-09-24',
      xp: 25,
      sessions: 2,
      goalMet: true,
      freezeUsed: false,
    })
    await withUserLock(ctx.h.db, u, (tx) =>
      progress.markFreezeUsed(tx, u, ['2026-09-22', '2026-09-23']),
    )
    const all = await withUser(ctx.h.db, u, (tx) => progress.listDailyActivity(tx, u))
    expect(all.map((x) => [x.localDate, x.freezeUsed, x.sessions])).toEqual([
      ['2026-09-22', true, 0],
      ['2026-09-23', true, 0],
      ['2026-09-24', false, 2],
    ])
    const ranged = await withUser(ctx.h.db, u, (tx) =>
      progress.listDailyActivity(tx, u, { from: '2026-09-23', to: '2026-09-23' }),
    )
    expect(ranged.map((x) => x.localDate)).toEqual(['2026-09-23'])
    expect(
      await withUser(ctx.h.db, u, (tx) => progress.getDailyActivity(tx, u, '2026-09-24')),
    ).toMatchObject({ xp: 25 })
    expect(
      await withUser(ctx.h.db, u, (tx) => progress.getDailyActivity(tx, u, '2026-09-25')),
    ).toBeNull()
  })

  it('marks freeze days given duplicate dates without aborting the transaction', async () => {
    const u = await ctx.newUser()
    const days = await withUserLock(ctx.h.db, u, async (tx) => {
      await progress.markFreezeUsed(tx, u, ['2026-09-20', '2026-09-20', '2026-09-21'])
      return progress.listDailyActivity(tx, u)
    })
    expect(days.map((d) => [d.localDate, d.freezeUsed])).toEqual([
      ['2026-09-20', true],
      ['2026-09-21', true],
    ])
  })

  it('is invisible to and unwritable by other users', async () => {
    await withUserLock(ctx.h.db, bob, (tx) =>
      progress.addDailyActivity(tx, bob, { localDate: '2026-09-25', xp: 5 }),
    )
    expect(await withUser(ctx.h.db, alice, (tx) => progress.listDailyActivity(tx, bob))).toEqual([])
    await expect(
      withUserLock(ctx.h.db, alice, (tx) =>
        progress.addDailyActivity(tx, bob, { localDate: '2026-09-25', xp: 500 }),
      ),
    ).rejects.toThrow()
    expect(
      await withUser(ctx.h.db, bob, (tx) => progress.getDailyActivity(tx, bob, '2026-09-25')),
    ).toMatchObject({ xp: 5 })
  })
})

describe('streaks, lives and items', () => {
  it('saves and reads the streak', async () => {
    expect(await withUser(ctx.h.db, alice, (tx) => state.getStreak(tx, alice))).toBeNull()
    const s = { current: 3, longest: 5, lastActiveDate: '2026-09-25', freezes: 1 }
    await withUserLock(ctx.h.db, alice, (tx) => state.saveStreak(tx, alice, s))
    await withUserLock(ctx.h.db, alice, (tx) => state.saveStreak(tx, alice, { ...s, current: 4 }))
    expect(await withUser(ctx.h.db, alice, (tx) => state.getStreak(tx, alice))).toEqual({
      ...s,
      current: 4,
    })
  })

  it('saves and reads lives', async () => {
    const l = { policy: 'hearts' as const, count: 4, updatedAt: '2026-09-25T10:00:00.000Z' }
    await withUserLock(ctx.h.db, alice, (tx) => state.saveLives(tx, alice, l))
    expect(await withUser(ctx.h.db, alice, (tx) => state.getLives(tx, alice))).toEqual(l)
    await withUserLock(ctx.h.db, alice, (tx) => state.saveLives(tx, alice, { ...l, count: 3 }))
    expect((await withUser(ctx.h.db, alice, (tx) => state.getLives(tx, alice)))?.count).toBe(3)
  })

  it('adds and spends items without going negative', async () => {
    const u = await ctx.newUser()
    expect(await withUserLock(ctx.h.db, u, (tx) => state.addItem(tx, u, 'streak_freeze', 1))).toBe(
      1,
    )
    expect(await withUserLock(ctx.h.db, u, (tx) => state.addItem(tx, u, 'streak_freeze', 1))).toBe(
      2,
    )
    expect(await withUserLock(ctx.h.db, u, (tx) => state.addItem(tx, u, 'streak_freeze', -2))).toBe(
      0,
    )
    expect(
      await withUserLock(ctx.h.db, u, (tx) => state.addItem(tx, u, 'streak_freeze', -1)),
    ).toBeNull()
    expect(
      await withUserLock(ctx.h.db, u, (tx) => state.addItem(tx, u, 'never_had', -1)),
    ).toBeNull()
    expect(await withUser(ctx.h.db, u, (tx) => state.getItems(tx, u))).toEqual({ streak_freeze: 0 })
  })

  it("cannot read or write another user's state", async () => {
    await withUserLock(ctx.h.db, bob, (tx) =>
      state.saveStreak(tx, bob, { current: 9, longest: 9, lastActiveDate: null, freezes: 0 }),
    )
    expect(await withUser(ctx.h.db, alice, (tx) => state.getStreak(tx, bob))).toBeNull()
    expect(await withUser(ctx.h.db, alice, (tx) => state.getLives(tx, bob))).toBeNull()
    await expect(
      withUserLock(ctx.h.db, alice, (tx) =>
        state.saveStreak(tx, bob, { current: 0, longest: 0, lastActiveDate: null, freezes: 0 }),
      ),
    ).rejects.toThrow()
    await expect(
      withUserLock(ctx.h.db, alice, (tx) => state.addItem(tx, bob, 'streak_freeze', 5)),
    ).rejects.toThrow()
    expect(
      await withUserLock(ctx.h.db, alice, (tx) => state.addItem(tx, bob, 'streak_freeze', -1)),
    ).toBeNull()
    expect(await withUser(ctx.h.db, bob, (tx) => state.getStreak(tx, bob))).toMatchObject({
      current: 9,
    })
  })
})
