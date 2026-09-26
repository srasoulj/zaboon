/**
 * The lesson URL contract (other workstreams link here):
 *   /lesson?course=<courseId>&kind=<lesson|practice|letters|unit_review|story>&level=<levelId>
 *   /lesson?course=<courseId>&kind=practice&mode=<mixed|mistakes|listening|typing>  (practice hub)
 * `level` is omitted for practice. `mode` (practice only) reaches `createSession`. Leaving the
 * player returns to the kind's home tab.
 */
import { PracticeMode, SessionKind, type RouteRequest } from '@zaboon/contracts'

/** `story` (P2, flags.stories) plays a unit's story level; the server refuses it while the flag is off. */
export const PLAYER_KINDS = ['lesson', 'practice', 'letters', 'unit_review', 'story'] as const
export type PlayerKind = (typeof PLAYER_KINDS)[number]

export interface LessonRequest {
  courseId: string
  kind: PlayerKind
  levelId: string | null
  /** Practice hub mode (practice only); absent for every other entry point. */
  mode?: PracticeMode
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
  if (
    levelId === null &&
    (playerKind === 'lesson' || playerKind === 'unit_review' || playerKind === 'story')
  )
    return { ok: false, reason: `a ${playerKind} needs a level` }
  const modeRaw = params.get('mode')
  if (modeRaw === null || modeRaw === '')
    return { ok: true, request: { courseId, kind: playerKind, levelId } }
  const mode = PracticeMode.safeParse(modeRaw)
  if (!mode.success) return { ok: false, reason: 'invalid practice mode' }
  if (playerKind !== 'practice') return { ok: false, reason: 'a mode is only for practice' }
  return { ok: true, request: { courseId, kind: playerKind, levelId, mode: mode.data } }
}

export function lessonHref(request: LessonRequest): string {
  const q = new URLSearchParams({ course: request.courseId, kind: request.kind })
  if (request.levelId !== null) q.set('level', request.levelId)
  if (request.mode !== undefined) q.set('mode', request.mode)
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
  const base = `${request.courseId}|${request.kind}|${request.levelId ?? ''}`
  return request.mode === undefined ? base : `${base}|${request.mode}`
}

/**
 * The createSession body for a lesson request. `speakPaused` (P2 speak: the learner's "Can't speak
 * now" pause is running on this device) is sent only while true: without a pause the body, and
 * `requestKey`, are exactly what they were before Wave 4. The pause is device state, not part of
 * the lesson's identity, so it never enters `requestKey` (a resumed snapshot stays the same lesson).
 */
export function createSessionBody(
  request: LessonRequest,
  opts: { tz: string; speakPaused?: boolean },
): RouteRequest<'createSession'> {
  return {
    courseId: request.courseId,
    kind: request.kind,
    ...(request.levelId !== null ? { levelId: request.levelId } : {}),
    ...(request.mode !== undefined ? { mode: request.mode } : {}),
    tz: opts.tz,
    ...(opts.speakPaused === true ? { speakPaused: true } : {}),
  }
}
