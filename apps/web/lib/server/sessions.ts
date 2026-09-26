/**
 * Sessions (ARCHITECTURE §3.2, §6): create (generate from the immutable bundle), wrong-attempt
 * events (hearts), and complete (re-grade, then apply every game rule in one locked transaction).
 *
 * Kinds in the MVP: lesson, practice, letters, unit_review. Level locking follows path.ts; hearts
 * are spent per wrong-attempt event and reconciled at commit; practice never costs hearts and earns
 * one back. The client's XP is never trusted: XP comes from the server's own count of wrong
 * attempts, and implausible sessions (anticheat.ts) earn none.
 */
import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import {
  PASSING_VERDICTS,
  SessionResult,
  type AppConfig,
  type Challenge,
  type ChallengeRef,
  type ChallengeResponse,
  type CompleteSessionRequest,
  type CreateSessionResponse,
  type LivesState,
  type LivesView,
  type PracticeMode,
  type SessionKind,
  type Verdict,
} from '@zaboon/contracts'
import { itemRef } from '@zaboon/content-schema'
import { repos, withUserLock, type Db, type Tx } from '@zaboon/db'
import {
  applyActivity,
  applyMistakeEvent,
  clampActivityTime,
  dailyGoalStep,
  dateInZone,
  initialLives,
  initialStreak,
  livesPolicy,
  sessionXp,
  settleCommit,
  streakView,
} from '@zaboon/game-rules'
import { GRADER_VERSION } from '@zaboon/grader'
import {
  ContentError,
  generateSession,
  NotImplementedError,
  rebuildChallenges,
  type SessionFeatures,
} from '@zaboon/session-engine'
import { plausibilityFlags } from './anticheat'
import type { AuthUser } from './auth'
import {
  contentView,
  findLevel,
  loadBundle,
  requireCurrentVersion,
  versionOf,
  type LoadedBundle,
} from './content'
import { ApiError } from './errors'
import { gradingLexicon, serverVerdict } from './grading'
import { verifySpeechToken } from './speech/token'
import { commitEngagement } from './engagement/commit'
import { applySrs, loadLearnerState } from './learner'
import {
  currentOf,
  letterLessonStates,
  migrateEnrollment,
  migrateLevelId,
  migrationSteps,
  pathStates,
  progressMap,
} from './path'
import { acceptTz } from './tz'

export interface Ctx {
  db: Db
  user: AuthUser
  now: Date
  config: AppConfig
  /** The request's feature flags (ctx.flags); absent = every Wave 3 feature off. */
  flags?: Readonly<Record<string, boolean>>
}

/**
 * P2 session-engine features from the request's flags (each off unless its flag is on). Speak is
 * also off while the learner's "Can't speak now" pause runs (`speakPaused` from the device).
 * `speak` is present only when on (absent = off for the engine).
 */
export function sessionFeatures(
  flags: Readonly<Record<string, boolean>> = {},
  opts: { speakPaused?: boolean | undefined } = {},
): SessionFeatures {
  return {
    persianTyping: flags.persianKeyboard === true,
    letterTrace: flags.letterTrace === true,
    ...(flags.speak === true && opts.speakPaused !== true ? { speak: true } : {}),
  }
}

/** Session kinds this server can generate. legendary and jump_test are P2. */
const MVP_KINDS: ReadonlySet<SessionKind> = new Set([
  'lesson',
  'practice',
  'letters',
  'unit_review',
])

async function livesState(
  tx: Tx,
  userId: string,
  now: Date,
  config: AppConfig,
): Promise<LivesState> {
  return (await repos.state.getLives(tx, userId)) ?? initialLives(now, config)
}

const livesViewOf = (lives: LivesState, now: Date, config: AppConfig): LivesView =>
  livesPolicy(lives.policy).view(lives, now, config)

/**
 * Brings the learner's enrollment in the bundle's course to its version (creating it if missing)
 * and returns the path states at that version.
 */
export async function enrollAtCurrent(tx: Tx, userId: string, bundle: LoadedBundle) {
  await repos.enrollments.ensureEnrollment(tx, userId, {
    courseId: bundle.courseId,
    contentVersion: bundle.version,
  })
  const enrollment = await migrateEnrollment(tx, userId, bundle)
  const path = await pathStates(tx, userId, bundle)
  const current = currentOf(path.states)
  if (enrollment && enrollment.currentLevelId === null && current !== null)
    await repos.enrollments.updateEnrollment(tx, userId, bundle.courseId, {
      currentLevelId: current,
    })
  return path
}

interface Target {
  /** Stored with the session: the level (or letter lesson) the session counts for. */
  levelId: string | null
  /** What the engine gets as `levelId`. */
  engineLevelId: string | null
  /** The unit whose content the session may use (null: letters only). */
  unitIndex: number | null
  lessonIndex: number
}

async function resolveTarget(
  tx: Tx,
  userId: string,
  bundle: LoadedBundle,
  kind: SessionKind,
  requested: string | undefined,
): Promise<Target> {
  const { levels, states } = await pathStates(tx, userId, bundle)

  if (kind === 'letters') {
    const progress = progressMap(
      await repos.learning.listLevelProgress(tx, userId, bundle.courseId),
    )
    const letterStates = letterLessonStates(bundle, progress)
    const levelId = requested ?? currentOf(letterStates)
    if (levelId !== null) {
      const st = letterStates.get(levelId)
      if (!st) throw new ApiError('not_found', `unknown letters lesson ${levelId}`)
      if (st.state === 'locked')
        throw new ApiError('forbidden', `letters lesson ${levelId} is locked`)
    }
    return { levelId, engineLevelId: levelId, unitIndex: null, lessonIndex: 0 }
  }

  if (kind === 'practice') {
    // Practice may be scoped to any unlocked level; by default the learner's current one.
    const levelId = requested ?? currentOf(states) ?? levels.at(-1)?.id ?? null
    if (levelId === null) throw new ApiError('not_found', 'the course has no levels')
    const loc = findLevel(bundle, levelId)
    if (!loc) throw new ApiError('not_found', `unknown level ${levelId}`)
    if (states.get(levelId)?.state === 'locked')
      throw new ApiError('forbidden', `level ${levelId} is locked`)
    return { levelId, engineLevelId: null, unitIndex: loc.unitIndex, lessonIndex: 0 }
  }

  // lesson | unit_review: a level of that kind
  if (!requested) throw new ApiError('validation', `levelId is required for ${kind} sessions`)
  const loc = findLevel(bundle, requested)
  if (!loc) throw new ApiError('not_found', `unknown level ${requested}`)
  if (loc.level.kind !== kind)
    throw new ApiError('validation', `level ${requested} is a ${loc.level.kind}, not a ${kind}`)
  const st = states.get(requested)
  if (!st || st.state === 'locked') throw new ApiError('forbidden', `level ${requested} is locked`)
  return {
    levelId: requested,
    engineLevelId: requested,
    unitIndex: loc.unitIndex,
    lessonIndex: Math.min(st.lessonsDone, loc.level.lessons - 1),
  }
}

export async function createSession(
  ctx: Ctx,
  input: {
    courseId: string
    kind: SessionKind
    levelId?: string | undefined
    tz: string
    /** Practice sessions only (the contract enforces it); used while flags.practiceHub is on. */
    mode?: PracticeMode | undefined
    /** P2 speak: the learner's "Can't speak now" pause runs, so no speak challenges. */
    speakPaused?: boolean | undefined
  },
): Promise<CreateSessionResponse> {
  if (!MVP_KINDS.has(input.kind))
    throw new ApiError('validation', `session kind ${input.kind} is not available yet`)
  const cv = await requireCurrentVersion(ctx.db, input.courseId)
  const bundle = await loadBundle(cv)
  const { now, config } = ctx
  const userId = ctx.user.id

  return withUserLock(ctx.db, userId, async (tx) => {
    const tz = await acceptTz(tx, userId, input.tz, now, config)
    await enrollAtCurrent(tx, userId, bundle)
    const lives = await livesState(tx, userId, now, config)
    const livesView = livesViewOf(lives, now, config)
    if (input.kind !== 'practice' && livesView.count === 0)
      throw new ApiError('out_of_lives', 'no hearts left')

    const target = await resolveTarget(tx, userId, bundle, input.kind, input.levelId)
    const seed = randomUUID()
    let generated: ReturnType<typeof generateSession>
    try {
      generated = generateSession({
        content: contentView(bundle, target.unitIndex),
        kind: input.kind,
        levelId: target.engineLevelId,
        lessonIndex: target.lessonIndex,
        learner: await loadLearnerState(tx, userId),
        seed,
        now,
        config,
        features: sessionFeatures(ctx.flags, { speakPaused: input.speakPaused }),
        ...(input.mode && ctx.flags?.practiceHub === true ? { practiceMode: input.mode } : {}),
      })
    } catch (e) {
      if (e instanceof ContentError) throw new ApiError('validation', e.message)
      // A level that pins a Wave 3 challenge type whose builder hasn't landed yet: a clear 400.
      if (e instanceof NotImplementedError)
        throw new ApiError('validation', `this level is not available yet (${e.message})`)
      throw e
    }
    const expiresAt = new Date(now.getTime() + config.session.ttlHours * 3_600_000)
    const session = await repos.sessions.createSession(tx, userId, {
      courseId: cv.courseId,
      levelId: target.levelId,
      lessonIndex: target.lessonIndex,
      kind: input.kind,
      contentVersion: cv.version,
      seed,
      challengeRefs: generated.refs,
      tz,
      startedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      graderVersion: GRADER_VERSION,
    })
    // "Most recently used" enrollment = the active course (GET /api/home).
    await repos.enrollments.updateEnrollment(tx, userId, cv.courseId, {})
    return {
      sessionId: session.id,
      contentVersion: cv.version,
      kind: input.kind,
      levelId: target.levelId,
      expiresAt: expiresAt.toISOString(),
      challenges: generated.challenges,
      lives: livesView,
      graderVersion: GRADER_VERSION,
    }
  })
}

/** Returned from a transaction that marked a session expired (a throw would roll that back). */
const EXPIRED = Symbol('expired')

/** A started, unexpired session of the caller's, locked for this transaction. */
async function openSession(tx: Tx, userId: string, sessionId: string, now: Date) {
  const session = await repos.sessions.getSessionForUpdate(tx, userId, sessionId)
  if (!session) throw new ApiError('not_found', 'session not found')
  return {
    session,
    expired:
      session.status === 'expired' ||
      (session.status === 'started' && now.getTime() > new Date(session.expiresAt).getTime()),
  }
}

/** POST /api/sessions/:id/events: one wrong attempt, idempotent on (session, attemptSeq). */
export async function recordWrongAttempt(
  ctx: Ctx,
  sessionId: string,
  input: { attemptSeq: number; index: number; kind: 'wrong' },
): Promise<{ lives: LivesView; duplicate: boolean }> {
  const { now, config } = ctx
  const userId = ctx.user.id
  const out = await withUserLock(ctx.db, userId, async (tx) => {
    const { session, expired } = await openSession(tx, userId, sessionId, now)
    if (session.status === 'completed')
      throw new ApiError('conflict', 'session is already completed')
    if (expired) {
      await repos.sessions.expireSession(tx, userId, sessionId)
      return EXPIRED // commit the expiry, then answer 410
    }
    if (input.index >= session.challengeRefs.length)
      throw new ApiError('validation', `unknown challenge ${input.index}`)
    const { duplicate } = await repos.sessions.recordSessionEvent(tx, userId, {
      sessionId,
      attemptSeq: input.attemptSeq,
      challengeIndex: input.index,
      kind: input.kind,
      createdAt: now.toISOString(),
    })
    let lives = await livesState(tx, userId, now, config)
    if (!duplicate) {
      // The insert above already decided "duplicate", so nothing else is recorded yet.
      lives = applyMistakeEvent({
        state: lives,
        kind: session.kind,
        sessionId,
        attemptSeq: input.attemptSeq,
        recorded: new Set(),
        now,
        cfg: config,
      }).state
      await repos.state.saveLives(tx, userId, lives)
    }
    return { lives: livesViewOf(lives, now, config), duplicate }
  })
  if (out === EXPIRED) throw new ApiError('gone', 'session expired')
  return out
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

/**
 * A response the learner declined ("Can't trace now" / "Can't speak now"): graded, never rated.
 */
export const isDeclined = (r: ChallengeResponse): boolean =>
  (r.kind === 'trace' || r.kind === 'audio') && r.declined === true

/**
 * P2 speak: whether a response to a speak challenge may be graded at all. A skip is a skip, and a
 * declined answer is graded as declined; anything else needs an audio transcript whose signed
 * token (POST /api/speech/transcribe) verifies for this user, session, index and transcript.
 * Without one the server verdict is `wrong`, even inside the grader trust window.
 */
export function speechVerified(
  challenge: Challenge,
  response: ChallengeResponse,
  bound: { userId: string; sessionId: string; index: number },
  now: Date,
): boolean {
  if (challenge.type !== 'speak') return true
  if (response.kind === 'skip') return true
  if (response.kind !== 'audio') return false
  if (response.declined === true) return true
  return verifySpeechToken(response.token, { ...bound, transcript: response.transcript }, now)
}

/** The response as stored with the answer: a speech token is a credential, never kept. */
export function storableResponse(r: ChallengeResponse): ChallengeResponse {
  if (r.kind !== 'audio' || r.token === undefined) return r
  const { token: _token, ...rest } = r
  return rest
}

/**
 * Records one finished lesson of the session's level, if the level still exists at the current
 * content version (its id mapped through the path migrations) and matches the session kind.
 */
async function recordLevelProgress(
  tx: Tx,
  userId: string,
  session: repos.sessions.Session,
  current: LoadedBundle,
  at: string,
): Promise<SessionResult['level']> {
  if (!session.levelId) return null
  const steps = migrationSteps(current.manifest, session.contentVersion, current.version)
  const levelId = migrateLevelId(steps, session.levelId)
  if (levelId === null) return null
  let lessonsTotal: number
  if (session.kind === 'letters') {
    if (!current.letters.track.lessons.some((l) => l.id === levelId)) return null
    lessonsTotal = 1
  } else {
    const loc = findLevel(current, levelId)
    if (!loc || loc.level.kind !== session.kind) return null
    lessonsTotal = loc.level.lessons
  }
  const p = await repos.learning.recordLessonDone(tx, userId, {
    courseId: session.courseId,
    levelId,
    lessonsTotal,
    at,
  })
  return { levelId, lessonsDone: p.lessonsDone, lessonsTotal, completed: p.completedAt !== null }
}

export async function completeSession(
  ctx: Ctx,
  sessionId: string,
  input: z.output<typeof CompleteSessionRequest>,
): Promise<SessionResult> {
  const { db, now, config } = ctx
  const userId = ctx.user.id
  const out = await withUserLock(db, userId, async (tx) => {
    const { session, expired } = await openSession(tx, userId, sessionId, now)
    if (session.status === 'completed') return SessionResult.parse(session.result) // idempotent replay
    if (expired) {
      await repos.sessions.expireSession(tx, userId, sessionId)
      return EXPIRED // commit the expiry, then answer 410
    }

    const bundle = await loadBundle(await versionOf(tx, session.courseId, session.contentVersion))
    const loc = session.levelId ? findLevel(bundle, session.levelId) : null
    const view = contentView(bundle, loc?.unitIndex ?? null)
    const challenges = rebuildChallenges(session.challengeRefs, view)

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

    // The learner's verdict stands within the supported grader window (LEARNING-ENGINE §7.3).
    const trustClient =
      input.graderVersion > GRADER_VERSION - config.graderWindow &&
      input.graderVersion <= GRADER_VERSION
    const lexicon = gradingLexicon(view)
    let graderMismatches = 0
    const graded = [...input.answers]
      .sort((a, b) => a.attemptSeq - b.attemptSeq)
      .map((a) => {
        const challenge = challenges[a.index]!
        const verified = speechVerified(
          challenge,
          a.response,
          { userId, sessionId, index: a.index },
          now,
        )
        const server = verified ? serverVerdict(challenge, a.response, lexicon) : 'wrong'
        if (passes(server) !== passes(a.verdict)) graderMismatches++
        return {
          ...a,
          response: storableResponse(a.response),
          verdict: trustClient && verified ? a.verdict : server,
        }
      })
    if (graderMismatches > 0)
      console.warn('[grader] client/server verdict mismatch', {
        sessionId,
        graderMismatches,
        clientGraderVersion: input.graderVersion,
        serverGraderVersion: GRADER_VERSION,
      })
    const first = new Map<number, Verdict>()
    for (const a of graded) if (!first.has(a.index)) first.set(a.index, a.verdict)
    const firstPass = [...first.values()].filter(passes).length
    // A skip counts as a wrong attempt for hearts and "perfect" (Duolingo parity; the player sends
    // a wrong event for each skip). SRS ratings ignore skips, and a skip never clears a mistake.
    const wrongAttempts = graded.filter(
      (a) => a.verdict === 'wrong' || a.verdict === 'skipped',
    ).length
    const wrongIndexes = new Set(graded.filter((a) => a.verdict === 'wrong').map((a) => a.index))
    const accuracy = challenges.length === 0 ? 0 : firstPass / challenges.length

    // --- XP (server-counted; never the client's) ----------------------------------------------
    const earned = sessionXp(session.kind, wrongAttempts, config)
    const cheatFlags = await plausibilityFlags(tx, {
      userId,
      sessionId,
      answerMs: graded.filter((a) => a.verdict !== 'skipped').map((a) => a.ms),
      now,
      xp: earned.total,
      config,
    })
    const flagged = cheatFlags.length > 0
    const xp = flagged ? { base: 0, bonus: 0, total: 0 } : earned

    // The session counts at the client's completedAt clamped to [startedAt, now] (§6).
    const startedAt = new Date(session.startedAt)
    const countedAt = clampActivityTime(
      { completedAt: new Date(input.completedAt), startedAt },
      now,
    )
    const localDate = dateInZone(countedAt, session.tz)
    const today = dateInZone(now, session.tz)
    const at = now.toISOString()
    if (xp.base > 0)
      await repos.progress.appendXp(tx, userId, {
        amount: xp.base,
        reason: session.kind,
        sessionId,
        occurredAt: at,
        localDate,
      })
    if (xp.bonus > 0)
      await repos.progress.appendXp(tx, userId, {
        amount: xp.bonus,
        reason: 'perfect_bonus',
        sessionId,
        occurredAt: at,
        localDate,
      })

    const settings = await repos.profiles.getSettings(tx, userId)
    const before = (await repos.progress.getDailyActivity(tx, userId, localDate))?.xp ?? 0
    const goal = dailyGoalStep(before, xp.total, settings.dailyGoalXp)
    await repos.progress.addDailyActivity(tx, userId, {
      localDate,
      xp: xp.total,
      goalMet: goal.met,
    })

    // --- streak ---------------------------------------------------------------------------
    const streak = applyActivity(
      (await repos.state.getStreak(tx, userId)) ?? initialStreak(config),
      localDate,
      config,
    )
    await repos.state.saveStreak(tx, userId, streak.state)
    await repos.progress.markFreezeUsed(tx, userId, streak.frozenDates)

    // --- hearts: charge wrong answers whose events never arrived; practice earns one back ------
    const events = await repos.sessions.listSessionEvents(tx, userId, sessionId)
    const settled = settleCommit({
      state: await livesState(tx, userId, now, config),
      kind: session.kind,
      serverWrong: wrongAttempts,
      recordedEvents: events.length,
      now,
      cfg: config,
    })
    await repos.state.saveLives(tx, userId, settled.state)

    // --- progress, mistakes, memory --------------------------------------------------------
    const current = await loadBundle(await requireCurrentVersion(tx, session.courseId))
    await repos.enrollments.ensureEnrollment(tx, userId, {
      courseId: session.courseId,
      contentVersion: current.version,
    })
    await migrateEnrollment(tx, userId, current)
    const level = await recordLevelProgress(tx, userId, session, current, at)

    const mistakes = [...new Set([...wrongIndexes].flatMap((i) => refItems(challenges[i]!.ref)))]
    // Per item, like the SRS rating: an item is cleared only when a challenge that exercised it
    // passed and no challenge in this session got it wrong (an item often appears in several).
    const wrongItems = new Set(mistakes)
    // A declined attempt ("Can't trace now") passes for hearts and re-queue, but it is not a
    // review: it applies no SRS rating and never resolves an open mistake.
    const rated = graded.filter((a) => !isDeclined(a.response))
    const answeredOk = new Set(rated.filter((a) => passes(a.verdict)).map((a) => a.index))
    const cleared = [
      ...new Set([...answeredOk].flatMap((i) => refItems(challenges[i]!.ref))),
    ].filter((item) => !wrongItems.has(item))
    await repos.learning.recordMistakes(tx, userId, mistakes, at)
    await repos.learning.resolveMistakes(tx, userId, cleared, at)
    await applySrs(tx, userId, { attempts: rated, challenges, view, now, config })
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

    // --- enrollment and public stats ---------------------------------------------------------
    if (xp.total > 0)
      await repos.enrollments.addEnrollmentXp(tx, userId, session.courseId, xp.total)
    const { states } = await pathStates(tx, userId, current)
    await repos.enrollments.updateEnrollment(tx, userId, session.courseId, {
      currentLevelId: currentOf(states),
    })
    await repos.profiles.syncPublicStats(tx, userId, {
      xpTotal: await repos.progress.getXpTotal(tx, userId),
      streakCurrent: streak.state.current,
    })

    // --- P2 engagement: league XP, quests, coins (only for the flags that are on) -------------
    const engagement = await commitEngagement(tx, {
      user: ctx.user,
      flags: ctx.flags ?? {},
      config,
      now,
      session: { kind: session.kind },
      localDate,
      xp: xp.total,
      perfect: earned.perfect,
      flagged,
    })

    const result = SessionResult.parse({
      sessionId,
      kind: session.kind,
      contentVersion: session.contentVersion,
      localDate,
      xp: { base: xp.base, bonus: xp.bonus, total: xp.total },
      accuracy,
      perfect: earned.perfect,
      // The clamp can land before startedAt when the server clock is behind the session start (#28).
      durationMs: Math.max(0, countedAt.getTime() - startedAt.getTime()),
      streak: {
        ...streakView(streak.state, today),
        extendedToday: streak.extendedToday,
        freezeGranted: streak.freezeGranted,
        frozenDates: streak.frozenDates,
      },
      lives: livesViewOf(settled.state, now, config),
      dailyGoal: { xp: goal.dayXp, goal: goal.goal, met: goal.met, justMet: goal.justMet },
      level,
      mistakes,
      graderMismatches,
      ...engagement,
    })
    const stored = await repos.sessions.completeSession(tx, userId, sessionId, {
      result,
      completedAt: at,
    })
    if (!stored) throw new ApiError('conflict', 'session was completed concurrently')
    return result
  })
  if (out === EXPIRED) throw new ApiError('gone', 'session expired')
  return out
}
