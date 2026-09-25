/** Hand-built sessions for the lesson player's tests (no DB, no content bundle). */
import type { Challenge, CreateSessionResponse, LivesView, SessionResult } from '@zaboon/contracts'

const graph = (words: string[]) => ({
  v: 1 as const,
  start: 0,
  accept: [words.length],
  edges: words.map((t, i) => ({ from: i, to: i + 1, t })),
})

export const SESSION_ID = '0b9a4f7e-6c1d-4e2a-9f3b-8a7c6d5e4f30'
export const USER_ID = '11111111-2222-4333-8444-555555555555'

/** 0: select_translation (answer 1) · 1: translate_bank "hello friend" · 2: match_pairs (3 pairs). */
export function testChallenges(): Challenge[] {
  return [
    {
      index: 0,
      type: 'select_translation',
      ref: { type: 'select_translation', items: ['s_t_0001'], direction: 'fa_en' },
      isNew: false,
      direction: 'fa_en',
      prompt: { lang: 'fa', text: 'سلام', fa: { fa: 'سلام', translit: 'salām' } },
      choices: [
        { lang: 'en', text: 'thanks' },
        { lang: 'en', text: 'hello' },
      ],
      answer: 1,
    },
    {
      index: 1,
      type: 'translate_bank',
      ref: { type: 'translate_bank', items: ['s_t_0002'], direction: 'fa_en' },
      isNew: false,
      direction: 'fa_en',
      prompt: { lang: 'fa', text: 'سلام دوست', fa: { fa: 'سلام دوست', translit: 'salām dust' } },
      answerLang: 'en',
      bank: ['hello', 'friend', 'water'],
      graph: graph(['hello', 'friend']),
    },
    {
      index: 2,
      type: 'match_pairs',
      ref: { type: 'match_pairs', items: ['lx_salam', 'lx_ab', 'lx_nun'] },
      isNew: false,
      pairs: [
        { fa: { fa: 'سلام', translit: 'salām' }, en: 'hello' },
        { fa: { fa: 'آب', translit: 'āb' }, en: 'water' },
        { fa: { fa: 'نون', translit: 'nun' }, en: 'bread' },
      ],
    },
  ]
}

export const lives = (count = 5, policy: LivesView['policy'] = 'hearts'): LivesView => ({
  policy,
  count,
  max: 5,
  nextRegenAt: null,
})

export function testSession(over: Partial<CreateSessionResponse> = {}): CreateSessionResponse {
  return {
    sessionId: SESSION_ID,
    contentVersion: 1,
    kind: 'lesson',
    levelId: 'u01-s0',
    expiresAt: '2030-01-01T00:00:00.000Z',
    challenges: testChallenges(),
    lives: lives(),
    graderVersion: 2,
    ...over,
  }
}

export function testResult(over: Partial<SessionResult> = {}): SessionResult {
  return {
    sessionId: SESSION_ID,
    kind: 'lesson',
    contentVersion: 1,
    localDate: '2026-09-25',
    xp: { base: 10, bonus: 5, total: 15 },
    accuracy: 1,
    perfect: true,
    durationMs: 65_000,
    streak: {
      current: 3,
      status: 'extended',
      freezes: 1,
      extendedToday: true,
      freezeGranted: false,
      frozenDates: [],
    },
    lives: lives(),
    dailyGoal: { xp: 25, goal: 20, met: true, justMet: true },
    level: { levelId: 'u01-s0', lessonsDone: 1, lessonsTotal: 1, completed: true },
    mistakes: [],
    graderMismatches: 0,
    ...over,
  }
}
