/**
 * Leagues (P2, ARCHITECTURE §6, §10.6): weeks, cohorts of at most 30, members and each learner's
 * tier. Game math (placement, ranking, rollover outcomes) lives in @zaboon/game-rules; this module
 * only reads and writes rows and takes the advisory locks.
 *
 * Lock order (never violated, so a commit and a rollover can't deadlock):
 *   user lock (withUserLock) → week lock (shared in commits and purchases, exclusive in the
 *   rollover) → (week, tier) placement lock (exclusive, commits only).
 * The rollover takes no user locks. A commit takes its week lock before any wallet or league write.
 */
import { and, asc, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import type { LeagueOutcome, LeagueTier } from '@zaboon/contracts'
import type { Tx } from '../index'
import * as schema from '../schema'
import { assertSystemScope, toIso, toIsoOrNull } from './shared'

const iso = (t: string) => new Date(t).toISOString()

function weekLockKey(startsAt: string) {
  return sql`hashtextextended(${`zaboon:league_week:${iso(startsAt)}`}, 0)`
}

/** Shared week lock: commits and purchases (many at once); blocks while the rollover closes it. */
export async function lockWeekShared(tx: Tx, startsAt: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${weekLockKey(startsAt)})`)
}

/** Exclusive week lock: the rollover, while it closes the week. */
export async function lockWeekExclusive(tx: Tx, startsAt: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${weekLockKey(startsAt)})`)
}

/** Exclusive (week, tier) lock: placing a learner in a cohort (§6: fills the fullest open cohort). */
export async function lockPlacement(tx: Tx, startsAt: string, tier: LeagueTier): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`zaboon:league_place:${iso(startsAt)}:${tier}`}, 0))`,
  )
}

// ---------------------------------------------------------------------------------------- weeks
export interface Week {
  id: number
  startsAt: string
  endsAt: string
  closedAt: string | null
}

function toWeek(r: typeof schema.leagueWeeks.$inferSelect): Week {
  return {
    id: r.id,
    startsAt: toIso(r.startsAt),
    endsAt: toIso(r.endsAt),
    closedAt: toIsoOrNull(r.closedAt),
  }
}

export async function getWeek(tx: Tx, startsAt: string): Promise<Week | null> {
  const [row] = await tx
    .select()
    .from(schema.leagueWeeks)
    .where(eq(schema.leagueWeeks.startsAt, iso(startsAt)))
  return row ? toWeek(row) : null
}

/** The week's row, created open if missing (user scope may create; nobody but the rollover closes). */
export async function ensureWeek(
  tx: Tx,
  week: { startsAt: string; endsAt: string },
): Promise<Week> {
  await tx
    .insert(schema.leagueWeeks)
    .values({ startsAt: iso(week.startsAt), endsAt: iso(week.endsAt) })
    .onConflictDoNothing({ target: schema.leagueWeeks.startsAt })
  const row = await getWeek(tx, week.startsAt)
  if (!row) throw new Error(`league week ${week.startsAt} is missing after insert`)
  return row
}

/** Weeks that are not closed yet (the rollover's input). */
export async function listOpenWeeks(tx: Tx): Promise<Week[]> {
  const rows = await tx
    .select()
    .from(schema.leagueWeeks)
    .where(isNull(schema.leagueWeeks.closedAt))
    .orderBy(asc(schema.leagueWeeks.startsAt))
  return rows.map(toWeek)
}

/** System scope: marks the week closed. Returns false when it was already closed. */
export async function closeWeek(tx: Tx, weekId: number, at: string): Promise<boolean> {
  await assertSystemScope(tx)
  const rows = await tx
    .update(schema.leagueWeeks)
    .set({ closedAt: at })
    .where(and(eq(schema.leagueWeeks.id, weekId), isNull(schema.leagueWeeks.closedAt)))
    .returning({ id: schema.leagueWeeks.id })
  return rows.length === 1
}

// ----------------------------------------------------------------------------------------- tiers
export async function getTier(tx: Tx, userId: string): Promise<LeagueTier> {
  const [row] = await tx
    .select({ tier: schema.userLeague.tier })
    .from(schema.userLeague)
    .where(eq(schema.userLeague.userId, userId))
  return (row?.tier as LeagueTier | undefined) ?? 'mes'
}

/** System scope (rollover): the learner's tier from now on. */
export async function setTier(tx: Tx, userId: string, tier: LeagueTier, at: string): Promise<void> {
  await assertSystemScope(tx)
  await tx
    .insert(schema.userLeague)
    .values({ userId, tier, updatedAt: at })
    .onConflictDoUpdate({ target: schema.userLeague.userId, set: { tier, updatedAt: at } })
}

// ------------------------------------------------------------------------------ cohorts, members
export interface Membership {
  cohortId: number
  weekId: number
  tier: LeagueTier
  weeklyXp: number
  finalRank: number | null
  outcome: LeagueOutcome | null
}

/** The learner's cohort membership in a week, or null. */
export async function getMembership(
  tx: Tx,
  userId: string,
  weekId: number,
): Promise<Membership | null> {
  const m = schema.leagueMembers
  const c = schema.leagueCohorts
  const [row] = await tx
    .select({
      cohortId: m.cohortId,
      weekId: m.weekId,
      tier: c.tier,
      weeklyXp: m.weeklyXp,
      finalRank: m.finalRank,
      outcome: m.outcome,
    })
    .from(m)
    .innerJoin(c, eq(c.id, m.cohortId))
    .where(and(eq(m.userId, userId), eq(m.weekId, weekId)))
  return row ? { ...row, tier: row.tier as LeagueTier } : null
}

export interface PastMembership {
  weekId: number
  startsAt: string
  closedAt: string | null
  cohortId: number
  tier: LeagueTier
}

/**
 * The learner's membership in their latest week that started before `startsAt`, or null. While
 * that week is still open (the rollover hasn't closed it yet), its outcome decides the learner's
 * next tier, not `user_league`.
 */
export async function latestMembershipBefore(
  tx: Tx,
  userId: string,
  startsAt: string,
): Promise<PastMembership | null> {
  const m = schema.leagueMembers
  const w = schema.leagueWeeks
  const c = schema.leagueCohorts
  const [row] = await tx
    .select({
      weekId: w.id,
      startsAt: w.startsAt,
      closedAt: w.closedAt,
      cohortId: m.cohortId,
      tier: c.tier,
    })
    .from(m)
    .innerJoin(w, eq(w.id, m.weekId))
    .innerJoin(c, eq(c.id, m.cohortId))
    .where(and(eq(m.userId, userId), lt(w.startsAt, iso(startsAt))))
    .orderBy(desc(w.startsAt))
    .limit(1)
  return row
    ? {
        weekId: row.weekId,
        startsAt: toIso(row.startsAt),
        closedAt: toIsoOrNull(row.closedAt),
        cohortId: row.cohortId,
        tier: row.tier as LeagueTier,
      }
    : null
}

/** Open cohorts of (week, tier) in creation order, for game-rules `placeInCohort`. */
export async function listCohorts(
  tx: Tx,
  weekId: number,
  tier: LeagueTier,
): Promise<{ id: string; size: number; createdOrder: number }[]> {
  const rows = await tx
    .select({ id: schema.leagueCohorts.id, size: schema.leagueCohorts.size })
    .from(schema.leagueCohorts)
    .where(and(eq(schema.leagueCohorts.weekId, weekId), eq(schema.leagueCohorts.tier, tier)))
    .orderBy(asc(schema.leagueCohorts.id))
  return rows.map((r) => ({ id: String(r.id), size: r.size, createdOrder: r.id }))
}

export async function createCohort(tx: Tx, weekId: number, tier: LeagueTier): Promise<number> {
  const [row] = await tx
    .insert(schema.leagueCohorts)
    .values({ weekId, tier })
    .returning({ id: schema.leagueCohorts.id })
  return row!.id
}

/**
 * Adds the learner to a cohort with their first weekly XP and bumps its size. Run under
 * `lockPlacement` for the cohort's (week, tier); the size CHECK (≤ 30) is the last line of defence.
 */
export async function joinCohort(
  tx: Tx,
  userId: string,
  j: { cohortId: number; weekId: number; weeklyXp: number; at: string },
): Promise<void> {
  await tx.insert(schema.leagueMembers).values({
    cohortId: j.cohortId,
    weekId: j.weekId,
    userId,
    weeklyXp: j.weeklyXp,
    joinedAt: j.at,
  })
  await tx
    .update(schema.leagueCohorts)
    .set({ size: sql`${schema.leagueCohorts.size} + 1` })
    .where(eq(schema.leagueCohorts.id, j.cohortId))
}

/** Sets the learner's weekly XP in a week they already joined. */
export async function setWeeklyXp(
  tx: Tx,
  userId: string,
  weekId: number,
  weeklyXp: number,
): Promise<void> {
  await tx
    .update(schema.leagueMembers)
    .set({ weeklyXp })
    .where(and(eq(schema.leagueMembers.userId, userId), eq(schema.leagueMembers.weekId, weekId)))
}

export interface Standing {
  userId: string
  weeklyXp: number
  displayName: string | null
  username: string | null
  avatar: Record<string, unknown> | null
}

/**
 * The members of the caller's own cohort in that week with their public profile fields (the
 * leaderboard). Empty when the caller is not in a cohort that week. Unordered: game-rules ranks.
 */
export async function listMyCohort(tx: Tx, userId: string, weekId: number): Promise<Standing[]> {
  const rows = await tx.execute<{
    user_id: string
    weekly_xp: number
    display_name: string | null
    username: string | null
    avatar: Record<string, unknown> | null
  }>(sql`
    SELECT m.user_id, m.weekly_xp, p.display_name, p.username, p.avatar
    FROM public.league_members m
    LEFT JOIN public.public_profiles p ON p.user_id = m.user_id
    WHERE m.cohort_id = (
      SELECT me.cohort_id FROM public.league_members me WHERE me.user_id = ${userId} AND me.week_id = ${weekId}
    )`)
  return rows.map((r) => ({
    userId: r.user_id,
    weeklyXp: Number(r.weekly_xp),
    displayName: r.display_name,
    username: r.username,
    avatar: r.avatar,
  }))
}

// ------------------------------------------------------------------------------------- rollover
export interface CohortRow {
  id: number
  tier: LeagueTier
  members: { userId: string; weeklyXp: number }[]
}

/** System scope: every cohort of a week with its members (the rollover's input). */
export async function listWeekCohorts(tx: Tx, weekId: number): Promise<CohortRow[]> {
  await assertSystemScope(tx)
  const cohorts = await tx
    .select({ id: schema.leagueCohorts.id, tier: schema.leagueCohorts.tier })
    .from(schema.leagueCohorts)
    .where(eq(schema.leagueCohorts.weekId, weekId))
    .orderBy(asc(schema.leagueCohorts.id))
  const members = await tx
    .select({
      cohortId: schema.leagueMembers.cohortId,
      userId: schema.leagueMembers.userId,
      weeklyXp: schema.leagueMembers.weeklyXp,
    })
    .from(schema.leagueMembers)
    .where(eq(schema.leagueMembers.weekId, weekId))
  return cohorts.map((c) => ({
    id: c.id,
    tier: c.tier as LeagueTier,
    members: members
      .filter((m) => m.cohortId === c.id)
      .map((m) => ({ userId: m.userId, weeklyXp: m.weeklyXp })),
  }))
}

/**
 * System scope: of `userIds`, the ones whose profile still exists, each locked FOR KEY SHARE until
 * the transaction ends, so an account deleted while the rollover runs can't turn its tier and coin
 * writes into foreign-key violations (the deletion waits; a profile already gone is skipped).
 */
export async function lockLiveProfiles(tx: Tx, userIds: readonly string[]): Promise<Set<string>> {
  await assertSystemScope(tx)
  if (userIds.length === 0) return new Set()
  const rows = await tx
    .select({ userId: schema.profiles.userId })
    .from(schema.profiles)
    .where(inArray(schema.profiles.userId, [...userIds]))
    .orderBy(asc(schema.profiles.userId))
    .for('key share')
  return new Set(rows.map((r) => r.userId))
}

/**
 * System scope: the members of `weekId` who already joined a later week. Their tier comes from that
 * later week (which placed them with this week's outcome), so closing this week late must not
 * overwrite it.
 */
export async function membersWithLaterWeeks(tx: Tx, weekId: number): Promise<Set<string>> {
  await assertSystemScope(tx)
  const rows = await tx.execute<{ user_id: string }>(sql`
    SELECT DISTINCT m.user_id
    FROM public.league_members m
    JOIN public.league_weeks w ON w.id = m.week_id
    WHERE m.week_id = ${weekId}
      AND EXISTS (
        SELECT 1 FROM public.league_members later
        JOIN public.league_weeks lw ON lw.id = later.week_id
        WHERE later.user_id = m.user_id AND lw.starts_at > w.starts_at
      )`)
  return new Set(rows.map((r) => r.user_id))
}

/** System scope: stores a member's final rank and outcome. */
export async function setFinalStanding(
  tx: Tx,
  s: { cohortId: number; userId: string; rank: number; outcome: LeagueOutcome },
): Promise<void> {
  await assertSystemScope(tx)
  await tx
    .update(schema.leagueMembers)
    .set({ finalRank: s.rank, outcome: s.outcome })
    .where(
      and(eq(schema.leagueMembers.cohortId, s.cohortId), eq(schema.leagueMembers.userId, s.userId)),
    )
}
