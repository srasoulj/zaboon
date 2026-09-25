/** League XP inside /complete, cohort placement, and GET /api/leaderboard (flags.leagues). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, type Harness, type TestUser } from '../api/harness'
import { api, completeRaw, lesson, read, startLesson } from './helpers'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
  await h.setFlags({ leagues: true })
})
afterAll(async () => {
  await h?.close()
})

// Wednesday of the week that starts on Monday 2031-05-05.
const wed = '2031-05-07T12:00:00.000Z'
const thu = '2031-05-08T12:00:00.000Z'
const WEEK = { startsAt: '2031-05-05T00:00:00.000Z', endsAt: '2031-05-12T00:00:00.000Z' }

const board = (user: TestUser, now = wed) =>
  read(h, api.leaderboard, '/api/leaderboard', user, { now })

async function cohortSizes(startsAt: string, tier = 'mes'): Promise<number[]> {
  const rows = await h.sql`
    SELECT c.size, (SELECT count(*)::int FROM league_members m WHERE m.cohort_id = c.id) AS n
    FROM league_cohorts c JOIN league_weeks w ON w.id = c.week_id
    WHERE w.starts_at = ${startsAt} AND c.tier = ${tier} ORDER BY c.id`
  for (const r of rows) expect(r.size).toBe(r.n)
  return rows.map((r) => r.size as number)
}

describe('league XP at commit', () => {
  it('the first XP of the week joins a cohort; later XP accumulates; a replay adds nothing', async () => {
    const alice = await h.member()
    const before = await board(alice)
    expect(before.status).toBe(200)
    expect(before.body).toMatchObject({
      tier: 'mes',
      week: WEEK,
      joined: false,
      members: [],
      lastResult: null,
    })

    const r1 = await lesson(h, alice, { now: wed })
    expect(r1.league).toEqual({
      tier: 'mes',
      weeklyXp: 15,
      rank: 1,
      previousRank: null,
      joinedNow: true,
    })

    const s = await startLesson(h, alice, { now: thu })
    const done = await completeRaw(h, alice, s, { now: thu, wrong: [0] })
    expect(done.body.league).toEqual({
      tier: 'mes',
      weeklyXp: 25,
      rank: 1,
      previousRank: 1,
      joinedNow: false,
    })
    const replay = await completeRaw(h, alice, s, { now: thu })
    expect(replay.body).toEqual(done.body)

    const after = await board(alice, thu)
    expect(after.body.joined).toBe(true)
    expect(after.body.members).toEqual([
      {
        rank: 1,
        displayName: null,
        username: null,
        avatar: null,
        weeklyXp: 25,
        isMe: true,
        zone: 'promote',
      },
    ])
    const [m] = await h.sql`SELECT weekly_xp FROM league_members WHERE user_id = ${alice.id}`
    expect(m!.weekly_xp).toBe(25)
  })

  it('guests never join and get 403 from the leaderboard; their result has no league', async () => {
    const guest = await h.guest()
    const r = await lesson(h, guest, { now: wed })
    expect(r).not.toHaveProperty('league')
    expect((await board(guest)).status).toBe(403)
    const [n] =
      await h.sql`SELECT count(*)::int AS n FROM league_members WHERE user_id = ${guest.id}`
    expect(n!.n).toBe(0)
  })

  it('a flagged (implausible) session does not join and adds no weekly XP', async () => {
    const bob = await h.member()
    const flagged = await lesson(h, bob, { now: wed, ms: 100 })
    expect(flagged.xp.total).toBe(0)
    expect(flagged.league).toEqual({
      tier: 'mes',
      weeklyXp: 0,
      rank: null,
      previousRank: null,
      joinedNow: false,
    })
    await lesson(h, bob, { now: wed })
    const again = await lesson(h, bob, { now: thu, ms: 100 })
    expect(again.league).toMatchObject({ weeklyXp: 15, joinedNow: false })
  })

  it('a new week is a new cohort (first XP of the week joins again)', async () => {
    const carol = await h.member()
    await lesson(h, carol, { now: wed })
    const next = await lesson(h, carol, { now: '2031-05-12T00:00:01.000Z' })
    expect(next.league).toMatchObject({ weeklyXp: 15, joinedNow: true })
    const weeks = await h.sql`
      SELECT w.starts_at FROM league_members m JOIN league_weeks w ON w.id = m.week_id
      WHERE m.user_id = ${carol.id} ORDER BY 1`
    expect(weeks.map((w) => (w.starts_at as Date).toISOString())).toEqual([
      WEEK.startsAt,
      '2031-05-12T00:00:00.000Z',
    ])
  })
})

describe('cohort placement', () => {
  // A week of its own, so the counts are exact.
  const now = '2031-06-04T12:00:00.000Z'
  const startsAt = '2031-06-02T00:00:00.000Z'

  it('fills a cohort to 30; the 31st learner opens a new one', async () => {
    const users = await Promise.all(Array.from({ length: 31 }, () => h.member()))
    for (const u of users.slice(0, 30)) await lesson(h, u, { now })
    expect(await cohortSizes(startsAt)).toEqual([30])
    await lesson(h, users[30]!, { now })
    expect(await cohortSizes(startsAt)).toEqual([30, 1])
    // The 31st sees only their own cohort.
    const b = await board(users[30]!, now)
    expect(b.body.members).toHaveLength(1)
    expect(b.body.members[0]).toMatchObject({ rank: 1, isMe: true })
    // A full cohort's board: 30 rows, 7 promote, 5 demote, never a user id.
    const full = await board(users[0]!, now)
    expect(full.body.members).toHaveLength(30)
    expect(full.body).toMatchObject({ promoteCount: 7, demoteCount: 0 })
    expect(JSON.stringify(full.body)).not.toContain(users[1]!.id)
    for (const m of full.body.members)
      expect(Object.keys(m).sort()).toEqual(
        ['avatar', 'displayName', 'isMe', 'rank', 'username', 'weeklyXp', 'zone'].sort(),
      )
    expect(full.body.members.filter((m: { isMe: boolean }) => m.isMe)).toHaveLength(1)
  })

  it('concurrent first-XP commits for one (week, tier) never exceed 30 or fragment cohorts', async () => {
    const at = '2031-06-11T12:00:00.000Z'
    const users = await Promise.all(Array.from({ length: 45 }, () => h.member()))
    const sessions = await Promise.all(users.map((u) => startLesson(h, u, { now: at })))
    const results = await Promise.all(
      users.map((u, i) => completeRaw(h, u, sessions[i]!, { now: at })),
    )
    for (const r of results) expect(r.status).toBe(200)
    expect(await cohortSizes('2031-06-09T00:00:00.000Z')).toEqual([30, 15])
  })
})

describe('leaderboard privacy (IDOR)', () => {
  it('shows only the caller cohort, with public profile fields and no user ids', async () => {
    const now = '2031-07-02T12:00:00.000Z'
    const a = await h.member()
    const b = await h.member()
    await h.sql`UPDATE public_profiles SET display_name = 'Bita', username = 'bita' WHERE user_id = ${b.id}`
    await lesson(h, a, { now })
    await lesson(h, b, { now, wrong: [0] })
    const res = await board(a, now)
    expect(res.body.members).toEqual([
      expect.objectContaining({ rank: 1, isMe: true, weeklyXp: 15 }),
      expect.objectContaining({
        rank: 2,
        isMe: false,
        weeklyXp: 10,
        displayName: 'Bita',
        username: 'bita',
      }),
    ])
    const text = JSON.stringify(res.body)
    expect(text).not.toContain(a.id)
    expect(text).not.toContain(b.id)
    // A learner in another tier's cohort never appears.
    const c = await h.member()
    await h.sql`INSERT INTO user_league (user_id, tier) VALUES (${c.id}, 'tala')`
    await lesson(h, c, { now })
    expect((await board(a, now)).body.members).toHaveLength(2)
    const cb = await board(c, now)
    expect(cb.body).toMatchObject({ tier: 'tala', joined: true })
    expect(cb.body.members).toHaveLength(1)
  })

  it('home carries the league card for members only', async () => {
    const now = '2031-07-02T12:00:00.000Z'
    const m = await h.member()
    await lesson(h, m, { now })
    const home = await read(h, api.home, '/api/home', m, { now })
    expect(home.body.league).toEqual({
      tier: 'mes',
      joined: true,
      rank: expect.any(Number),
      weeklyXp: 15,
      zone: expect.any(String),
      endsAt: '2031-07-07T00:00:00.000Z',
    })
    const g = await h.guest()
    expect((await read(h, api.home, '/api/home', g, { now })).body).not.toHaveProperty('league')
  })
})
