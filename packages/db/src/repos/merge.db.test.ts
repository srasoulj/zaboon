import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ScopeError, repos, withSystem, withUser, withUserLock } from '../index'
import { createTestContext, type TestContext } from '../testing'
import { fixtureCard, seedLearner } from './seed.fixture'

const { merge, progress, state, memory, learning, enrollments, sessions, reports, profiles } = repos

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(() => ctx.close())

describe('mergeGuestIntoMember', () => {
  it('requires system scope', async () => {
    const g = await ctx.newUser()
    const m = await ctx.newUser({ anonymous: false })
    await expect(withUser(ctx.h.db, m, (tx) => merge.mergeGuestIntoMember(tx, { guestId: g, memberId: m }))).rejects.toBeInstanceOf(
      ScopeError,
    )
    await expect(withSystem(ctx.h.db, (tx) => merge.mergeGuestIntoMember(tx, { guestId: m, memberId: m }))).rejects.toThrow()
  })

  it("moves the guest's progress into the member and deletes the guest's rows", async () => {
    const guest = await ctx.newUser()
    const member = await ctx.newUser({ anonymous: false, email: 'member@example.test' })
    // Overlapping day (09-25) plus a guest-only day (09-24).
    const guestSession = await seedLearner(ctx, guest, { localDate: '2026-09-25', xp: 10, stability: 9 })
    await withUserLock(ctx.h.db, guest, async (tx) => {
      await progress.addDailyActivity(tx, guest, { localDate: '2026-09-24', xp: 7 })
      await progress.appendXp(tx, guest, { amount: 7, reason: 'bonus', occurredAt: '2026-09-24T09:00:00Z', localDate: '2026-09-24' })
      await memory.upsertLexemeCards(tx, guest, [{ id: 'lx_guest_only', card: fixtureCard(), exposures: 5 }])
      await learning.setLegendary(tx, guest, { courseId: 'fixture', levelId: 'u01-l1', at: '2026-09-25T12:00:00Z' })
      await state.saveStreak(tx, guest, { current: 2, longest: 2, lastActiveDate: '2026-09-25', freezes: 1 })
    })
    await withUser(ctx.h.db, guest, (tx) => reports.createReport(tx, guest, { itemRef: 'lexeme:lx_ab', kind: 'other' }))
    await seedLearner(ctx, member, { localDate: '2026-09-25', xp: 20, stability: 1 })
    await withUserLock(ctx.h.db, member, (tx) =>
      memory.upsertLetterCards(tx, member, [{ id: 'l_be', card: fixtureCard({ stability: 50 }), exposures: 0 }]),
    )

    const summary = await withSystem(ctx.h.db, (tx) => merge.mergeGuestIntoMember(tx, { guestId: guest, memberId: member }))
    expect(summary).toEqual({ merged: true, sessionsMoved: 1, xpMoved: 17, daysMerged: 2 })

    await withUser(ctx.h.db, member, async (tx) => {
      // XP: 20 (member) + 10 (moved with the guest's session) + 7 (copied bonus)
      expect(await progress.getXpTotal(tx, member)).toBe(37)
      expect(await progress.listDailyActivity(tx, member)).toEqual([
        { localDate: '2026-09-24', xp: 7, sessions: 1, goalMet: false, freezeUsed: false },
        { localDate: '2026-09-25', xp: 30, sessions: 2, goalMet: false, freezeUsed: false },
      ])
      // The guest's session (and its events/answers/report) now belongs to the member.
      const moved = await sessions.getSession(tx, member, guestSession)
      expect(moved?.userId).toBe(member)
      expect(await sessions.listSessionEvents(tx, member, guestSession)).toHaveLength(1)
      expect(await sessions.listSessionAnswers(tx, member, guestSession)).toHaveLength(2)
      expect((await reports.listReportsForUser(tx, member)).map((r) => r.itemRef).sort()).toEqual([
        'lexeme:lx_ab',
        'lexeme:lx_salam',
        'lexeme:lx_salam',
      ])
      // Stronger FSRS card wins, per item.
      const lex = await memory.getLexemeCards(tx, member)
      expect(lex.map((c) => [c.id, c.card.stability, c.exposures])).toEqual([
        ['lx_guest_only', 2, 5],
        ['lx_salam', 9, 1],
      ])
      const [letter] = await memory.getLetterCards(tx, member)
      expect(letter!.card.stability).toBe(50)
      // Progress, enrollment, mistakes, items, streak
      expect(await learning.getLevelProgress(tx, member, 'fixture', 'u01-l1')).toMatchObject({ lessonsDone: 1, legendary: true })
      expect((await enrollments.getEnrollment(tx, member, 'fixture'))?.xpTotal).toBe(30)
      expect((await learning.listOpenMistakes(tx, member))[0]).toMatchObject({ itemRef: 'lexeme:lx_salam', timesWrong: 2 })
      expect(await state.getItems(tx, member)).toEqual({ streak_freeze: 2 })
      expect(await state.getStreak(tx, member)).toEqual({ current: 2, longest: 2, lastActiveDate: '2026-09-25', freezes: 1 })
      expect(await state.getLives(tx, member)).toMatchObject({ count: 4 })
      expect(await profiles.getPublicProfile(tx, member)).toMatchObject({ xpTotal: 37, streakCurrent: 2 })
    })

    // Nothing of the guest's remains.
    const tables = await ctx.admin<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'user_id'`
    for (const { table_name } of tables) {
      const rows = await ctx.admin.unsafe(`SELECT count(*)::int AS n FROM public."${table_name}" WHERE user_id = $1`, [guest])
      expect({ table_name, n: rows[0]!.n }).toEqual({ table_name, n: 0 })
    }

    // Replaying the merge is a no-op (the guest is gone).
    const again = await withSystem(ctx.h.db, (tx) => merge.mergeGuestIntoMember(tx, { guestId: guest, memberId: member }))
    expect(again.merged).toBe(false)
    expect(await withUser(ctx.h.db, member, (tx) => progress.getXpTotal(tx, member))).toBe(37)
  })

  it('keeps wallet and coin ledger consistent when both claimed the same reward', async () => {
    const guest = await ctx.newUser()
    const member = await ctx.newUser({ anonymous: false })
    // Both claimed today's quest (same reason + ref); the guest also earned a bonus and spent some.
    await ctx.admin`INSERT INTO public.coin_ledger (user_id, amount, reason, ref) VALUES
      (${guest}, 5, 'quest', '2026-09-25:earn_xp'), (${guest}, 3, 'bonus', 'b1'), (${guest}, -2, 'refill', 'r1'),
      (${member}, 5, 'quest', '2026-09-25:earn_xp')`
    await ctx.admin`INSERT INTO public.wallet (user_id, coins) VALUES (${guest}, 6), (${member}, 5)`

    await withSystem(ctx.h.db, (tx) => merge.mergeGuestIntoMember(tx, { guestId: guest, memberId: member }))

    const [w] = await ctx.admin`SELECT coins FROM public.wallet WHERE user_id = ${member}`
    const [l] = await ctx.admin`SELECT sum(amount)::int AS total, count(*)::int AS n FROM public.coin_ledger WHERE user_id = ${member}`
    // The member's 5 plus the guest's net 6 (5 + 3 - 2): the guest's duplicate quest row is not
    // copied, its 5 comes back as one balancing `merge` row, so no coin is lost or counted twice.
    expect(w!.coins).toBe(11)
    expect(l).toEqual({ total: 11, n: 4 })
    const [b] = await ctx.admin`SELECT amount, ref FROM public.coin_ledger WHERE user_id = ${member} AND reason = 'merge'`
    expect(b).toEqual({ amount: 5, ref: guest })
  })

  it('creates the member wallet from the guest net coins and never goes negative', async () => {
    const guest = await ctx.newUser()
    const member = await ctx.newUser({ anonymous: false })
    await ctx.admin`INSERT INTO public.coin_ledger (user_id, amount, reason, ref) VALUES
      (${guest}, 4, 'quest', 'q1'), (${guest}, -4, 'refill', 'r1'), (${member}, 4, 'quest', 'q1')`
    await ctx.admin`INSERT INTO public.wallet (user_id, coins) VALUES (${guest}, 0), (${member}, 4)`
    await withSystem(ctx.h.db, (tx) => merge.mergeGuestIntoMember(tx, { guestId: guest, memberId: member }))
    // The copied rows sum to -4 (the duplicate quest is skipped); the balancing row gives back 4, so
    // the member gains the guest's net 0 and wallet = ledger.
    const [w] = await ctx.admin`SELECT coins FROM public.wallet WHERE user_id = ${member}`
    const [l] = await ctx.admin`SELECT sum(amount)::int AS total FROM public.coin_ledger WHERE user_id = ${member}`
    expect(w!.coins).toBe(4)
    expect(l!.total).toBe(4)

    const g2 = await ctx.newUser()
    const m2 = await ctx.newUser({ anonymous: false })
    await ctx.admin`INSERT INTO public.coin_ledger (user_id, amount, reason, ref) VALUES (${g2}, 7, 'signup', NULL)`
    await ctx.admin`INSERT INTO public.wallet (user_id, coins) VALUES (${g2}, 7)`
    await withSystem(ctx.h.db, (tx) => merge.mergeGuestIntoMember(tx, { guestId: g2, memberId: m2 }))
    const [w2] = await ctx.admin`SELECT coins FROM public.wallet WHERE user_id = ${m2}`
    expect(w2!.coins).toBe(7)
  })

  it('works when the member has no rows yet', async () => {
    const guest = await ctx.newUser()
    const member = await ctx.newUser({ anonymous: false })
    await seedLearner(ctx, guest, { xp: 12 })
    const summary = await withSystem(ctx.h.db, (tx) => merge.mergeGuestIntoMember(tx, { guestId: guest, memberId: member }))
    expect(summary).toMatchObject({ merged: true, xpMoved: 12, daysMerged: 1 })
    await withUser(ctx.h.db, member, async (tx) => {
      expect(await progress.getXpTotal(tx, member)).toBe(12)
      expect(await state.getStreak(tx, member)).toMatchObject({ current: 1 })
      expect((await enrollments.getEnrollment(tx, member, 'fixture'))?.currentLevelId).toBe('u01-l1')
    })
  })
})
