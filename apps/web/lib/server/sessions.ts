/**
 * Lesson sessions: create (generate from the immutable bundle) and complete (re-grade, then apply
 * the game rules in one locked transaction). Walking-skeleton scope: lessons only; ws-api adds
 * practice/letters/review kinds, level locking, hearts events, SRS updates and anti-cheat checks.
 */
import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import {
  PASSING_VERDICTS,
  SessionResult,
  type AppConfig,
  type ChallengeRef,
  type CompleteSessionRequest,
  type CreateSessionResponse,
  type LivesState,
  type Verdict,
} from '@zaboon/contracts'
import { itemRef } from '@zaboon/content-schema'
import { repos, withUserLock, type Db, type Tx } from '@zaboon/db'
import {
  acceptTzChange,
  applyActivity,
  dailyGoalStatus,
  dateInZone,
  initialLives,
  initialStreak,
  livesPolicy,
  localDateFor,
  streakView,
  xpFor,
} from '@zaboon/game-rules'
import { GRADER_VERSION } from '@zaboon/grader'
import { generateSession, rebuildChallenges } from '@zaboon/session-engine'
import type { AuthUser } from './auth'
import { contentView, findLevel, loadBundle, requireCurrentVersion, versionOf } from './content'
import { ApiError } from './errors'
import { regrade } from './regrade'

interface Ctx {
  db: Db
  user: AuthUser
  now: Date
  config: AppConfig
}

async function livesState(
  tx: Tx,
  userId: string,
  now: Date,
  config: AppConfig,
): Promise<LivesState> {
  return (await repos.state.getLives(tx, userId)) ?? initialLives(now, config)
}

/** The learner's timezone after (maybe) accepting the browser's, rate-limited by AppConfig.tz. */
async function acceptTz(
  tx: Tx,
  userId: string,
  requested: string,
  now: Date,
  config: AppConfig,
): Promise<string> {
  await repos.profiles.ensureProfile(tx, userId)
  const profile = await repos.profiles.getProfile(tx, userId)
  if (!profile) throw new ApiError('internal', 'profile missing')
  if (!isValidTimeZone(requested)) return profile.timezone
  const tzChangedAt = profile.tzChangedAt ? new Date(profile.tzChangedAt) : null
  const r = acceptTzChange({ tz: profile.timezone, tzChangedAt }, requested, now, config)
  if (r.changed)
    await repos.profiles.updateProfile(tx, userId, {
      timezone: r.tz,
      tzChangedAt: now.toISOString(),
    })
  return r.tz
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export async function createSession(
  ctx: Ctx,
  input: { courseId: string; kind: string; levelId?: string | undefined; tz: string },
): Promise<CreateSessionResponse> {
  if (input.kind !== 'lesson')
    throw new ApiError('validation', `session kind ${input.kind} is not available yet`)
  if (!input.levelId) throw new ApiError('validation', 'levelId is required for lessons')
  const levelId = input.levelId
  const cv = await requireCurrentVersion(ctx.db, input.courseId)
  const bundle = await loadBundle(cv)
  const loc = findLevel(bundle, levelId)
  if (!loc || loc.level.kind !== 'lesson')
    throw new ApiError('not_found', `unknown lesson level ${levelId}`)

  return withUserLock(ctx.db, ctx.user.id, async (tx) => {
    const { now, config } = ctx
    const tz = await acceptTz(tx, ctx.user.id, input.tz, now, config)
    await repos.enrollments.ensureEnrollment(tx, ctx.user.id, {
      courseId: cv.courseId,
      contentVersion: cv.version,
    })
    const lives = await livesState(tx, ctx.user.id, now, config)
    const livesView = livesPolicy(lives.policy).view(lives, now, config)
    if (livesView.count === 0) throw new ApiError('out_of_lives', 'no hearts left')

    const progress = await repos.learning.getLevelProgress(tx, ctx.user.id, cv.courseId, levelId)
    const lessonIndex = Math.min(progress?.lessonsDone ?? 0, loc.level.lessons - 1)
    const seed = randomUUID()
    const view = contentView(bundle, loc.unitIndex)
    const generated = generateSession({
      content: view,
      kind: 'lesson',
      levelId,
      lessonIndex,
      learner: { lexemeCards: {}, letterCards: {}, mistakes: [], exposures: {} },
      seed,
      now,
      config,
    })
    const expiresAt = new Date(now.getTime() + config.session.ttlHours * 3_600_000)
    const session = await repos.sessions.createSession(tx, ctx.user.id, {
      courseId: cv.courseId,
      levelId,
      lessonIndex,
      kind: 'lesson',
      contentVersion: cv.version,
      seed,
      challengeRefs: generated.refs,
      tz,
      startedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      graderVersion: GRADER_VERSION,
    })
    return {
      sessionId: session.id,
      contentVersion: cv.version,
      kind: 'lesson',
      levelId,
      expiresAt: expiresAt.toISOString(),
      challenges: generated.challenges,
      lives: livesView,
      graderVersion: GRADER_VERSION,
    }
  })
}

function refItems(ref: ChallengeRef): string[] {
  const out: string[] = []
  for (const id of ref.items) {
    if (id.startsWith('lx_')) out.push(itemRef('lexeme', id))
    else if (id.startsWith('s_')) out.push(itemRef('sentence', id))
    else if (id.startsWith('l_')) out.push(itemRef('letter', id))
    else if (id.startsWith('c_')) out.push(itemRef('chat', id))
  }
  return out
}

const passes = (v: Verdict) => PASSING_VERDICTS.includes(v)

export async function completeSession(
  ctx: Ctx,
  sessionId: string,
  input: z.output<typeof CompleteSessionRequest>,
): Promise<SessionResult> {
  const { db, now, config } = ctx
  const userId = ctx.user.id
  return withUserLock(db, userId, async (tx) => {
    const session = await repos.sessions.getSessionForUpdate(tx, userId, sessionId)
    if (!session) throw new ApiError('not_found', 'session not found')
    if (session.status === 'completed') return SessionResult.parse(session.result) // idempotent replay
    if (session.status === 'expired' || now.getTime() > new Date(session.expiresAt).getTime()) {
      await repos.sessions.expireSession(tx, userId, sessionId)
      throw new ApiError('gone', 'session expired')
    }

    const cv = await versionOf(db, session.courseId, session.contentVersion)
    const bundle = await loadBundle(cv)
    const loc = session.levelId ? findLevel(bundle, session.levelId) : null
    const challenges = rebuildChallenges(
      session.challengeRefs,
      contentView(bundle, loc?.unitIndex ?? null),
    )

    // --- validate and re-grade ---------------------------------------------------------------
    const seqs = new Set<number>()
    for (const a of input.answers) {
      if (a.index >= challenges.length)
        throw new ApiError('validation', `answer for unknown challenge ${a.index}`)
      if (seqs.has(a.attemptSeq))
        throw new ApiError('validation', `duplicate attemptSeq ${a.attemptSeq}`)
      seqs.add(a.attemptSeq)
    }
    const answered = new Set(input.answers.map((a) => a.index))
    if (answered.size !== challenges.length)
      throw new ApiError('validation', 'every challenge needs an answer')

    const trustClient =
      input.graderVersion > GRADER_VERSION - config.graderWindow &&
      input.graderVersion <= GRADER_VERSION
    let graderMismatches = 0
    const graded = [...input.answers]
      .sort((a, b) => a.attemptSeq - b.attemptSeq)
      .map((a) => {
        const server = regrade(challenges[a.index]!, a.response)
        if (passes(server) !== passes(a.verdict)) graderMismatches++
        return { ...a, verdict: trustClient ? a.verdict : server }
      })
    const first = new Map<number, Verdict>()
    for (const a of graded) if (!first.has(a.index)) first.set(a.index, a.verdict)
    const firstPass = [...first.values()].filter(passes).length
    const wrongIndexes = new Set(graded.filter((a) => a.verdict === 'wrong').map((a) => a.index))
    const perfect = wrongIndexes.size === 0
    const accuracy = challenges.length === 0 ? 0 : firstPass / challenges.length

    // --- rules -------------------------------------------------------------------------------
    const completedAt = new Date(input.completedAt)
    const startedAt = new Date(session.startedAt)
    const localDate = localDateFor({ completedAt, startedAt, now, tz: session.tz })
    const today = dateInZone(now, session.tz)
    const xp = xpFor(session.kind, perfect, config)
    const at = now.toISOString()
    await repos.progress.appendXp(tx, userId, {
      amount: xp.base,
      reason: session.kind,
      sessionId,
      occurredAt: at,
      localDate,
    })
    if (xp.bonus > 0) {
      await repos.progress.appendXp(tx, userId, {
        amount: xp.bonus,
        reason: 'perfect_bonus',
        sessionId,
        occurredAt: at,
        localDate,
      })
    }
    await repos.enrollments.addEnrollmentXp(tx, userId, session.courseId, xp.total)

    const settings = await repos.profiles.getSettings(tx, userId)
    const before = (await repos.progress.getDailyActivity(tx, userId, localDate))?.xp ?? 0
    const goal = dailyGoalStatus(before + xp.total, settings.dailyGoalXp)
    await repos.progress.addDailyActivity(tx, userId, {
      localDate,
      xp: xp.total,
      goalMet: goal.met,
    })

    const streak = applyActivity(
      (await repos.state.getStreak(tx, userId)) ?? initialStreak(config),
      localDate,
      config,
    )
    await repos.state.saveStreak(tx, userId, streak.state)
    await repos.progress.markFreezeUsed(tx, userId, streak.frozenDates)

    const lives = await livesState(tx, userId, now, config)
    const livesView = livesPolicy(lives.policy).view(lives, now, config)

    let level: SessionResult['level'] = null
    if (session.levelId && loc) {
      const p = await repos.learning.recordLessonDone(tx, userId, {
        courseId: session.courseId,
        levelId: session.levelId,
        lessonsTotal: loc.level.lessons,
        at,
      })
      level = {
        levelId: session.levelId,
        lessonsDone: p.lessonsDone,
        lessonsTotal: loc.level.lessons,
        completed: p.completedAt !== null,
      }
    }

    const mistakes = [...new Set([...wrongIndexes].flatMap((i) => refItems(challenges[i]!.ref)))]
    const cleared = [
      ...new Set(
        [...first.keys()]
          .filter((i) => !wrongIndexes.has(i))
          .flatMap((i) => refItems(challenges[i]!.ref)),
      ),
    ]
    await repos.learning.recordMistakes(tx, userId, mistakes, at)
    await repos.learning.resolveMistakes(tx, userId, cleared, at)
    await repos.sessions.insertSessionAnswers(
      tx,
      userId,
      sessionId,
      graded.map((a) => ({
        idx: a.index,
        attemptSeq: a.attemptSeq,
        challengeType: challenges[a.index]!.type,
        itemRefs: refItems(challenges[a.index]!.ref),
        response: a.response,
        verdict: a.verdict,
        ms: a.ms,
        hinted: a.hinted,
      })),
    )

    const result = SessionResult.parse({
      sessionId,
      kind: session.kind,
      contentVersion: session.contentVersion,
      localDate,
      xp,
      accuracy,
      perfect,
      durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
      streak: {
        ...streakView(streak.state, today),
        extendedToday: streak.extendedToday,
        freezeGranted: streak.freezeGranted,
        frozenDates: streak.frozenDates,
      },
      lives: livesView,
      dailyGoal: { ...goal, justMet: goal.met && before < settings.dailyGoalXp },
      level,
      mistakes,
      graderMismatches,
    })
    const stored = await repos.sessions.completeSession(tx, userId, sessionId, {
      result,
      completedAt: at,
    })
    if (!stored) throw new ApiError('conflict', 'session was completed concurrently')
    return result
  })
}
