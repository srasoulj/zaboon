/**
 * Read models for the path, the letters tab and the words list (GET /api/path, /api/letters,
 * /api/words). They run under the user lock because opening the path may apply a lazy path
 * migration (§10.4); nothing else is written.
 */
import {
  DEFAULT_COURSE_ID,
  type AppConfig,
  type FsrsCard,
  type LettersResponse,
  type PathResponse,
  type WordsResponse,
} from '@zaboon/contracts'
import { repos, withUserLock, type Db, type Tx } from '@zaboon/db'
import { retrievability, strengthBars } from '@zaboon/srs'
import { allLexemes, loadBundle, requireCurrentVersion, type LoadedBundle } from './content'
import { ApiError } from './errors'
import {
  letterLessonStates,
  migrateEnrollment,
  pathResponse,
  pathStates,
  progressMap,
} from './path'

const COURSE_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

/** The active course: the most recently used enrollment, else the default course. */
export async function activeCourseId(tx: Tx, userId: string): Promise<string> {
  const enrollments = await repos.enrollments.listEnrollments(tx, userId)
  const latest = [...enrollments].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  return latest?.courseId ?? DEFAULT_COURSE_ID
}

/** `?courseId=` from the request URL, or null when absent. */
export function courseParam(req: Request): string | null {
  const value = new URL(req.url).searchParams.get('courseId')
  if (value === null) return null
  if (!COURSE_ID_RE.test(value)) throw new ApiError('validation', 'invalid courseId')
  return value
}

export function strengthOf(card: FsrsCard, now: Date, config: AppConfig): 0 | 1 | 2 | 3 | 4 {
  return strengthBars(retrievability(card, now), config.srs.strengthBars)
}

interface ReadCtx {
  db: Db
  userId: string
  courseId: string | null
}

/** Runs `fn` with the learner's course bundle, after bringing their enrollment to its version. */
async function withCourse<T>(
  ctx: ReadCtx,
  fn: (tx: Tx, bundle: LoadedBundle) => Promise<T>,
): Promise<T> {
  return withUserLock(ctx.db, ctx.userId, async (tx) => {
    const courseId = ctx.courseId ?? (await activeCourseId(tx, ctx.userId))
    const bundle = await loadBundle(await requireCurrentVersion(ctx.db, courseId))
    await migrateEnrollment(tx, ctx.userId, bundle)
    return fn(tx, bundle)
  })
}

export function buildPath(ctx: ReadCtx): Promise<PathResponse> {
  return withCourse(ctx, async (tx, bundle) => {
    const { states } = await pathStates(tx, ctx.userId, bundle)
    return pathResponse(bundle, states)
  })
}

export function buildLetters(
  ctx: ReadCtx & { now: Date; config: AppConfig },
): Promise<LettersResponse> {
  return withCourse(ctx, async (tx, bundle) => {
    const cards = new Map(
      (await repos.memory.getLetterCards(tx, ctx.userId)).map((e) => [e.id, e.card]),
    )
    const progress = progressMap(
      await repos.learning.listLevelProgress(tx, ctx.userId, bundle.courseId),
    )
    const states = letterLessonStates(bundle, progress)
    return {
      letters: [...bundle.letters.track.letters]
        .sort((a, b) => a.order - b.order)
        .map((l) => {
          const card = cards.get(l.id)
          return {
            id: l.id,
            letter: l.letter,
            name: l.name,
            translit: l.translit,
            strength: card ? strengthOf(card, ctx.now, ctx.config) : 0,
            introduced: card !== undefined,
          }
        }),
      lessons: bundle.letters.track.lessons.map((l) => ({
        id: l.id,
        title: l.title,
        letters: l.letters,
        state: states.get(l.id)?.state ?? 'locked',
      })),
    }
  })
}

export function buildWords(
  ctx: ReadCtx & { now: Date; config: AppConfig },
): Promise<WordsResponse> {
  return withCourse(ctx, async (tx, bundle) => {
    const lexemes = allLexemes(bundle)
    const words = (await repos.memory.getLexemeCards(tx, ctx.userId))
      .filter((e) => lexemes.has(e.id)) // cards of words this course version doesn't have are hidden
      .sort((a, b) => a.card.due.localeCompare(b.card.due) || a.id.localeCompare(b.id))
      .map((e) => {
        const l = lexemes.get(e.id)!
        return {
          lexemeId: e.id,
          fa: l.fa,
          translit: l.translit,
          gloss: l.glosses[0] ?? '',
          strength: strengthOf(e.card, ctx.now, ctx.config),
          dueAt: e.card.lastReview === null ? null : e.card.due,
        }
      })
    return { words }
  })
}
