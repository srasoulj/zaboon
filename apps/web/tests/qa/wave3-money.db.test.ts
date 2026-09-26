/**
 * QA: money under concurrency (flags.shop / flags.quests). Parallel purchases never overdraw, the
 * ledger always sums to the wallet, purchase ids are per user, a refused id can be retried
 * (oracle sh-15), and a /complete racing a purchase leaves the wallet consistent.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, type Harness, type TestUser } from '../api/harness'
import { api, completeRaw, grantCoins, read, startLesson } from '../engagement/helpers'
import {
  ensureProfile,
  expectBalanced,
  loseHearts,
  plusMinutes,
  purchase,
  refill,
  setFreezes,
  uuid,
} from './support'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h?.close()
})

const now = '2034-03-15T12:00:00.000Z'
const shopOn = { shop: true }

/** A guest with `coins` coins (granted) and `freezes` streak freezes. */
async function funded(coins: number, freezes = 0): Promise<TestUser> {
  const u = await h.guest()
  await ensureProfile(h, u, now)
  if (coins > 0) await grantCoins(h, u.id, coins, uuid())
  await setFreezes(h, u.id, freezes)
  return u
}

describe('parallel purchases with distinct purchaseIds', () => {
  for (const balance of [99, 150, 199]) {
    it(`a wallet of ${balance} buys exactly floor(${balance} / 100) freezes out of 6 at once`, async () => {
      const u = await funded(balance)
      const res = await Promise.all(
        Array.from({ length: 6 }, () => purchase(h, u, 'streak_freeze', uuid(), { now })),
      )
      const ok = res.filter((r) => r.status === 200)
      expect(ok).toHaveLength(Math.floor(balance / 100))
      for (const r of res.filter((x) => x.status !== 200))
        expect(r.body.error).toMatchObject({
          code: 'insufficient_coins',
          details: { reason: 'insufficient_coins' },
        })
      await expectBalanced(h, u.id, balance - 100 * ok.length)
      const [ledger] = await h.sql`
        SELECT count(*)::int AS n FROM public.coin_ledger WHERE user_id = ${u.id} AND amount < 0`
      expect(ledger!.n).toBe(ok.length)
    })
  }

  it('freezes and heart refills racing for one wallet never overdraw it', async () => {
    const u = await funded(260)
    await loseHearts(h, u, 3, now)
    const res = await Promise.all([
      purchase(h, u, 'streak_freeze', uuid(), { now }),
      refill(h, u, uuid(), { now }),
      purchase(h, u, 'streak_freeze', uuid(), { now }),
      refill(h, u, uuid(), { now }),
      purchase(h, u, 'streak_freeze', uuid(), { now }),
      refill(h, u, uuid(), { now }),
    ])
    const ok = res.filter((r) => r.status === 200)
    const spent = ok.reduce((n, r) => n + (r.body.item === 'heart_refill' ? 150 : 100), 0)
    expect(spent).toBeLessThanOrEqual(260)
    // At most one refill (it fills the hearts) and at most two freezes (the cap).
    expect(ok.filter((r) => r.body.item === 'heart_refill').length).toBeLessThanOrEqual(1)
    expect(ok.filter((r) => r.body.item === 'streak_freeze').length).toBeLessThanOrEqual(2)
    const wallet = await expectBalanced(h, u.id, 260 - spent)
    // The last response any request saw is the final balance (each ran under the user lock).
    expect(Math.min(...ok.map((r) => r.body.coins as number))).toBe(wallet)
    for (const r of res.filter((x) => x.status !== 200)) expect(r.status).toBe(409)
  })
})

describe('purchase ids', () => {
  it('the same purchaseId from two users makes two independent purchases', async () => {
    const alice = await funded(250, 1)
    const bob = await funded(120, 1)
    const id = uuid()
    const [a, b] = await Promise.all([
      purchase(h, alice, 'streak_freeze', id, { now }),
      purchase(h, bob, 'streak_freeze', id, { now }),
    ])
    expect(a.body).toMatchObject({ purchaseId: id, replayed: false, coins: 150 })
    expect(b.body).toMatchObject({ purchaseId: id, replayed: false, coins: 20 })
    // Each replay answers with its own buyer's balance only.
    expect((await purchase(h, alice, 'streak_freeze', id, { now })).body).toMatchObject({
      replayed: true,
      coins: 150,
    })
    expect((await purchase(h, bob, 'streak_freeze', id, { now })).body).toMatchObject({
      replayed: true,
      coins: 20,
    })
    await expectBalanced(h, alice.id, 150)
    await expectBalanced(h, bob.id, 20)
  })

  it("another user's purchaseId for another item is neither a replay nor a 'reused' refusal", async () => {
    const alice = await funded(250, 0)
    const id = uuid()
    expect((await purchase(h, alice, 'streak_freeze', id, { now })).status).toBe(200)
    // Mallory tries alice's id for a heart refill: her own purchase, judged on her own state.
    const mallory = await funded(200, 0)
    await loseHearts(h, mallory, 1, now)
    const r = await refill(h, mallory, id, { now })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body).toMatchObject({ purchaseId: id, item: 'heart_refill', replayed: false })
    expect(JSON.stringify(r.body)).not.toContain(alice.id)
    await expectBalanced(h, mallory.id, 50)
    await expectBalanced(h, alice.id, 150)
  })

  it('a replay after a refusal is a fresh purchase (sh-15), then a real replay', async () => {
    const u = await funded(50, 0)
    const id = uuid()
    const refused = await purchase(h, u, 'streak_freeze', id, { now })
    expect(refused.status).toBe(409)
    expect(refused.body.error).toMatchObject({ code: 'insufficient_coins' })
    await grantCoins(h, u.id, 100, uuid())
    const later = plusMinutes(now, 1)
    const first = await purchase(h, u, 'streak_freeze', id, { now: later })
    expect(first.body).toMatchObject({ replayed: false, coins: 50, streak: { freezes: 1 } })
    const again = await purchase(h, u, 'streak_freeze', id, { now: later })
    expect(again.body).toMatchObject({ replayed: true, coins: 50, streak: { freezes: 1 } })
    await expectBalanced(h, u.id, 50)
  })
})

describe('heart refill with full hearts', () => {
  it('is 409 lives_full, also when the hearts have regenerated to full by now', async () => {
    const u = await funded(500, 1)
    const full = await refill(h, u, uuid(), { now })
    expect(full.status).toBe(409)
    expect(full.body.error).toMatchObject({ code: 'conflict', details: { reason: 'lives_full' } })

    // One heart lost at `now`; 5 hours later (regeneration: one heart per 4 h) it is back.
    await loseHearts(h, u, 1, now)
    const regenerated = await refill(h, u, uuid(), { now: plusMinutes(now, 300) })
    expect(regenerated.status).toBe(409)
    expect(regenerated.body.error).toMatchObject({ details: { reason: 'lives_full' } })
    await expectBalanced(h, u.id, 500)
  })
})

describe('/complete and a purchase at the same moment', () => {
  it('leave the wallet equal to the ledger, whatever order they commit in', async () => {
    const flags = { shop: true, quests: true }
    for (let round = 0; round < 4; round++) {
      const u = await funded(150, 1)
      const s = await startLesson(h, u, { now, flags })
      const [done, bought] = await Promise.all([
        completeRaw(h, u, s, { now, flags }),
        purchase(h, u, 'streak_freeze', uuid(), { now, flags }),
      ])
      expect(done.status, JSON.stringify(done.body)).toBe(200)
      expect(bought.status, JSON.stringify(bought.body)).toBe(200)
      const earned = done.body.coins.earned as number
      const wallet = await expectBalanced(h, u.id, 150 - 100 + earned)
      // Whichever committed second reported the final balance.
      expect([done.body.coins.total, bought.body.coins]).toContain(wallet)
      const shop = await read(h, api.shop, '/api/shop', u, { now, flags: shopOn })
      expect(shop.body.coins).toBe(wallet)
    }
  })
})
