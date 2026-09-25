import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { repos, withUser } from '../index'
import { createTestContext, type TestContext } from '../testing'

const { rateLimits } = repos

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(() => ctx.close())

const T0 = '2026-09-25T10:00:00.000Z'
const at = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString()

describe('consumeToken (token bucket)', () => {
  it('allows a burst up to the per-minute capacity, then denies with a retry hint', async () => {
    const results = []
    for (let i = 0; i < 4; i++) results.push(await rateLimits.consumeToken(ctx.h.db, 'burst', 3, { now: T0 }))
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false])
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0])
    // 3/min refills one token every 20s.
    expect(results[3]!.retryAfterMs).toBe(20_000)
  })

  it('refills continuously over time, capped at capacity', async () => {
    for (let i = 0; i < 3; i++) await rateLimits.consumeToken(ctx.h.db, 'refill', 3, { now: T0 })
    expect((await rateLimits.consumeToken(ctx.h.db, 'refill', 3, { now: at(10) })).allowed).toBe(false)
    const denied = await rateLimits.consumeToken(ctx.h.db, 'refill', 3, { now: at(10) })
    expect(denied.retryAfterMs).toBe(10_000)
    expect((await rateLimits.consumeToken(ctx.h.db, 'refill', 3, { now: at(20) })).allowed).toBe(true)
    // After a long idle period the bucket is full again, never above capacity.
    const burst = []
    for (let i = 0; i < 4; i++) burst.push((await rateLimits.consumeToken(ctx.h.db, 'refill', 3, { now: at(3600) })).allowed)
    expect(burst).toEqual([true, true, true, false])
  })

  it('keeps keys independent and supports a cost', async () => {
    expect((await rateLimits.consumeToken(ctx.h.db, 'a', 1, { now: T0 })).allowed).toBe(true)
    expect((await rateLimits.consumeToken(ctx.h.db, 'b', 1, { now: T0 })).allowed).toBe(true)
    expect((await rateLimits.consumeToken(ctx.h.db, 'a', 1, { now: T0 })).allowed).toBe(false)
    expect((await rateLimits.consumeToken(ctx.h.db, 'c', 10, { now: T0, cost: 8 })).remaining).toBe(2)
    expect((await rateLimits.consumeToken(ctx.h.db, 'c', 10, { now: T0, cost: 3 })).allowed).toBe(false)
    expect((await rateLimits.consumeToken(ctx.h.db, 'd', 2, { now: T0, cost: 3 })).allowed).toBe(false)
  })

  it('never over-spends under concurrency', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () => rateLimits.consumeToken(ctx.h.db, 'concurrent', 10, { now: T0 })),
    )
    expect(results.filter((r) => r.allowed)).toHaveLength(10)
  })

  it('works inside a user-scoped transaction and with the real clock', async () => {
    const u = await ctx.newUser()
    const r = await withUser(ctx.h.db, u, (tx) => rateLimits.consumeToken(tx, `sessions:${u}`, 20))
    expect(r).toEqual({ allowed: true, remaining: 19, retryAfterMs: 0 })
  })

  it('rejects nonsensical limits', async () => {
    await expect(rateLimits.consumeToken(ctx.h.db, 'x', 0)).rejects.toThrow()
    await expect(rateLimits.consumeToken(ctx.h.db, 'x', 5, { cost: 0 })).rejects.toThrow()
  })
})
