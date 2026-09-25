/**
 * The shop (P2, flags.shop): GET /api/shop, POST /api/shop/purchase and POST /api/lives/refill.
 * A purchase runs game-rules `purchase` in one `withUserLock` transaction: the wallet and one
 * negative coin_ledger row (ref = purchaseId), plus the streak freeze or the refilled hearts. A
 * replayed purchaseId is found by its ledger ref and never charged twice.
 */
import type {
  AppConfig,
  PurchaseResponse,
  ShopItemId,
  ShopResponse,
  StreakState,
} from '@zaboon/contracts'
import { repos, withUser, withUserLock, type Db, type Tx } from '@zaboon/db'
import {
  dateInZone,
  initialLives,
  initialStreak,
  leagueWeek,
  livesPolicy,
  purchase,
  shopItems,
  streakView,
  type ShopState,
} from '@zaboon/game-rules'
import { ApiError } from '../errors'

async function loadShopState(
  tx: Tx,
  userId: string,
  now: Date,
  cfg: AppConfig,
  purchaseId: string | null,
): Promise<ShopState> {
  const known = purchaseId ? await repos.wallet.findPurchase(tx, userId, purchaseId) : null
  return {
    coins: await repos.wallet.getCoins(tx, userId),
    streak: (await repos.state.getStreak(tx, userId)) ?? initialStreak(cfg),
    lives: (await repos.state.getLives(tx, userId)) ?? initialLives(now, cfg),
    purchases: known ? [known] : [],
  }
}

export async function buildShop(
  db: Db,
  userId: string,
  now: Date,
  cfg: AppConfig,
): Promise<ShopResponse> {
  return withUser(db, userId, async (tx) => {
    const state = await loadShopState(tx, userId, now, cfg, null)
    return { coins: state.coins, items: shopItems(state, now, cfg) }
  })
}

async function today(tx: Tx, userId: string, now: Date): Promise<string> {
  const profile = await repos.profiles.getProfile(tx, userId)
  return dateInZone(now, profile?.timezone ?? 'UTC')
}

function sameStreak(a: StreakState, b: StreakState): boolean {
  return a.freezes === b.freezes && a.current === b.current && a.longest === b.longest
}

/** Buys one item for coins. Refusals: 409 insufficient_coins, or 409 conflict with details.reason. */
export async function buy(
  db: Db,
  userId: string,
  req: { item: ShopItemId; purchaseId: string },
  now: Date,
  cfg: AppConfig,
): Promise<PurchaseResponse> {
  return withUserLock(db, userId, async (tx) => {
    // Lock order (repos.leagues): user lock → shared week lock → wallet (the rollover credits
    // wallets under the exclusive week lock).
    await repos.leagues.lockWeekShared(tx, leagueWeek(now).startsAt)
    await repos.profiles.ensureProfile(tx, userId)
    const before = await loadShopState(tx, userId, now, cfg, req.purchaseId)
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
      if (!sameStreak(before.streak, r.state.streak))
        await repos.state.saveStreak(tx, userId, r.state.streak)
      if (before.lives !== r.state.lives) await repos.state.saveLives(tx, userId, r.state.lives)
    }
    return {
      purchaseId: req.purchaseId,
      item: req.item,
      replayed: r.replayed,
      coins: await repos.wallet.getCoins(tx, userId),
      streak: streakView(r.state.streak, await today(tx, userId, now)),
      lives: livesPolicy(r.state.lives.policy).view(r.state.lives, now, cfg),
    }
  })
}
