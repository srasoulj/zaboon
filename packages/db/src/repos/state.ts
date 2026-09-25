/** Small per-user game state rows: streaks, lives (hearts) and user_items (streak freezes, …). */
import { and, eq, gte, sql } from 'drizzle-orm'
import type { LivesState, StreakState } from '@zaboon/contracts'
import type { Tx } from '../index'
import * as schema from '../schema'
import { toIso } from './shared'

// ---------------------------------------------------------------------------------------------
// Streaks (written only at commit; display state is computed by @zaboon/game-rules)
// ---------------------------------------------------------------------------------------------
export async function getStreak(tx: Tx, userId: string): Promise<StreakState | null> {
  const [row] = await tx.select().from(schema.streaks).where(eq(schema.streaks.userId, userId))
  return row
    ? { current: row.current, longest: row.longest, lastActiveDate: row.lastActiveDate, freezes: row.freezes }
    : null
}

export async function saveStreak(tx: Tx, userId: string, state: StreakState): Promise<void> {
  const values = {
    current: state.current,
    longest: state.longest,
    lastActiveDate: state.lastActiveDate,
    freezes: state.freezes,
  }
  await tx
    .insert(schema.streaks)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: schema.streaks.userId, set: { ...values, updatedAt: sql`now()` } })
}

// ---------------------------------------------------------------------------------------------
// Lives (regeneration is computed lazily by @zaboon/game-rules from count + updatedAt)
// ---------------------------------------------------------------------------------------------
export async function getLives(tx: Tx, userId: string): Promise<LivesState | null> {
  const [row] = await tx.select().from(schema.lives).where(eq(schema.lives.userId, userId))
  return row ? { policy: row.policy as LivesState['policy'], count: row.count, updatedAt: toIso(row.updatedAt) } : null
}

export async function saveLives(tx: Tx, userId: string, state: LivesState): Promise<void> {
  const values = { policy: state.policy, count: state.count, updatedAt: state.updatedAt }
  await tx
    .insert(schema.lives)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: schema.lives.userId, set: values })
}

// ---------------------------------------------------------------------------------------------
// user_items
// ---------------------------------------------------------------------------------------------
export async function getItems(tx: Tx, userId: string): Promise<Record<string, number>> {
  const rows = await tx.select().from(schema.userItems).where(eq(schema.userItems.userId, userId))
  return Object.fromEntries(rows.map((r) => [r.item, r.qty]))
}

/**
 * Adds `delta` (may be negative) to an item's quantity. Returns the new quantity, or null when a
 * negative delta would take it below zero (nothing changes then).
 */
export async function addItem(tx: Tx, userId: string, item: string, delta: number): Promise<number | null> {
  const t = schema.userItems
  if (delta < 0) {
    const [row] = await tx
      .update(t)
      .set({ qty: sql`${t.qty} + ${delta}`, updatedAt: sql`now()` })
      .where(and(eq(t.userId, userId), eq(t.item, item), gte(t.qty, -delta)))
      .returning({ qty: t.qty })
    return row?.qty ?? null
  }
  const [row] = await tx
    .insert(t)
    .values({ userId, item, qty: delta })
    .onConflictDoUpdate({ target: [t.userId, t.item], set: { qty: sql`${t.qty} + ${delta}`, updatedAt: sql`now()` } })
    .returning({ qty: t.qty })
  return row!.qty
}
