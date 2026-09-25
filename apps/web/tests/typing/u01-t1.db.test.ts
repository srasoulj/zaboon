/**
 * The fixture's Wave 3 level u01-t1 (typed Persian + letter tracing), owned by ws-typing from
 * Wave 3. Until the P2 builders land, creating its session answers 400 `validation` ("not
 * available yet") and stores nothing; ws-typing turns the second test into "builds the four
 * pinned challenges" when it implements them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, get, play, startRaw } from '../api/flows'
import { createHarness, type Harness } from '../api/harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h?.close()
})

type Level = { id: string; state: string }
const levels = async (user: Parameters<typeof get>[3]): Promise<Level[]> => {
  const res = await get(h, api.path, '/api/path?courseId=fixture', user)
  expect(res.status).toBe(200)
  return (res.body.sections as { units: { levels: Level[] }[] }[]).flatMap((s) =>
    s.units.flatMap((u) => u.levels),
  )
}

describe('fixture level u01-t1', () => {
  it('is the last level of the path, locked until the unit review is done', async () => {
    const alice = await h.guest()
    await play(h, alice) // u01-s0
    const path = await levels(alice)
    expect(path.map((l) => l.id)).toEqual([
      'u01-s0',
      'u01-l1',
      'u01-l2',
      'u01-p1',
      'u01-r1',
      'u01-t1',
    ])
    expect(path.at(-1)).toMatchObject({ id: 'u01-t1', state: 'locked' })
    expect((await startRaw(h, alice, { levelId: 'u01-t1' })).status).toBe(403)
  })

  it('becomes current after the MVP levels; its session is not available yet', async () => {
    const alice = await h.guest()
    await play(h, alice) // u01-s0
    await play(h, alice, { levelId: 'u01-l1' })
    await play(h, alice, { levelId: 'u01-l2' })
    await play(h, alice, { kind: 'practice', levelId: 'u01-p1' })
    await play(h, alice, { kind: 'unit_review', levelId: 'u01-r1' })
    expect((await levels(alice)).at(-1)).toMatchObject({ id: 'u01-t1', state: 'current' })

    const res = await h.call(api.createSession, {
      path: '/api/sessions',
      user: alice,
      flags: { persianKeyboard: true, letterTrace: true },
      body: { courseId: 'fixture', kind: 'lesson', levelId: 'u01-t1', tz: 'UTC' },
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatchObject({ code: 'validation' })
    expect(res.body.error.message).toMatch(/not available yet/)
    const stored =
      await h.sql`SELECT count(*)::int AS n FROM sessions WHERE user_id = ${alice.id} AND level_id = 'u01-t1'`
    expect(stored[0]!.n).toBe(0)
  })
})
