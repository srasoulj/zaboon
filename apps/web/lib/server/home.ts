/** GET /api/home read model: who the learner is and the numbers in the top bar. */
import { DEFAULT_COURSE_ID, type AppConfig, type HomeResponse } from '@zaboon/contracts'
import { repos, withUser, type Db } from '@zaboon/db'
import {
  dailyGoalStatus,
  dateInZone,
  initialLives,
  initialStreak,
  livesPolicy,
  streakView,
} from '@zaboon/game-rules'
import type { AuthUser } from './auth'
import { currentVersion } from './content'
import { ApiError } from './errors'

export async function buildHome(
  db: Db,
  user: AuthUser,
  now: Date,
  config: AppConfig,
  flags: Record<string, boolean>,
): Promise<HomeResponse> {
  const home = await withUser(db, user.id, async (tx) => {
    await repos.profiles.ensureProfile(tx, user.id)
    const profile = await repos.profiles.getProfile(tx, user.id)
    if (!profile) throw new ApiError('internal', 'profile missing')
    const pub = await repos.profiles.getPublicProfile(tx, user.id)
    const enrollments = await repos.enrollments.listEnrollments(tx, user.id)
    const active =
      [...enrollments].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
    const today = dateInZone(now, profile.timezone)
    const streak = (await repos.state.getStreak(tx, user.id)) ?? initialStreak(config)
    const lives = (await repos.state.getLives(tx, user.id)) ?? initialLives(now, config)
    const dayXp = (await repos.progress.getDailyActivity(tx, user.id, today))?.xp ?? 0
    return {
      user: {
        id: user.id,
        isAnonymous: user.isAnonymous,
        displayName: pub?.displayName ?? null,
        username: pub?.username ?? null,
        ageConfirmed: profile.ageConfirmed,
        onboarded: profile.onboarded,
      },
      courseId: active?.courseId ?? DEFAULT_COURSE_ID,
      currentLevelId: active?.currentLevelId ?? null,
      streak: streakView(streak, today),
      lives: livesPolicy(lives.policy).view(lives, now, config),
      dailyGoal: dailyGoalStatus(dayXp, profile.settings.dailyGoalXp),
      xpTotal: await repos.progress.getXpTotal(tx, user.id),
      settings: profile.settings,
    }
  })
  const cv = await currentVersion(db, home.courseId)
  const { courseId, currentLevelId, ...rest } = home
  return {
    ...rest,
    course: { id: courseId, contentVersion: cv?.version ?? 0, currentLevelId },
    flags,
  }
}
