/** POST /api/onboarding, GET/PATCH /api/profile and GET/PATCH /api/settings. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_COURSE_ID, DEFAULT_SETTINGS } from '@zaboon/contracts'
import { api, get, play, start } from './flows'
import { createHarness, type Harness, type TestUser } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness({ courses: ['fixtures', 'fa-en'] })
})
afterAll(async () => {
  await h?.close()
})

const onboarding = {
  reason: 'heritage',
  selfLevel: 'speak_not_read',
  dailyGoalXp: 30,
  ageConfirmed: true,
  tz: 'Europe/Berlin',
}
const onboard = (user: TestUser, body: unknown = onboarding, now?: string) =>
  h.call(api.onboarding, { path: '/api/onboarding', user, body, ...(now ? { now } : {}) })

describe('POST /api/onboarding', () => {
  it('requires the 13+ confirmation and a daily goal from the options', async () => {
    const alice = await h.guest()
    expect((await onboard(alice, { ...onboarding, ageConfirmed: false })).status).toBe(400)
    const { ageConfirmed: _, ...noAge } = onboarding
    expect((await onboard(alice, noAge)).status).toBe(400)
    const goal = await onboard(alice, { ...onboarding, dailyGoalXp: 15 })
    expect(goal.status).toBe(400)
    expect(goal.body.error.code).toBe('validation')
    const [p] =
      await h.sql`SELECT onboarded, age_confirmed FROM profiles WHERE user_id = ${alice.id}`
    expect(p).toMatchObject({ onboarded: false, age_confirmed: false })
  })

  it('saves the answers, the timezone and enrolls in the default course; replays are harmless', async () => {
    const alice = await h.guest()
    const res = await onboard(alice)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body).toMatchObject({
      user: { id: alice.id, isAnonymous: true, onboarded: true, ageConfirmed: true },
      course: { id: DEFAULT_COURSE_ID },
      settings: { reason: 'heritage', selfLevel: 'speak_not_read', dailyGoalXp: 30 },
      dailyGoal: { goal: 30, xp: 0 },
    })
    expect(res.body.course.contentVersion).toBeGreaterThan(0)
    expect(res.body.course.currentLevelId).toEqual(expect.any(String))
    const replay = await onboard(alice)
    expect(replay.status).toBe(200)
    expect(replay.body).toEqual(res.body)
    const [p] = await h.sql`SELECT timezone FROM profiles WHERE user_id = ${alice.id}`
    expect(p!.timezone).toBe('Europe/Berlin')
    const enrollments = await h.sql`SELECT course_id FROM enrollments WHERE user_id = ${alice.id}`
    expect(enrollments.map((e) => e.course_id)).toEqual([DEFAULT_COURSE_ID])
    // The default course's path is readable right away.
    const path = await get(h, api.path, '/api/path', alice)
    expect(path.status).toBe(200)
    expect(path.body.courseId).toBe(DEFAULT_COURSE_ID)
  })

  it('accepts a timezone change at most once per 24 hours', async () => {
    const alice = await h.guest()
    const t0 = '2031-06-01T10:00:00Z'
    await onboard(alice, onboarding, t0)
    await start(h, alice, { tz: 'Asia/Tokyo', now: '2031-06-01T12:00:00Z' })
    let [p] = await h.sql`SELECT timezone FROM profiles WHERE user_id = ${alice.id}`
    expect(p!.timezone).toBe('Europe/Berlin')
    const s = await start(h, alice, { tz: 'Asia/Tokyo', now: '2031-06-02T11:00:00Z' })
    ;[p] = await h.sql`SELECT timezone FROM profiles WHERE user_id = ${alice.id}`
    expect(p!.timezone).toBe('Asia/Tokyo')
    const [row] = await h.sql`SELECT tz FROM sessions WHERE id = ${s.sessionId}`
    expect(row!.tz).toBe('Asia/Tokyo')
    // An invalid IANA name is ignored.
    await start(h, alice, { tz: 'Mars/Olympus', now: '2031-06-05T11:00:00Z' })
    ;[p] = await h.sql`SELECT timezone FROM profiles WHERE user_id = ${alice.id}`
    expect(p!.timezone).toBe('Asia/Tokyo')
  })
})

describe('GET/PATCH /api/profile', () => {
  it('returns the profile and its stats', async () => {
    const alice = await h.guest()
    const empty = await get(h, api.profile, '/api/profile', alice)
    expect(empty.status).toBe(200)
    expect(empty.body).toMatchObject({
      id: alice.id,
      isAnonymous: true,
      username: null,
      displayName: null,
      stats: { xpTotal: 0, streakCurrent: 0, streakLongest: 0, lessonsCompleted: 0 },
    })
    await play(h, alice)
    const after = await get(h, api.profile, '/api/profile', alice)
    expect(after.body.stats).toEqual({
      xpTotal: 15,
      streakCurrent: 1,
      streakLongest: 1,
      lessonsCompleted: 1,
    })
  })

  it('updates display name and avatar; usernames need a linked account and are unique', async () => {
    const guest = await h.guest()
    const patch = (user: TestUser, body: unknown) =>
      h.call(api.updateProfile, { method: 'PATCH', path: '/api/profile', user, body })
    const named = await patch(guest, { displayName: '  Sara  ', avatar: { color: 'firouzeh' } })
    expect(named.status).toBe(200)
    expect(named.body).toMatchObject({ displayName: 'Sara', avatar: { color: 'firouzeh' } })
    const guestUsername = await patch(guest, { username: 'sara_1' })
    expect(guestUsername.status).toBe(403)

    const a = await h.member()
    const b = await h.member()
    expect((await patch(a, { username: 'sara_1' })).body.username).toBe('sara_1')
    expect((await patch(a, { username: 'sara_1' })).status).toBe(200) // idempotent
    const taken = await patch(b, { username: 'sara_1' })
    expect(taken.status).toBe(409)
    expect(taken.body.error.code).toBe('conflict')

    expect((await patch(a, { username: 'No Spaces' })).status).toBe(400)
    expect((await patch(a, { email: 'x@y.z' })).status).toBe(400) // strict
    expect((await patch(a, { avatar: { blob: 'x'.repeat(5000) } })).status).toBe(400)
    // Other learners see only the public fields they set.
    const [pub] = await h.sql`SELECT username FROM public_profiles WHERE user_id = ${b.id}`
    expect(pub!.username).toBeNull()
  })
})

describe('GET/PATCH /api/settings', () => {
  it('reads defaults, merges patches, and validates the daily goal', async () => {
    const alice = await h.guest()
    const patch = (body: unknown) =>
      h.call(api.updateSettings, { method: 'PATCH', path: '/api/settings', user: alice, body })
    expect((await get(h, api.settings, '/api/settings', alice)).body).toEqual(DEFAULT_SETTINGS)
    const r = await patch({ sound: false, transliteration: 'off' })
    expect(r.body).toEqual({ ...DEFAULT_SETTINGS, sound: false, transliteration: 'off' })
    expect((await patch({ sound: false, transliteration: 'off' })).body).toEqual(r.body) // replay
    expect((await patch({ dailyGoalXp: 50 })).body.dailyGoalXp).toBe(50)
    expect((await patch({ dailyGoalXp: 7 })).status).toBe(400)
    expect((await patch({ motion: 'sideways' })).status).toBe(400)
    expect((await patch({ unknown: true })).status).toBe(400)
    expect((await get(h, api.settings, '/api/settings', alice)).body).toMatchObject({
      sound: false,
      transliteration: 'off',
      dailyGoalXp: 50,
    })
    const home = await get(h, api.home, '/api/home', alice)
    expect(home.body.dailyGoal.goal).toBe(50)
  })
})
