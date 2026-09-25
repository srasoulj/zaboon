/**
 * Test helpers: each test file gets its own database cloned from `<db>_template` (built by
 * scripts/migrate.ts), so DB tests run in parallel without sharing state.
 */
import { randomBytes } from 'node:crypto'
import postgres from 'postgres'

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
  const admin = postgres({ host: HOST, port: PORT, user: 'supabase_admin', database: 'postgres', max: 1, onnotice: () => {} })
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
      const a = postgres({ host: HOST, port: PORT, user: 'supabase_admin', database: 'postgres', max: 1, onnotice: () => {} })
      try {
        await a.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      } finally {
        await a.end()
      }
    },
  }
}

/** Inserts an auth.users row (as Supabase Auth would) and returns its id. */
export async function createAuthUser(adminUrl: string, opts: { anonymous?: boolean; email?: string } = {}): Promise<string> {
  const sql = postgres(adminUrl, { max: 1, onnotice: () => {} })
  try {
    const rows = await sql`INSERT INTO auth.users (is_anonymous, email) VALUES (${opts.anonymous ?? true}, ${opts.email ?? null}) RETURNING id`
    return rows[0]!.id as string
  } finally {
    await sql.end()
  }
}
