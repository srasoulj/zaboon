import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ScopeError, repos, withSystem, withUser, withUserLock } from '../index'
import { createTestContext, type TestContext } from '../testing'

const { leagues } = repos
const week = { startsAt: '2026-09-21T00:00:00.000Z', endsAt: '2026-09-28T00:00:00.000Z' }
const at = '2026-09-25T12:00:00.000Z'

let ctx: TestContext
let alice: string
let bob: string
let carol: string

beforeAll(async () => {
  ctx = await createTestContext()
  alice = await ctx.newUser({ anonymous: false })
  bob = await ctx.newUser({ anonymous: false })
  carol = await ctx.newUser({ anonymous: false })
})
afterAll(() => ctx.close())

describe('leagues', () => {
  it('a user-scoped commit opens the week once', async () => {
    const w1 = await withUserLock(ctx.h.db, alice, (tx) => leagues.ensureWeek(tx, week))
    const w2 = await withUserLock(ctx.h.db, bob, (tx) => leagues.ensureWeek(tx, week))
    expect(w1).toEqual({ id: w2.id, ...week, closedAt: null })
    expect(await withUser(ctx.h.db, carol, (tx) => leagues.listOpenWeeks(tx))).toHaveLength(1)
  })

  it('joins cohorts, keeps sizes, and shows each learner only their own cohort', async () => {
    const w = (await withUser(ctx.h.db, alice, (tx) => leagues.getWeek(tx, week.startsAt)))!
    const join = (userId: string, cohortId: number | null, xp: number) =>
      withUserLock(ctx.h.db, userId, async (tx) => {
        await leagues.lockWeekShared(tx, week.startsAt)
        await leagues.lockPlacement(tx, week.startsAt, 'mes')
        const id = cohortId ?? (await leagues.createCohort(tx, w.id, 'mes'))
        await leagues.joinCohort(tx, userId, { cohortId: id, weekId: w.id, weeklyXp: xp, at })
        return id
      })
    const c1 = await join(alice, null, 15)
    await join(bob, c1, 20)
    const c2 = await join(carol, null, 5)
    expect(await withUser(ctx.h.db, alice, (tx) => leagues.listCohorts(tx, w.id, 'mes'))).toEqual([
      { id: String(c1), size: 2, createdOrder: c1 },
      { id: String(c2), size: 1, createdOrder: c2 },
    ])

    await withUserLock(ctx.h.db, alice, (tx) => leagues.setWeeklyXp(tx, alice, w.id, 40))
    const aliceView = await withUser(ctx.h.db, alice, (tx) => leagues.listMyCohort(tx, alice, w.id))
    expect(aliceView.map((s) => [s.userId, s.weeklyXp]).sort()).toEqual(
      [
        [alice, 40],
        [bob, 20],
      ].sort(),
    )
    // Carol is alone in her cohort; RLS and the query both keep alice's cohort out of her view.
    const carolView = await withUser(ctx.h.db, carol, (tx) => leagues.listMyCohort(tx, carol, w.id))
    expect(carolView.map((s) => s.userId)).toEqual([carol])
    // Asking for alice's cohort from carol's scope shows nothing.
    expect(await withUser(ctx.h.db, carol, (tx) => leagues.listMyCohort(tx, alice, w.id))).toEqual(
      [],
    )
    expect(
      await withUser(ctx.h.db, alice, (tx) => leagues.getMembership(tx, alice, w.id)),
    ).toMatchObject({
      cohortId: c1,
      tier: 'mes',
      weeklyXp: 40,
      finalRank: null,
    })
  })

  it('tiers default to mes; only the system scope sets them or closes weeks', async () => {
    expect(await withUser(ctx.h.db, alice, (tx) => leagues.getTier(tx, alice))).toBe('mes')
    await expect(
      withUserLock(ctx.h.db, alice, (tx) => leagues.setTier(tx, alice, 'almas', at)),
    ).rejects.toBeInstanceOf(ScopeError)
    const w = (await withUser(ctx.h.db, alice, (tx) => leagues.getWeek(tx, week.startsAt)))!
    await expect(
      withUserLock(ctx.h.db, alice, (tx) => leagues.closeWeek(tx, w.id, at)),
    ).rejects.toBeInstanceOf(ScopeError)
    await withSystem(ctx.h.db, async (tx) => {
      await leagues.lockWeekExclusive(tx, week.startsAt)
      const cohorts = await leagues.listWeekCohorts(tx, w.id)
      expect(cohorts.flatMap((c) => c.members)).toHaveLength(3)
      await leagues.setFinalStanding(tx, {
        cohortId: cohorts[0]!.id,
        userId: alice,
        rank: 1,
        outcome: 'promote',
      })
      await leagues.setTier(tx, alice, 'noqreh', at)
      expect(await leagues.closeWeek(tx, w.id, at)).toBe(true)
      expect(await leagues.closeWeek(tx, w.id, at)).toBe(false)
    })
    expect(await withUser(ctx.h.db, alice, (tx) => leagues.getTier(tx, alice))).toBe('noqreh')
    expect(
      await withUser(ctx.h.db, alice, (tx) => leagues.getMembership(tx, alice, w.id)),
    ).toMatchObject({
      finalRank: 1,
      outcome: 'promote',
    })
    expect(await withUser(ctx.h.db, alice, (tx) => leagues.listOpenWeeks(tx))).toEqual([])
  })

  it('a shared week lock blocks the exclusive one until the commit ends', async () => {
    const order: string[] = []
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    let locked!: () => void
    const isLocked = new Promise<void>((r) => (locked = r))
    const commit = withUserLock(ctx.h.db, bob, async (tx) => {
      await leagues.lockWeekShared(tx, '2026-09-28T00:00:00.000Z')
      locked()
      await held
      order.push('commit')
    })
    await isLocked
    const rollover = withSystem(ctx.h.db, async (tx) => {
      await leagues.lockWeekExclusive(tx, '2026-09-28T00:00:00.000Z')
      order.push('rollover')
    })
    await new Promise((r) => setTimeout(r, 100))
    expect(order).toEqual([])
    release()
    await Promise.all([commit, rollover])
    expect(order).toEqual(['commit', 'rollover'])
  })
})
