/**
 * Shared helpers for repositories.
 *
 * Every user-scoped repository function takes the transaction (from `withUser` / `withUserLock`)
 * AND the caller's `userId`, and filters by it explicitly; RLS is the second line of defense.
 * Cross-user functions (admin, merge) require system scope (`withSystem`) and check it at runtime.
 */
import { sql } from 'drizzle-orm'
import type { Db, Tx } from '../index'

/** Anything that can run a query: the pool (outside a transaction) or a transaction. */
export type Queryable = Db | Tx

/** The resource does not exist or is not the caller's (the two are deliberately indistinguishable). */
export class NotFoundError extends Error {
  override readonly name = 'NotFoundError'
  constructor(what: string) {
    super(`${what} not found`)
  }
}

/** A uniqueness or state conflict the caller should surface as HTTP 409. */
export class ConflictError extends Error {
  override readonly name = 'ConflictError'
}

/** A system-scope function was called outside `withSystem`. */
export class ScopeError extends Error {
  override readonly name = 'ScopeError'
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

export function assertUserId(userId: string): void {
  if (!isUuid(userId)) throw new Error('invalid user id')
}

/** Throws unless the transaction runs in system scope (`withSystem`). */
export async function assertSystemScope(tx: Tx): Promise<void> {
  const rows = await tx.execute<{ scope: string | null }>(
    sql`SELECT current_setting('app.scope', true) AS scope`,
  )
  if (rows[0]?.scope !== 'system')
    throw new ScopeError('this repository function requires withSystem()')
}

/**
 * Postgres text timestamps (`2026-09-25 10:00:00.123+00`) → ISO 8601 UTC (`2026-09-25T10:00:00.123Z`),
 * the format the contracts' IsoDateTime expects.
 */
export function toIso(ts: string): string {
  let s = ts.includes('T') ? ts : ts.replace(' ', 'T')
  if (/[+-]\d{2}$/.test(s)) s += ':00'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) throw new Error(`unparseable timestamp: ${ts}`)
  return d.toISOString()
}

export function toIsoOrNull(ts: string | null | undefined): string | null {
  return ts == null ? null : toIso(ts)
}
