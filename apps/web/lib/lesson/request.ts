/**
 * The lesson URL contract (other workstreams link here):
 *   /lesson?course=<courseId>&kind=<lesson|practice|letters|unit_review>&level=<levelId>
 * `level` is omitted for practice. Leaving the player returns to the kind's home tab.
 */
import { SessionKind } from '@zaboon/contracts'

export const PLAYER_KINDS = ['lesson', 'practice', 'letters', 'unit_review'] as const
export type PlayerKind = (typeof PLAYER_KINDS)[number]

export interface LessonRequest {
  courseId: string
  kind: PlayerKind
  levelId: string | null
}

export type ParsedLessonRequest =
  { ok: true; request: LessonRequest } | { ok: false; reason: string }

interface ParamReader {
  get(name: string): string | null
}

const LEVEL_ID = /^[a-z0-9-]+$/
const COURSE_ID = /^[a-z0-9-]+$/

export function parseLessonRequest(params: ParamReader): ParsedLessonRequest {
  const courseId = params.get('course')
  const kindRaw = params.get('kind')
  const level = params.get('level')
  if (!courseId || !COURSE_ID.test(courseId))
    return { ok: false, reason: 'missing or invalid course' }
  const kind = SessionKind.safeParse(kindRaw)
  if (!kind.success || !(PLAYER_KINDS as readonly string[]).includes(kind.data))
    return { ok: false, reason: `unsupported lesson kind ${kindRaw ?? '(none)'}` }
  const playerKind = kind.data as PlayerKind
  if (level !== null && level !== '' && !LEVEL_ID.test(level))
    return { ok: false, reason: 'invalid level' }
  const levelId = level ? level : null
  if (levelId === null && (playerKind === 'lesson' || playerKind === 'unit_review'))
    return { ok: false, reason: `a ${playerKind} needs a level` }
  return { ok: true, request: { courseId, kind: playerKind, levelId } }
}

export function lessonHref(request: LessonRequest): string {
  const q = new URLSearchParams({ course: request.courseId, kind: request.kind })
  if (request.levelId !== null) q.set('level', request.levelId)
  return `/lesson?${q.toString()}`
}

/** Where CONTINUE/quit leads: the tab the lesson was started from. */
export function exitHref(kind: PlayerKind): string {
  if (kind === 'letters') return '/letters'
  if (kind === 'practice') return '/practice'
  return '/learn'
}

/** Identifies "the same lesson" across reloads (the URL carries no session id). */
export function requestKey(request: LessonRequest): string {
  return `${request.courseId}|${request.kind}|${request.levelId ?? ''}`
}
