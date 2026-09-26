/**
 * POST /api/account/merge keeps streak freezes bought with coins (#53's contract change request):
 * the member's streak is rebuilt by replaying the active days together with the freeze purchases.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ALL_ON, api, grantCoins, lesson, read } from '../engagement/helpers'
import { createHarness, type Harness } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h?.close()
})

const now = '2031-05-07T12:00:00.000Z'

async function freezesOf(user: Parameters<typeof read>[3]): Promise<number> {
  const res = await read(h, api.home, '/api/home', user, { now, flags: ALL_ON })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body.streak.freezes as number
}

describe('guest → member merge', () => {
  it('keeps a streak freeze the guest bought', async () => {
    const guest = await h.guest()
    await lesson(h, guest, { now, flags: ALL_ON })
    await grantCoins(h, guest.id, 500, 'merge-freeze')
    const before = await freezesOf(guest)
    const bought = await h.call(api.purchase, {
      path: '/api/shop/purchase',
      user: guest,
      now,
      flags: ALL_ON,
      body: { item: 'streak_freeze', purchaseId: crypto.randomUUID() },
    })
    expect(bought.status, JSON.stringify(bought.body)).toBe(200)
    const guestFreezes = await freezesOf(guest)
    expect(guestFreezes).toBe(before + 1)

    const member = await h.member()
    const res = await h.call(api.merge, {
      path: '/api/account/merge',
      user: member,
      now,
      flags: ALL_ON,
      body: { guestToken: guest.token },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(await freezesOf(member)).toBe(guestFreezes)
  })

  it('leaves a merge without purchases exactly as before', async () => {
    const guest = await h.guest()
    await lesson(h, guest, { now })
    const member = await h.member()
    const res = await h.call(api.merge, {
      path: '/api/account/merge',
      user: member,
      now,
      body: { guestToken: guest.token },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const home = await read(h, api.home, '/api/home', member, { now })
    expect(home.body.streak).toMatchObject({ current: 1, freezes: 1 })
  })
})
