/**
 * Coins (P2): `wallet` holds the balance and `coin_ledger` every change to it (append-only). Every
 * function here changes both in the caller's transaction, so the balance always equals the ledger
 * sum. Grants are idempotent by (user_id, reason, ref); a shop purchase is one debit row with
 * reason = the item and ref = the client's purchaseId (unique per user).
 *
 * User-scoped (`withUserLock`) except that the league rollover grants coins in system scope.
 */
import { and, eq, inArray, sql, sum } from 'drizzle-orm'
import type { ShopItemId } from '@zaboon/contracts'
import type { Tx } from '../index'
import * as schema from '../schema'
import { ConflictError } from './shared'

/** Ledger reasons that are shop purchases (the item id); coin_ledger_purchase_ref_uniq covers them. */
export const PURCHASE_REASONS: readonly ShopItemId[] = ['streak_freeze', 'heart_refill']

export interface CoinCredit {
  reason: string
  ref: string
  amount: number
}

export async function getCoins(tx: Tx, userId: string): Promise<number> {
  const [row] = await tx
    .select({ coins: schema.wallet.coins })
    .from(schema.wallet)
    .where(eq(schema.wallet.userId, userId))
  return row?.coins ?? 0
}

/** The sum of the user's ledger (equals `getCoins` by construction; tests check the invariant). */
export async function getLedgerSum(tx: Tx, userId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sum(schema.coinLedger.amount).mapWith(Number) })
    .from(schema.coinLedger)
    .where(eq(schema.coinLedger.userId, userId))
  return row?.total ?? 0
}

/** The (reason, ref) keys already in the ledger among `refs` (for game-rules `applyCoinGrants`). */
export async function listLedgerKeys(
  tx: Tx,
  userId: string,
  refs: readonly string[],
): Promise<{ reason: string; ref: string }[]> {
  if (refs.length === 0) return []
  const rows = await tx
    .select({ reason: schema.coinLedger.reason, ref: schema.coinLedger.ref })
    .from(schema.coinLedger)
    .where(and(eq(schema.coinLedger.userId, userId), inArray(schema.coinLedger.ref, [...refs])))
  return rows.flatMap((r) => (r.ref === null ? [] : [{ reason: r.reason, ref: r.ref }]))
}

/**
 * Credits the grants that are not in the ledger yet (ON CONFLICT DO NOTHING on (user, reason,
 * ref)) and adds exactly what was inserted to the wallet. Returns the credited grants and the
 * balance after them. Safe to replay.
 */
export async function creditCoins(
  tx: Tx,
  userId: string,
  grants: readonly CoinCredit[],
  at: string,
): Promise<{ credited: CoinCredit[]; coins: number }> {
  const credited: CoinCredit[] = []
  for (const g of grants) {
    if (!Number.isInteger(g.amount) || g.amount <= 0)
      throw new Error(`invalid coin grant ${g.amount}`)
    const rows = await tx
      .insert(schema.coinLedger)
      .values({ userId, amount: g.amount, reason: g.reason, ref: g.ref, createdAt: at })
      .onConflictDoNothing()
      .returning({ id: schema.coinLedger.id })
    if (rows.length === 1) credited.push(g)
  }
  const earned = credited.reduce((n, g) => n + g.amount, 0)
  const [row] = await tx
    .insert(schema.wallet)
    .values({ userId, coins: earned, updatedAt: at })
    .onConflictDoUpdate({
      target: schema.wallet.userId,
      set: { coins: sql`${schema.wallet.coins} + ${earned}`, updatedAt: at },
    })
    .returning({ coins: schema.wallet.coins })
  return { credited, coins: row!.coins }
}

/** The item an earlier purchase with this purchaseId bought, or null. */
export async function findPurchase(
  tx: Tx,
  userId: string,
  purchaseId: string,
): Promise<{ purchaseId: string; item: ShopItemId } | null> {
  const [row] = await tx
    .select({ reason: schema.coinLedger.reason })
    .from(schema.coinLedger)
    .where(
      and(
        eq(schema.coinLedger.userId, userId),
        eq(schema.coinLedger.ref, purchaseId),
        inArray(schema.coinLedger.reason, [...PURCHASE_REASONS]),
      ),
    )
  return row ? { purchaseId, item: row.reason as ShopItemId } : null
}

/**
 * Debits a purchase: one ledger row (-price, reason item, ref purchaseId) and the wallet. Throws
 * ConflictError when the balance can't pay (the caller checks first under the user lock) or the
 * purchaseId was already used; nothing is written then.
 */
export async function debitPurchase(
  tx: Tx,
  userId: string,
  p: { item: ShopItemId; purchaseId: string; price: number },
  at: string,
): Promise<{ coins: number }> {
  if (!Number.isInteger(p.price) || p.price <= 0) throw new Error(`invalid price ${p.price}`)
  const [w] = await tx
    .update(schema.wallet)
    .set({ coins: sql`${schema.wallet.coins} - ${p.price}`, updatedAt: at })
    .where(and(eq(schema.wallet.userId, userId), sql`${schema.wallet.coins} >= ${p.price}`))
    .returning({ coins: schema.wallet.coins })
  if (!w) throw new ConflictError('insufficient coins')
  const rows = await tx
    .insert(schema.coinLedger)
    .values({ userId, amount: -p.price, reason: p.item, ref: p.purchaseId, createdAt: at })
    .onConflictDoNothing()
    .returning({ id: schema.coinLedger.id })
  // The UPDATE above already ran: throwing rolls the whole transaction back.
  if (rows.length !== 1) throw new ConflictError('purchase id already used')
  return { coins: w.coins }
}
