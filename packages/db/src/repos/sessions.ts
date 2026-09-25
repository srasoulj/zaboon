/**
 * sessions, session_events (idempotent wrong attempts) and session_answers (kept 90 days).
 *
 * Ownership: every function filters by `userId`, and child rows carry a composite FK
 * (session_id, user_id) → sessions (id, user_id), so a row can never point at another user's session.
 */
import { and, count, eq, gte, sql } from 'drizzle-orm'
import type { ChallengeRef, ChallengeResponse, SessionKind, Verdict } from '@zaboon/contracts'
import type { Tx } from '../index'
import * as schema from '../schema'
import { NotFoundError, isUuid, toIso, toIsoOrNull } from './shared'

export type SessionStatus = 'started' | 'completed' | 'expired'

export interface Session {
  id: string
  userId: string
  courseId: string
  levelId: string | null
  lessonIndex: number
  kind: SessionKind
  contentVersion: number
  seed: string
  challengeRefs: ChallengeRef[]
  tz: string
  startedAt: string
  expiresAt: string
  status: SessionStatus
  completedAt: string | null
  /** The stored SessionResult (returned verbatim on replay), or null until completed. */
  result: unknown
  graderVersion: number
}

type SessionRow = typeof schema.sessions.$inferSelect

function toSession(row: SessionRow): Session {
  return {
    ...row,
    kind: row.kind as SessionKind,
    status: row.status as SessionStatus,
    challengeRefs: row.challengeRefs as ChallengeRef[],
    startedAt: toIso(row.startedAt),
    expiresAt: toIso(row.expiresAt),
    completedAt: toIsoOrNull(row.completedAt),
  }
}

const own = (userId: string, sessionId: string) =>
  and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId))

export interface NewSession {
  courseId: string
  levelId: string | null
  lessonIndex?: number
  kind: SessionKind
  contentVersion: number
  seed: string
  challengeRefs: ChallengeRef[]
  tz: string
  startedAt: string
  expiresAt: string
  graderVersion: number
}

export async function createSession(tx: Tx, userId: string, input: NewSession): Promise<Session> {
  const [row] = await tx
    .insert(schema.sessions)
    .values({ ...input, userId, lessonIndex: input.lessonIndex ?? 0 })
    .returning()
  return toSession(row!)
}

/** The caller's session, or null if it doesn't exist or belongs to someone else. */
export async function getSession(tx: Tx, userId: string, sessionId: string): Promise<Session | null> {
  if (!isUuid(sessionId)) return null
  const [row] = await tx.select().from(schema.sessions).where(own(userId, sessionId))
  return row ? toSession(row) : null
}

/** Like getSession, but locks the row until the transaction ends (use inside withUserLock). */
export async function getSessionForUpdate(tx: Tx, userId: string, sessionId: string): Promise<Session | null> {
  if (!isUuid(sessionId)) return null
  const [row] = await tx.select().from(schema.sessions).where(own(userId, sessionId)).for('update')
  return row ? toSession(row) : null
}

/**
 * Marks a started session completed and stores its result. Returns false when the session is not
 * the caller's or not in `started` state (the caller then replays the stored result or answers 409).
 */
export async function completeSession(
  tx: Tx,
  userId: string,
  sessionId: string,
  input: { result: unknown; completedAt: string },
): Promise<boolean> {
  if (!isUuid(sessionId)) return false
  const rows = await tx
    .update(schema.sessions)
    .set({ status: 'completed', result: input.result, completedAt: input.completedAt })
    .where(and(own(userId, sessionId), eq(schema.sessions.status, 'started')))
    .returning({ id: schema.sessions.id })
  return rows.length === 1
}

/** Marks a started session expired (e.g. found past its TTL at completion). */
export async function expireSession(tx: Tx, userId: string, sessionId: string): Promise<boolean> {
  if (!isUuid(sessionId)) return false
  const rows = await tx
    .update(schema.sessions)
    .set({ status: 'expired' })
    .where(and(own(userId, sessionId), eq(schema.sessions.status, 'started')))
    .returning({ id: schema.sessions.id })
  return rows.length === 1
}

export async function countCompletedSessions(tx: Tx, userId: string, kind?: SessionKind): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.userId, userId),
        eq(schema.sessions.status, 'completed'),
        kind ? eq(schema.sessions.kind, kind) : undefined,
      ),
    )
  return row?.n ?? 0
}

/** Sessions started at or after `since` (anti-cheat: sessions per hour). */
export async function countSessionsStartedSince(tx: Tx, userId: string, since: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), gte(schema.sessions.startedAt, since)))
  return row?.n ?? 0
}

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------
export interface SessionEvent {
  sessionId: string
  attemptSeq: number
  challengeIndex: number
  kind: 'wrong'
  createdAt: string
}

/**
 * Records a wrong attempt, idempotent on (session, attemptSeq). Returns `{ duplicate: true }` when
 * the event was already stored. Throws NotFoundError if the session is not the caller's.
 * Implemented without relying on a constraint error, which would abort the caller's transaction.
 */
export async function recordSessionEvent(
  tx: Tx,
  userId: string,
  input: { sessionId: string; attemptSeq: number; challengeIndex: number; kind?: 'wrong'; createdAt?: string },
): Promise<{ duplicate: boolean }> {
  if (!isUuid(input.sessionId)) throw new NotFoundError('session')
  const inserted = await tx.execute<{ attempt_seq: number }>(sql`
    INSERT INTO public.session_events (session_id, user_id, attempt_seq, challenge_index, kind, created_at)
    SELECT s.id, s.user_id, ${input.attemptSeq}, ${input.challengeIndex}, ${input.kind ?? 'wrong'},
           coalesce(${input.createdAt ?? null}::timestamptz, now())
    FROM public.sessions s
    WHERE s.id = ${input.sessionId} AND s.user_id = ${userId}
    ON CONFLICT (session_id, attempt_seq) DO NOTHING
    RETURNING attempt_seq`)
  if (inserted.length === 1) return { duplicate: false }
  if (!(await getSession(tx, userId, input.sessionId))) throw new NotFoundError('session')
  return { duplicate: true }
}

export async function listSessionEvents(tx: Tx, userId: string, sessionId: string): Promise<SessionEvent[]> {
  if (!isUuid(sessionId)) return []
  const rows = await tx
    .select()
    .from(schema.sessionEvents)
    .where(and(eq(schema.sessionEvents.sessionId, sessionId), eq(schema.sessionEvents.userId, userId)))
    .orderBy(schema.sessionEvents.attemptSeq)
  return rows.map((r) => ({
    sessionId: r.sessionId,
    attemptSeq: r.attemptSeq,
    challengeIndex: r.challengeIndex,
    kind: r.kind as 'wrong',
    createdAt: toIso(r.createdAt),
  }))
}

// ---------------------------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------------------------
export interface SessionAnswerInput {
  idx: number
  attemptSeq: number
  challengeType: string
  itemRefs: string[]
  response: ChallengeResponse
  verdict: Verdict
  ms: number
  hinted?: boolean
}

export interface SessionAnswer extends Required<SessionAnswerInput> {
  sessionId: string
  contentVersion: number
  createdAt: string
}

/**
 * Stores the (server-graded) answers of a session at commit. Idempotent on
 * (session, idx, attemptSeq). Throws NotFoundError if the session is not the caller's.
 * Returns the number of newly stored answers.
 */
export async function insertSessionAnswers(
  tx: Tx,
  userId: string,
  sessionId: string,
  answers: readonly SessionAnswerInput[],
): Promise<number> {
  const session = await getSession(tx, userId, sessionId)
  if (!session) throw new NotFoundError('session')
  if (answers.length === 0) return 0
  const rows = await tx
    .insert(schema.sessionAnswers)
    .values(
      answers.map((a) => ({
        sessionId,
        userId,
        idx: a.idx,
        attemptSeq: a.attemptSeq,
        challengeType: a.challengeType,
        itemRefs: a.itemRefs,
        contentVersion: session.contentVersion,
        response: a.response,
        verdict: a.verdict,
        ms: a.ms,
        hinted: a.hinted ?? false,
      })),
    )
    .onConflictDoNothing()
    .returning({ idx: schema.sessionAnswers.idx })
  return rows.length
}

export async function listSessionAnswers(tx: Tx, userId: string, sessionId: string): Promise<SessionAnswer[]> {
  if (!isUuid(sessionId)) return []
  const rows = await tx
    .select()
    .from(schema.sessionAnswers)
    .where(and(eq(schema.sessionAnswers.sessionId, sessionId), eq(schema.sessionAnswers.userId, userId)))
    .orderBy(schema.sessionAnswers.idx, schema.sessionAnswers.attemptSeq)
  return rows.map((r) => ({
    sessionId: r.sessionId,
    idx: r.idx,
    attemptSeq: r.attemptSeq,
    challengeType: r.challengeType,
    itemRefs: r.itemRefs,
    contentVersion: r.contentVersion,
    response: r.response as ChallengeResponse,
    verdict: r.verdict as Verdict,
    ms: r.ms,
    hinted: r.hinted,
    createdAt: toIso(r.createdAt),
  }))
}
