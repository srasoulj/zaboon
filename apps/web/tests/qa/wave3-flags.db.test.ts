/**
 * QA: the engagement flag matrix at the API level. Each flag alone, and all off: a P2 route answers
 * 404 exactly while its own flag is off, and home and the session result carry only the fields of
 * the flags that are on. The engagement flags never change what a session contains.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from '../api/harness'
import { ALL_OFF, api, lesson, read, startLesson, type Flags } from '../engagement/helpers'
import { ensureProfile } from './support'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h?.close()
})

const now = '2034-07-05T12:00:00.000Z'

const ROUTES = [
  { handler: api.leaderboard, path: '/api/leaderboard', flag: 'leagues' },
  { handler: api.quests, path: '/api/quests', flag: 'quests' },
  { handler: api.shop, path: '/api/shop', flag: 'shop' },
  { handler: api.practice, path: '/api/practice', flag: 'practiceHub' },
] as const

const MATRIX: [string, Flags][] = [
  ['all off', ALL_OFF],
  ['no flags sent', {}],
  ['leagues alone', { ...ALL_OFF, leagues: true }],
  ['quests alone', { ...ALL_OFF, quests: true }],
  ['shop alone', { ...ALL_OFF, shop: true }],
  ['practiceHub alone', { ...ALL_OFF, practiceHub: true }],
]

/** The P2 fields a response has. */
const p2Fields = (body: Record<string, unknown>) =>
  ['coins', 'league', 'quests'].filter((k) => k in body)

describe('each engagement flag alone, and all off', () => {
  for (const [name, flags] of MATRIX) {
    it(`${name}: 404s, home fields and result fields follow the flags`, async () => {
      const m = await h.member()
      await ensureProfile(h, m, now)
      for (const r of ROUTES) {
        const res = await read(h, r.handler, r.path, m, { now, flags })
        if (flags[r.flag] === true) expect(res.status, r.path).toBe(200)
        else {
          expect(res.status, r.path).toBe(404)
          expect(res.body.error.code).toBe('not_found')
        }
      }
      // POST routes of the shop.
      const buy = await h.call(api.purchase, {
        path: '/api/shop/purchase',
        user: m,
        now,
        flags,
        body: { item: 'streak_freeze', purchaseId: crypto.randomUUID() },
      })
      const fill = await h.call(api.refill, {
        path: '/api/lives/refill',
        user: m,
        now,
        flags,
        body: { purchaseId: crypto.randomUUID() },
      })
      // With the shop on, both are refused on the learner's state (no coins / full hearts).
      expect([buy.status, fill.status]).toEqual(flags.shop ? [409, 409] : [404, 404])

      const expected = [
        ...(flags.shop || flags.quests ? ['coins'] : []),
        ...(flags.leagues ? ['league'] : []),
        ...(flags.quests ? ['quests'] : []),
      ]
      const result = await lesson(h, m, { now, flags })
      expect(p2Fields(result)).toEqual(expected)
      const home = await read(h, api.home, '/api/home', m, { now, flags })
      expect(p2Fields(home.body)).toEqual(expected)
      // A guest never gets league fields, whatever the flag.
      const g = await h.guest()
      expect(p2Fields(await lesson(h, g, { now, flags }))).toEqual(
        expected.filter((f) => f !== 'league'),
      )
    })
  }

  it('the rollover cron is not behind a flag, and still needs its secret', async () => {
    const res = await h.call(api.rollover, { path: '/api/cron/league-rollover', now })
    expect(res.status).toBe(401)
  })
})

describe('sessions do not depend on the engagement flags', () => {
  it('the same learner and level build the same lesson with every engagement flag on or off', async () => {
    const u = await h.guest()
    const off = await startLesson(h, u, { now, flags: ALL_OFF })
    const none = await startLesson(h, u, { now })
    const on = await startLesson(h, u, {
      now,
      flags: { leagues: true, quests: true, shop: true, practiceHub: true },
    })
    expect(on.challenges).toEqual(off.challenges)
    expect(none.challenges).toEqual(off.challenges)
    const refs = await h.sql`
      SELECT id, challenge_refs FROM public.sessions
      WHERE id IN (${off.sessionId}, ${none.sessionId}, ${on.sessionId})`
    const stored = refs.map((r) => JSON.stringify(r.challenge_refs))
    expect(new Set(stored).size).toBe(1)
  })
})
