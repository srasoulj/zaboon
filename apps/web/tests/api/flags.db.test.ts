/** Test seams for Wave 3: feature flags per request (x-test-flags) and per harness, every bucket raised. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_APP_CONFIG, FLAG_DEFAULTS } from '@zaboon/contracts'
import { api, finish, get, play, type StartedSession } from './flows'
import { createHarness, type Harness } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h?.close()
})

describe('feature flags in route tests', () => {
  it('are the defaults (all Wave 3 features off) unless a test turns one on', async () => {
    const alice = await h.guest()
    const home = await get(h, api.home, '/api/home', alice)
    expect(home.status).toBe(200)
    expect(home.body.flags).toEqual({ ...FLAG_DEFAULTS })
  })

  it('x-test-flags turns a feature on for one request only', async () => {
    const alice = await h.guest()
    const on = await h.call(api.home, {
      path: '/api/home',
      user: alice,
      flags: { leagues: true, quests: true },
    })
    expect(on.body.flags).toMatchObject({ leagues: true, quests: true, shop: false })
    expect((await get(h, api.home, '/api/home', alice)).body.flags.leagues).toBe(false)
    const unknown = await h.call(api.home, {
      path: '/api/home',
      user: alice,
      flags: { nope: true },
    })
    expect(unknown.status).toBe(400)
  })

  it('setFlags turns features on for every later request, and {} restores the defaults', async () => {
    const alice = await h.guest()
    try {
      await h.setFlags({ shop: true, persianKeyboard: true })
      const home = await get(h, api.home, '/api/home', alice)
      expect(home.body.flags).toMatchObject({ shop: true, persianKeyboard: true, leagues: false })
      // A header still wins for its request.
      const off = await h.call(api.home, { path: '/api/home', user: alice, flags: { shop: false } })
      expect(off.body.flags.shop).toBe(false)
    } finally {
      await h.setFlags({})
    }
    expect((await get(h, api.home, '/api/home', alice)).body.flags).toEqual({ ...FLAG_DEFAULTS })
  })

  it('MVP flows are unchanged with every Wave 3 flag on (nothing is wired to them yet)', async () => {
    const alice = await h.guest()
    const flags = {
      leagues: true,
      quests: true,
      shop: true,
      practiceHub: true,
      persianKeyboard: true,
      letterTrace: true,
    }
    const s = await h.call(api.createSession, {
      path: '/api/sessions',
      user: alice,
      flags,
      body: { courseId: 'fixture', kind: 'lesson', levelId: 'u01-s0', tz: 'UTC' },
    })
    expect(s.status).toBe(200)
    expect(s.body.challenges.map((c: { type: string }) => c.type)).toEqual([
      'select_translation',
      'translate_bank',
      'translate_type',
      'match_pairs',
    ])
    expect((await finish(h, alice, s.body as StartedSession)).xp.total).toBe(15)
    const result = await play(h, alice, { levelId: 'u01-l1' })
    expect(result.level).toMatchObject({ levelId: 'u01-l1', completed: true })
  })

  it('raises every rate-limit bucket, including the P2 shop and cron buckets', async () => {
    const [row] = await h.sql`SELECT value FROM app_config WHERE key = 'rateLimits'`
    const limits = row!.value as Record<string, { perMinute: number }>
    expect(Object.keys(limits).sort()).toEqual(Object.keys(DEFAULT_APP_CONFIG.rateLimits).sort())
    for (const limit of Object.values(limits)) expect(limit.perMinute).toBe(100_000)
  })
})
