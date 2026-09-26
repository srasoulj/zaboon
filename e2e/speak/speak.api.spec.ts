/**
 * P2 speak over HTTP against the running app (fixture level u01-v1: two speak pins and a
 * listen_tap): POST /api/speech/transcribe answers 404 while flags.speak is off; with the flag on,
 * a transcript sent to /complete without the route's signed token grades wrong (a lost heart, a
 * grader mismatch), and the token the route returns for local test audio (TEST_TRANSCRIPT_PREFIX
 * + the words) grades correct.
 */
import type { APIRequestContext } from '@playwright/test'
import { expect, flagsHeader, test, TEST_TRANSCRIPT_PREFIX } from '../fixtures'
import {
  answersFor,
  call,
  canonical,
  correctResponse,
  expectEnvelope,
  guest,
  play,
  type Challenge,
  type Session,
  type User,
} from '../qa/support'

const SPEAK = { speak: true }

/** A guest who has played every level before u01-v1 (flags off), so u01-v1 is current. */
async function reachV1(request: APIRequestContext): Promise<User> {
  const u = await guest(request)
  await play(request, u)
  await play(request, u, { levelId: 'u01-l1' })
  await play(request, u, { levelId: 'u01-l2' })
  await play(request, u, { kind: 'practice', levelId: 'u01-p1' })
  await play(request, u, { kind: 'unit_review', levelId: 'u01-r1' })
  await play(request, u, { levelId: 'u01-t1' })
  return u
}

async function startV1(request: APIRequestContext, u: User, flags = SPEAK): Promise<Session> {
  const res = await call(request, u, '/api/sessions', {
    headers: flagsHeader(flags),
    data: { courseId: 'fixture', kind: 'lesson', levelId: 'u01-v1', tz: 'UTC' },
  })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as unknown as Session
}

const testAudio = (text: string) =>
  Buffer.from(TEST_TRANSCRIPT_PREFIX + text, 'utf8').toString('base64')

const transcribe = (
  request: APIRequestContext,
  u: User,
  s: Session,
  index: number,
  text: string,
  flags: Record<string, boolean> = SPEAK,
) =>
  call(request, u, '/api/speech/transcribe', {
    headers: flagsHeader(flags),
    data: {
      sessionId: s.sessionId,
      index,
      format: 'webm',
      audio: testAudio(text),
      durationMs: 1500,
    },
  })

/** The words a learner who says the prompt correctly is heard as. */
const said = (c: Challenge) => canonical(c.graph!).join(' ')

/** A ChallengeResponse (the QA helpers type only the MVP shapes). */
type Response = { kind: string } & Record<string, unknown>

/** Every challenge answered on the first try and claimed correct; speak answers from `speak`. */
function answers(s: Session, speak: (c: Challenge) => Response): unknown[] {
  return s.challenges.map((c, i) => ({
    index: c.index,
    attemptSeq: i,
    response: c.type === 'speak' ? speak(c) : correctResponse(c),
    verdict: 'correct',
    ms: 2500,
    hinted: false,
  }))
}

const complete = (request: APIRequestContext, u: User, s: Session, a: unknown[]) =>
  call(request, u, `/api/sessions/${s.sessionId}/complete`, {
    headers: flagsHeader(SPEAK),
    data: { answers: a, completedAt: new Date().toISOString(), graderVersion: s.graderVersion },
  })

test('transcribe answers 404 while flags.speak is off; u01-v1 then plays listen_tap twins', async ({
  request,
}) => {
  const u = await reachV1(request)
  const off = await startV1(request, u, {})
  expect(off.challenges.map((c) => c.type)).toEqual(['listen_tap', 'listen_tap', 'listen_tap'])
  expectEnvelope(await transcribe(request, u, off, 0, 'سلام', {}), 404, 'not_found')
  expectEnvelope(await transcribe(request, u, off, 0, 'سلام', { speak: false }), 404, 'not_found')
  const done = await complete(request, u, off, answersFor(off.challenges))
  expect(done.status, JSON.stringify(done.body)).toBe(200)
  expect(done.body).toMatchObject({ accuracy: 1, perfect: true })
})

test('a transcript without the signed token grades wrong, even when the client is trusted', async ({
  request,
}) => {
  const u = await reachV1(request)
  const s = await startV1(request, u)
  expect(s.challenges.filter((c) => c.type === 'speak')).toHaveLength(2)
  const forged = await complete(
    request,
    u,
    s,
    answers(s, (c) => ({ kind: 'audio', transcript: said(c) })),
  )
  expect(forged.status, JSON.stringify(forged.body)).toBe(200)
  expect(forged.body).toMatchObject({ perfect: false, graderMismatches: 2 })
  expect(forged.body.accuracy as number).toBeCloseTo(1 / 3)
  expect((forged.body.lives as { count: number }).count).toBe(3)
})

test('the token from the transcribe route grades the spoken transcript correct', async ({
  request,
}) => {
  const u = await reachV1(request)
  const s = await startV1(request, u)
  const tokens = new Map<number, Response>()
  for (const c of s.challenges.filter((x) => x.type === 'speak')) {
    const res = await transcribe(request, u, s, c.index, said(c))
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body).toMatchObject({ transcript: said(c), token: expect.any(String) })
    expect(res.body.remaining).toEqual(expect.any(Number))
    tokens.set(c.index, { kind: 'audio', transcript: res.body.transcript, token: res.body.token })
  }
  const ok = await complete(
    request,
    u,
    s,
    answers(s, (c) => tokens.get(c.index)!),
  )
  expect(ok.status, JSON.stringify(ok.body)).toBe(200)
  expect(ok.body).toMatchObject({ accuracy: 1, perfect: true, graderMismatches: 0 })
  expect((ok.body.xp as { total: number }).total).toBeGreaterThan(0)
})
