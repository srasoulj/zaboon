/** Profile, settings and onboarding (GET/PATCH /api/profile, GET/PATCH /api/settings, POST /api/onboarding). */
import type { z } from 'zod'
import {
  DEFAULT_COURSE_ID,
  type AppConfig,
  type OnboardingRequest,
  type ProfilePatch,
  type ProfileResponse,
  type Settings,
  type SettingsPatch,
} from '@zaboon/contracts'
import { repos, withUser, withUserLock, type Db, type Tx } from '@zaboon/db'
import { dateInZone, initialStreak, streakView } from '@zaboon/game-rules'
import type { AuthUser } from './auth'
import { loadBundle, requireCurrentVersion } from './content'
import { ApiError } from './errors'
import { enrollAtCurrent } from './sessions'
import { acceptTz } from './tz'

/** Upper bound for the free-form avatar JSON (it is shown to other learners). */
const MAX_AVATAR_BYTES = 2048

interface Ctx {
  db: Db
  user: AuthUser
  now: Date
  config: AppConfig
}

function assertDailyGoal(goal: number | undefined, config: AppConfig): void {
  if (goal !== undefined && !config.dailyGoal.options.includes(goal))
    throw new ApiError(
      'validation',
      `dailyGoalXp must be one of ${config.dailyGoal.options.join(', ')}`,
    )
}

/** True for a Postgres unique violation (a race the repository's pre-check can't see). */
function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 5; i++) {
    if (typeof e === 'object' && (e as { code?: unknown }).code === '23505') return true
    e = (e as { cause?: unknown }).cause
  }
  return false
}

async function readProfile(
  tx: Tx,
  user: AuthUser,
  now: Date,
  config: AppConfig,
): Promise<ProfileResponse> {
  await repos.profiles.ensureProfile(tx, user.id)
  const profile = await repos.profiles.getProfile(tx, user.id)
  const pub = await repos.profiles.getPublicProfile(tx, user.id)
  if (!profile || !pub) throw new ApiError('internal', 'profile missing')
  const streak = (await repos.state.getStreak(tx, user.id)) ?? initialStreak(config)
  return {
    id: user.id,
    username: pub.username,
    displayName: pub.displayName,
    avatar: pub.avatar,
    isAnonymous: user.isAnonymous,
    createdAt: profile.createdAt,
    stats: {
      xpTotal: await repos.progress.getXpTotal(tx, user.id),
      // The displayed streak (0 once broken), like /api/home.
      streakCurrent: streakView(streak, dateInZone(now, profile.timezone)).current,
      streakLongest: streak.longest,
      lessonsCompleted: await repos.sessions.countCompletedSessions(tx, user.id),
    },
  }
}

export function getProfile(ctx: Ctx): Promise<ProfileResponse> {
  return withUser(ctx.db, ctx.user.id, (tx) => readProfile(tx, ctx.user, ctx.now, ctx.config))
}

export async function updateProfile(
  ctx: Ctx,
  patch: z.output<typeof ProfilePatch>,
): Promise<ProfileResponse> {
  if (patch.username !== undefined && ctx.user.isAnonymous)
    throw new ApiError('forbidden', 'create a profile before choosing a username')
  if (patch.avatar !== undefined && JSON.stringify(patch.avatar).length > MAX_AVATAR_BYTES)
    throw new ApiError('validation', `avatar must be at most ${MAX_AVATAR_BYTES} bytes of JSON`)
  try {
    return await withUserLock(ctx.db, ctx.user.id, async (tx) => {
      await repos.profiles.ensureProfile(tx, ctx.user.id)
      if (Object.keys(patch).length > 0)
        await repos.profiles.updatePublicProfile(tx, ctx.user.id, patch)
      return readProfile(tx, ctx.user, ctx.now, ctx.config)
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError('conflict', 'username is taken')
    throw err
  }
}

export function getSettings(ctx: Ctx): Promise<Settings> {
  return withUser(ctx.db, ctx.user.id, async (tx) => {
    await repos.profiles.ensureProfile(tx, ctx.user.id)
    return repos.profiles.getSettings(tx, ctx.user.id)
  })
}

export function updateSettings(ctx: Ctx, patch: z.output<typeof SettingsPatch>): Promise<Settings> {
  assertDailyGoal(patch.dailyGoalXp, ctx.config)
  return withUserLock(ctx.db, ctx.user.id, async (tx) => {
    await repos.profiles.ensureProfile(tx, ctx.user.id)
    const settings = await repos.profiles.updateSettings(tx, ctx.user.id, patch)
    if (!settings) throw new ApiError('internal', 'profile missing')
    return settings
  })
}

/**
 * POST /api/onboarding: 13+ confirmation (the contract requires `ageConfirmed: true`), reason,
 * self-assessed level and daily goal into settings, the browser timezone, and an enrollment in the
 * default course at its current version. Replaying it is harmless.
 */
export async function onboard(ctx: Ctx, input: z.output<typeof OnboardingRequest>): Promise<void> {
  assertDailyGoal(input.dailyGoalXp, ctx.config)
  const bundle = await loadBundle(await requireCurrentVersion(ctx.db, DEFAULT_COURSE_ID))
  await withUserLock(ctx.db, ctx.user.id, async (tx) => {
    await acceptTz(tx, ctx.user.id, input.tz, ctx.now, ctx.config)
    await repos.profiles.updateSettings(tx, ctx.user.id, {
      reason: input.reason,
      selfLevel: input.selfLevel,
      dailyGoalXp: input.dailyGoalXp,
    })
    await repos.profiles.updateProfile(tx, ctx.user.id, { ageConfirmed: true, onboarded: true })
    await enrollAtCurrent(tx, ctx.user.id, bundle)
    await repos.enrollments.updateEnrollment(tx, ctx.user.id, bundle.courseId, {}) // active course
  })
}
