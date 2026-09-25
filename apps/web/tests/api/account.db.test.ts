/** POST /api/account/merge, GET /api/account/export and DELETE /api/account. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, get, play } from './flows'
import { createHarness, type Harness, type TestUser } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h?.close()
})

const day = (d: number) => `2031-05-0${d}T12:00:00Z`
const merge = (member: TestUser, guestToken: string) =>
  h.call(api.merge, { path: '/api/account/merge', user: member, body: { guestToken } })

/** Every public table that holds per-user rows. */
async function userTables(): Promise<string[]> {
  const rows = await h.sql<{ table_name: string }[]>`
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'user_id' ORDER BY 1`
  return rows.map((r) => r.table_name)
}

async function rowCounts(userId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const t of await userTables()) {
    const [r] = await h.sql.unsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public."${t}" WHERE user_id = $1`,
      [userId],
    )
    out[t] = r!.n
  }
  return out
}

describe('POST /api/account/merge', () => {
  it('sums XP, keeps the stronger FSRS rows, recomputes the streak and deletes the guest', async () => {
    const guest = await h.guest()
    await play(h, guest, { now: day(1) })
    await play(h, guest, { now: day(2) }) // lx_salam reviewed twice → stronger card
    const member = await h.member()
    await play(h, member, { now: day(3) })
    const bystander = await h.guest()
    await play(h, bystander, { now: day(3) })
    const bystanderBefore = await rowCounts(bystander.id)

    const res = await merge(member, guest.token)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body).toMatchObject({ merged: true, home: { user: { id: member.id }, xpTotal: 45 } })

    const [card] = await h.sql`
      SELECT reps FROM lexeme_memory WHERE user_id = ${member.id} AND lexeme_id = 'lx_salam'`
    expect(card!.reps).toBe(2)
    const [streak] = await h.sql`SELECT current, longest FROM streaks WHERE user_id = ${member.id}`
    expect(streak).toMatchObject({ current: 3, longest: 3 })
    const [pub] =
      await h.sql`SELECT xp_total, streak_current FROM public_profiles WHERE user_id = ${member.id}`
    expect(pub).toMatchObject({ xp_total: 45, streak_current: 3 })
    const sessions =
      await h.sql`SELECT count(*)::int AS n FROM sessions WHERE user_id = ${member.id}`
    expect(sessions[0]!.n).toBe(3)

    // The guest is gone entirely, and nobody else was touched.
    expect(Object.values(await rowCounts(guest.id)).every((n) => n === 0)).toBe(true)
    expect(await h.sql`SELECT id FROM auth.users WHERE id = ${guest.id}`).toHaveLength(0)
    expect(await rowCounts(bystander.id)).toEqual(bystanderBefore)

    // Replaying the merge is harmless.
    const replay = await merge(member, guest.token)
    expect(replay.status).toBe(200)
    expect(replay.body).toMatchObject({ merged: false, home: { xpTotal: 45 } })
  })

  it('is for linked members only, and only merges guests', async () => {
    const guest = await h.guest()
    const other = await h.guest()
    const asGuest = await merge(guest, other.token)
    expect(asGuest.status).toBe(403)

    const member = await h.member()
    const otherMember = await h.member()
    expect((await merge(member, otherMember.token)).status).toBe(403)
    const bad = await merge(member, 'x'.repeat(40))
    expect(bad.status).toBe(401)
    expect((await merge(member, 'short')).status).toBe(400)
    // Nothing moved.
    expect((await rowCounts(other.id)).profiles).toBe(1)
  })

  it('works for a guest who linked an email and a guest merged into an account made later', async () => {
    const guest = await h.guest()
    await play(h, guest)
    const linked = await h.link(await h.guest(), `linked-${Date.now()}@zaboon.test`)
    expect(linked.isAnonymous).toBe(false)
    const res = await merge(linked, guest.token)
    expect(res.body).toMatchObject({
      merged: true,
      home: { xpTotal: 15, user: { isAnonymous: false } },
    })
  })
})

describe('GET /api/account/export', () => {
  it("contains every table's rows for the caller and nobody else's", async () => {
    const alice = await h.guest()
    const bob = await h.guest()
    await play(h, alice)
    await play(h, bob)
    await h.call(api.createReport, {
      path: '/api/reports',
      user: alice,
      body: { itemRef: 'lexeme:lx_salam', kind: 'audio_problem' },
    })
    const res = await get(h, api.exportAccount, '/api/account/export', alice)
    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({ id: alice.id, isAnonymous: true })
    const tables = res.body.tables as Record<string, { user_id: string }[]>
    const counts = await rowCounts(alice.id)
    expect(Object.keys(tables).sort()).toEqual(Object.keys(counts).sort())
    for (const [t, rows] of Object.entries(tables)) {
      expect(rows.length, t).toBe(counts[t])
      expect(
        rows.every((r) => r.user_id === alice.id),
        t,
      ).toBe(true)
    }
    for (const t of [
      'profiles',
      'sessions',
      'xp_ledger',
      'lexeme_memory',
      'reports',
      'session_answers',
    ])
      expect(tables[t]!.length, t).toBeGreaterThan(0)
  })
})

describe('DELETE /api/account', () => {
  it('leaves no rows behind, deletes the auth user and is safe to replay', async () => {
    const alice = await h.guest()
    const bob = await h.guest()
    await play(h, alice)
    await play(h, bob)
    const bobBefore = await rowCounts(bob.id)
    const del = () =>
      h.call(api.deleteAccount, { method: 'DELETE', path: '/api/account', user: alice })
    const res = await del()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ deleted: true })
    expect(Object.values(await rowCounts(alice.id)).every((n) => n === 0)).toBe(true)
    expect(await h.sql`SELECT id FROM auth.users WHERE id = ${alice.id}`).toHaveLength(0)
    expect(await rowCounts(bob.id)).toEqual(bobBefore)
    expect((await del()).status).toBe(200)
  })
})
