/**
 * The shop (P2, flags.shop): GET /api/shop, POST /api/shop/purchase and POST /api/lives/refill.
 * A purchase runs game-rules `purchase` in one `withUserLock` transaction: the wallet and one
 * negative coin_ledger row (ref = purchaseId), plus the streak freeze or the refilled hearts. A
 * replayed purchaseId is found by its ledger ref and never charged twice.
 */
import type { AppConfig, PurchaseResponse, ShopItemId, ShopResponse } from '@zaboon/contracts'
import { repos, withUser, withUserLock, type Db, type Tx } from '@zaboon/db'
import {
  dateInZone,
  initialLives,
  initialStreak,
  livesPolicy,
  purchase,
  settleStreak,
  shopItems,
  streakView,
  type ShopState,
} from '@zaboon/game-rules'
import { ApiError } from '../errors'

async function today(tx: Tx, userId: string, now: Date): Promise<string> {
  const profile = await repos.profiles.getProfile(tx, userId)
  return dateInZone(now, profile?.timezone ?? 'UTC')
}

/**
 * What a purchase reads. The streak is settled up to today first (game-rules `settleStreak`): a
 * freeze bought now only covers future days, it never repairs a streak that is already broken.
 */
async function loadShopState(
  tx: Tx,
  userId: string,
  now: Date,
  cfg: AppConfig,
  purchaseId: string | null,
): Promise<{ state: ShopState; settled: ReturnType<typeof settleStreak>; today: string }> {
  const known = purchaseId ? await repos.wallet.findPurchase(tx, userId, purchaseId) : null
  const date = await today(tx, userId, now)
  const settled = settleStreak(
    (await repos.state.getStreak(tx, userId)) ?? initialStreak(cfg),
    date,
  )
  return {
    state: {
      coins: await repos.wallet.getCoins(tx, userId),
      streak: settled.state,
      lives: (await repos.state.getLives(tx, userId)) ?? initialLives(now, cfg),
      purchases: known ? [known] : [],
    },
    settled,
    today: date,
  }
}

export async function buildShop(
  db: Db,
  userId: string,
  now: Date,
  cfg: AppConfig,
): Promise<ShopResponse> {
  return withUser(db, userId, async (tx) => {
    const { state } = await loadShopState(tx, userId, now, cfg, null)
    return { coins: state.coins, items: shopItems(state, now, cfg) }
  })
}

/**
 * Buys one item for coins. Refusals: 409 insufficient_coins, or 409 conflict with details.reason.
 * Only the user lock is needed: the rollover also credits wallets, but it holds no lock a purchase
 * waits for, so the two only meet on the wallet row.
 */
export async function buy(
  db: Db,
  userId: string,
  req: { item: ShopItemId; purchaseId: string },
  now: Date,
  cfg: AppConfig,
): Promise<PurchaseResponse> {
  return withUserLock(db, userId, async (tx) => {
    await repos.profiles.ensureProfile(tx, userId)
    const {
      state: before,
      settled,
      today,
    } = await loadShopState(tx, userId, now, cfg, req.purchaseId)
    const r = purchase(before, req, now, cfg)
    if (!r.ok) {
      if (r.refusal === 'insufficient_coins')
        throw new ApiError('insufficient_coins', 'not enough coins', { reason: r.refusal })
      throw new ApiError('conflict', `purchase refused: ${r.refusal}`, { reason: r.refusal })
    }
    const at = now.toISOString()
    if (!r.replayed) {
      await repos.wallet.debitPurchase(
        tx,
        userId,
        { item: req.item, purchaseId: req.purchaseId, price: r.charged },
        at,
      )
      if (req.item === 'streak_freeze') {
        // The settlement is written with the freeze: the missed days break the streak first.
        await repos.state.saveStreak(tx, userId, r.state.streak)
        if (settled.frozenDates.length > 0)
          await repos.progress.markFreezeUsed(tx, userId, settled.frozenDates)
      } else await repos.state.saveLives(tx, userId, r.state.lives)
    }
    const stored = (await repos.state.getStreak(tx, userId)) ?? initialStreak(cfg)
    return {
      purchaseId: req.purchaseId,
      item: req.item,
      replayed: r.replayed,
      coins: await repos.wallet.getCoins(tx, userId),
      streak: streakView(stored, today),
      lives: livesPolicy(r.state.lives.policy).view(r.state.lives, now, cfg),
    }
  })
}
