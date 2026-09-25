/**
 * The practice hub (P2, flags.practiceHub): GET /api/practice lists the practice modes the learner
 * can start. A mode reaches `POST /api/sessions` as `mode` (practice sessions only) and the session
 * engine's `practiceMode`; until the engine builds a mode differently, every mode is today's
 * practice session, so each one works end to end.
 */
import { DEFAULT_COURSE_ID, type PracticeResponse } from '@zaboon/contracts'
import { repos, withUser, type Db } from '@zaboon/db'
import type { Flags } from './flags'

/** Counts shown on a mode card stop here ("999+" is plenty). */
const COUNT_CAP = 999

export async function buildPractice(
  db: Db,
  userId: string,
  now: Date,
  flags: Flags,
): Promise<PracticeResponse> {
  return withUser(db, userId, async (tx) => {
    const enrollments = await repos.enrollments.listEnrollments(tx, userId)
    const latest = [...enrollments].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    const mistakes = (await repos.learning.listOpenMistakes(tx, userId, COUNT_CAP)).length
    const due = (await repos.memory.listDueLexemes(tx, userId, now.toISOString(), COUNT_CAP)).length
    return {
      courseId: latest?.courseId ?? DEFAULT_COURSE_ID,
      modes: [
        { mode: 'mixed', available: true, count: due },
        { mode: 'mistakes', available: mistakes > 0, count: mistakes },
        { mode: 'listening', available: true, count: null },
        // Typed answers need the Persian keyboard feature (ws-typing).
        { mode: 'typing', available: flags.persianKeyboard === true, count: null },
      ],
    }
  })
}
