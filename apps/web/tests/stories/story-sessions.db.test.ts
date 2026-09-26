/**
 * P2 stories on the server (flags.stories): the fixture's story level u01-st1 (story st_u01_tea,
 * three beats) plays as a `story` session. It starts only while the flag is on, needs no hearts,
 * spends none (live wrong events or at commit), earns xp.base.story, is not rated (no SRS rows, no
 * mistakes) and completes its path level.
 */
import { DEFAULT_APP_CONFIG, type Challenge, type ChallengeResponse } from '@zaboon/contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  api,
  finish,
  finishRaw,
  get,
  play,
  start,
  wrongEvent,
  type StartedSession,
} from '../api/flows'
import { createHarness, type Harness, type TestUser } from '../api/harness'

const STORIES = { stories: true } as const
const LEVEL = 'u01-st1'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h?.close()
})

type Level = { id: string; kind: string; state: string }
const levels = async (user: TestUser): Promise<Level[]> => {
  const res = await get(h, api.path, '/api/path?courseId=fixture', user)
  expect(res.status).toBe(200)
  return (res.body.sections as { units: { levels: Level[] }[] }[]).flatMap((s) =>
    s.units.flatMap((u) => u.levels),
  )
}
const levelState = async (user: TestUser, id: string) =>
  (await levels(user)).find((l) => l.id === id)?.state

function startStoryRaw(
  user: TestUser,
  o: { levelId?: string; flags?: Record<string, boolean> } = {},
) {
  return h.call(api.createSession, {
    path: '/api/sessions',
    user,
    flags: o.flags ?? STORIES,
    body: { courseId: 'fixture', kind: 'story', levelId: o.levelId ?? LEVEL, tz: 'UTC' },
  })
}
async function startStory(user: TestUser): Promise<StartedSession> {
  const res = await startStoryRaw(user)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as StartedSession
}

/** A guest who has played every level before the story (flags off), so the story is open. */
async function reachStory(): Promise<TestUser> {
  const u = await h.guest()
  await play(h, u) // u01-s0
  await play(h, u, { levelId: 'u01-l1' })
  await play(h, u, { levelId: 'u01-l2' })
  await play(h, u, { kind: 'practice', levelId: 'u01-p1' })
  await play(h, u, { kind: 'unit_review', levelId: 'u01-r1' })
  await play(h, u, { levelId: 'u01-t1' }) // flags off: its MVP twins
  await play(h, u, { levelId: 'u01-v1' }) // flags off: its MVP twins
  return u
}

type Story = Extract<Challenge, { type: 'story' }>
const asStory = (c: Challenge): Story => {
  expect(c.type).toBe('story')
  return c as Story
}
const right = (c: Story): ChallengeResponse =>
  c.question ? { kind: 'choice', value: c.question.answer } : { kind: 'none' }

/** Answers every beat right; `wrongFirst` beats get a wrong choice first (retried in place). */
function storyAnswers(s: StartedSession, wrongFirst: readonly number[] = []) {
  const out: unknown[] = []
  let seq = 0
  for (const c of s.challenges.map(asStory)) {
    if (wrongFirst.includes(c.index) && c.question)
      out.push({
        index: c.index,
        attemptSeq: seq++,
        response: {
          kind: 'choice',
          value: (c.question.answer + 1) % c.question.choices.length,
        },
        verdict: 'wrong',
        ms: 2500,
        hinted: false,
      })
    out.push({
      index: c.index,
      attemptSeq: seq++,
      response: right(c),
      verdict: 'correct',
      ms: 2500,
      hinted: false,
    })
  }
  return out
}

/** The learner's SRS memory and open mistakes, to compare before and after a session. */
const learnerRows = async (userId: string) => ({
  memory: await h.sql`
    SELECT lexeme_id, reps, exposures, due, updated_at FROM lexeme_memory
    WHERE user_id = ${userId} ORDER BY lexeme_id`,
  letters: await h.sql`
    SELECT letter_id, reps, exposures, due, updated_at FROM letter_memory
    WHERE user_id = ${userId} ORDER BY letter_id`,
  mistakes: await h.sql`SELECT * FROM mistakes WHERE user_id = ${userId} ORDER BY item_ref`,
})

describe('story sessions: availability', () => {
  it('with the flag off, kind story is a 400 validation (whatever the level)', async () => {
    const alice = await reachStory()
    for (const flags of [{}, { stories: false }] as Record<string, boolean>[]) {
      const res = await startStoryRaw(alice, { flags })
      expect(res.status, JSON.stringify(res.body)).toBe(400)
      expect(res.body.error.code).toBe('validation')
    }
    const lesson = await startStoryRaw(alice, { levelId: 'u01-s0', flags: {} })
    expect(lesson.status).toBe(400)
    expect(lesson.body.error.code).toBe('validation')
  })

  it('a level that is not a story is a 400 validation; an unknown level a 404', async () => {
    const alice = await h.guest()
    const res = await startStoryRaw(alice, { levelId: 'u01-s0' })
    expect(res.status, JSON.stringify(res.body)).toBe(400)
    expect(res.body.error.code).toBe('validation')
    const missing = await startStoryRaw(alice, { levelId: 'u99-st9' })
    expect(missing.status).toBe(404)
    // …and the story level cannot be played as a lesson.
    const asLesson = await h.call(api.createSession, {
      path: '/api/sessions',
      user: alice,
      flags: STORIES,
      body: { courseId: 'fixture', kind: 'lesson', levelId: LEVEL, tz: 'UTC' },
    })
    expect(asLesson.status).toBe(400)
  })

  it('needs a level id', async () => {
    const alice = await h.guest()
    const res = await h.call(api.createSession, {
      path: '/api/sessions',
      user: alice,
      flags: STORIES,
      body: { courseId: 'fixture', kind: 'story', tz: 'UTC' },
    })
    expect(res.status).toBe(400)
  })

  it('is locked until the path reaches it, then open (it never becomes current)', async () => {
    const alice = await h.guest()
    await play(h, alice) // u01-s0
    expect(await levelState(alice, LEVEL)).toBe('locked')
    const locked = await startStoryRaw(alice)
    expect(locked.status).toBe(403)

    const bob = await reachStory()
    const path = await levels(bob)
    expect(path.find((l) => l.id === LEVEL)).toMatchObject({ kind: 'story', state: 'available' })
    expect(path.some((l) => l.state === 'current')).toBe(false)
  })
})

describe('story sessions: play and commit', () => {
  it('is one story challenge per beat, in order, and stores story refs', async () => {
    const alice = await reachStory()
    const s = await startStory(alice)
    expect(s).toMatchObject({ kind: 'story', levelId: LEVEL })
    const beats = s.challenges.map(asStory)
    expect(beats).toHaveLength(3)
    expect(beats.map((b) => b.beat)).toEqual([0, 1, 2])
    for (const b of beats) expect(b).toMatchObject({ storyId: 'st_u01_tea', beats: 3 })
    const stored = await h.sql`SELECT kind, challenge_refs FROM sessions WHERE id = ${s.sessionId}`
    expect(stored[0]!.kind).toBe('story')
    for (const r of stored[0]!.challenge_refs as { type: string; items: string[] }[])
      expect(r).toMatchObject({ type: 'story', items: ['st_u01_tea'] })
  })

  it('earns xp.base.story (plus the perfect bonus), completes the level, and is not rated', async () => {
    const alice = await reachStory()
    const before = await learnerRows(alice.id)
    expect(before.memory.length).toBeGreaterThan(0) // the lessons before it were rated
    const s = await startStory(alice)
    const result = await finish(h, alice, s, { answers: storyAnswers(s) })
    const { base } = DEFAULT_APP_CONFIG.xp
    expect(result).toMatchObject({
      kind: 'story',
      accuracy: 1,
      perfect: true,
      xp: {
        base: base.story,
        bonus: DEFAULT_APP_CONFIG.xp.perfectBonus,
        total: base.story + DEFAULT_APP_CONFIG.xp.perfectBonus,
      },
      level: { levelId: LEVEL, completed: true },
      mistakes: [],
      lives: { count: 5 },
    })
    expect(await levelState(alice, LEVEL)).toBe('completed')
    // Not rated: no memory row written or changed, no mistake opened or cleared.
    expect(await learnerRows(alice.id)).toEqual(before)
    // The XP counts like any session's: ledger (reason = the kind), daily activity, streak.
    const ledger =
      await h.sql`SELECT reason, amount FROM xp_ledger WHERE session_id = ${s.sessionId} ORDER BY reason`
    expect(ledger.map((r) => [r.reason, r.amount])).toEqual([
      ['perfect_bonus', DEFAULT_APP_CONFIG.xp.perfectBonus],
      ['story', base.story],
    ])
    expect(result.streak).toMatchObject({ current: 1 })
    // Replayable like any completed level.
    const again = await startStory(alice)
    expect(again.challenges).toHaveLength(3)
  })

  it('a wrong answer, live or at commit, costs no heart; the session is not perfect', async () => {
    const alice = await reachStory()
    const s = await startStory(alice)
    const question = s.challenges.map(asStory).find((c) => c.question)!
    const ev = await wrongEvent(h, alice, s.sessionId, 0, { index: question.index })
    expect(ev.status, JSON.stringify(ev.body)).toBe(200)
    expect(ev.body).toMatchObject({ duplicate: false, lives: { count: 5 } })
    const replay = await wrongEvent(h, alice, s.sessionId, 0, { index: question.index })
    expect(replay.body).toMatchObject({ duplicate: true, lives: { count: 5 } })

    // Two wrong first attempts at commit, only one of them sent live: still no heart.
    const both = s.challenges
      .map(asStory)
      .filter((c) => c.question)
      .map((c) => c.index)
    const before = await learnerRows(alice.id)
    const result = await finish(h, alice, s, { answers: storyAnswers(s, both) })
    expect(result).toMatchObject({
      perfect: false,
      xp: { base: DEFAULT_APP_CONFIG.xp.base.story, bonus: 0 },
      lives: { count: 5 },
      mistakes: [],
      level: { levelId: LEVEL, completed: true },
    })
    expect(result.accuracy).toBeLessThan(1)
    expect(await learnerRows(alice.id)).toEqual(before) // a wrong answer opens no mistake
    expect((await get(h, api.home, '/api/home', alice)).body.lives.count).toBe(5)
  })

  it('starts with no hearts left (lessons do not)', async () => {
    const alice = await reachStory()
    const lesson = await start(h, alice) // u01-s0, replay
    for (let seq = 0; seq < 5; seq++) {
      const r = await wrongEvent(h, alice, lesson.sessionId, seq)
      expect(r.body.lives.count).toBe(4 - seq)
    }
    const blocked = await h.call(api.createSession, {
      path: '/api/sessions',
      user: alice,
      body: { courseId: 'fixture', kind: 'lesson', levelId: 'u01-s0', tz: 'UTC' },
    })
    expect(blocked.body.error.code).toBe('out_of_lives')

    const s = await startStory(alice)
    expect(s.lives.count).toBe(0)
    const result = await finish(h, alice, s, { answers: storyAnswers(s) })
    expect(result).toMatchObject({ lives: { count: 0 }, level: { completed: true } })
  })

  it('a session started with the flag on completes after it is turned off (refs are stored)', async () => {
    const alice = await reachStory()
    const s = await startStory(alice)
    const res = await h.call(api.complete, {
      path: `/api/sessions/${s.sessionId}/complete`,
      params: { id: s.sessionId },
      user: alice,
      flags: { stories: false },
      body: {
        answers: storyAnswers(s),
        completedAt: new Date().toISOString(),
        graderVersion: s.graderVersion,
      },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body).toMatchObject({ kind: 'story', level: { completed: true } })
  })

  it('another learner cannot send events to or complete the story session (IDOR)', async () => {
    const alice = await reachStory()
    const bob = await h.guest()
    const s = await startStory(alice)
    const ev = await wrongEvent(h, bob, s.sessionId, 0)
    expect(ev.status).toBe(404)
    const done = await finishRaw(h, bob, s, { answers: storyAnswers(s) })
    expect(done.status).toBe(404)
    // alice's session is untouched and still completes.
    const rows = await h.sql`SELECT status FROM sessions WHERE id = ${s.sessionId}`
    expect(rows[0]!.status).toBe('started')
    await finish(h, alice, s, { answers: storyAnswers(s) })
  })
})
