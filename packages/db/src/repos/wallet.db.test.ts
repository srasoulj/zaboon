import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ConflictError, repos, withSystem, withUser, withUserLock } from '../index'
import { createTestContext, type TestContext } from '../testing'

const { wallet } = repos
const at = '2026-09-25T12:00:00.000Z'

let ctx: TestContext
let alice: string
let bob: string

beforeAll(async () => {
  ctx = await createTestContext()
  alice = await ctx.newUser({ anonymous: false })
  bob = await ctx.newUser({ anonymous: false })
})
afterAll(() => ctx.close())

const invariant = async (userId: string) => {
  const [coins, sum] = await withUser(ctx.h.db, userId, async (tx) => [
    await wallet.getCoins(tx, userId),
    await wallet.getLedgerSum(tx, userId),
  ])
  expect(coins).toBe(sum)
  return coins
}

describe('wallet', () => {
  it('starts at 0 without a row', async () => {
    expect(await withUser(ctx.h.db, alice, (tx) => wallet.getCoins(tx, alice))).toBe(0)
  })

  it('credits grants once per (reason, ref), keeping balance = ledger sum', async () => {
    const grants = [
      { reason: 'quest', ref: '2026-09-25:xp_20', amount: 10 },
      { reason: 'quest', ref: '2026-09-25:lessons_1', amount: 10 },
    ]
    const r1 = await withUserLock(ctx.h.db, alice, (tx) =>
      wallet.creditCoins(tx, alice, grants, at),
    )
    expect(r1).toEqual({ credited: grants, coins: 20 })
    const r2 = await withUserLock(ctx.h.db, alice, (tx) =>
      wallet.creditCoins(tx, alice, grants, at),
    )
    expect(r2).toEqual({ credited: [], coins: 20 })
    expect(await invariant(alice)).toBe(20)
    expect(
      await withUser(ctx.h.db, alice, (tx) =>
        wallet.listLedgerKeys(tx, alice, ['2026-09-25:xp_20', 'other']),
      ),
    ).toEqual([{ reason: 'quest', ref: '2026-09-25:xp_20' }])
  })

  it('refuses invalid grant amounts', async () => {
    await expect(
      withUserLock(ctx.h.db, alice, (tx) =>
        wallet.creditCoins(tx, alice, [{ reason: 'quest', ref: 'x', amount: 0 }], at),
      ),
    ).rejects.toThrow(/invalid coin grant/)
  })

  it('debits a purchase once, found again by its purchaseId', async () => {
    const purchaseId = 'a0000000-0000-4000-8000-000000000001'
    const r = await withUserLock(ctx.h.db, alice, (tx) =>
      wallet.debitPurchase(tx, alice, { item: 'streak_freeze', purchaseId, price: 15 }, at),
    )
    expect(r.coins).toBe(5)
    expect(
      await withUser(ctx.h.db, alice, (tx) => wallet.findPurchase(tx, alice, purchaseId)),
    ).toEqual({
      purchaseId,
      item: 'streak_freeze',
    })
    // The same id again (any item) conflicts and rolls back the debit.
    await expect(
      withUserLock(ctx.h.db, alice, (tx) =>
        wallet.debitPurchase(tx, alice, { item: 'heart_refill', purchaseId, price: 1 }, at),
      ),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(await invariant(alice)).toBe(5)
  })

  it('never goes negative', async () => {
    await expect(
      withUserLock(ctx.h.db, alice, (tx) =>
        wallet.debitPurchase(
          tx,
          alice,
          { item: 'heart_refill', purchaseId: 'a0000000-0000-4000-8000-000000000002', price: 6 },
          at,
        ),
      ),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(await invariant(alice)).toBe(5)
  })

  it('is per user (a purchaseId of alice is unknown to bob; RLS hides her rows)', async () => {
    expect(
      await withUser(ctx.h.db, bob, (tx) =>
        wallet.findPurchase(tx, bob, 'a0000000-0000-4000-8000-000000000001'),
      ),
    ).toBeNull()
    // Even asking for alice's rows from bob's scope sees nothing.
    expect(await withUser(ctx.h.db, bob, (tx) => wallet.getCoins(tx, alice))).toBe(0)
    expect(await invariant(bob)).toBe(0)
  })

  it('system scope can credit (league rewards)', async () => {
    const r = await withSystem(ctx.h.db, (tx) =>
      wallet.creditCoins(
        tx,
        bob,
        [{ reason: 'league', ref: '2026-09-21T00:00:00.000Z', amount: 30 }],
        at,
      ),
    )
    expect(r.coins).toBe(30)
    expect(await invariant(bob)).toBe(30)
  })
})
