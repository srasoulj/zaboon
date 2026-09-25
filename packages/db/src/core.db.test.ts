import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import postgres from 'postgres'
import { createDb, schema, withSystem, withUser, withUserLock, type DbHandle } from './index'
import { createAuthUser, createTestDatabase, type TestDatabase } from './testing'

let tdb: TestDatabase
let h: DbHandle
let alice: string
let bob: string

beforeAll(async () => {
  tdb = await createTestDatabase()
  h = createDb(tdb.appUrl)
  alice = await createAuthUser(tdb.adminUrl)
  bob = await createAuthUser(tdb.adminUrl)
  // The auth.users trigger creates profiles; an explicit insert must stay harmless.
  for (const id of [alice, bob]) {
    await withUser(h.db, id, (tx) => tx.insert(schema.profiles).values({ userId: id }).onConflictDoNothing())
  }
})

afterAll(async () => {
  await h.close()
  await tdb.drop()
})

describe('db isolation (ADR 0009)', () => {
  it('a user-scoped transaction only sees its own rows, even without a WHERE clause', async () => {
    const rows = await withUser(h.db, alice, (tx) => tx.select().from(schema.profiles))
    expect(rows.map((r) => r.userId)).toEqual([alice])
  })

  it('a user cannot write rows for another user', async () => {
    await expect(
      withUser(h.db, alice, (tx) => tx.insert(schema.streaks).values({ userId: bob, freezes: 1 })),
    ).rejects.toThrow()
  })

  it('with no scope set, app_server sees nothing', async () => {
    const rows = await h.db.select().from(schema.profiles)
    expect(rows).toEqual([])
  })

  it('system scope sees every user', async () => {
    const rows = await withSystem(h.db, (tx) => tx.select().from(schema.profiles))
    expect(rows).toHaveLength(2)
  })

  it('anon and authenticated roles have no access at all', async () => {
    const admin = postgres(tdb.adminUrl, { max: 1, onnotice: () => {} })
    try {
      for (const role of ['anon', 'authenticated']) {
        await expect(
          admin.begin(async (tx) => {
            await tx.unsafe(`SET LOCAL ROLE ${role}`)
            await tx.unsafe('SELECT * FROM public.profiles')
          }),
        ).rejects.toThrow(/permission denied/)
      }
    } finally {
      await admin.end()
    }
  })

  it('withUserLock serializes concurrent writers for one user', async () => {
    await withUserLock(h.db, alice, (tx) => tx.insert(schema.streaks).values({ userId: alice, freezes: 1 }))
    const bump = () =>
      withUserLock(h.db, alice, async (tx) => {
        const [row] = await tx.select().from(schema.streaks).where(eq(schema.streaks.userId, alice))
        await new Promise((r) => setTimeout(r, 20))
        await tx.update(schema.streaks).set({ current: row!.current + 1 }).where(eq(schema.streaks.userId, alice))
      })
    await Promise.all(Array.from({ length: 5 }, bump))
    const [row] = await withUser(h.db, alice, (tx) => tx.select().from(schema.streaks))
    expect(row!.current).toBe(5)
  })
})
