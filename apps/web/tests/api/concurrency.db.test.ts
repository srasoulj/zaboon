/**
 * More parallel requests for ONE user than the connection pool has connections (10): all but one
 * wait on the user's advisory lock while holding a pooled connection, so the lock holder must never
 * need a second connection (e.g. an uncached content-version lookup through the pool).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetContentCache } from '../../lib/server/content'
import { api, finishRaw, get, play, start } from './flows'
import { createHarness, type Harness } from './harness'

const PARALLEL = 15 // > pool max (10)

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h?.close()
})

/** Fails fast (instead of hanging the suite) if the requests deadlock. */
function withinSeconds<T>(seconds: number, work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`deadlock: not done after ${seconds}s`)), seconds * 1000),
    ),
  ])
}

describe('one user, more parallel requests than pooled connections', () => {
  it('GET /api/path and /api/home with a cold content-version cache', async () => {
    const alice = await h.guest()
    await play(h, alice)
    resetContentCache()
    const results = await withinSeconds(
      20,
      Promise.all([
        ...Array.from({ length: PARALLEL }, () => get(h, api.path, '/api/path', alice)),
        ...Array.from({ length: PARALLEL }, () => get(h, api.home, '/api/home', alice)),
      ]),
    )
    expect(results.every((r) => r.status === 200)).toBe(true)
  })

  it('POST /complete for one session', async () => {
    const alice = await h.guest()
    const s = await start(h, alice)
    resetContentCache()
    const results = await withinSeconds(
      20,
      Promise.all(Array.from({ length: PARALLEL }, () => finishRaw(h, alice, s))),
    )
    expect(results.every((r) => r.status === 200)).toBe(true)
    for (const r of results) expect(r.body).toEqual(results[0]!.body)
    const [xp] =
      await h.sql`SELECT sum(amount)::int AS n FROM xp_ledger WHERE user_id = ${alice.id}`
    expect(xp!.n).toBe(15)
  })

  it('POST /complete for many sessions', async () => {
    const alice = await h.guest()
    const sessions = await Promise.all(
      Array.from({ length: PARALLEL }, () => start(h, alice, { kind: 'practice' })),
    )
    resetContentCache()
    const results = await withinSeconds(
      20,
      Promise.all(sessions.map((s) => finishRaw(h, alice, s))),
    )
    expect(results.map((r) => r.status)).toEqual(sessions.map(() => 200))
    const [n] = await h.sql`
      SELECT count(*)::int AS n FROM sessions WHERE user_id = ${alice.id} AND status = 'completed'`
    expect(n!.n).toBe(PARALLEL)
  })
})
