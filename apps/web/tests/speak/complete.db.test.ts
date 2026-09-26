/**
 * /complete re-grades a speak answer only through its signed transcript token (P2 speak): a
 * missing, forged or mismatched token (other user, session, index or transcript, or expired) grades
 * `wrong` whatever the client claims, even inside the grader trust window. A valid token grades
 * the transcript; the token is never stored. "Can't speak now" (`declined`) grades correct but is
 * non-rated: no SRS review and no mistake resolution, like a declined trace.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Challenge, ChallengeResponse } from '@zaboon/contracts'
import { speechToken } from '../../lib/server/speech/token'
import { finish } from '../api/flows'
import { createHarness, type Harness, type TestUser } from '../api/harness'
import {
  reachV1,
  speakIndexes,
  spoken,
  startV1,
  transcribeOk,
  v1Answers,
  type V1Session,
} from './support'

let h: Harness
let alice: TestUser
let bob: TestUser
beforeAll(async () => {
  h = await createHarness()
  alice = await reachV1(h)
  bob = await h.guest()
}, 120_000)
afterAll(async () => {
  await h?.close()
})

/** Real tokens from the route for every speak challenge of `s`, said correctly. */
async function realTokens(u: TestUser, s: V1Session): Promise<Map<number, ChallengeResponse>> {
  const out = new Map<number, ChallengeResponse>()
  for (const c of s.challenges.filter((x) => x.type === 'speak')) {
    const r = await transcribeOk(h, u, s, c.index, spoken(c))
    out.set(c.index, { kind: 'audio', transcript: r.transcript, token: r.token })
  }
  return out
}

/** Completes `s` with every speak answer from `speak(c)` (all claimed correct). */
function complete(
  u: TestUser,
  s: V1Session,
  speak: (c: Challenge) => ChallengeResponse,
  o: { trusted?: boolean } = {},
) {
  // Trusted: the server's own grader version (inside the window); untrusted: newer than the server's.
  const graderVersion = o.trusted === false ? s.graderVersion + 1 : s.graderVersion
  return finish(h, u, { ...s, graderVersion }, { answers: v1Answers(s, speak) })
}

describe('speak answers on /complete', () => {
  it('a real token from the route grades correct and is not stored', async () => {
    for (const trusted of [true, false]) {
      const s = await startV1(h, alice)
      const tokens = await realTokens(alice, s)
      const res = await complete(alice, s, (c) => tokens.get(c.index)!, { trusted })
      expect(res).toMatchObject({ accuracy: 1, perfect: true, graderMismatches: 0 })
      expect(res.lives).toMatchObject({ count: 5 })
      const rows = await h.sql`
        SELECT idx, response FROM session_answers
        WHERE session_id = ${s.sessionId} AND challenge_type = 'speak' ORDER BY idx`
      expect(rows).toHaveLength(2)
      for (const r of rows) {
        expect(r.response).toEqual({ kind: 'audio', transcript: spoken(s.challenges[r.idx]!) })
        expect(JSON.stringify(r.response)).not.toContain('token')
      }
      const [session] = await h.sql`SELECT result FROM sessions WHERE id = ${s.sessionId}`
      for (const t of tokens.values())
        expect(JSON.stringify(session!.result)).not.toContain((t as { token: string }).token)
    }
  })

  it('without a valid token the answer is wrong, even when the client is trusted', async () => {
    type Tamper = (
      c: Challenge,
      s: V1Session,
      real: ChallengeResponse & { kind: 'audio' },
    ) => ChallengeResponse
    const mint = (s: V1Session, over: Partial<Parameters<typeof speechToken>[0]>, c: Challenge) =>
      speechToken({
        userId: alice.id,
        sessionId: s.sessionId,
        index: c.index,
        transcript: spoken(c),
        expiresAt: new Date(s.expiresAt),
        ...over,
      })
    const cases: [string, Tamper][] = [
      ['missing token', (c) => ({ kind: 'audio', transcript: spoken(c) })],
      [
        'forged token',
        (c) => ({
          kind: 'audio',
          transcript: spoken(c),
          token: `v1.${'A'.repeat(60)}.${'B'.repeat(43)}`,
        }),
      ],
      ['garbage token', (c) => ({ kind: 'audio', transcript: spoken(c), token: 'not-a-token' })],
      ['empty token', (c) => ({ kind: 'audio', transcript: spoken(c), token: '' })],
      [
        'token of another user',
        (c, s) => ({ kind: 'audio', transcript: spoken(c), token: mint(s, { userId: bob.id }, c) }),
      ],
      [
        'token of another session',
        (c, s) => ({
          kind: 'audio',
          transcript: spoken(c),
          token: mint(s, { sessionId: crypto.randomUUID() }, c),
        }),
      ],
      [
        'token of another index',
        (c, s) => ({
          kind: 'audio',
          transcript: spoken(c),
          token: mint(s, { index: c.index + 1 }, c),
        }),
      ],
      [
        'token of another transcript',
        (c, s) => ({
          kind: 'audio',
          transcript: spoken(c),
          token: mint(s, { transcript: 'سلام' }, c),
        }),
      ],
      [
        'expired token',
        (c, s) => ({
          kind: 'audio',
          transcript: spoken(c),
          token: mint(s, { expiresAt: new Date(Date.now() - 1000) }, c),
        }),
      ],
      [
        'real token, edited transcript',
        (_c, _s, real) => ({ ...real, transcript: `${real.transcript} خوب` }),
      ],
      ['text instead of audio', (c) => ({ kind: 'text', value: spoken(c) })],
      [
        'declined trace sent for speak',
        () => ({ kind: 'trace', coverage: 0, precision: 0, declined: true }),
      ],
    ]
    for (const [name, tamper] of cases) {
      const s = await startV1(h, alice)
      const tokens = await realTokens(alice, s)
      const [target] = speakIndexes(s)
      const res = await complete(alice, s, (c) => {
        const real = tokens.get(c.index)! as ChallengeResponse & { kind: 'audio' }
        return c.index === target ? tamper(c, s, real) : real
      })
      expect(res, name).toMatchObject({ perfect: false, graderMismatches: 1 })
      expect(res.accuracy, name).toBeCloseTo(2 / 3)
      expect(res.lives.count, name).toBe(4)
      expect(res.mistakes, name).toEqual(
        expect.arrayContaining([expect.stringMatching(/^sentence:/)]),
      )
      const [row] = await h.sql`
        SELECT verdict FROM session_answers WHERE session_id = ${s.sessionId} AND idx = ${target!}`
      expect(row!.verdict, name).toBe('wrong')
      // Refill hearts for the next case.
      await h.sql`DELETE FROM lives WHERE user_id = ${alice.id}`
    }
  })

  it('a real token for a wrong utterance grades the transcript (wrong), whatever the client says', async () => {
    const s = await startV1(h, alice)
    const tokens = await realTokens(alice, s)
    const [target] = speakIndexes(s)
    const other = await transcribeOk(h, alice, s, target!, 'خداحافظ')
    const res = await complete(
      alice,
      s,
      (c) =>
        c.index === target
          ? { kind: 'audio', transcript: other.transcript, token: other.token }
          : tokens.get(c.index)!,
      { trusted: false },
    )
    expect(res).toMatchObject({ perfect: false, graderMismatches: 1 })
    expect(res.accuracy).toBeCloseTo(2 / 3)
    await h.sql`DELETE FROM lives WHERE user_id = ${alice.id}`
  })
})

describe('"Can\'t speak now" (declined)', () => {
  const declined: ChallengeResponse = { kind: 'audio', transcript: '', declined: true }

  /** Open mistakes and SRS state of the items only the speak pins exercise. */
  async function speakItems(u: TestUser, s: V1Session) {
    const refs = s.challenges
      .filter((c) => c.type === 'speak')
      .map((c) => `sentence:${c.ref.items[0]}`)
    const mistakes = await h.sql`
      SELECT item_ref, resolved_at FROM mistakes WHERE user_id = ${u.id} AND item_ref IN ${h.sql(refs)}
      ORDER BY item_ref`
    // lx_salam and lx_khub appear only in s_u01_0001 (not in the listen_tap sentence s_u01_0005).
    const cards = await h.sql`
      SELECT lexeme_id, reps, last_review FROM lexeme_memory
      WHERE user_id = ${u.id} AND lexeme_id IN ('lx_salam', 'lx_khub') ORDER BY lexeme_id`
    return { mistakes, cards: cards.map((c) => ({ ...c })) }
  }

  it('grades correct without a token, costs no heart, and is non-rated; a spoken answer rates', async () => {
    const results: Record<string, Awaited<ReturnType<typeof speakItems>>> = {}
    for (const name of ['declined', 'spoken'] as const) {
      const u = await reachV1(h)
      const s = await startV1(h, u)
      for (const c of s.challenges.filter((x) => x.type === 'speak'))
        await h.sql`INSERT INTO mistakes (user_id, item_ref, last_wrong_at)
                    VALUES (${u.id}, ${`sentence:${c.ref.items[0]}`}, '2026-01-01T00:00:00Z')
                    ON CONFLICT (user_id, item_ref) DO UPDATE SET resolved_at = NULL`
      const before = await speakItems(u, s)
      expect(before.mistakes).toHaveLength(2)
      const tokens = name === 'spoken' ? await realTokens(u, s) : null
      const res = await complete(u, s, (c) => (tokens ? tokens.get(c.index)! : declined), {
        trusted: false,
      })
      expect(res, name).toMatchObject({ accuracy: 1, perfect: true, graderMismatches: 0 })
      expect(res.lives, name).toMatchObject({ count: 5 })
      const after = await speakItems(u, s)
      if (name === 'declined') expect(after).toEqual(before)
      results[name] = after
    }
    expect(results.declined!.mistakes.every((m) => m.resolved_at === null)).toBe(true)
    expect(results.spoken!.mistakes.every((m) => m.resolved_at !== null)).toBe(true)
    const reps = (r: (typeof results)[string] | undefined) =>
      (r?.cards ?? []).reduce((n, c) => n + Number(c.reps), 0)
    expect(reps(results.spoken)).toBeGreaterThan(reps(results.declined))
  })

  it('a declined answer is stored as declined (no token) and trusted clients get the same result', async () => {
    const s = await startV1(h, alice)
    const res = await complete(alice, s, () => declined)
    expect(res).toMatchObject({ accuracy: 1, perfect: true, graderMismatches: 0 })
    const rows = await h.sql`
      SELECT response, verdict FROM session_answers
      WHERE session_id = ${s.sessionId} AND challenge_type = 'speak'`
    expect(rows.map((r) => [r.response, r.verdict])).toEqual([
      [declined, 'correct'],
      [declined, 'correct'],
    ])
  })
})
