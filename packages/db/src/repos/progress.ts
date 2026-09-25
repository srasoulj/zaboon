/** xp_ledger (append-only) and daily_activity (source of truth for streaks). */
import { and, asc, eq, gte, lte, sql, sum } from 'drizzle-orm'
import type { Tx } from '../index'
import * as schema from '../schema'
import { NotFoundError, isUuid, toIso } from './shared'

export interface XpEntry {
  id: number
  amount: number
  reason: string
  sessionId: string | null
  occurredAt: string
  localDate: string
}

export interface NewXpEntry {
  amount: number
  reason: string
  sessionId?: string | null
  occurredAt: string
  localDate: string
}

/**
 * Appends an XP entry. Entries tied to a session are idempotent on (session_id, reason): a replayed
 * commit returns `{ inserted: false }` and adds nothing. Throws NotFoundError if `sessionId` is not
 * one of the caller's sessions.
 */
export async function appendXp(tx: Tx, userId: string, entry: NewXpEntry): Promise<{ inserted: boolean }> {
  const sessionId = entry.sessionId ?? null
  if (sessionId !== null) {
    if (!isUuid(sessionId)) throw new NotFoundError('session')
    const [owned] = await tx
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId)))
    if (!owned) throw new NotFoundError('session')
  }
  const rows = await tx
    .insert(schema.xpLedger)
    .values({
      userId,
      amount: entry.amount,
      reason: entry.reason,
      sessionId,
      occurredAt: entry.occurredAt,
      localDate: entry.localDate,
    })
    .onConflictDoNothing()
    .returning({ id: schema.xpLedger.id })
  return { inserted: rows.length === 1 }
}

export async function getXpTotal(tx: Tx, userId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sum(schema.xpLedger.amount).mapWith(Number) })
    .from(schema.xpLedger)
    .where(eq(schema.xpLedger.userId, userId))
  return row?.total ?? 0
}

/** XP earned at or after `since` (anti-cheat: XP per hour). */
export async function getXpSince(tx: Tx, userId: string, since: string): Promise<number> {
  const [row] = await tx
    .select({ total: sum(schema.xpLedger.amount).mapWith(Number) })
    .from(schema.xpLedger)
    .where(and(eq(schema.xpLedger.userId, userId), gte(schema.xpLedger.occurredAt, since)))
  return row?.total ?? 0
}

export async function listXpLedger(tx: Tx, userId: string, opts: { sessionId?: string } = {}): Promise<XpEntry[]> {
  if (opts.sessionId !== undefined && !isUuid(opts.sessionId)) return []
  const rows = await tx
    .select()
    .from(schema.xpLedger)
    .where(
      and(
        eq(schema.xpLedger.userId, userId),
        opts.sessionId !== undefined ? eq(schema.xpLedger.sessionId, opts.sessionId) : undefined,
      ),
    )
    .orderBy(asc(schema.xpLedger.id))
  return rows.map((r) => ({
    id: r.id,
    amount: r.amount,
    reason: r.reason,
    sessionId: r.sessionId,
    occurredAt: toIso(r.occurredAt),
    localDate: r.localDate,
  }))
}

// ---------------------------------------------------------------------------------------------
// daily_activity
// ---------------------------------------------------------------------------------------------
export interface DailyActivity {
  localDate: string
  xp: number
  sessions: number
  goalMet: boolean
  freezeUsed: boolean
}

function toDaily(r: typeof schema.dailyActivity.$inferSelect): DailyActivity {
  return { localDate: r.localDate, xp: r.xp, sessions: r.sessions, goalMet: r.goalMet, freezeUsed: r.freezeUsed }
}

export async function getDailyActivity(tx: Tx, userId: string, localDate: string): Promise<DailyActivity | null> {
  const [row] = await tx
    .select()
    .from(schema.dailyActivity)
    .where(and(eq(schema.dailyActivity.userId, userId), eq(schema.dailyActivity.localDate, localDate)))
  return row ? toDaily(row) : null
}

/** Days in [from, to] (inclusive, either bound optional), oldest first. */
export async function listDailyActivity(
  tx: Tx,
  userId: string,
  range: { from?: string; to?: string } = {},
): Promise<DailyActivity[]> {
  const rows = await tx
    .select()
    .from(schema.dailyActivity)
    .where(
      and(
        eq(schema.dailyActivity.userId, userId),
        range.from ? gte(schema.dailyActivity.localDate, range.from) : undefined,
        range.to ? lte(schema.dailyActivity.localDate, range.to) : undefined,
      ),
    )
    .orderBy(asc(schema.dailyActivity.localDate))
  return rows.map(toDaily)
}

/**
 * Adds a completed session's XP to its local day. `goalMet` is sticky (once met, stays met).
 * Returns the day after the update.
 */
export async function addDailyActivity(
  tx: Tx,
  userId: string,
  input: { localDate: string; xp: number; sessions?: number; goalMet?: boolean },
): Promise<DailyActivity> {
  const t = schema.dailyActivity
  const [row] = await tx
    .insert(t)
    .values({
      userId,
      localDate: input.localDate,
      xp: input.xp,
      sessions: input.sessions ?? 1,
      goalMet: input.goalMet ?? false,
    })
    .onConflictDoUpdate({
      target: [t.userId, t.localDate],
      set: {
        xp: sql`${t.xp} + excluded.xp`,
        sessions: sql`${t.sessions} + excluded.sessions`,
        goalMet: sql`${t.goalMet} OR excluded.goal_met`,
      },
    })
    .returning()
  return toDaily(row!)
}

/** Records that streak freezes covered these (missed) days. */
export async function markFreezeUsed(tx: Tx, userId: string, localDates: readonly string[]): Promise<void> {
  // De-duplicated: one upsert touching the same row twice would fail (21000) and abort the commit.
  const unique = [...new Set(localDates)]
  if (unique.length === 0) return
  const t = schema.dailyActivity
  await tx
    .insert(t)
    .values(unique.map((localDate) => ({ userId, localDate, freezeUsed: true })))
    .onConflictDoUpdate({ target: [t.userId, t.localDate], set: { freezeUsed: true } })
}
