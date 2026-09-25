/**
 * P2 engagement over HTTP against the running app: flags off → 404, league XP → leaderboard,
 * quests → coins, the shop, and the weekly rollover through its Vercel Cron route.
 */
import { cronHeaders, expect, flagsHeader, test } from '../fixtures'
import { newGuest, signInEmail, uniqueEmail } from '../pages/helpers'
import { ENGAGEMENT_ON, grantCoins, playLesson, randomPastWeek } from './helpers'

const on = flagsHeader(ENGAGEMENT_ON)

test('with the flags off the engagement routes are 404 and the result has no P2 fields', async ({
  request,
}) => {
  const guest = await newGuest(request)
  for (const path of ['/api/quests', '/api/shop', '/api/practice']) {
    const res = await request.get(path, { headers: guest.headers })
    expect(res.status(), path).toBe(404)
  }
  const result = await playLesson(request, guest)
  expect(result).not.toHaveProperty('coins')
  expect(result).not.toHaveProperty('quests')
  expect(result).not.toHaveProperty('league')
})

test('earning XP places a member on the leaderboard', async ({ request }) => {
  const week = await randomPastWeek()
  const member = await signInEmail(request, uniqueEmail())
  const result = await playLesson(request, member, { flags: ENGAGEMENT_ON, now: week.now })
  expect(result.league).toMatchObject({ tier: 'mes', weeklyXp: 15, rank: 1, joinedNow: true })
  const res = await request.get('/api/leaderboard', {
    headers: { ...member.headers, ...on, 'x-test-now': week.now },
  })
  expect(res.status()).toBe(200)
  const board = await res.json()
  expect(board).toMatchObject({
    tier: 'mes',
    joined: true,
    week: { startsAt: week.startsAt, endsAt: week.endsAt },
  })
  expect(board.members).toEqual([
    expect.objectContaining({ rank: 1, isMe: true, weeklyXp: 15, zone: 'promote' }),
  ])
  expect(JSON.stringify(board)).not.toContain(member.userId)
  // Guests can't see leagues.
  const guest = await newGuest(request)
  expect(
    (await request.get('/api/leaderboard', { headers: { ...guest.headers, ...on } })).status(),
  ).toBe(403)
})

test('the weekly rollover (Vercel Cron) closes the week once and pays the winner', async ({
  request,
}) => {
  const week = await randomPastWeek()
  const winner = await signInEmail(request, uniqueEmail())
  const second = await signInEmail(request, uniqueEmail())
  // Leagues only: a quest reward would add to the coins this test counts.
  const leagues = { leagues: true }
  await playLesson(request, winner, { flags: leagues, now: week.now })
  await playLesson(request, second, { flags: leagues, now: week.now, wrong: [0] })

  expect((await request.get('/api/cron/league-rollover')).status()).toBe(401)
  // Like Vercel Cron: at the real time, which closes every ended week (this one included). The
  // cron bucket's rate limit also runs on the request clock, so no x-test-now here.
  const run = () => request.get('/api/cron/league-rollover', { headers: cronHeaders() })
  const first = await run()
  expect(first.status(), await first.text()).toBe(200)
  const body = await first.json()
  expect(body.closed).toContainEqual(
    expect.objectContaining({ week: { startsAt: week.startsAt, endsAt: week.endsAt } }),
  )
  const again = await (await run()).json()
  expect(again.closed.map((c: { week: { startsAt: string } }) => c.week.startsAt)).not.toContain(
    week.startsAt,
  )

  // The next week the winner sees last week's result and is in the next tier; coins were paid.
  const board = await (
    await request.get('/api/leaderboard', {
      headers: { ...winner.headers, ...on, 'x-test-now': week.after },
    })
  ).json()
  expect(board).toMatchObject({
    tier: 'noqreh',
    lastResult: { rank: 1, outcome: 'promote', tier: 'mes', newTier: 'noqreh', coins: 30 },
  })
  const shop = await (
    await request.get('/api/shop', { headers: { ...winner.headers, ...on } })
  ).json()
  expect(shop.coins).toBe(30)
})

test('a completed quest pays coins; a streak freeze can be bought once per purchaseId', async ({
  request,
}) => {
  // Quests are drawn per learner: find one whose first lesson completes a quest.
  let paid: { user: Awaited<ReturnType<typeof newGuest>>; total: number } | null = null
  for (let i = 0; i < 20 && !paid; i++) {
    const guest = await newGuest(request)
    const r = await playLesson(request, guest, { flags: ENGAGEMENT_ON })
    expect(r.quests).toHaveLength(3)
    if (r.coins && r.coins.earned > 0) paid = { user: guest, total: r.coins.total }
  }
  expect(paid, 'a learner whose first lesson completes a quest').not.toBeNull()
  const { user, total } = paid!
  const home = await (
    await request.get('/api/home', { headers: { ...user.headers, ...on } })
  ).json()
  expect(home.coins).toBe(total)

  await grantCoins(user.userId, 200)
  const purchaseId = crypto.randomUUID()
  const buy = () =>
    request.post('/api/shop/purchase', {
      headers: { ...user.headers, ...on },
      data: { item: 'streak_freeze', purchaseId },
    })
  const first = await buy()
  expect(first.status(), await first.text()).toBe(200)
  expect(await first.json()).toMatchObject({ replayed: false, coins: total + 100 })
  const replay = await buy()
  expect(await replay.json()).toMatchObject({ replayed: true, coins: total + 100 })
  const reused = await request.post('/api/lives/refill', {
    headers: { ...user.headers, ...on },
    data: { purchaseId },
  })
  expect(reused.status()).toBe(409)
})
