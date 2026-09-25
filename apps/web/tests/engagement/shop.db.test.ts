/** The shop (flags.shop): GET /api/shop, POST /api/shop/purchase, POST /api/lives/refill. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, type Harness, type TestUser } from '../api/harness'
import { wrongEvent } from '../api/flows'
import { api, coinsOf, grantCoins, read, startLesson } from './helpers'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
  await h.setFlags({ shop: true })
})
afterAll(async () => {
  await h?.close()
})

const now = '2031-05-07T12:00:00.000Z'
const buy = (user: TestUser, item: string, purchaseId: string, at = now) =>
  h.call(api.purchase, { path: '/api/shop/purchase', user, now: at, body: { item, purchaseId } })
const refill = (user: TestUser, purchaseId: string, at = now) =>
  h.call(api.refill, { path: '/api/lives/refill', user, now: at, body: { purchaseId } })
const shop = (user: TestUser, at = now) => read(h, api.shop, '/api/shop', user, { now: at })
const uuid = () => crypto.randomUUID()

async function expectBalanced(userId: string, coins: number) {
  expect(await coinsOf(h, userId)).toEqual({ wallet: coins, ledger: coins })
}

/** Takes `n` hearts away through wrong-attempt events on a fresh lesson. */
async function loseHearts(user: TestUser, n: number, at = now) {
  const s = await startLesson(h, user, { now: at })
  for (let i = 0; i < n; i++)
    expect((await wrongEvent(h, user, s.sessionId, i, { now: at })).status).toBe(200)
}

describe('GET /api/shop', () => {
  it('lists both items with prices, owned/max and why they are unavailable', async () => {
    const u = await h.guest()
    const res = await shop(u)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      coins: 0,
      items: [
        { id: 'streak_freeze', price: 100, owned: 1, max: 2, unavailable: 'insufficient_coins' },
        { id: 'heart_refill', price: 150, owned: null, max: null, unavailable: 'lives_full' },
      ],
    })
  })
})

describe('purchases', () => {
  it('buys a streak freeze: one debit, freezes + 1, balance = ledger', async () => {
    const u = await h.guest()
    await grantCoins(h, u.id, 250, 'g1')
    const id = uuid()
    const res = await buy(u, 'streak_freeze', id)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body).toMatchObject({
      purchaseId: id,
      item: 'streak_freeze',
      replayed: false,
      coins: 150,
    })
    expect(res.body.streak.freezes).toBe(2)
    await expectBalanced(u.id, 150)
    const [row] =
      await h.sql`SELECT amount, reason, ref FROM coin_ledger WHERE user_id = ${u.id} AND amount < 0`
    expect(row).toEqual({ amount: -100, reason: 'streak_freeze', ref: id })

    // A replay (same id, same item) changes nothing and answers replayed.
    const again = await buy(u, 'streak_freeze', id)
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ replayed: true, coins: 150 })
    expect(again.body.streak.freezes).toBe(2)
    await expectBalanced(u.id, 150)

    // At the cap: max_owned (409 conflict, details.reason).
    const capped = await buy(u, 'streak_freeze', uuid())
    expect(capped.status).toBe(409)
    expect(capped.body.error).toMatchObject({ code: 'conflict', details: { reason: 'max_owned' } })

    // The same id for another item: purchase_id_reused.
    await loseHearts(u, 2)
    const reused = await refill(u, id)
    expect(reused.status).toBe(409)
    expect(reused.body.error).toMatchObject({
      code: 'conflict',
      details: { reason: 'purchase_id_reused' },
    })
    await expectBalanced(u.id, 150)
  })

  it('refills hearts, refusing when full, unlimited or unaffordable', async () => {
    const u = await h.guest()
    await grantCoins(h, u.id, 200, 'g1')
    const full = await refill(u, uuid())
    expect(full.status).toBe(409)
    expect(full.body.error).toMatchObject({ code: 'conflict', details: { reason: 'lives_full' } })

    await loseHearts(u, 3)
    const ok = await refill(u, uuid())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body).toMatchObject({ item: 'heart_refill', replayed: false, coins: 50 })
    expect(ok.body.lives).toMatchObject({ count: 5, max: 5, nextRegenAt: null })
    const [lives] = await h.sql`SELECT count FROM lives WHERE user_id = ${u.id}`
    expect(lives!.count).toBe(5)

    await loseHearts(u, 1)
    const broke = await refill(u, uuid())
    expect(broke.status).toBe(409)
    expect(broke.body.error).toMatchObject({
      code: 'insufficient_coins',
      details: { reason: 'insufficient_coins' },
    })
    await expectBalanced(u.id, 50)

    await h.sql`UPDATE lives SET policy = 'unlimited' WHERE user_id = ${u.id}`
    const unlimited = await refill(u, uuid())
    expect(unlimited.status).toBe(409)
    expect(unlimited.body.error.details).toEqual({ reason: 'unlimited_lives' })
  })

  it('a refused purchaseId is not recorded: the retry is a fresh purchase', async () => {
    const u = await h.guest()
    const id = uuid()
    await loseHearts(u, 1)
    expect((await refill(u, id)).body.error.code).toBe('insufficient_coins')
    await grantCoins(h, u.id, 150, 'g1')
    const ok = await refill(u, id)
    expect(ok.status).toBe(200)
    expect(ok.body.replayed).toBe(false)
    await expectBalanced(u.id, 0)
  })

  it('concurrent double purchases charge once (same id) and never overdraw (different ids)', async () => {
    const u = await h.guest()
    await grantCoins(h, u.id, 150, 'g1')
    const id = uuid()
    const same = await Promise.all(Array.from({ length: 5 }, () => buy(u, 'streak_freeze', id)))
    expect(same.every((r) => r.status === 200)).toBe(true)
    expect(same.filter((r) => r.body.replayed === false)).toHaveLength(1)
    await expectBalanced(u.id, 50)

    const v = await h.guest()
    await grantCoins(h, v.id, 150, 'g1')
    await h.sql`INSERT INTO streaks (user_id, freezes) VALUES (${v.id}, 0)`
    const different = await Promise.all(
      Array.from({ length: 4 }, () => buy(v, 'streak_freeze', uuid())),
    )
    expect(different.filter((r) => r.status === 200)).toHaveLength(1)
    expect(different.filter((r) => r.status === 409).map((r) => r.body.error.code)).toEqual([
      'insufficient_coins',
      'insufficient_coins',
      'insufficient_coins',
    ])
    await expectBalanced(v.id, 50)
  })

  it('purchase ids are per user (IDOR): another user can reuse an id without replaying mine', async () => {
    const a = await h.guest()
    const b = await h.guest()
    await grantCoins(h, a.id, 100, 'g1')
    await grantCoins(h, b.id, 100, 'g1')
    const id = uuid()
    expect((await buy(a, 'streak_freeze', id)).body.replayed).toBe(false)
    const rb = await buy(b, 'streak_freeze', id)
    expect(rb.status).toBe(200)
    expect(rb.body).toMatchObject({ replayed: false, coins: 0 })
    await expectBalanced(a.id, 0)
    await expectBalanced(b.id, 0)
  })

  it('validates the request', async () => {
    const u = await h.guest()
    expect((await buy(u, 'streak_freeze', 'not-a-uuid')).status).toBe(400)
    expect((await buy(u, 'gems', uuid())).status).toBe(400)
  })
})
