/**
 * @zaboon/db: typed Postgres access for route handlers (ADR 0002 + ADR 0009).
 *
 * - Connects as `app_server` (never a superuser, never BYPASSRLS) through the Supavisor
 *   transaction pooler in production, so prepared statements are disabled.
 * - Every user-scoped transaction sets `app.user_id`; RLS policies then hide other users' rows even
 *   if a query forgets `WHERE user_id = …` (defense in depth). Cross-user code paths (cron, admin,
 *   merge) opt in explicitly with `withSystem`.
 * - Writes that change game state run under a per-user advisory lock (`withUserLock`).
 *
 * Owner of repositories/extensions: ws-db. The helpers below are the contract.
 */
import { sql } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export { schema }
export type Db = PostgresJsDatabase<typeof schema>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

export interface DbHandle {
  db: Db
  close(): Promise<void>
}

export function createDb(url: string, opts: { max?: number } = {}): DbHandle {
  const client = postgres(url, { prepare: false, max: opts.max ?? 5, onnotice: () => {} })
  return { db: drizzle(client, { schema }), close: () => client.end() }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function assertUuid(userId: string): void {
  if (!UUID_RE.test(userId)) throw new Error('invalid user id')
}

/** Read-only (or non-conflicting) work scoped to one user. RLS limits every table to their rows. */
export async function withUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  assertUuid(userId)
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`)
    return fn(tx)
  })
}

/** Game-state writes for one user: RLS scope + a transaction-level advisory lock on the user. */
export async function withUserLock<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  assertUuid(userId)
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`)
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`)
    return fn(tx)
  })
}

/** Cross-user work (cron jobs, admin, account merge). Use sparingly; callers must authorize first. */
export async function withSystem<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.scope', 'system', true)`)
    return fn(tx)
  })
}
