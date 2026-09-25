/**
 * Leagues (P2, flags.leagues): the learner's standing in this week's cohort, for the leaderboard,
 * the home league card and the lesson result. Ranking and zones come from game-rules
 * `rolloverCohort` (the same function the rollover uses), so what the board shows is what the
 * rollover will do. Other learners appear only through public profile fields, never a user id.
 */
import type {
  AppConfig,
  LeaderboardEntry,
  LeaderboardResponse,
  LeagueOutcome,
  LeagueResult,
  LeagueSummary,
  LeagueTier,
} from '@zaboon/contracts'
import { repos, type Tx } from '@zaboon/db'
import {
  leagueRewardCoins,
  leagueWeek,
  rolloverCohort,
  tierAfter,
  weekOf,
  type LeagueWeekBounds,
} from '@zaboon/game-rules'

const WEEK_MS = 7 * 86_400_000

export interface RankedStanding extends repos.leagues.Standing {
  rank: number
  zone: LeagueOutcome
}

/** The cohort in rank order with each member's zone (what the rollover would do right now). */
export function rankCohort(
  standings: readonly repos.leagues.Standing[],
  tier: LeagueTier,
  cfg: AppConfig,
): RankedStanding[] {
  const byId = new Map(standings.map((s) => [s.userId, s]))
  return rolloverCohort(standings, tier, cfg).map((r) => ({
    ...byId.get(r.userId)!,
    rank: r.rank,
    zone: r.outcome,
  }))
}

export interface LeagueStanding {
  week: LeagueWeekBounds
  weekId: number | null
  tier: LeagueTier
  membership: repos.leagues.Membership | null
  ranked: RankedStanding[]
  me: RankedStanding | null
}

/** The learner's standing this week (reads only; nothing is created before the first XP). */
export async function readStanding(
  tx: Tx,
  userId: string,
  now: Date,
  cfg: AppConfig,
): Promise<LeagueStanding> {
  const week = leagueWeek(now)
  const row = await repos.leagues.getWeek(tx, week.startsAt)
  const membership = row ? await repos.leagues.getMembership(tx, userId, row.id) : null
  const tier = membership?.tier ?? (await repos.leagues.getTier(tx, userId))
  const ranked =
    row && membership
      ? rankCohort(await repos.leagues.listMyCohort(tx, userId, row.id), tier, cfg)
      : []
  return {
    week,
    weekId: row?.id ?? null,
    tier,
    membership,
    ranked,
    me: ranked.find((r) => r.userId === userId) ?? null,
  }
}

/** How the learner's previous week ended, once the rollover has closed it. */
export async function readLastResult(
  tx: Tx,
  userId: string,
  now: Date,
  cfg: AppConfig,
): Promise<LeagueResult | null> {
  const prev = weekOf(new Date(Date.parse(leagueWeek(now).startsAt) - WEEK_MS).toISOString())
  const row = await repos.leagues.getWeek(tx, prev.startsAt)
  if (!row || row.closedAt === null) return null
  const m = await repos.leagues.getMembership(tx, userId, row.id)
  if (!m || m.finalRank === null || m.outcome === null) return null
  return {
    week: prev,
    tier: m.tier,
    rank: m.finalRank,
    outcome: m.outcome,
    newTier: tierAfter(m.tier, m.outcome),
    coins: leagueRewardCoins(m.finalRank, cfg),
  }
}

export async function buildLeaderboard(
  tx: Tx,
  userId: string,
  now: Date,
  cfg: AppConfig,
): Promise<LeaderboardResponse> {
  const s = await readStanding(tx, userId, now, cfg)
  const members: LeaderboardEntry[] = s.ranked.map((r) => ({
    rank: r.rank,
    displayName: r.displayName,
    username: r.username,
    avatar: r.avatar,
    weeklyXp: r.weeklyXp,
    isMe: r.userId === userId,
    zone: r.zone,
  }))
  return {
    tier: s.tier,
    week: s.week,
    joined: s.membership !== null,
    members,
    promoteCount: s.ranked.filter((r) => r.zone === 'promote').length,
    demoteCount: s.ranked.filter((r) => r.zone === 'demote').length,
    lastResult: await readLastResult(tx, userId, now, cfg),
  }
}

export async function leagueSummary(
  tx: Tx,
  userId: string,
  now: Date,
  cfg: AppConfig,
): Promise<LeagueSummary> {
  const s = await readStanding(tx, userId, now, cfg)
  return {
    tier: s.tier,
    joined: s.membership !== null,
    rank: s.me?.rank ?? null,
    weeklyXp: s.membership?.weeklyXp ?? 0,
    zone: s.me?.zone ?? null,
    endsAt: s.week.endsAt,
  }
}
