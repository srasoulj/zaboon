/**
 * Weekly league rollover (ARCHITECTURE §8, §10.6): GET /api/cron/league-rollover (Vercel Cron,
 * Mondays 00:00 UTC). Closes every ended week that is still open, oldest first, each in its own
 * system-scope transaction under the week's exclusive lock (taken after every commit holding the
 * shared lock has finished; the rollover takes no user locks). Per cohort, game-rules
 * `rolloverCohort` fixes each member's final rank, outcome and next tier, and `leagueGrant` their
 * coins. `closed_at` makes it idempotent: a second run, or two at once, close nothing twice.
 */
import type { AppConfig, LeagueRolloverResponse } from '@zaboon/contracts'
import { repos, withSystem, type Db } from '@zaboon/db'
import { leagueGrant, rolloverCohort, rolloverPlan, weekOf } from '@zaboon/game-rules'

type Closed = LeagueRolloverResponse['closed'][number]

async function closeWeek(
  db: Db,
  startsAt: string,
  now: Date,
  cfg: AppConfig,
): Promise<Closed | null> {
  const at = now.toISOString()
  return withSystem(db, async (tx) => {
    await repos.leagues.lockWeekExclusive(tx, startsAt)
    const week = await repos.leagues.getWeek(tx, startsAt)
    if (!week || week.closedAt !== null) return null // closed meanwhile by another run
    const bounds = weekOf(week.startsAt)
    const summary: Closed = { week: bounds, cohorts: 0, members: 0, promoted: 0, demoted: 0 }
    for (const cohort of await repos.leagues.listWeekCohorts(tx, week.id)) {
      summary.cohorts++
      for (const r of rolloverCohort(cohort.members, cohort.tier, cfg)) {
        summary.members++
        if (r.outcome === 'promote') summary.promoted++
        if (r.outcome === 'demote') summary.demoted++
        await repos.leagues.setFinalStanding(tx, {
          cohortId: cohort.id,
          userId: r.userId,
          rank: r.rank,
          outcome: r.outcome,
        })
        await repos.leagues.setTier(tx, r.userId, r.nextTier, at)
        const grant = leagueGrant(bounds, r.rank, cfg)
        if (grant) await repos.wallet.creditCoins(tx, r.userId, [grant], at)
      }
    }
    await repos.leagues.closeWeek(tx, week.id, at)
    return summary
  })
}

export async function runRollover(
  db: Db,
  now: Date,
  cfg: AppConfig,
): Promise<LeagueRolloverResponse> {
  const open = await withSystem(db, (tx) => repos.leagues.listOpenWeeks(tx))
  const plan = rolloverPlan(
    open.map((w) => ({ startsAt: w.startsAt, closedAt: w.closedAt })),
    now,
  )
  const closed: Closed[] = []
  for (const startsAt of plan.close) {
    const c = await closeWeek(db, startsAt, now, cfg)
    if (c) closed.push(c)
  }
  // Open the current week, so the first commit of the week finds it.
  await withSystem(db, (tx) => repos.leagues.ensureWeek(tx, plan.current))
  return { closed, current: plan.current }
}
