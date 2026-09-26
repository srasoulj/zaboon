import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { repos, withSystem, withUser, withUserLock } from '../index'
import { createTestContext, type TestContext } from '../testing'

const { speech, merge, account } = repos

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(() => ctx.close())

const NOW = '2026-09-27T10:00:00.000Z'
const DAY = '2026-09-27'

const consume = (u: string, limit: number, day = DAY) =>
  withUserLock(ctx.h.db, u, (tx) => speech.consumeSpeechQuota(tx, u, { day, limit, now: NOW }))

describe('speech quota', () => {
  it('counts up to the limit, then refuses without counting further', async () => {
    const u = await ctx.newUser()
    const results = []
    for (let i = 0; i < 4; i++) results.push(await consume(u, 3))
    expect(results).toEqual([
      { allowed: true, used: 1 },
      { allowed: true, used: 2 },
      { allowed: true, used: 3 },
      { allowed: false, used: 3 },
    ])
    expect(await withUser(ctx.h.db, u, (tx) => speech.getSpeechUsage(tx, u, DAY))).toBe(3)
  })

  it('keeps days and learners apart', async () => {
    const a = await ctx.newUser()
    const b = await ctx.newUser()
    expect(await consume(a, 1)).toEqual({ allowed: true, used: 1 })
    expect(await consume(a, 1)).toEqual({ allowed: false, used: 1 })
    expect(await consume(a, 1, '2026-09-28')).toEqual({ allowed: true, used: 1 })
    expect(await consume(b, 1)).toEqual({ allowed: true, used: 1 })
  })

  it('never overspends under concurrency', async () => {
    const u = await ctx.newUser()
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        withUser(ctx.h.db, u, (tx) =>
          speech.consumeSpeechQuota(tx, u, { day: DAY, limit: 5, now: NOW }),
        ),
      ),
    )
    expect(results.filter((r) => r.allowed)).toHaveLength(5)
    expect(await withUser(ctx.h.db, u, (tx) => speech.getSpeechUsage(tx, u, DAY))).toBe(5)
  })

  it('refunds one transcription, never below zero', async () => {
    const u = await ctx.newUser()
    await consume(u, 2)
    await consume(u, 2)
    expect((await consume(u, 2)).allowed).toBe(false)
    const refund = () =>
      withUserLock(ctx.h.db, u, (tx) => speech.refundSpeechQuota(tx, u, { day: DAY, now: NOW }))
    await refund()
    expect(await consume(u, 2)).toEqual({ allowed: true, used: 2 })
    await refund()
    await refund()
    await refund()
    expect(await withUser(ctx.h.db, u, (tx) => speech.getSpeechUsage(tx, u, DAY))).toBe(0)
  })

  it("is scoped: another learner's scope can neither read nor write the row", async () => {
    const a = await ctx.newUser()
    const b = await ctx.newUser()
    await consume(a, 5)
    const seen = await withUser(ctx.h.db, b, (tx) => speech.getSpeechUsage(tx, a, DAY))
    expect(seen).toBe(0)
    await expect(
      withUser(ctx.h.db, b, (tx) =>
        speech.consumeSpeechQuota(tx, a, { day: DAY, limit: 5, now: NOW }),
      ),
    ).rejects.toThrow()
  })

  it('rejects bad input', async () => {
    const u = await ctx.newUser()
    await expect(consume(u, 0)).rejects.toThrow()
    await expect(consume(u, 3, '27-09-2026')).rejects.toThrow()
    await expect(
      withUser(ctx.h.db, u, (tx) => speech.getSpeechUsage(tx, 'nope', DAY)),
    ).rejects.toThrow()
  })

  it('stores a counter only (no audio, no transcript)', async () => {
    const cols = await ctx.admin<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'speech_usage' ORDER BY ordinal_position`
    expect(cols.map((c) => c.column_name)).toEqual(['user_id', 'day', 'count', 'updated_at'])
  })

  it('is exported with the account and deleted with it', async () => {
    const u = await ctx.newUser()
    await consume(u, 5)
    const exported = await withUser(ctx.h.db, u, (tx) => account.exportAccount(tx, u))
    expect(exported.speech_usage).toEqual([
      expect.objectContaining({ user_id: u, day: DAY, count: 1 }),
    ])
    await withUserLock(ctx.h.db, u, (tx) => account.deleteAccount(tx, u))
    const [row] = await ctx.admin`SELECT count(*)::int AS n FROM speech_usage WHERE user_id = ${u}`
    expect(row!.n).toBe(0)
  })

  it("adds the guest's usage into the member's on merge (a merge never resets today's quota)", async () => {
    const guest = await ctx.newUser()
    const member = await ctx.newUser({ anonymous: false })
    await consume(guest, 10)
    await consume(guest, 10)
    await consume(guest, 10, '2026-09-26')
    await consume(member, 10)
    await withSystem(ctx.h.db, (tx) =>
      merge.mergeGuestIntoMember(tx, { guestId: guest, memberId: member }),
    )
    const rows = await ctx.admin<{ user_id: string; day: string; count: number }[]>`
      SELECT user_id, day::text AS day, count FROM speech_usage
      WHERE user_id IN (${guest}, ${member}) ORDER BY day`
    expect(rows).toEqual([
      { user_id: member, day: '2026-09-26', count: 1 },
      { user_id: member, day: DAY, count: 3 },
    ])
  })
})
