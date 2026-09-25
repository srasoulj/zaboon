/** Test fixture: gives a learner a row in every user-scoped MVP table through the repositories. */
import type { FsrsCard } from '@zaboon/contracts'
import { repos, withUser, withUserLock } from '../index'
import type { TestContext } from '../testing'

export const fixtureCard = (overrides: Partial<FsrsCard> = {}): FsrsCard => ({
  due: '2026-09-26T10:00:00.000Z',
  stability: 2,
  difficulty: 5,
  elapsedDays: 0,
  scheduledDays: 1,
  learningSteps: 0,
  reps: 1,
  lapses: 0,
  state: 2,
  lastReview: '2026-09-25T10:00:00.000Z',
  ...overrides,
})

export interface SeedOptions {
  localDate?: string
  xp?: number
  stability?: number
}

/** Returns the id of the completed session it creates. */
export async function seedLearner(ctx: TestContext, userId: string, opts: SeedOptions = {}): Promise<string> {
  const localDate = opts.localDate ?? '2026-09-25'
  const xp = opts.xp ?? 10
  const at = `${localDate}T10:00:00.000Z`
  const sessionId = await withUserLock(ctx.h.db, userId, async (tx) => {
    const s = await repos.sessions.createSession(tx, userId, {
      courseId: 'fixture',
      levelId: 'u01-l1',
      kind: 'lesson',
      contentVersion: 1,
      seed: `seed-${userId}`,
      challengeRefs: [{ type: 'select_translation', items: ['lexeme:lx_salam'] }],
      tz: 'UTC',
      startedAt: at,
      expiresAt: `${localDate}T23:59:59.000Z`,
      graderVersion: 1,
    })
    await repos.sessions.recordSessionEvent(tx, userId, { sessionId: s.id, attemptSeq: 0, challengeIndex: 0 })
    await repos.sessions.insertSessionAnswers(tx, userId, s.id, [
      {
        idx: 0,
        attemptSeq: 0,
        challengeType: 'select_translation',
        itemRefs: ['lexeme:lx_salam'],
        response: { kind: 'choice', value: 2 },
        verdict: 'wrong',
        ms: 900,
      },
      {
        idx: 0,
        attemptSeq: 1,
        challengeType: 'select_translation',
        itemRefs: ['lexeme:lx_salam'],
        response: { kind: 'choice', value: 1 },
        verdict: 'correct',
        ms: 1200,
      },
    ])
    await repos.sessions.completeSession(tx, userId, s.id, { result: { sessionId: s.id }, completedAt: at })
    await repos.progress.appendXp(tx, userId, { amount: xp, reason: 'session', sessionId: s.id, occurredAt: at, localDate })
    await repos.progress.addDailyActivity(tx, userId, { localDate, xp })
    await repos.state.saveStreak(tx, userId, { current: 1, longest: 1, lastActiveDate: localDate, freezes: 1 })
    await repos.state.saveLives(tx, userId, { policy: 'hearts', count: 4, updatedAt: at })
    await repos.state.addItem(tx, userId, 'streak_freeze', 1)
    await repos.enrollments.ensureEnrollment(tx, userId, { courseId: 'fixture', contentVersion: 1, currentLevelId: 'u01-l1' })
    await repos.enrollments.addEnrollmentXp(tx, userId, 'fixture', xp)
    await repos.learning.recordLessonDone(tx, userId, { courseId: 'fixture', levelId: 'u01-l1', lessonsTotal: 3, at })
    await repos.memory.upsertLexemeCards(tx, userId, [
      { id: 'lx_salam', card: fixtureCard({ stability: opts.stability ?? 2 }), exposures: 1 },
    ])
    await repos.memory.upsertLetterCards(tx, userId, [{ id: 'l_be', card: fixtureCard() }])
    await repos.learning.recordMistakes(tx, userId, ['lexeme:lx_salam'], at)
    await repos.profiles.setConsent(tx, userId, 'analytics', true)
    return s.id
  })
  await withUser(ctx.h.db, userId, (tx) =>
    repos.reports.createReport(tx, userId, { itemRef: 'lexeme:lx_salam', kind: 'audio_problem', sessionId }),
  )
  return sessionId
}
