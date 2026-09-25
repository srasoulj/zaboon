/**
 * Account operations: guest → member merge (§10.3), GDPR export and delete (§12).
 */
import type { AppConfig } from '@zaboon/contracts'
import { repos, withSystem, withUser, withUserLock, type Db } from '@zaboon/db'
import { applyActivity, initialStreak } from '@zaboon/game-rules'
import { verifyAccessToken, type AuthUser } from './auth'
import { authAdmin } from './auth/admin'
import { currentVersion, loadBundle } from './content'
import { ApiError } from './errors'
import { migrateEnrollment } from './path'

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
 * POST /api/account/merge. The caller (a linked member) proves they also hold the guest session by
 * sending its access token. Both learners are brought to the current content version first (the
 * repository merge unions level_progress by level id), then everything of the guest's moves into
 * the member, the streak is recomputed from the merged days, and the guest's auth user is deleted.
 * Idempotent: once the guest is gone, a replay reports `merged: false`.
 */
export async function mergeAccounts(ctx: Ctx, guestToken: string): Promise<{ merged: boolean }> {
  const guest = await verifyAccessToken(guestToken)
  if (!guest.isAnonymous) throw new ApiError('forbidden', 'only a guest account can be merged')
  if (guest.id === ctx.user.id)
    throw new ApiError('validation', 'cannot merge an account into itself')

  await migrateAllEnrollments(ctx.db, guest.id)
  await migrateAllEnrollments(ctx.db, ctx.user.id)
  const summary = await withSystem(ctx.db, (tx) =>
    repos.merge.mergeGuestIntoMember(tx, { guestId: guest.id, memberId: ctx.user.id }),
  )
  if (!summary.merged) return { merged: false }

  // The merge takes each streak field's max; the real streak follows from the merged days.
  await withUserLock(ctx.db, ctx.user.id, async (tx) => {
    const days = await repos.progress.listDailyActivity(tx, ctx.user.id)
    let state = initialStreak(ctx.config)
    const frozen: string[] = []
    for (const d of days) {
      if (d.sessions === 0) continue
      const r = applyActivity(state, d.localDate, ctx.config)
      state = r.state
      frozen.push(...r.frozenDates)
    }
    await repos.state.saveStreak(tx, ctx.user.id, state)
    await repos.progress.markFreezeUsed(tx, ctx.user.id, frozen)
    await repos.profiles.syncPublicStats(tx, ctx.user.id, {
      xpTotal: await repos.progress.getXpTotal(tx, ctx.user.id),
      streakCurrent: state.current,
    })
  })
  await authAdmin().deleteUser(guest.id)
  console.info('[account] merged guest into member', { memberId: ctx.user.id, ...summary })
  return { merged: true }
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
