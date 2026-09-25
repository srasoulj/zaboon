/**
 * Engagement rules (P2, Wave 3): league weeks, league XP and rollover, quest progress with
 * auto-claim, coin grants and the shop. Pure functions; the server is authoritative.
 *
 * The executable spec is oracles/engagement.yaml (read-only), run by
 * oracles/engagement.oracle.test.ts, which calls exactly these signatures (the YAML header
 * documents each rule). Placement and rollover of a cohort are `placeInCohort` / `rolloverCohort`
 * (index.ts, oracles/leagues.yaml).
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
import { livesPolicy, questIncrement } from './index'

export const ENGAGEMENT_IMPLEMENTATION: 'stub' | 'real' = 'real'

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS

// ---------------------------------------------------------------------------------------- leagues
/** A league week: ISO instants, [Monday 00:00 UTC, next Monday 00:00 UTC). */
export interface LeagueWeekBounds {
  startsAt: string
  endsAt: string
}

/** The league week containing `now` (UTC for everybody, whatever the learner's timezone). */
export function leagueWeek(now: Date): LeagueWeekBounds {
  const t = now.getTime()
  const midnight = Math.floor(t / DAY_MS) * DAY_MS
  // getUTCDay: 0 = Sunday … 6 = Saturday; days since Monday = (day + 6) % 7.
  const start = midnight - ((new Date(midnight).getUTCDay() + 6) % 7) * DAY_MS
  return weekFrom(start)
}

function weekFrom(startMs: number): LeagueWeekBounds {
  return {
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(startMs + WEEK_MS).toISOString(),
  }
}

/** The league week that starts at `startsAt` (any ISO instant of a Monday 00:00 UTC). */
export function weekOf(startsAt: string): LeagueWeekBounds {
  return weekFrom(Date.parse(startsAt))
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
  weeks: readonly StoredWeek[],
  now: Date,
): { close: string[]; current: LeagueWeekBounds } {
  const t = now.getTime()
  const close = weeks
    .filter((w) => w.closedAt === null && Date.parse(w.startsAt) + WEEK_MS <= t)
    .map((w) => w.startsAt)
    .sort((a, b) => Date.parse(a) - Date.parse(b))
  return { close, current: leagueWeek(now) }
}

/**
 * One committed session's league step (inside the /complete transaction): guests never join,
 * flagged or 0-XP sessions change nothing, the week's first XP joins, later XP accumulates.
 * `weeklyXp` is null while the learner is not in a cohort.
 */
export function leagueXpStep(input: {
  member: { weeklyXp: number } | null
  linked: boolean
  sessionXp: number
  flagged: boolean
}): { join: boolean; weeklyXp: number | null } {
  const weeklyXp = input.member?.weeklyXp ?? null
  if (!input.linked || input.flagged || input.sessionXp <= 0) return { join: false, weeklyXp }
  if (weeklyXp === null) return { join: true, weeklyXp: input.sessionXp }
  return { join: false, weeklyXp: weeklyXp + input.sessionXp }
}

// ----------------------------------------------------------------------------------------- coins
/** One coin_ledger credit; (reason, ref) is its idempotency key (UNIQUE(user_id, reason, ref)). */
export interface CoinGrant {
  reason: 'quest' | 'league'
  ref: string
  amount: number
}

/** Coins for a final league rank: AppConfig.leagues.rewardCoins[rank - 1], 0 past the list. */
export function leagueRewardCoins(rank: number, cfg: AppConfig): number {
  if (!Number.isInteger(rank) || rank < 1) return 0
  return cfg.leagues.rewardCoins[rank - 1] ?? 0
}

/** The rollover grant for a final rank (ref = the week's startsAt), or null when it pays nothing. */
export function leagueGrant(
  week: LeagueWeekBounds,
  rank: number,
  cfg: AppConfig,
): CoinGrant | null {
  const amount = leagueRewardCoins(rank, cfg)
  return amount > 0 ? { reason: 'league', ref: week.startsAt, amount } : null
}

/** The grant for completing a quest: ref `${date}:${questId}`, amount AppConfig.quests.rewardCoins. */
export function questGrant(date: string, questId: string, cfg: AppConfig): CoinGrant {
  return { reason: 'quest', ref: `${date}:${questId}`, amount: cfg.quests.rewardCoins }
}

/** A wallet and the (reason, ref) keys of the ledger rows already written for it. */
export interface Wallet {
  coins: number
  ledger: readonly { reason: string; ref: string }[]
}

/** Applies grants in order, skipping a (reason, ref) already in the ledger or earlier in `grants`. */
export function applyCoinGrants(
  wallet: Wallet,
  grants: readonly CoinGrant[],
): { coins: number; applied: CoinGrant[]; skipped: CoinGrant[] } {
  const key = (g: { reason: string; ref: string }) => `${g.reason}\u0000${g.ref}`
  const seen = new Set(wallet.ledger.map(key))
  let coins = wallet.coins
  const applied: CoinGrant[] = []
  const skipped: CoinGrant[] = []
  for (const g of grants) {
    const k = key(g)
    if (seen.has(k)) {
      skipped.push(g)
      continue
    }
    seen.add(k)
    coins += g.amount
    applied.push(g)
  }
  return { coins, applied, skipped }
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
export function applyQuestProgress(input: {
  date: string
  defs: readonly QuestDef[]
  rows: readonly QuestRow[]
  session: QuestSession
  cfg: AppConfig
}): { quests: QuestState[]; grants: CoinGrant[] } {
  const { date, defs, rows, session, cfg } = input
  const quests: QuestState[] = []
  const grants: CoinGrant[] = []
  for (const def of defs) {
    const row = rows.find((r) => r.questId === def.id)
    const before = row?.progress ?? 0
    const wasClaimed = row?.claimed ?? false
    // A flagged session changes nothing at all: no progress and no claim.
    if (session.flagged) {
      const completed = before >= def.target
      quests.push({
        questId: def.id,
        progress: before,
        claimed: wasClaimed,
        completed,
        justCompleted: false,
      })
      continue
    }
    const progress = Math.min(def.target, before + questIncrement(def.metric, session))
    const completed = progress >= def.target
    const claimed = wasClaimed || completed
    if (completed && !wasClaimed) grants.push(questGrant(date, def.id, cfg))
    quests.push({
      questId: def.id,
      progress,
      claimed,
      completed,
      justCompleted: completed && before < def.target,
    })
  }
  return { quests, grants }
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
  state: ShopState,
  request: { item: ShopItemId; purchaseId: string },
  now: Date,
  cfg: AppConfig,
): PurchaseResult {
  const known = state.purchases.find((p) => p.purchaseId === request.purchaseId)
  if (known) {
    if (known.item !== request.item) return { ok: false, refusal: 'purchase_id_reused' }
    return { ok: true, replayed: true, charged: 0, state }
  }
  const refusal = unavailable(request.item, state, now, cfg)
  if (refusal) return { ok: false, refusal }
  const price = cfg.shop.prices[request.item]
  const next: ShopState = {
    ...state,
    coins: state.coins - price,
    purchases: [...state.purchases, { purchaseId: request.purchaseId, item: request.item }],
  }
  if (request.item === 'streak_freeze')
    next.streak = { ...state.streak, freezes: state.streak.freezes + 1 }
  else
    next.lives = { policy: state.lives.policy, count: cfg.hearts.max, updatedAt: now.toISOString() }
  return { ok: true, replayed: false, charged: price, state: next }
}

/** The shop's items, in display order. */
export const SHOP_ITEMS: readonly ShopItemId[] = ['streak_freeze', 'heart_refill']

/** Why `item` can't be bought now (the item's own refusal first, then the price), or null. */
export function unavailable(
  item: ShopItemId,
  state: ShopState,
  now: Date,
  cfg: AppConfig,
): ShopUnavailable | null {
  if (item === 'streak_freeze') {
    if (state.streak.freezes >= cfg.streak.maxFreezes) return 'max_owned'
  } else {
    if (state.lives.policy === 'unlimited') return 'unlimited_lives'
    const view = livesPolicy(state.lives.policy).view(state.lives, now, cfg)
    if (view.count >= view.max) return 'lives_full'
  }
  return state.coins < cfg.shop.prices[item] ? 'insufficient_coins' : null
}

/** The shop's items for GET /api/shop, each with the refusal `purchase` would give now (or null). */
export function shopItems(
  state: ShopState,
  now: Date,
  cfg: AppConfig,
): {
  id: ShopItemId
  price: number
  owned: number | null
  max: number | null
  unavailable: ShopUnavailable | null
}[] {
  return SHOP_ITEMS.map((id) => {
    const freeze = id === 'streak_freeze'
    return {
      id,
      price: cfg.shop.prices[id],
      owned: freeze ? state.streak.freezes : null,
      max: freeze ? cfg.streak.maxFreezes : null,
      unavailable: unavailable(id, state, now, cfg),
    }
  })
}

// ------------------------------------------------------------------------------------ day resets
const zoneFormatters = new Map<string, Intl.DateTimeFormat>()

function localDate(instant: number, tz: string): string {
  let f = zoneFormatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    zoneFormatters.set(tz, f)
  }
  return f.format(new Date(instant))
}

/**
 * The first instant of the next local day in `tz` after `now` (when today's quests reset). Usually
 * the next local midnight; where a DST jump skips midnight, the first instant that exists.
 */
export function nextLocalMidnight(now: Date, tz: string): string {
  const today = localDate(now.getTime(), tz)
  // A local day lasts at most 25 hours, so the next day has begun 26 hours from now.
  let lo = now.getTime()
  let hi = lo + 26 * 3_600_000
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2)
    if (localDate(mid, tz) > today) hi = mid
    else lo = mid
  }
  return new Date(hi).toISOString()
}
