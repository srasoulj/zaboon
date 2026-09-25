/** Unit tests for the player's pure helpers: URL contract, progress, grading and summaries. */
import { describe, expect, it } from 'vitest'
import type { Challenge } from '@zaboon/contracts'
import { gradeAttempt, sessionLexicon, solutionFor } from './grading'
import {
  costsHeart,
  firstTryAccuracy,
  initialProgress,
  loseHeart,
  outOfHearts,
  progressValue,
  recordAttempt,
  recordMismatch,
  wrongAttempts,
} from './progress'
import { exitHref, lessonHref, parseLessonRequest, requestKey } from './request'
import { MemorySnapshotStore } from './stores'
import { formatDuration, localSummary, streakDaysAfter, summaryFromResult } from './summary'
import { lives, testChallenges, testResult, testSession, USER_ID } from './test-support'

const q = (s: string) => new URLSearchParams(s)

describe('lesson URL contract', () => {
  it('parses lesson, letters, unit review and practice URLs', () => {
    expect(parseLessonRequest(q('course=fixture&kind=lesson&level=u01-s0'))).toEqual({
      ok: true,
      request: { courseId: 'fixture', kind: 'lesson', levelId: 'u01-s0' },
    })
    expect(parseLessonRequest(q('course=fa-en&kind=practice'))).toEqual({
      ok: true,
      request: { courseId: 'fa-en', kind: 'practice', levelId: null },
    })
    expect(parseLessonRequest(q('course=fa-en&kind=letters&level=lt-01')).ok).toBe(true)
    expect(parseLessonRequest(q('course=fa-en&kind=unit_review&level=u01-review')).ok).toBe(true)
  })

  it('rejects missing or unsupported parameters', () => {
    expect(parseLessonRequest(q('kind=lesson&level=u01')).ok).toBe(false)
    expect(parseLessonRequest(q('course=fa-en&kind=legendary&level=u01')).ok).toBe(false)
    expect(parseLessonRequest(q('course=fa-en&kind=bogus')).ok).toBe(false)
    expect(parseLessonRequest(q('course=fa-en&kind=lesson')).ok).toBe(false)
    expect(parseLessonRequest(q('course=fa-en&kind=lesson&level=../x')).ok).toBe(false)
  })

  it('builds hrefs, exits and keys', () => {
    const r = { courseId: 'fixture', kind: 'lesson' as const, levelId: 'u01-s0' }
    expect(lessonHref(r)).toBe('/lesson?course=fixture&kind=lesson&level=u01-s0')
    expect(lessonHref({ ...r, kind: 'practice', levelId: null })).toBe('/lesson?course=fixture&kind=practice')
    expect(exitHref('lesson')).toBe('/learn')
    expect(exitHref('unit_review')).toBe('/learn')
    expect(exitHref('letters')).toBe('/letters')
    expect(exitHref('practice')).toBe('/practice')
    expect(requestKey(r)).toBe('fixture|lesson|u01-s0')
  })
})

describe('progress', () => {
  it('re-queues wrong and skipped answers at the end, counting progress by passes', () => {
    let p = initialProgress(testChallenges())
    expect(progressValue(p)).toBe(0)
    p = recordAttempt(p, { index: 0, response: { kind: 'choice', value: 0 }, verdict: 'wrong', ms: 5 }).progress
    expect(p.queue).toEqual([1, 2, 0])
    p = recordAttempt(p, { index: 1, response: { kind: 'skip' }, verdict: 'skipped', ms: 5 }).progress
    expect(p.queue).toEqual([2, 0, 1])
    p = recordAttempt(p, { index: 2, response: { kind: 'none' }, verdict: 'correct', ms: 5 }).progress
    expect(p.queue).toEqual([0, 1])
    expect(progressValue(p)).toBeCloseTo(1 / 3)
    p = recordAttempt(p, { index: 0, response: { kind: 'choice', value: 1 }, verdict: 'typo', ms: 5 }).progress
    expect(p.passed).toEqual([2, 0])
    expect(p.answers.map((a) => a.attemptSeq)).toEqual([0, 1, 2, 3])
    expect(wrongAttempts(p)).toBe(1)
    expect(firstTryAccuracy(p)).toBeCloseTo(1 / 3)
  })

  it('clamps answer times into the contract bounds', () => {
    const p = initialProgress(testChallenges())
    expect(recordAttempt(p, { index: 0, response: { kind: 'skip' }, verdict: 'skipped', ms: -5 }).answer.ms).toBe(0)
    expect(
      recordAttempt(p, { index: 0, response: { kind: 'skip' }, verdict: 'skipped', ms: 9e9 }).answer.ms,
    ).toBe(3_600_000)
  })

  it('a mismatch records a wrong attempt without moving the queue', () => {
    const p = recordMismatch(initialProgress(testChallenges()), 0, 700)
    expect(p.progress.queue).toEqual([0, 1, 2])
    expect(p.answer).toMatchObject({ index: 0, attemptSeq: 0, verdict: 'wrong', response: { kind: 'pairs', value: [] } })
    expect(gradeAttempt(testChallenges()[2]!, p.answer.response, []).verdict).toBe('wrong')
  })

  it('hearts: practice and unlimited are free; running out needs the hearts policy', () => {
    expect(costsHeart('lesson', lives(3))).toBe(true)
    expect(costsHeart('practice', lives(3))).toBe(false)
    expect(costsHeart('lesson', lives(3, 'unlimited'))).toBe(false)
    expect(loseHeart(lives(0)).count).toBe(0)
    expect(outOfHearts('lesson', lives(0))).toBe(true)
    expect(outOfHearts('practice', lives(0))).toBe(false)
  })
})

describe('grading', () => {
  const [select, bank, match] = testChallenges() as [
    Extract<Challenge, { type: 'select_translation' }>,
    Extract<Challenge, { type: 'translate_bank' }>,
    Challenge,
  ]

  it('grades with the shared gradeResponse', () => {
    expect(gradeAttempt(select, { kind: 'choice', value: 1 }, []).verdict).toBe('correct')
    expect(gradeAttempt(bank, { kind: 'tiles', value: ['hello', 'friend'] }, []).verdict).toBe('correct')
    expect(gradeAttempt(bank, { kind: 'tiles', value: ['water'] }, []).verdict).toBe('wrong')
    expect(gradeAttempt(bank, { kind: 'skip' }, []).verdict).toBe('skipped')
  })

  it('shows the correct solution per challenge type', () => {
    expect(solutionFor(select, null)).toEqual({ text: 'hello', lang: 'en' })
    const wrong = gradeAttempt(bank, { kind: 'tiles', value: ['water'] }, [])
    expect(solutionFor(bank, wrong)).toEqual({ text: 'hello friend', lang: 'en' })
    expect(solutionFor(bank, null)).toEqual({ text: 'hello friend', lang: 'en' })
    expect(solutionFor(match, null)).toBeNull()
  })

  it('collects single Persian words from the session as the lexicon', () => {
    const lex = sessionLexicon(testChallenges())
    expect(lex).toEqual(expect.arrayContaining(['سلام', 'آب', 'نون']))
    expect(lex).not.toContain('سلام دوست')
  })
})

describe('summaries', () => {
  it('maps the server result', () => {
    expect(summaryFromResult(testResult())).toEqual({
      source: 'server',
      xp: 15,
      perfect: true,
      accuracy: 1,
      durationMs: 65_000,
      streak: { days: 3, extendedToday: true },
      dailyGoal: { xp: 25, goal: 20, justMet: true },
    })
  })

  it('estimates offline with the shared game rules', () => {
    let p = initialProgress(testSession().challenges)
    p = recordAttempt(p, { index: 0, response: { kind: 'choice', value: 0 }, verdict: 'wrong', ms: 5 }).progress
    const s = localSummary({
      kind: 'lesson',
      progress: p,
      durationMs: 61_400,
      home: { streak: { current: 4, status: 'extended', freezes: 0 }, dailyGoal: { xp: 30, goal: 20, met: true } },
    })
    expect(s).toMatchObject({
      source: 'local',
      xp: 10,
      perfect: false,
      durationMs: 61_400,
      streak: { days: 4, extendedToday: false },
      dailyGoal: { xp: 40, goal: 20, justMet: false },
    })
    expect(localSummary({ kind: 'lesson', progress: p, durationMs: 0, home: null }).streak).toEqual({
      days: 1,
      extendedToday: true,
    })
  })

  it('computes the streak after a lesson', () => {
    expect(streakDaysAfter(null)).toBe(1)
    expect(streakDaysAfter({ current: 5, status: 'extended', freezes: 0 })).toBe(5)
    expect(streakDaysAfter({ current: 5, status: 'at_risk', freezes: 0 })).toBe(6)
    expect(streakDaysAfter({ current: 5, status: 'frozen', freezes: 0 })).toBe(6)
    expect(streakDaysAfter({ current: 0, status: 'broken', freezes: 0 })).toBe(1)
    expect(streakDaysAfter({ current: 0, status: 'none', freezes: 0 })).toBe(1)
  })

  it('formats durations as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(65_400)).toBe('1:05')
    expect(formatDuration(600_000)).toBe('10:00')
  })
})

describe('memory snapshot store', () => {
  it('finds the newest snapshot for a user and lesson', async () => {
    const store = new MemorySnapshotStore()
    const base = {
      v: 1 as const,
      userId: USER_ID,
      key: 'k',
      session: testSession(),
      progress: initialProgress(testChallenges()),
      hearts: lives(),
      startedAt: 1,
    }
    await store.save({ ...base, sessionId: 'a', savedAt: 1 })
    await store.save({ ...base, sessionId: 'b', savedAt: 2 })
    await store.save({ ...base, sessionId: 'c', savedAt: 3, userId: 'other' })
    expect((await store.find(USER_ID, 'k'))?.sessionId).toBe('b')
    await store.remove('b')
    expect((await store.find(USER_ID, 'k'))?.sessionId).toBe('a')
    expect(await store.find(USER_ID, 'nope')).toBeNull()
  })
})
