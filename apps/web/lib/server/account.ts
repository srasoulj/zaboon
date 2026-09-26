/**
 * Account operations: guest → member merge (§10.3), GDPR export and delete (§12).
 */
import type { AppConfig } from '@zaboon/contracts'
import { repos, withSystem, withUser, withUserLock, type Db, type Tx } from '@zaboon/db'
import { dateInZone, replayStreak } from '@zaboon/game-rules'
import { verifyAccessToken, type AuthUser } from './auth'
import { authAdmin } from './auth/admin'
import { currentVersion, loadBundle } from './content'
import { ApiError } from './errors'
import { currentOf, migrateEnrollment, pathStates } from './path'

interface Ctx {
  db: Db
  user: AuthUser
  now: Date
  config: AppConfig
}

/** Brings every enrollment of the user to its course's current content version. */
async function migrateAllEnrollments(db: Db, userId: string): Promise<void> {
  const enrollments = await withUser(db, userId, (tx) =>
    repos.enrollments.listEnrollments(tx, userId),
  )
  for (const e of enrollments) {
    const cv = await currentVersion(db, e.courseId)
    if (!cv || e.contentVersion >= cv.version) continue
    const bundle = await loadBundle(cv)
    await withUserLock(db, userId, (tx) => migrateEnrollment(tx, userId, bundle))
  }
}

/**
 * Rebuilds what the repository merge can't: the streak from the merged days (game-rules is the one
 * implementation of streak math), the public stats, and each enrollment's current level from the
 * merged progress (the repository keeps the member's). Deterministic, so running it again is safe.
 */
async function rebuildMemberState(tx: Tx, memberId: string, config: AppConfig): Promise<void> {
  const days = await repos.progress.listDailyActivity(tx, memberId)
  // Freezes bought with coins (the member's own and the guest's, whose purchases moved over in the
  // merge) are replayed on the local date they were bought, so a merge never drops them. With no
  // purchases this is exactly the plain replay of the active days.
  const tz = (await repos.profiles.getProfile(tx, memberId))?.timezone ?? 'UTC'
  const bought = (await repos.wallet.listPurchaseTimes(tx, memberId, 'streak_freeze')).map((t) =>
    dateInZone(new Date(t), tz),
  )
  const { state, frozenDates: frozen } = replayStreak(
    days.filter((d) => d.sessions > 0).map((d) => d.localDate),
    bought,
    config,
  )
  await repos.state.saveStreak(tx, memberId, state)
  await repos.progress.markFreezeUsed(tx, memberId, frozen)
  await repos.profiles.syncPublicStats(tx, memberId, {
    xpTotal: await repos.progress.getXpTotal(tx, memberId),
    streakCurrent: state.current,
  })
  for (const e of await repos.enrollments.listEnrollments(tx, memberId)) {
    const cv = await currentVersion(tx, e.courseId)
    if (!cv || e.contentVersion !== cv.version) continue
    const { states } = await pathStates(tx, memberId, await loadBundle(cv))
    await repos.enrollments.updateEnrollment(tx, memberId, e.courseId, {
      currentLevelId: currentOf(states),
    })
  }
}

/**
 * POST /api/account/merge. The caller (a linked member) proves they also hold the guest session by
 * sending its access token. Both learners are brought to the current content version first (the
 * repository merge unions level_progress by level id); then, in ONE transaction, everything of the
 * guest's moves into the member and the member's derived state is rebuilt; finally the guest's
 * auth user is deleted.
 * Idempotent and retryable: a replay reports `merged: false` but still rebuilds the member's state
 * and deletes the guest's auth user, so a request that failed after the commit completes on retry.
 */
export async function mergeAccounts(ctx: Ctx, guestToken: string): Promise<{ merged: boolean }> {
  const guest = await verifyAccessToken(guestToken)
  if (!guest.isAnonymous) throw new ApiError('forbidden', 'only a guest account can be merged')
  if (guest.id === ctx.user.id)
    throw new ApiError('validation', 'cannot merge an account into itself')

  await migrateAllEnrollments(ctx.db, guest.id)
  await migrateAllEnrollments(ctx.db, ctx.user.id)
  const summary = await withSystem(ctx.db, async (tx) => {
    const r = await repos.merge.mergeGuestIntoMember(tx, {
      guestId: guest.id,
      memberId: ctx.user.id,
    })
    await rebuildMemberState(tx, ctx.user.id, ctx.config)
    return r
  })
  await authAdmin().deleteUser(guest.id)
  if (summary.merged)
    console.info('[account] merged guest into member', { memberId: ctx.user.id, ...summary })
  return { merged: summary.merged }
}

/** GET /api/account/export: every row we hold about the caller. */
export async function exportAccount(ctx: Ctx): Promise<Record<string, unknown>> {
  const tables = await withUser(ctx.db, ctx.user.id, (tx) =>
    repos.account.exportAccount(tx, ctx.user.id),
  )
  return {
    exportedAt: ctx.now.toISOString(),
    user: { id: ctx.user.id, isAnonymous: ctx.user.isAnonymous, email: ctx.user.email },
    tables,
  }
}

/**
 * DELETE /api/account: removes the learner's rows (profile cascade) and then the auth user. Safe to
 * replay: a second call finds nothing left and still answers `deleted: true`.
 */
export async function deleteAccount(ctx: Ctx): Promise<{ deleted: true }> {
  await withUserLock(ctx.db, ctx.user.id, (tx) => repos.account.deleteAccount(tx, ctx.user.id))
  await authAdmin().deleteUser(ctx.user.id)
  return { deleted: true }
}
