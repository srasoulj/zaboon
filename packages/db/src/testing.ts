/**
 * Test helpers: each test file gets its own database cloned from `<db>_template` (built by
 * scripts/migrate.ts), so DB tests run in parallel without sharing state.
 */
import { randomBytes } from 'node:crypto'
import postgres from 'postgres'
import { createDb, type DbHandle } from './index'

const HOST = '127.0.0.1'
const PORT = Number(process.env.ZABOON_DB_PORT ?? 54322)
const BASE = process.env.ZABOON_DB_NAME ?? 'zaboon'

export interface TestDatabase {
  name: string
  /** app_server connection string (what route handlers use). */
  appUrl: string
  /** Superuser connection string (fixtures, auth.users inserts, assertions). */
  adminUrl: string
  drop(): Promise<void>
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `${BASE}_t_${randomBytes(5).toString('hex')}`
  const admin = postgres({
    host: HOST,
    port: PORT,
    user: 'supabase_admin',
    database: 'postgres',
    max: 1,
    onnotice: () => {},
  })
  try {
    await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE "${BASE}_template"`)
  } finally {
    await admin.end()
  }
  return {
    name,
    appUrl: `postgres://app_server:app_server_local@${HOST}:${PORT}/${name}`, // pragma: allowlist secret
    adminUrl: `postgres://supabase_admin@${HOST}:${PORT}/${name}`,
    async drop() {
      const a = postgres({
        host: HOST,
        port: PORT,
        user: 'supabase_admin',
        database: 'postgres',
        max: 1,
        onnotice: () => {},
      })
      try {
        await a.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      } finally {
        await a.end()
      }
    },
  }
}

/** Inserts an auth.users row (as Supabase Auth would) and returns its id. */
export async function createAuthUser(
  adminUrl: string,
  opts: { anonymous?: boolean; email?: string } = {},
): Promise<string> {
  const sql = postgres(adminUrl, { max: 1, onnotice: () => {} })
  try {
    const rows =
      await sql`INSERT INTO auth.users (is_anonymous, email) VALUES (${opts.anonymous ?? true}, ${opts.email ?? null}) RETURNING id`
    return rows[0]!.id as string
  } finally {
    await sql.end()
  }
}

/** Everything a repository test needs: a private database, an app_server pool and fixtures. */
export interface TestContext {
  tdb: TestDatabase
  /** app_server handle (what route handlers use). */
  h: DbHandle
  /** Superuser connection for fixtures and assertions that must bypass RLS. */
  admin: postgres.Sql
  /** Creates an auth user (the trigger creates its profile rows) and returns its id. */
  newUser(opts?: { anonymous?: boolean; email?: string }): Promise<string>
  close(): Promise<void>
}

export async function createTestContext(): Promise<TestContext> {
  const tdb = await createTestDatabase()
  const h = createDb(tdb.appUrl)
  const admin = postgres(tdb.adminUrl, { max: 2, onnotice: () => {} })
  return {
    tdb,
    h,
    admin,
    async newUser(opts = {}) {
      const rows =
        await admin`INSERT INTO auth.users (is_anonymous, email) VALUES (${opts.anonymous ?? true}, ${opts.email ?? null}) RETURNING id`
      return rows[0]!.id as string
    },
    async close() {
      await h.close()
      await admin.end()
      await tdb.drop()
    },
  }
}
