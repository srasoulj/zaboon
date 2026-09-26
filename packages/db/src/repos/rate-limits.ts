/**
 * Token-bucket rate limiting in Postgres (§7, §9). A bucket holds up to `perMinute` tokens and
 * refills continuously at perMinute/60 tokens per second. One atomic upsert per request, so
 * concurrent requests on the same key never over-spend (the row lock serializes them).
 *
 * Works in any scope (rate_limits is not user-owned); pass the pool to run it in its own
 * transaction, or a transaction to include it in one.
 */
import { sql } from 'drizzle-orm'
import type { Queryable } from './shared'

export interface RateLimitResult {
  allowed: boolean
  /** Whole tokens left after this request. */
  remaining: number
  /** When denied: milliseconds until enough tokens have refilled; 0 when allowed. */
  retryAfterMs: number
}

export async function consumeToken(
  db: Queryable,
  key: string,
  perMinute: number,
  opts: { now?: string; cost?: number } = {},
): Promise<RateLimitResult> {
  if (!Number.isFinite(perMinute) || perMinute <= 0) throw new Error('perMinute must be positive')
  const cost = opts.cost ?? 1
  if (!(cost > 0)) throw new Error('cost must be positive')
  const cap = perMinute
  const now = opts.now ?? new Date().toISOString()
  if (cost > cap) return { allowed: false, remaining: 0, retryAfterMs: Number.POSITIVE_INFINITY }

  // Tokens available now = min(cap, stored + elapsed seconds × cap / 60).
  const refilled = sql`least(${cap}::float8, r.tokens + greatest(0, extract(epoch FROM (${now}::timestamptz - r.updated_at))) * ${cap}::float8 / 60)`
  const rows = await db.execute<{ tokens: number }>(sql`
    INSERT INTO public.rate_limits AS r (key, tokens, updated_at)
    VALUES (${key}, ${cap}::float8 - ${cost}::float8, ${now}::timestamptz)
    ON CONFLICT (key) DO UPDATE
      SET tokens = ${refilled} - ${cost}::float8,
          updated_at = greatest(r.updated_at, ${now}::timestamptz)
      WHERE ${refilled} >= ${cost}::float8
    RETURNING tokens`)
  const allowedRow = rows[0]
  if (allowedRow)
    return { allowed: true, remaining: Math.floor(Number(allowedRow.tokens)), retryAfterMs: 0 }

  const [state] = await db.execute<{ tokens: number }>(sql`
    SELECT ${refilled} AS tokens FROM public.rate_limits r WHERE r.key = ${key}`)
  const available = Number(state?.tokens ?? 0)
  const retryAfterMs = Math.max(1, Math.ceil(((cost - available) * 60_000) / cap))
  return { allowed: false, remaining: Math.floor(available), retryAfterMs }
}
