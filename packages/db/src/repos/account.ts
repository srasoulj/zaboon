/** GDPR export and delete (§12 Privacy, GET /api/account/export, DELETE /api/account). */
import { eq, sql } from 'drizzle-orm'
import type { Tx } from '../index'
import * as schema from '../schema'
import { assertUserId } from './shared'

/** Tables whose rows belong to a user: every public table with a user_id column (discovered, so new tables are exported automatically). */
async function userTables(tx: Tx): Promise<string[]> {
  const rows = await tx.execute<{ table_name: string }>(sql`
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'user_id'
    ORDER BY c.table_name`)
  return rows.map((r) => r.table_name)
}

/**
 * Every row we hold about the user, as `{ tableName: rows[] }` (column names as in the database,
 * timestamps in ISO 8601). Run inside `withUser(db, userId, …)`.
 */
export async function exportAccount(tx: Tx, userId: string): Promise<Record<string, unknown[]>> {
  assertUserId(userId)
  const out: Record<string, unknown[]> = {}
  for (const table of await userTables(tx)) {
    const rows = await tx.execute<{ rows: unknown[] }>(sql`
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) AS rows
      FROM ${sql.identifier('public')}.${sql.identifier(table)} t
      WHERE t.user_id = ${userId}`)
    out[table] = rows[0]?.rows ?? []
  }
  return out
}

/**
 * Deletes the user's profile and, through ON DELETE CASCADE, every row that references it.
 * The auth.users row is deleted by the caller through the Auth Admin API (which would also cascade
 * here). Returns false if there was no profile. Run inside `withUserLock(db, userId, …)`.
 */
export async function deleteAccount(tx: Tx, userId: string): Promise<boolean> {
  assertUserId(userId)
  const rows = await tx
    .delete(schema.profiles)
    .where(eq(schema.profiles.userId, userId))
    .returning({ userId: schema.profiles.userId })
  return rows.length === 1
}
