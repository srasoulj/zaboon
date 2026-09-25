/**
 * The fixture's Wave 3 level u01-t1 (typed Persian + letter tracing), end to end on the server.
 * With the flags persianKeyboard and letterTrace on, its session builds the four pinned P2
 * challenges and /complete re-grades them (typed Persian through the grader, traces against the
 * engine's thresholds). With the flags off it plays the MVP twins in place. Stored refs hold what
 * was built, so /complete never depends on the flags.
 */
import type { Challenge, ChallengeResponse } from '@zaboon/contracts'
import { TRACE_MIN_COVERAGE, TRACE_MIN_PRECISION } from '@zaboon/session-engine'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, finish, get, play, startRaw, type StartedSession } from '../api/flows'
import { createHarness, type Harness, type TestUser } from '../api/harness'
import { answersFor, canonicalTokens } from '../api/play'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h?.close()
})

type Level = { id: string; state: string }
const levels = async (user: Parameters<typeof get>[3]): Promise<Level[]> => {
  const res = await get(h, api.path, '/api/path?courseId=fixture', user)
  expect(res.status).toBe(200)
  return (res.body.sections as { units: { levels: Level[] }[] }[]).flatMap((s) =>
    s.units.flatMap((u) => u.levels),
  )
}

describe('fixture level u01-t1', () => {
  it('is the last level of the path, locked until the unit review is done', async () => {
    const alice = await h.guest()
    await play(h, alice) // u01-s0
    const path = await levels(alice)
    expect(path.map((l) => l.id)).toEqual([
      'u01-s0',
      'u01-l1',
      'u01-l2',
      'u01-p1',
      'u01-r1',
      'u01-t1',
    ])
    expect(path.at(-1)).toMatchObject({ id: 'u01-t1', state: 'locked' })
    expect((await startRaw(h, alice, { levelId: 'u01-t1' })).status).toBe(403)
  })

  /** A guest who has finished every MVP level, so u01-t1 is current. */
  const reachT1 = async (): Promise<TestUser> => {
    const alice = await h.guest()
    await play(h, alice) // u01-s0
    await play(h, alice, { levelId: 'u01-l1' })
    await play(h, alice, { levelId: 'u01-l2' })
    await play(h, alice, { kind: 'practice', levelId: 'u01-p1' })
    await play(h, alice, { kind: 'unit_review', levelId: 'u01-r1' })
    expect((await levels(alice)).at(-1)).toMatchObject({ id: 'u01-t1', state: 'current' })
    return alice
  }

  const startT1 = async (user: TestUser, flags: Record<string, boolean>) => {
    const res = await h.call(api.createSession, {
      path: '/api/sessions',
      user,
      flags,
      body: { courseId: 'fixture', kind: 'lesson', levelId: 'u01-t1', tz: 'UTC' },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return res.body as StartedSession
  }

  /** What a learner types (or traces) for a P2 challenge. */
  const p2Answer = (
    c: Challenge,
    trace: { coverage: number; precision: number },
  ): ChallengeResponse => {
    switch (c.type) {
      case 'translate_type':
      case 'listen_type':
      case 'cloze_type':
        return { kind: 'text', value: canonicalTokens(c.graph).join(' ') }
      case 'letter_trace':
        return { kind: 'trace', ...trace }
      default:
        throw new Error(`not a P2 challenge: ${c.type}`)
    }
  }
  const answers = (s: StartedSession, trace: { coverage: number; precision: number }) =>
    s.challenges.map((c, i) => ({
      index: c.index,
      attemptSeq: i,
      response: p2Answer(c, trace),
      verdict: 'correct' as const,
      ms: 2500,
      hinted: false,
    }))
  /**
   * A grader version outside the server's window (newer than the server's), so /complete keeps its
   * own verdicts instead of the learner's: what these tests check is the server's re-grade.
   */
  const untrusted = (s: StartedSession): StartedSession => ({
    ...s,
    graderVersion: s.graderVersion + 1,
  })
  const good = { coverage: TRACE_MIN_COVERAGE + 0.1, precision: TRACE_MIN_PRECISION + 0.1 }

  it('with the flags on: builds the four P2 challenges and completes, re-graded on the server', async () => {
    const alice = await reachT1()
    const s = await startT1(alice, { persianKeyboard: true, letterTrace: true })
    expect(s.challenges.map((c) => c.type)).toEqual([
      'translate_type',
      'listen_type',
      'cloze_type',
      'letter_trace',
    ])
    const [typed, , , trace] = s.challenges
    expect(typed).toMatchObject({ direction: 'en_fa', answerLang: 'fa' })
    expect(trace).toMatchObject({ form: 'isolated', letter: { id: 'l_be', letter: 'ب' } })
    const stored = await h.sql`SELECT challenge_refs FROM sessions WHERE id = ${s.sessionId}`
    expect((stored[0]!.challenge_refs as { type: string }[]).map((r) => r.type)).toEqual([
      'translate_type',
      'listen_type',
      'cloze_type',
      'letter_trace',
    ])

    const result = await finish(h, alice, untrusted(s), { answers: answers(s, good) })
    expect(result).toMatchObject({ accuracy: 1, perfect: true, graderMismatches: 0 })
    expect((await levels(alice)).at(-1)).toMatchObject({ id: 'u01-t1', state: 'completed' })
  })

  it('a failed trace the client called correct is wrong on the server; a declined one passes', async () => {
    const alice = await reachT1()
    const s = await startT1(alice, { persianKeyboard: true, letterTrace: true })
    const scribble = { coverage: 0.2, precision: 0.3 }
    const res = await finish(h, alice, untrusted(s), { answers: answers(s, scribble) })
    expect(res).toMatchObject({ accuracy: 0.75, perfect: false, graderMismatches: 1 })

    const bob = await reachT1()
    const t = await startT1(bob, { persianKeyboard: true, letterTrace: true })
    const declined = answers(t, good).map((a) =>
      a.response.kind === 'trace'
        ? {
            ...a,
            response: {
              kind: 'trace' as const,
              coverage: 0,
              precision: 0,
              declined: true as const,
            },
          }
        : a,
    )
    const ok = await finish(h, bob, untrusted(t), { answers: declined })
    expect(ok).toMatchObject({ accuracy: 1, perfect: true, graderMismatches: 0 })
    expect(ok.lives).toMatchObject({ count: 5 })
  })

  it('lenient typed Persian passes (no half-space, a typo); another word is wrong', async () => {
    const alice = await reachT1()
    const s = await startT1(alice, { persianKeyboard: true, letterTrace: true })
    const typed = answers(s, good)
    const cloze = s.challenges.findIndex((c) => c.type === 'cloze_type')
    const listen = s.challenges.findIndex((c) => c.type === 'listen_type')
    const translate = s.challenges.findIndex((c) => c.type === 'translate_type')
    // «نون می‌خوام» typed without the half-space is accepted.
    typed[translate] = { ...typed[translate]!, response: { kind: 'text', value: 'نون میخوام' } }
    // «چای می‌خوای؟» with a letter left out of the verb is a typo, not a wrong answer.
    typed[listen] = { ...typed[listen]!, response: { kind: 'text', value: 'چای می‌خوی' } }
    typed[cloze] = { ...typed[cloze]!, response: { kind: 'text', value: 'نون' } }
    const res = await finish(h, alice, untrusted(s), { answers: typed })
    expect(res).toMatchObject({ accuracy: 0.75, perfect: false, graderMismatches: 1 })
  })

  it('with the flags off: the MVP twins in place, completed like any MVP lesson', async () => {
    const alice = await reachT1()
    for (const flags of [{}, { persianKeyboard: false, letterTrace: false }]) {
      const s = await startT1(alice, flags)
      expect(s.challenges.map((c) => c.type)).toEqual([
        'translate_bank',
        'listen_tap',
        'cloze_choice',
        'letter_forms',
      ])
    }
    const s = await startT1(alice, {})
    const result = await finish(h, alice, s, { answers: answersFor(s.challenges) })
    expect(result).toMatchObject({ accuracy: 1, perfect: true })
  })

  it('a session started with the flags on completes after they are turned off (refs are stored)', async () => {
    const alice = await reachT1()
    const s = await startT1(alice, { persianKeyboard: true, letterTrace: true })
    await h.setFlags({ persianKeyboard: false, letterTrace: false })
    const result = await finish(h, alice, untrusted(s), { answers: answers(s, good) })
    expect(result).toMatchObject({ accuracy: 1, perfect: true })
  })
})
