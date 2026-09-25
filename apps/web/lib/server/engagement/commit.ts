/**
 * The P2 part of POST /api/sessions/:id/complete (ARCHITECTURE §6): league XP, quest progress with
 * auto-claim, and coin grants, inside the SAME `withUserLock` transaction as the XP ledger, and
 * only for the features whose flag is on. With every flag off this writes nothing and adds no
 * result field. Anti-cheat flagged sessions advance no league, no quest and grant no coins.
 *
 * Locks (repos.leagues): the caller holds the user lock; the shared lock on the week of `now`
 * comes before any wallet or league write; placement takes the (week, tier) lock.
 */
import type { AppConfig, SessionKind, SessionResult } from '@zaboon/contracts'
import { repos, type Tx } from '@zaboon/db'
import {
  applyCoinGrants,
  applyQuestProgress,
  leagueWeek,
  leagueXpStep,
  placeInCohort,
  type CoinGrant,
} from '@zaboon/game-rules'
import type { AuthUser } from '../auth'
import { engagementFlags, showsCoins, type Flags } from './flags'
import { rankCohort } from './leagues'
import { questDefs, questDtos, questsOfDay } from './quests'

export interface CommitInput {
  user: AuthUser
  flags: Flags
  config: AppConfig
  now: Date
  session: { kind: SessionKind }
  /** The local date the session counts for. */
  localDate: string
  /** The session's XP after the anti-cheat check (0 when flagged). */
  xp: number
  perfect: boolean
  /** Anti-cheat flagged (plausibilityFlags): nothing advances. */
  flagged: boolean
}

export type EngagementResult = Pick<SessionResult, 'coins' | 'league' | 'quests'>

export async function commitEngagement(tx: Tx, input: CommitInput): Promise<EngagementResult> {
  const f = engagementFlags(input.flags)
  if (!f.leagues && !f.quests && !showsCoins(f)) return {}
  const { user, config: cfg, now } = input
  const userId = user.id
  const at = now.toISOString()
  const week = leagueWeek(now)
  await repos.leagues.lockWeekShared(tx, week.startsAt)

  const out: EngagementResult = {}

  // --- league XP -------------------------------------------------------------------------------
  if (f.leagues && !user.isAnonymous) {
    let row = await repos.leagues.getWeek(tx, week.startsAt)
    const before = row ? await repos.leagues.getMembership(tx, userId, row.id) : null
    const tier = before?.tier ?? (await repos.leagues.getTier(tx, userId))
    const step = leagueXpStep({
      member: before ? { weeklyXp: before.weeklyXp } : null,
      linked: true,
      sessionXp: input.xp,
      flagged: input.flagged,
    })
    const rankIn = async (weekId: number) =>
      rankCohort(await repos.leagues.listMyCohort(tx, userId, weekId), tier, cfg).find(
        (r) => r.userId === userId,
      )?.rank ?? null
    const previousRank = row && before ? await rankIn(row.id) : null
    // A closed week never receives XP (the rollover closed it while this request waited).
    const open = row === null || row.closedAt === null
    if (open && step.join) {
      row = await repos.leagues.ensureWeek(tx, week)
      if (row.closedAt === null) {
        await repos.leagues.lockPlacement(tx, week.startsAt, tier)
        const cohorts = await repos.leagues.listCohorts(tx, row.id, tier)
        const placed = placeInCohort(cohorts, cfg)
        const cohortId =
          placed === null ? await repos.leagues.createCohort(tx, row.id, tier) : Number(placed)
        await repos.leagues.joinCohort(tx, userId, {
          cohortId,
          weekId: row.id,
          weeklyXp: step.weeklyXp ?? input.xp,
          at,
        })
      }
    } else if (
      open &&
      row &&
      before &&
      step.weeklyXp !== null &&
      step.weeklyXp !== before.weeklyXp
    ) {
      await repos.leagues.setWeeklyXp(tx, userId, row.id, step.weeklyXp)
    }
    const after = row ? await repos.leagues.getMembership(tx, userId, row.id) : null
    out.league = {
      tier,
      weeklyXp: after?.weeklyXp ?? 0,
      rank: row && after ? await rankIn(row.id) : null,
      previousRank,
      joinedNow: before === null && after !== null,
    }
  }

  // --- quests (auto-claim) ---------------------------------------------------------------------
  let grants: CoinGrant[] = []
  if (f.quests) {
    const daily = questsOfDay(userId, input.localDate, cfg)
    const rows = await repos.quests.listUserQuests(tx, userId, input.localDate)
    const applied = applyQuestProgress({
      date: input.localDate,
      defs: questDefs(daily),
      rows,
      session: {
        kind: input.session.kind,
        xp: input.xp,
        perfect: input.perfect,
        flagged: input.flagged,
      },
      cfg,
    })
    if (!input.flagged) {
      const changed = applied.quests.filter((q) => {
        const r = rows.find((x) => x.questId === q.questId)
        return !r || r.progress !== q.progress || r.claimed !== q.claimed
      })
      await repos.quests.saveUserQuests(
        tx,
        userId,
        input.localDate,
        changed.map((q) => ({ questId: q.questId, progress: q.progress, claimed: q.claimed })),
        at,
      )
    }
    grants = applied.grants
    const dtos = questDtos(daily, applied.quests, cfg)
    out.quests = dtos.map((d) => ({
      ...d,
      justCompleted: applied.quests.find((q) => q.questId === d.id)?.justCompleted ?? false,
    }))
  }

  // --- coins -----------------------------------------------------------------------------------
  let earned = 0
  if (grants.length > 0) {
    const ledger = await repos.wallet.listLedgerKeys(
      tx,
      userId,
      grants.map((g) => g.ref),
    )
    const { applied } = applyCoinGrants({ coins: 0, ledger }, grants)
    if (applied.length > 0) {
      const r = await repos.wallet.creditCoins(tx, userId, applied, at)
      earned = r.credited.reduce((n, g) => n + g.amount, 0)
    }
  }
  if (showsCoins(f)) out.coins = { earned, total: await repos.wallet.getCoins(tx, userId) }
  return out
}
