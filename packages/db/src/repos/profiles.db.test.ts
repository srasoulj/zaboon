import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@zaboon/contracts'
import { ConflictError, repos, withSystem, withUser, withUserLock } from '../index'
import { createTestContext, type TestContext } from '../testing'

const { profiles } = repos

let ctx: TestContext
let alice: string
let bob: string

beforeAll(async () => {
  ctx = await createTestContext()
  alice = await ctx.newUser()
  bob = await ctx.newUser({ anonymous: false, email: 'bob@example.test' })
})
afterAll(() => ctx.close())

describe('profiles repository', () => {
  it('the auth.users trigger creates profile and public profile rows', async () => {
    const p = await withUser(ctx.h.db, alice, (tx) => profiles.getProfile(tx, alice))
    expect(p).toMatchObject({ userId: alice, timezone: 'UTC', ageConfirmed: false, onboarded: false })
    expect(p!.settings).toEqual(DEFAULT_SETTINGS)
    expect(p!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    const pub = await withUser(ctx.h.db, alice, (tx) => profiles.getPublicProfile(tx, alice))
    expect(pub).toEqual({ userId: alice, username: null, displayName: null, avatar: null, streakCurrent: 0, xpTotal: 0 })
  })

  it('ensureProfile is idempotent', async () => {
    await withUser(ctx.h.db, alice, async (tx) => {
      await profiles.ensureProfile(tx, alice)
      await profiles.ensureProfile(tx, alice)
    })
    const rows = await ctx.admin`SELECT count(*)::int AS n FROM public.profiles WHERE user_id = ${alice}`
    expect(rows[0]!.n).toBe(1)
  })

  it('updates profile fields', async () => {
    const at = '2026-09-25T10:00:00.000Z'
    const p = await withUserLock(ctx.h.db, alice, (tx) =>
      profiles.updateProfile(tx, alice, { timezone: 'Asia/Tehran', tzChangedAt: at, ageConfirmed: true, onboarded: true }),
    )
    expect(p).toMatchObject({ timezone: 'Asia/Tehran', tzChangedAt: at, ageConfirmed: true, onboarded: true })
  })

  it('merges settings patches over defaults and validates them', async () => {
    const s1 = await withUser(ctx.h.db, alice, (tx) => profiles.updateSettings(tx, alice, { sound: false, dailyGoalXp: 30 }))
    expect(s1).toEqual({ ...DEFAULT_SETTINGS, sound: false, dailyGoalXp: 30 })
    const s2 = await withUser(ctx.h.db, alice, (tx) => profiles.updateSettings(tx, alice, { motion: 'reduced' }))
    expect(s2).toEqual({ ...DEFAULT_SETTINGS, sound: false, dailyGoalXp: 30, motion: 'reduced' })
    expect(await withUser(ctx.h.db, alice, (tx) => profiles.getSettings(tx, alice))).toEqual(s2)
    await expect(
      withUser(ctx.h.db, alice, (tx) => profiles.updateSettings(tx, alice, { motion: 'wild' as never })),
    ).rejects.toThrow()
  })

  it('reads corrupt stored settings leniently', async () => {
    await ctx.admin`UPDATE public.profiles SET settings = '{"sound": "loud", "vowelMarks": "on", "junk": 1}'::jsonb WHERE user_id = ${bob}`
    const s = await withUser(ctx.h.db, bob, (tx) => profiles.getSettings(tx, bob))
    expect(s).toEqual({ ...DEFAULT_SETTINGS, vowelMarks: 'on' })
  })

  it('rejects a taken username with ConflictError and keeps the transaction usable', async () => {
    await withUser(ctx.h.db, alice, (tx) => profiles.updatePublicProfile(tx, alice, { username: 'alice_1', displayName: 'Alice' }))
    await expect(
      withUser(ctx.h.db, bob, (tx) => profiles.updatePublicProfile(tx, bob, { username: 'alice_1' })),
    ).rejects.toBeInstanceOf(ConflictError)
    // Setting your own current username again is fine.
    const same = await withUser(ctx.h.db, alice, (tx) => profiles.updatePublicProfile(tx, alice, { username: 'alice_1' }))
    expect(same?.username).toBe('alice_1')
  })

  it('lists public profiles of other users (readable by design) and syncs stats', async () => {
    await withUser(ctx.h.db, alice, (tx) => profiles.syncPublicStats(tx, alice, { xpTotal: 42, streakCurrent: 3 }))
    const list = await withUser(ctx.h.db, bob, (tx) => profiles.listPublicProfiles(tx, [alice, bob]))
    expect(list.find((p) => p.userId === alice)).toMatchObject({ username: 'alice_1', xpTotal: 42, streakCurrent: 3 })
  })

  it('records consents', async () => {
    await withUser(ctx.h.db, alice, async (tx) => {
      await profiles.setConsent(tx, alice, 'analytics', true)
      await profiles.setConsent(tx, alice, 'analytics', false)
      await profiles.setConsent(tx, alice, 'marketing', true)
    })
    expect(await withUser(ctx.h.db, alice, (tx) => profiles.getConsents(tx, alice))).toEqual({
      analytics: false,
      marketing: true,
    })
  })

  describe('cross-user access (IDOR)', () => {
    it("a user-scoped transaction cannot read or change another user's private profile", async () => {
      expect(await withUser(ctx.h.db, alice, (tx) => profiles.getProfile(tx, bob))).toBeNull()
      expect(await withUser(ctx.h.db, alice, (tx) => profiles.updateProfile(tx, bob, { onboarded: true }))).toBeNull()
      expect(await withUser(ctx.h.db, alice, (tx) => profiles.updateSettings(tx, bob, { sound: false }))).toBeNull()
      expect(await withUser(ctx.h.db, alice, (tx) => profiles.updatePublicProfile(tx, bob, { displayName: 'x' }))).toBeNull()
      const bobNow = await withSystem(ctx.h.db, (tx) => profiles.getProfile(tx, bob))
      expect(bobNow?.onboarded).toBe(false)
      expect(await withSystem(ctx.h.db, (tx) => profiles.getPublicProfile(tx, bob))).toMatchObject({ displayName: null })
    })

    it("cannot set another user's consent", async () => {
      await expect(withUser(ctx.h.db, alice, (tx) => profiles.setConsent(tx, bob, 'analytics', true))).rejects.toThrow()
    })
  })
})
