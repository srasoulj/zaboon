import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ScopeError, repos, withSystem, withUser, withUserLock } from '../index'
import { createTestContext, type TestContext } from '../testing'
import { seedLearner } from './seed.fixture'

const { account } = repos

let ctx: TestContext
let alice: string
let bob: string

beforeAll(async () => {
  ctx = await createTestContext()
  alice = await ctx.newUser()
  bob = await ctx.newUser()
  await seedLearner(ctx, alice)
  await seedLearner(ctx, bob)
})
afterAll(() => ctx.close())

async function userTables(): Promise<string[]> {
  const rows = await ctx.admin<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'user_id' ORDER BY table_name`
  return rows.map((r) => r.table_name)
}

describe('account export', () => {
  it("contains every user-owned table and only the caller's rows", async () => {
    const data = await withUser(ctx.h.db, alice, (tx) => account.exportAccount(tx, alice))
    expect(Object.keys(data).sort()).toEqual(await userTables())
    let total = 0
    for (const [table, rows] of Object.entries(data)) {
      for (const row of rows as Record<string, unknown>[]) {
        expect({ table, userId: row.user_id }).toEqual({ table, userId: alice })
        total++
      }
    }
    // seedLearner writes to these tables; the export must include them.
    for (const t of [
      'profiles',
      'public_profiles',
      'sessions',
      'session_events',
      'session_answers',
      'xp_ledger',
      'daily_activity',
      'streaks',
      'lives',
      'enrollments',
      'level_progress',
      'lexeme_memory',
      'letter_memory',
      'mistakes',
      'reports',
      'user_items',
      'consents',
    ]) {
      expect({ t, n: data[t]!.length > 0 }).toEqual({ t, n: true })
    }
    expect(total).toBeGreaterThan(17)
    expect(JSON.stringify(data)).not.toContain(bob)
  })

  it("cannot export another user's rows", async () => {
    await expect(
      withUser(ctx.h.db, alice, (tx) => account.exportAccount(tx, bob)),
    ).rejects.toBeInstanceOf(ScopeError)
  })
})

describe('account delete', () => {
  it("cannot delete another user's account", async () => {
    expect(await withUserLock(ctx.h.db, alice, (tx) => account.deleteAccount(tx, bob))).toBe(false)
    const rows =
      await ctx.admin`SELECT count(*)::int AS n FROM public.profiles WHERE user_id = ${bob}`
    expect(rows[0]!.n).toBe(1)
  })

  it('deletes the profile and every row that belongs to the user', async () => {
    expect(await withUserLock(ctx.h.db, alice, (tx) => account.deleteAccount(tx, alice))).toBe(true)
    for (const table of await userTables()) {
      const rows = await ctx.admin.unsafe(
        `SELECT count(*)::int AS n FROM public."${table}" WHERE user_id = $1`,
        [alice],
      )
      expect({ table, n: rows[0]!.n }).toEqual({ table, n: 0 })
    }
    // bob is untouched
    const bobData = await withSystem(ctx.h.db, (tx) => account.exportAccount(tx, bob))
    expect(bobData.sessions!.length).toBeGreaterThan(0)
    expect(await withUserLock(ctx.h.db, alice, (tx) => account.deleteAccount(tx, alice))).toBe(
      false,
    )
  })
})
