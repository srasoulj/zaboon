import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import type { ChallengeRef } from '@zaboon/contracts'
import { NotFoundError, repos, withSystem, withUser, withUserLock } from '../index'
import { createTestContext, type TestContext } from '../testing'
import type { NewSession, SessionAnswerInput } from './sessions'

const { sessions } = repos

let ctx: TestContext
let alice: string
let bob: string

const refs: ChallengeRef[] = [{ type: 'select_translation', items: ['lexeme:lx_salam'] }]

function newSession(overrides: Partial<NewSession> = {}): NewSession {
  return {
    courseId: 'fixture',
    levelId: 'u01-l1',
    kind: 'lesson',
    contentVersion: 1,
    seed: 'seed-1',
    challengeRefs: refs,
    tz: 'Asia/Tehran',
    startedAt: '2026-09-25T10:00:00.000Z',
    expiresAt: '2026-09-26T10:00:00.000Z',
    graderVersion: 1,
    ...overrides,
  }
}

const answer = (
  idx: number,
  attemptSeq: number,
  verdict: SessionAnswerInput['verdict'] = 'correct',
): SessionAnswerInput => ({
  idx,
  attemptSeq,
  challengeType: 'select_translation',
  itemRefs: ['lexeme:lx_salam'],
  response: { kind: 'choice', value: 1 },
  verdict,
  ms: 1500,
})

beforeAll(async () => {
  ctx = await createTestContext()
  alice = await ctx.newUser()
  bob = await ctx.newUser()
})
afterAll(() => ctx.close())

describe('sessions repository', () => {
  it('creates and reads a session with ISO timestamps', async () => {
    const s = await withUserLock(ctx.h.db, alice, (tx) =>
      sessions.createSession(tx, alice, newSession()),
    )
    expect(s).toMatchObject({
      userId: alice,
      status: 'started',
      startedAt: '2026-09-25T10:00:00.000Z',
      expiresAt: '2026-09-26T10:00:00.000Z',
      challengeRefs: refs,
      lessonIndex: 0,
      completedAt: null,
      result: null,
    })
    expect(await withUser(ctx.h.db, alice, (tx) => sessions.getSession(tx, alice, s.id))).toEqual(s)
    expect(
      await withUser(ctx.h.db, alice, (tx) => sessions.getSessionForUpdate(tx, alice, s.id)),
    ).toEqual(s)
  })

  it('returns null for malformed or unknown ids', async () => {
    expect(
      await withUser(ctx.h.db, alice, (tx) => sessions.getSession(tx, alice, 'not-a-uuid')),
    ).toBeNull()
    expect(
      await withUser(ctx.h.db, alice, (tx) =>
        sessions.getSession(tx, alice, '00000000-0000-4000-8000-000000000000'),
      ),
    ).toBeNull()
  })

  it('completes a started session once; the stored result is returned verbatim afterwards', async () => {
    const s = await withUserLock(ctx.h.db, alice, (tx) =>
      sessions.createSession(tx, alice, newSession()),
    )
    const result = { sessionId: s.id, xp: { total: 15 } }
    const at = '2026-09-25T10:05:00.000Z'
    expect(
      await withUserLock(ctx.h.db, alice, (tx) =>
        sessions.completeSession(tx, alice, s.id, { result, completedAt: at }),
      ),
    ).toBe(true)
    expect(
      await withUserLock(ctx.h.db, alice, (tx) =>
        sessions.completeSession(tx, alice, s.id, { result: { other: true }, completedAt: at }),
      ),
    ).toBe(false)
    const again = await withUser(ctx.h.db, alice, (tx) => sessions.getSession(tx, alice, s.id))
    expect(again).toMatchObject({ status: 'completed', result, completedAt: at })
    expect(
      await withUser(ctx.h.db, alice, (tx) => sessions.countCompletedSessions(tx, alice)),
    ).toBeGreaterThanOrEqual(1)
    expect(
      await withUser(ctx.h.db, alice, (tx) =>
        sessions.countCompletedSessions(tx, alice, 'practice'),
      ),
    ).toBe(0)
  })

  it('expires only started sessions', async () => {
    const s = await withUserLock(ctx.h.db, alice, (tx) =>
      sessions.createSession(tx, alice, newSession()),
    )
    expect(
      await withUserLock(ctx.h.db, alice, (tx) => sessions.expireSession(tx, alice, s.id)),
    ).toBe(true)
    expect(
      await withUserLock(ctx.h.db, alice, (tx) => sessions.expireSession(tx, alice, s.id)),
    ).toBe(false)
    expect(
      await withUserLock(ctx.h.db, alice, (tx) =>
        sessions.completeSession(tx, alice, s.id, { result: {}, completedAt: s.startedAt }),
      ),
    ).toBe(false)
  })

  it('counts sessions started since a time', async () => {
    const u = await ctx.newUser()
    await withUserLock(ctx.h.db, u, async (tx) => {
      await sessions.createSession(tx, u, newSession({ startedAt: '2026-09-25T08:00:00.000Z' }))
      await sessions.createSession(tx, u, newSession({ startedAt: '2026-09-25T09:30:00.000Z' }))
      await sessions.createSession(tx, u, newSession({ startedAt: '2026-09-25T09:45:00.000Z' }))
    })
    expect(
      await withUser(ctx.h.db, u, (tx) =>
        sessions.countSessionsStartedSince(tx, u, '2026-09-25T09:00:00.000Z'),
      ),
    ).toBe(2)
  })

  describe('session_events', () => {
    it('are idempotent on (session, attemptSeq)', async () => {
      const s = await withUserLock(ctx.h.db, alice, (tx) =>
        sessions.createSession(tx, alice, newSession()),
      )
      const ev = { sessionId: s.id, attemptSeq: 0, challengeIndex: 2 }
      expect(
        await withUserLock(ctx.h.db, alice, (tx) => sessions.recordSessionEvent(tx, alice, ev)),
      ).toEqual({ duplicate: false })
      expect(
        await withUserLock(ctx.h.db, alice, (tx) => sessions.recordSessionEvent(tx, alice, ev)),
      ).toEqual({ duplicate: true })
      // A re-queued retry gets a new attempt number and counts again.
      expect(
        await withUserLock(ctx.h.db, alice, (tx) =>
          sessions.recordSessionEvent(tx, alice, { ...ev, attemptSeq: 1 }),
        ),
      ).toEqual({ duplicate: false })
      const list = await withUser(ctx.h.db, alice, (tx) =>
        sessions.listSessionEvents(tx, alice, s.id),
      )
      expect(list.map((e) => [e.attemptSeq, e.challengeIndex, e.kind])).toEqual([
        [0, 2, 'wrong'],
        [1, 2, 'wrong'],
      ])
    })

    it('duplicates inside one transaction do not abort it', async () => {
      const s = await withUserLock(ctx.h.db, alice, (tx) =>
        sessions.createSession(tx, alice, newSession()),
      )
      const n = await withUserLock(ctx.h.db, alice, async (tx) => {
        await sessions.recordSessionEvent(tx, alice, {
          sessionId: s.id,
          attemptSeq: 5,
          challengeIndex: 0,
        })
        await sessions.recordSessionEvent(tx, alice, {
          sessionId: s.id,
          attemptSeq: 5,
          challengeIndex: 0,
        })
        return (await sessions.listSessionEvents(tx, alice, s.id)).length
      })
      expect(n).toBe(1)
    })
  })

  describe('session_answers', () => {
    it('are stored once per (session, idx, attemptSeq) with the session content version', async () => {
      const s = await withUserLock(ctx.h.db, alice, (tx) =>
        sessions.createSession(tx, alice, newSession({ contentVersion: 3 })),
      )
      const answers = [answer(0, 0), answer(1, 1, 'wrong'), answer(1, 2)]
      expect(
        await withUserLock(ctx.h.db, alice, (tx) =>
          sessions.insertSessionAnswers(tx, alice, s.id, answers),
        ),
      ).toBe(3)
      expect(
        await withUserLock(ctx.h.db, alice, (tx) =>
          sessions.insertSessionAnswers(tx, alice, s.id, answers),
        ),
      ).toBe(0)
      const stored = await withUser(ctx.h.db, alice, (tx) =>
        sessions.listSessionAnswers(tx, alice, s.id),
      )
      expect(stored).toHaveLength(3)
      expect(stored[1]).toMatchObject({
        idx: 1,
        attemptSeq: 1,
        verdict: 'wrong',
        contentVersion: 3,
        hinted: false,
      })
      expect(stored[0]!.response).toEqual({ kind: 'choice', value: 1 })
    })
  })

  describe('cross-user access (IDOR)', () => {
    let bobSession: string

    beforeAll(async () => {
      bobSession = (
        await withUserLock(ctx.h.db, bob, (tx) => sessions.createSession(tx, bob, newSession()))
      ).id
    })

    it("cannot read another user's session", async () => {
      expect(
        await withUser(ctx.h.db, alice, (tx) => sessions.getSession(tx, alice, bobSession)),
      ).toBeNull()
      // Even passing the victim's id as userId: RLS still hides the row.
      expect(
        await withUser(ctx.h.db, alice, (tx) => sessions.getSession(tx, bob, bobSession)),
      ).toBeNull()
      expect(
        await withUser(ctx.h.db, alice, (tx) =>
          sessions.getSessionForUpdate(tx, alice, bobSession),
        ),
      ).toBeNull()
    })

    it("cannot complete or expire another user's session", async () => {
      expect(
        await withUserLock(ctx.h.db, alice, (tx) =>
          sessions.completeSession(tx, alice, bobSession, {
            result: { hijacked: true },
            completedAt: '2026-09-25T10:01:00Z',
          }),
        ),
      ).toBe(false)
      expect(
        await withUserLock(ctx.h.db, alice, (tx) => sessions.expireSession(tx, bob, bobSession)),
      ).toBe(false)
      const s = await withUser(ctx.h.db, bob, (tx) => sessions.getSession(tx, bob, bobSession))
      expect(s).toMatchObject({ status: 'started', result: null })
    })

    it("cannot record events or answers on another user's session", async () => {
      await expect(
        withUserLock(ctx.h.db, alice, (tx) =>
          sessions.recordSessionEvent(tx, alice, {
            sessionId: bobSession,
            attemptSeq: 0,
            challengeIndex: 0,
          }),
        ),
      ).rejects.toBeInstanceOf(NotFoundError)
      await expect(
        withUserLock(ctx.h.db, alice, (tx) =>
          sessions.insertSessionAnswers(tx, alice, bobSession, [answer(0, 0)]),
        ),
      ).rejects.toBeInstanceOf(NotFoundError)
      expect(
        await withUser(ctx.h.db, alice, (tx) => sessions.listSessionEvents(tx, alice, bobSession)),
      ).toEqual([])
      expect(
        await withUser(ctx.h.db, alice, (tx) => sessions.listSessionAnswers(tx, bob, bobSession)),
      ).toEqual([])
      expect(
        await withUser(ctx.h.db, bob, (tx) => sessions.listSessionEvents(tx, bob, bobSession)),
      ).toEqual([])
    })

    it("the database rejects a child row pointing at another user's session, even in system scope", async () => {
      await expect(
        withSystem(ctx.h.db, (tx) =>
          // alice's event on bob's session: the composite FK (session_id, user_id) refuses it
          tx.execute(
            sql`INSERT INTO public.session_events (session_id, user_id, attempt_seq, challenge_index, kind)
              VALUES (${bobSession}, ${alice}, 0, 0, 'wrong')`,
          ),
        ),
      ).rejects.toMatchObject({ cause: { code: '23503' } }) // foreign_key_violation
    })
  })
})
