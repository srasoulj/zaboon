/**
 * Sessions: creation (kinds, level locking, hearts gate), wrong-attempt events and the commit
 * (replay, concurrency, hearts reconciliation, SRS, XP and plausibility checks).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, finish, finishRaw, get, play, start, startRaw, wrongEvent } from './flows'
import { createHarness, type Harness } from './harness'
import { answersFor, correctResponse } from './play'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h?.close()
})

describe('POST /api/sessions', () => {
  it('builds the fixture first lesson and enrolls the learner', async () => {
    const alice = await h.guest()
    const s = await start(h, alice)
    expect(s.challenges.map((c) => c.type)).toEqual([
      'select_translation',
      'translate_bank',
      'translate_type',
      'match_pairs',
    ])
    expect(s).toMatchObject({ kind: 'lesson', levelId: 'u01-s0', lives: { count: 5, max: 5 } })
    const home = await get(h, api.home, '/api/home', alice)
    expect(home.body.course).toMatchObject({ id: 'fixture', currentLevelId: 'u01-s0' })
  })

  it('refuses locked levels until the levels before them are completed', async () => {
    const alice = await h.guest()
    const locked = await startRaw(h, alice, { levelId: 'u01-l1' })
    expect(locked.status).toBe(403)
    expect(locked.body.error.code).toBe('forbidden')
    await play(h, alice)
    await start(h, alice, { levelId: 'u01-l1' })
    // Completed levels stay replayable.
    await start(h, alice, { levelId: 'u01-s0' })
  })

  it('validates kinds and levels', async () => {
    const alice = await h.guest()
    for (const kind of ['legendary', 'jump_test'] as const) {
      const r = await startRaw(h, alice, { kind, levelId: 'u01-s0' })
      expect(r.status).toBe(400)
      expect(r.body.error.code).toBe('validation')
    }
    expect((await startRaw(h, alice, { kind: 'unit_review' })).status).toBe(400) // needs levelId
    expect((await startRaw(h, alice, { kind: 'unit_review', levelId: 'u01-s0' })).status).toBe(400)
    expect((await startRaw(h, alice, { levelId: 'u99-nope' })).status).toBe(404)
    expect((await startRaw(h, alice, { courseId: 'no-such-course' })).status).toBe(404)
    expect((await startRaw(h, alice, { kind: 'letters', levelId: 'u01-letters-2' })).status).toBe(
      403,
    )
  })

  it('generates practice, letters and unit review sessions', async () => {
    const alice = await h.guest()
    const practice = await start(h, alice, { kind: 'practice' })
    expect(practice.levelId).toBe('u01-s0') // scoped to the current level's unit
    expect(practice.challenges.length).toBeGreaterThan(0)

    const letters = await start(h, alice, { kind: 'letters' })
    expect(letters.levelId).toBe('u01-letters-1')
    expect(letters.challenges.some((c) => c.type === 'letter_intro')).toBe(true)
    const result = await finish(h, alice, letters)
    expect(result.level).toMatchObject({ levelId: 'u01-letters-1', completed: true })
    expect((await start(h, alice, { kind: 'letters' })).levelId).toBe('u01-letters-2')

    // The unit review is locked until every level before it is done.
    expect((await startRaw(h, alice, { kind: 'unit_review', levelId: 'u01-r1' })).status).toBe(403)
    await play(h, alice) // u01-s0
    await play(h, alice, { levelId: 'u01-l1' })
    await play(h, alice, { levelId: 'u01-l2' })
    const p = await play(h, alice, { kind: 'practice', levelId: 'u01-p1' })
    expect(p.level).toMatchObject({ levelId: 'u01-p1', completed: true })
    const review = await start(h, alice, { kind: 'unit_review', levelId: 'u01-r1' })
    expect(review.challenges.length).toBeGreaterThan(0)
    const r = await finish(h, alice, review)
    expect(r.xp.base).toBe(20)
    expect(r.level).toMatchObject({ levelId: 'u01-r1', completed: true })
  })

  it('treats a repeated create (double tap) as two independent sessions that cost nothing', async () => {
    const alice = await h.guest()
    const [a, b] = await Promise.all([start(h, alice), start(h, alice)])
    expect(a.sessionId).not.toBe(b.sessionId)
    expect(b.challenges.map((c) => c.type)).toEqual(a.challenges.map((c) => c.type))
    await finish(h, alice, b)
    const home = await get(h, api.home, '/api/home', alice)
    expect(home.body).toMatchObject({ xpTotal: 15, lives: { count: 5 } })
    const [row] = await h.sql`SELECT status FROM sessions WHERE id = ${a.sessionId}`
    expect(row!.status).toBe('started')
  })

  it('stops lessons at zero hearts, but not practice', async () => {
    const alice = await h.guest()
    const s = await start(h, alice)
    for (let seq = 0; seq < 5; seq++) {
      const r = await wrongEvent(h, alice, s.sessionId, seq)
      expect(r.status).toBe(200)
      expect(r.body.lives.count).toBe(4 - seq)
    }
    const out = await startRaw(h, alice)
    expect(out.status).toBe(409)
    expect(out.body.error.code).toBe('out_of_lives')
    await start(h, alice, { kind: 'practice' })
  })
})

describe('POST /api/sessions/:id/events', () => {
  it('costs one heart per attempt and is idempotent on (session, attemptSeq)', async () => {
    const alice = await h.guest()
    const s = await start(h, alice)
    const first = await wrongEvent(h, alice, s.sessionId, 7)
    expect(first.body).toMatchObject({ duplicate: false, lives: { count: 4 } })
    const replay = await wrongEvent(h, alice, s.sessionId, 7)
    expect(replay.body).toMatchObject({ duplicate: true, lives: { count: 4 } })
    const retry = await wrongEvent(h, alice, s.sessionId, 8)
    expect(retry.body).toMatchObject({ duplicate: false, lives: { count: 3 } })
  })

  it('charges a heart once when the same event arrives concurrently (outbox retries)', async () => {
    const alice = await h.guest()
    const s = await start(h, alice)
    const results = await Promise.all(
      Array.from({ length: 4 }, () => wrongEvent(h, alice, s.sessionId, 3)),
    )
    expect(results.filter((r) => r.body.duplicate === false)).toHaveLength(1)
    expect((await get(h, api.home, '/api/home', alice)).body.lives.count).toBe(4)
  })

  it('never costs hearts in practice', async () => {
    const alice = await h.guest()
    const s = await start(h, alice, { kind: 'practice' })
    const r = await wrongEvent(h, alice, s.sessionId, 0)
    expect(r.body).toMatchObject({ duplicate: false, lives: { count: 5 } })
  })

  it('rejects unknown challenges, completed and expired sessions', async () => {
    const alice = await h.guest()
    const s = await start(h, alice)
    expect((await wrongEvent(h, alice, s.sessionId, 0, { index: 99 })).status).toBe(400)
    await finish(h, alice, s)
    const late = await wrongEvent(h, alice, s.sessionId, 50)
    expect(late.status).toBe(409)
    expect(late.body.error.code).toBe('conflict')

    const s2 = await start(h, alice)
    const later = new Date(Date.now() + 25 * 3_600_000)
    expect((await wrongEvent(h, alice, s2.sessionId, 0, { now: later })).status).toBe(410)
  })

  it("can't touch another learner's session (IDOR)", async () => {
    const alice = await h.guest()
    const bob = await h.guest()
    const s = await start(h, alice)
    const r = await wrongEvent(h, bob, s.sessionId, 0)
    expect(r.status).toBe(404)
    expect(r.body.error.code).toBe('not_found')
    const aliceHome = await get(h, api.home, '/api/home', alice)
    expect(aliceHome.body.lives.count).toBe(5)
    expect((await wrongEvent(h, bob, 'not-a-uuid', 0)).status).toBe(404)
  })
})

describe('POST /api/sessions/:id/complete', () => {
  it('commits XP, streak, level progress and returns the identical result on replay', async () => {
    const alice = await h.guest()
    const s = await start(h, alice)
    const result = await finish(h, alice, s)
    expect(result).toMatchObject({
      kind: 'lesson',
      xp: { base: 10, bonus: 5, total: 15 },
      perfect: true,
      accuracy: 1,
      graderMismatches: 0,
      streak: { current: 1, extendedToday: true },
      level: { levelId: 'u01-s0', lessonsDone: 1, lessonsTotal: 1, completed: true },
      lives: { count: 5 },
    })
    const replay = await finishRaw(h, alice, s)
    expect(replay.status).toBe(200)
    expect(replay.body).toEqual(result)
    const home = await get(h, api.home, '/api/home', alice)
    expect(home.body).toMatchObject({ xpTotal: 15, course: { currentLevelId: 'u01-l1' } })
    const rows = await h.sql`SELECT xp_total FROM public_profiles WHERE user_id = ${alice.id}`
    expect(rows[0]!.xp_total).toBe(15)
  })

  it('loses nothing and awards XP once when completions race', async () => {
    const alice = await h.guest()
    const s = await start(h, alice)
    const results = await Promise.all(Array.from({ length: 5 }, () => finishRaw(h, alice, s)))
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200])
    for (const r of results) expect(r.body).toEqual(results[0]!.body)
    const [xp] =
      await h.sql`SELECT sum(amount)::int AS n FROM xp_ledger WHERE user_id = ${alice.id}`
    expect(xp!.n).toBe(15)
    const [days] =
      await h.sql`SELECT sum(sessions)::int AS n FROM daily_activity WHERE user_id = ${alice.id}`
    expect(days!.n).toBe(1)
  })

  it('keeps XP of two different sessions completed concurrently', async () => {
    const alice = await h.guest()
    const a = await start(h, alice)
    const b = await start(h, alice)
    await Promise.all([finish(h, alice, a), finish(h, alice, b)])
    const home = await get(h, api.home, '/api/home', alice)
    expect(home.body.xpTotal).toBe(30)
  })

  it('charges hearts for server-graded wrong answers whose events never arrived', async () => {
    const alice = await h.guest()
    const s = await start(h, alice)
    await wrongEvent(h, alice, s.sessionId, 0) // one of the two wrong attempts was reported
    const r = await finish(h, alice, s, { wrong: [0, 1] })
    expect(r).toMatchObject({
      perfect: false,
      xp: { base: 10, bonus: 0, total: 10 },
      lives: { count: 3 },
    })
    expect(r.mistakes.length).toBeGreaterThan(0)
  })

  it('gives a heart back for practice and never charges one there', async () => {
    const alice = await h.guest()
    const lesson = await start(h, alice)
    await wrongEvent(h, alice, lesson.sessionId, 0)
    await wrongEvent(h, alice, lesson.sessionId, 1)
    const practice = await start(h, alice, { kind: 'practice' })
    const r = await finish(h, alice, practice, { wrong: [0] })
    expect(r.lives.count).toBe(4)
    expect(r.xp.total).toBe(10)
  })

  it('updates FSRS memory for every exercised lexeme and letter', async () => {
    const alice = await h.guest()
    await play(h, alice)
    const lexemes = await h.sql<{ lexeme_id: string; reps: number; exposures: number }[]>`
      SELECT lexeme_id, reps, exposures FROM lexeme_memory WHERE user_id = ${alice.id} ORDER BY lexeme_id`
    // match_pairs covers five words; the sentences add their words.
    expect(lexemes.map((r) => r.lexeme_id)).toEqual(
      expect.arrayContaining(['lx_baba', 'lx_khub', 'lx_maman', 'lx_mersi', 'lx_salam']),
    )
    expect(lexemes.every((r) => r.reps === 1 && r.exposures >= 1)).toBe(true)

    await play(h, alice, { levelId: 'u01-l1' })
    await play(h, alice, { levelId: 'u01-l2' })
    const letters = await h.sql<{ letter_id: string }[]>`
      SELECT letter_id FROM letter_memory WHERE user_id = ${alice.id} ORDER BY letter_id`
    expect(letters.map((r) => r.letter_id)).toEqual(['l_be', 'l_mim', 'l_nun'])
  })

  it('ignores skipped attempts for SRS and rates wrong answers "again"', async () => {
    const alice = await h.guest()
    const s = await start(h, alice)
    const answers = answersFor(s.challenges, { wrong: [3] }) // match_pairs wrong first
    const skipIdx = s.challenges.findIndex((c) => c.type === 'translate_type')
    const withSkip = answers.map((a) =>
      a.index === skipIdx
        ? { ...a, response: { kind: 'skip' as const }, verdict: 'skipped' as const }
        : a,
    )
    await finish(h, alice, s, { answers: withSkip })
    const rows = await h.sql<{ lexeme_id: string; lapses: number; state: number }[]>`
      SELECT lexeme_id, lapses, state FROM lexeme_memory WHERE user_id = ${alice.id} AND lexeme_id = 'lx_baba'`
    expect(rows).toHaveLength(1)
    const answersRows =
      await h.sql`SELECT verdict FROM session_answers WHERE session_id = ${s.sessionId} ORDER BY attempt_seq`
    expect(answersRows.map((r) => r.verdict)).toContain('skipped')
  })

  it('never trusts client XP: implausibly fast answers earn nothing but still count', async () => {
    const alice = await h.guest()
    const s = await start(h, alice)
    const r = await finish(h, alice, s, { ms: 50 })
    expect(r.xp).toEqual({ base: 0, bonus: 0, total: 0 })
    expect(r.level).toMatchObject({ completed: true })
    const [xp] = await h.sql`SELECT count(*)::int AS n FROM xp_ledger WHERE user_id = ${alice.id}`
    expect(xp!.n).toBe(0)
  })

  it('awards no XP beyond the hourly session cap', async () => {
    const alice = await h.guest()
    await h.sql`
      INSERT INTO sessions (user_id, course_id, level_id, kind, content_version, seed, challenge_refs, tz, started_at, expires_at, grader_version)
      SELECT ${alice.id}, 'fixture', 'u01-s0', 'lesson', 1, 'seed', '[]'::jsonb, 'UTC', now(), now() + interval '1 day', 1
      FROM generate_series(1, 30)`
    const r = await play(h, alice)
    expect(r.xp.total).toBe(0)
  })

  it('counts a wrong answer claimed as correct as a grader mismatch; outside the window the server decides', async () => {
    const alice = await h.guest()
    const s = await start(h, alice)
    const answers = answersFor(s.challenges)
    answers[2] = { ...answers[2]!, response: { kind: 'text', value: 'Dad is bad' } }
    const r = await finish(h, alice, s, { answers })
    expect(r).toMatchObject({ graderMismatches: 1, perfect: true })

    const s2 = await start(h, alice)
    const a2 = answersFor(s2.challenges)
    a2[2] = { ...a2[2]!, response: { kind: 'text', value: 'Dad is bad' } }
    const old = await h.call(api.complete, {
      path: `/api/sessions/${s2.sessionId}/complete`,
      params: { id: s2.sessionId },
      user: alice,
      body: {
        answers: a2,
        completedAt: new Date().toISOString(),
        graderVersion: s2.graderVersion + 50,
      },
    })
    expect(old.status).toBe(200)
    expect(old.body).toMatchObject({ graderMismatches: 1, perfect: false })
  })

  it('validates answers', async () => {
    const alice = await h.guest()
    const s = await start(h, alice)
    const missing = await finishRaw(h, alice, s, { answers: answersFor(s.challenges).slice(1) })
    expect(missing.status).toBe(400)
    const dup = answersFor(s.challenges).map((a) => ({ ...a, attemptSeq: 1 }))
    expect((await finishRaw(h, alice, s, { answers: dup })).status).toBe(400)
    const unknown = [
      ...answersFor(s.challenges),
      {
        index: 42,
        attemptSeq: 99,
        response: correctResponse(s.challenges[0]!),
        verdict: 'correct',
        ms: 2000,
        hinted: false,
      },
    ]
    expect((await finishRaw(h, alice, s, { answers: unknown })).status).toBe(400)
  })

  it("can't complete another learner's session (IDOR)", async () => {
    const alice = await h.guest()
    const bob = await h.guest()
    const s = await start(h, alice)
    const r = await finishRaw(h, bob, s)
    expect(r.status).toBe(404)
    const [row] = await h.sql`SELECT status FROM sessions WHERE id = ${s.sessionId}`
    expect(row!.status).toBe('started')
  })

  it('refuses an expired session', async () => {
    const alice = await h.guest()
    const s = await start(h, alice)
    const later = new Date(Date.now() + 25 * 3_600_000).toISOString()
    expect((await finishRaw(h, alice, s, { now: later })).status).toBe(410)
    const [row] = await h.sql`SELECT status FROM sessions WHERE id = ${s.sessionId}`
    expect(row!.status).toBe('expired')
  })
})
