/**
 * Engagement rules (P2, Wave 3): league weeks, league XP and rollover, quest progress with
 * auto-claim, coin grants and the shop. Pure functions; the server is authoritative.
 *
 * STUBS: every function throws NotImplementedError and ENGAGEMENT_IMPLEMENTATION is 'stub' until
 * ws-engagement implements them and flips it to 'real'. The executable spec is
 * oracles/engagement.yaml (read-only), run by oracles/engagement.oracle.test.ts, which calls
 * exactly these signatures (the YAML header documents each rule). Placement and rollover of a
 * cohort are `placeInCohort` / `rolloverCohort` (index.ts, oracles/leagues.yaml).
 */
import type {
  AppConfig,
  LivesState,
  QuestMetric,
  SessionKind,
  ShopItemId,
  ShopUnavailable,
  StreakState,
} from '@zaboon/contracts'

export const ENGAGEMENT_IMPLEMENTATION: 'stub' | 'real' = 'stub'

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet (ws-engagement, Wave 3)`)
    this.name = 'NotImplementedError'
  }
}

// ---------------------------------------------------------------------------------------- leagues
/** A league week: ISO instants, [Monday 00:00 UTC, next Monday 00:00 UTC). */
export interface LeagueWeekBounds {
  startsAt: string
  endsAt: string
}

/** The league week containing `now` (UTC for everybody, whatever the learner's timezone). */
export function leagueWeek(_now: Date): LeagueWeekBounds {
  throw new NotImplementedError('leagueWeek')
}

/** A stored league_weeks row. */
export interface StoredWeek {
  startsAt: string
  closedAt: string | null
}

/**
 * What one rollover run does: close every stored week that has ended and is not closed yet
 * (oldest first; a closed week is never closed again) and keep `current` = leagueWeek(now) open.
 */
export function rolloverPlan(
  _weeks: readonly StoredWeek[],
  _now: Date,
): { close: string[]; current: LeagueWeekBounds } {
  throw new NotImplementedError('rolloverPlan')
}

/**
 * One committed session's league step (inside the /complete transaction): guests never join,
 * flagged or 0-XP sessions change nothing, the week's first XP joins, later XP accumulates.
 * `weeklyXp` is null while the learner is not in a cohort.
 */
export function leagueXpStep(_input: {
  member: { weeklyXp: number } | null
  linked: boolean
  sessionXp: number
  flagged: boolean
}): { join: boolean; weeklyXp: number | null } {
  throw new NotImplementedError('leagueXpStep')
}

// ----------------------------------------------------------------------------------------- coins
/** One coin_ledger credit; (reason, ref) is its idempotency key (UNIQUE(user_id, reason, ref)). */
export interface CoinGrant {
  reason: 'quest' | 'league'
  ref: string
  amount: number
}

/** Coins for a final league rank: AppConfig.leagues.rewardCoins[rank - 1], 0 past the list. */
export function leagueRewardCoins(_rank: number, _cfg: AppConfig): number {
  throw new NotImplementedError('leagueRewardCoins')
}

/** The rollover grant for a final rank (ref = the week's startsAt), or null when it pays nothing. */
export function leagueGrant(
  _week: LeagueWeekBounds,
  _rank: number,
  _cfg: AppConfig,
): CoinGrant | null {
  throw new NotImplementedError('leagueGrant')
}

/** The grant for completing a quest: ref `${date}:${questId}`, amount AppConfig.quests.rewardCoins. */
export function questGrant(_date: string, _questId: string, _cfg: AppConfig): CoinGrant {
  throw new NotImplementedError('questGrant')
}

/** A wallet and the (reason, ref) keys of the ledger rows already written for it. */
export interface Wallet {
  coins: number
  ledger: readonly { reason: string; ref: string }[]
}

/** Applies grants in order, skipping a (reason, ref) already in the ledger or earlier in `grants`. */
export function applyCoinGrants(
  _wallet: Wallet,
  _grants: readonly CoinGrant[],
): { coins: number; applied: CoinGrant[]; skipped: CoinGrant[] } {
  throw new NotImplementedError('applyCoinGrants')
}

// ---------------------------------------------------------------------------------------- quests
/** One of the day's quests (from `dailyQuests`; ids follow the quest_defs rule, e.g. xp_20). */
export interface QuestDef {
  id: string
  metric: QuestMetric
  target: number
}

/** A stored user_quests row of that day. */
export interface QuestRow {
  questId: string
  progress: number
  claimed: boolean
}

/** The committed session, as quests see it. Flagged (anti-cheat) sessions advance nothing. */
export interface QuestSession {
  kind: SessionKind
  xp: number
  perfect: boolean
  flagged: boolean
}

export interface QuestState extends QuestRow {
  completed: boolean
  /** Completed by this session. */
  justCompleted: boolean
}

/**
 * Applies one committed session to the quests of its local date: progress += questIncrement,
 * capped at the target; a completed, unclaimed quest is claimed in this same commit (auto-claim)
 * with its questGrant; a claimed quest never pays again. Output follows `defs` order.
 */
export function applyQuestProgress(_input: {
  date: string
  defs: readonly QuestDef[]
  rows: readonly QuestRow[]
  session: QuestSession
  cfg: AppConfig
}): { quests: QuestState[]; grants: CoinGrant[] } {
  throw new NotImplementedError('applyQuestProgress')
}

// ------------------------------------------------------------------------------------------ shop
/** What a purchase reads and writes. `purchases` = earlier purchases (purchaseId → item). */
export interface ShopState {
  coins: number
  streak: StreakState
  lives: LivesState
  purchases: readonly { purchaseId: string; item: ShopItemId }[]
}

export type PurchaseRefusal = ShopUnavailable | 'purchase_id_reused'

export type PurchaseResult =
  | { ok: true; replayed: boolean; charged: number; state: ShopState }
  | { ok: false; refusal: PurchaseRefusal }

/**
 * Buys one item (oracles/engagement.yaml, rule shop): a known purchaseId replays (or is refused
 * as reused for another item); then the item's own refusals (max_owned; unlimited_lives,
 * lives_full at `now`); then insufficient_coins; else charge the price and apply the item.
 */
export function purchase(
  _state: ShopState,
  _request: { item: ShopItemId; purchaseId: string },
  _now: Date,
  _cfg: AppConfig,
): PurchaseResult {
  throw new NotImplementedError('purchase')
}

/** The shop's items for GET /api/shop, each with the refusal `purchase` would give now (or null). */
export function shopItems(
  _state: ShopState,
  _now: Date,
  _cfg: AppConfig,
): {
  id: ShopItemId
  price: number
  owned: number | null
  max: number | null
  unavailable: ShopUnavailable | null
}[] {
  throw new NotImplementedError('shopItems')
}
