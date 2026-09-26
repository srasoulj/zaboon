/**
 * QA: server authority over Wave 3 answers on /complete (LEARNING-ENGINE §7.3). The server
 * re-grades every attempt against the stored refs:
 * - inside the grader window the learner's verdict stands and each disagreement is counted in
 *   `graderMismatches` (the documented trust model);
 * - outside it (a graderVersion the server doesn't support) the server's verdict decides XP,
 *   hearts, accuracy and mistakes.
 * Also what a declined trace ("Can't trace now") moves compared with a traced letter.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ChallengeResponse } from '@zaboon/contracts'
import { createHarness, type Harness } from '../api/harness'
import { api, read } from '../engagement/helpers'
import { attempts, completeWith, reachT1, startT1 } from './support'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h?.close()
})

const day1 = '2034-05-02T09:00:00.000Z'
const day2 = '2034-05-03T09:00:00.000Z'
const typing = { persianKeyboard: true, letterTrace: true }
/** A graderVersion newer than the server's window: /complete keeps its own verdicts. */
const untrusted = (v: number) => v + 50

const cases: { name: string; type: string; response: ChallengeResponse }[] = [
  {
    name: 'a wrong typed Persian answer',
    type: 'translate_type',
    response: { kind: 'text', value: 'سلام' },
  },
  {
    name: 'Latin letters in a Persian answer',
    type: 'listen_type',
    response: { kind: 'text', value: 'chai mikhay' },
  },
  {
    name: 'another word in the cloze blank',
    type: 'cloze_type',
    response: { kind: 'text', value: 'نون' },
  },
  {
    name: 'an empty trace (no strokes)',
    type: 'letter_trace',
    response: { kind: 'trace', coverage: 0, precision: 0 },
  },
  {
    name: 'a random scribble',
    type: 'letter_trace',
    response: { kind: 'trace', coverage: 0.41, precision: 0.33 },
  },
  {
    name: 'a trace just under the coverage bar',
    type: 'letter_trace',
    response: { kind: 'trace', coverage: 0.79, precision: 1 },
  },
  {
    name: 'a declined trace sent for a typed challenge',
    type: 'translate_type',
    response: { kind: 'trace', coverage: 0, precision: 0, declined: true },
  },
  {
    name: 'a choice index sent for a trace',
    type: 'letter_trace',
    response: { kind: 'choice', value: 0 },
  },
]

describe('crafted /complete payloads for u01-t1 marked correct', () => {
  for (const c of cases) {
    it(`${c.name}: counted as a mismatch in the window, wrong outside it`, async () => {
      const u = await reachT1(h, day1)
      const s = await startT1(h, u, day2, typing)
      const trusted = await completeWith(h, u, s, attempts(s, { [c.type]: c.response }), {
        now: day2,
      })
      expect(trusted.status, JSON.stringify(trusted.body)).toBe(200)
      expect(trusted.body).toMatchObject({ graderMismatches: 1, accuracy: 1 })

      const v = await reachT1(h, day1)
      const t = await startT1(h, v, day2, typing)
      const res = await completeWith(h, v, t, attempts(t, { [c.type]: c.response }), {
        now: day2,
        graderVersion: untrusted(t.graderVersion),
      })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(res.body).toMatchObject({
        graderMismatches: 1,
        accuracy: 0.75,
        perfect: false,
        // The server-counted wrong answer costs its heart (no event was sent for it).
        lives: { count: 4 },
        xp: { bonus: 0 },
      })
      expect(res.body.mistakes.length).toBeGreaterThan(0)
    })
  }

  it('a trace scored above both thresholds passes (scores come from the client, by design)', async () => {
    const u = await reachT1(h, day1)
    const s = await startT1(h, u, day2, typing)
    const res = await completeWith(
      h,
      u,
      s,
      attempts(s, { letter_trace: { kind: 'trace', coverage: 1, precision: 1 } }),
      { now: day2, graderVersion: untrusted(s.graderVersion) },
    )
    expect(res.body).toMatchObject({ graderMismatches: 0, accuracy: 1, perfect: true })
  })
})

describe('a declined trace', () => {
  const declined: ChallengeResponse = { kind: 'trace', coverage: 0, precision: 0, declined: true }
  const all = { ...typing, quests: true, shop: true }
  /** What one perfect lesson of 15 XP adds to each quest metric. */
  const PER_LESSON: Record<string, number> = { xp: 15, lessons: 1, perfect_sessions: 1 }

  it('moves XP, hearts, perfect and quests exactly like a traced letter, and earns nothing extra', async () => {
    const results = []
    for (const response of [
      declined,
      { kind: 'trace', coverage: 0.95, precision: 0.95 } as const,
    ]) {
      const u = await reachT1(h, day1)
      const s = await startT1(h, u, day2, all)
      const res = await completeWith(h, u, s, attempts(s, { letter_trace: response }), {
        now: day2,
        flags: all,
        graderVersion: untrusted(s.graderVersion),
      })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      const q = await read(h, api.quests, '/api/quests', u, { now: day2, flags: all })
      results.push({
        xp: res.body.xp,
        perfect: res.body.perfect,
        accuracy: res.body.accuracy,
        lives: res.body.lives.count,
        mistakes: res.body.mistakes,
        // Quest ids differ per learner: what the session added to each of the day's quests.
        quests: (q.body.quests as { metric: string; target: number; progress: number }[]).map(
          (x) => ({ ...x, expected: Math.min(x.target, PER_LESSON[x.metric] ?? 0) }),
        ),
      })
    }
    const [d, t] = results
    expect(d).toMatchObject({
      xp: t!.xp,
      perfect: true,
      accuracy: 1,
      lives: 5,
      mistakes: [],
    })
    for (const r of results)
      for (const q of r.quests) expect(q.progress, `${q.metric} quest`).toBe(q.expected)
  })

  it('costs no heart even after a failed trace of the same letter in the session', async () => {
    const u = await reachT1(h, day1)
    const s = await startT1(h, u, day2, typing)
    const trace = s.challenges.find((c) => c.type === 'letter_trace')!
    const answers = attempts(s)
    const failed = answers.find((a) => a.index === trace.index)!
    failed.response = { kind: 'trace', coverage: 0.2, precision: 0.2 }
    failed.verdict = 'wrong'
    answers.push({ ...failed, attemptSeq: answers.length, response: declined, verdict: 'correct' })
    const res = await completeWith(h, u, s, answers, {
      now: day2,
      graderVersion: untrusted(s.graderVersion),
    })
    expect(res.body).toMatchObject({ graderMismatches: 0, perfect: false, lives: { count: 4 } })
    expect(res.body.mistakes).toEqual(['letter:l_be'])
  })
})
