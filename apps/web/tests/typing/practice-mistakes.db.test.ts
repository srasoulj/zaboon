/**
 * The practice hub's `mistakes` mode through the real server (flags.practiceHub): a drill of one
 * open mistake is topped up to the normal practice length, mistake first, so it never earns a full
 * session's rewards for one or two challenges.
 */
import { DEFAULT_APP_CONFIG } from '@zaboon/contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, play, type StartedSession } from '../api/flows'
import { createHarness, type Harness } from '../api/harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h?.close()
})

describe('practice mode "mistakes"', () => {
  it('one open mistake: a full-length session that starts with it', async () => {
    const alice = await h.guest()
    await play(h, alice, { wrong: [0] }) // u01-s0 #0 is s_u01_0001: one open mistake
    const res = await h.call(api.createSession, {
      path: '/api/sessions',
      user: alice,
      flags: { practiceHub: true },
      body: { courseId: 'fixture', kind: 'practice', mode: 'mistakes', tz: 'UTC' },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const s = res.body as StartedSession
    expect(s.challenges).toHaveLength(DEFAULT_APP_CONFIG.session.lengths.practice!)
    expect(s.challenges[0]!.ref.items).toEqual(['s_u01_0001'])
    expect(new Set(s.challenges.map((c) => c.ref.items[0])).size).toBeGreaterThan(1)
  })
})
