/**
 * The practice hub (P2, flags.practiceHub): GET /api/practice lists the practice modes the learner
 * can start. A mode reaches `POST /api/sessions` as `mode` (practice sessions only) and the session
 * engine's `practiceMode` (only while flags.practiceHub is on): `mistakes` drills open mistakes,
 * `listening` and `typing` keep to those challenges, `mixed` is today's practice session. A mode
 * with nothing to build falls back to the mixed session, so a card is available only when its
 * mode has material in the content the practice session would use (the learner's current level's
 * unit and the ones before it, like `createSession`).
 */
import { DEFAULT_COURSE_ID, type PracticeResponse } from '@zaboon/contracts'
import { repos, withUser, type Db, type Tx } from '@zaboon/db'
import { contentView, currentVersion, findLevel, loadBundle, type LoadedBundle } from '../content'
import { currentOf, pathStates } from '../path'
import type { Flags } from './flags'

/** Counts shown on a mode card stop here ("999+" is plenty). */
const COUNT_CAP = 999

/** What the practice session's content view can build: drillable item refs and audio. */
async function practiceContent(tx: Tx, userId: string, bundle: LoadedBundle) {
  const { levels, states } = await pathStates(tx, userId, bundle)
  const levelId = currentOf(states) ?? levels.at(-1)?.id ?? null
  const unitIndex = levelId ? (findLevel(bundle, levelId)?.unitIndex ?? null) : null
  const view = contentView(bundle, unitIndex)
  const lexemes = [...view.knownLexemes, ...(view.unit?.lexemes ?? [])]
  const sentences = [...view.knownSentences, ...(view.unit?.sentences ?? [])]
  // The engine drills lexeme, sentence and chat mistakes that exist in this view (never letters).
  const drillable = new Set([
    ...lexemes.map((l) => `lexeme:${l.id}`),
    ...sentences.map((s) => `sentence:${s.id}`),
    ...(view.unit?.chats ?? []).map((c) => `chat:${c.id}`),
  ])
  const hasAudio =
    lexemes.some((l) => l.audio !== undefined) ||
    sentences.some((s) => s.audio?.normal !== undefined)
  return { drillable, hasAudio }
}

export async function buildPractice(
  db: Db,
  userId: string,
  now: Date,
  flags: Flags,
): Promise<PracticeResponse> {
  return withUser(db, userId, async (tx) => {
    const enrollments = await repos.enrollments.listEnrollments(tx, userId)
    const latest = [...enrollments].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    const courseId = latest?.courseId ?? DEFAULT_COURSE_ID
    const cv = await currentVersion(tx, courseId)
    const content = cv ? await practiceContent(tx, userId, await loadBundle(cv)) : null
    const open = await repos.learning.listOpenMistakes(tx, userId, 10_000)
    const mistakes = Math.min(
      COUNT_CAP,
      content ? open.filter((m) => content.drillable.has(m.itemRef)).length : 0,
    )
    const due = (await repos.memory.listDueLexemes(tx, userId, now.toISOString(), COUNT_CAP)).length
    return {
      courseId,
      modes: [
        { mode: 'mixed', available: true, count: due },
        { mode: 'mistakes', available: mistakes > 0, count: mistakes },
        { mode: 'listening', available: content?.hasAudio === true, count: null },
        // Typed answers need the Persian keyboard feature (ws-typing).
        { mode: 'typing', available: flags.persianKeyboard === true, count: null },
      ],
    }
  })
}
