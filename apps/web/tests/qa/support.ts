/**
 * Shared helpers for the QA route tests of Wave 3 (engagement + typing), on top of the engagement
 * helpers (apps/web/tests/engagement/helpers.ts, read-only for QA). Every test makes its own users
 * in a private test database, so nothing here depends on test order.
 */
import { expect } from 'vitest'
import type { Challenge, ChallengeResponse } from '@zaboon/contracts'
import { play, start, wrongEvent, type StartedSession } from '../api/flows'
import type { Harness, Json, TestUser } from '../api/harness'
import { canonicalTokens } from '../api/play'
import { api, coinsOf, read } from '../engagement/helpers'

export const uuid = () => crypto.randomUUID()

/** Every engagement flag on, plus the typing flags (what a Wave 3 learner with all flags has). */
export const EVERYTHING = {
  leagues: true,
  quests: true,
  shop: true,
  practiceHub: true,
  persianKeyboard: true,
  letterTrace: true,
} as const

/** Creates the profile row (wallet, streak and league rows reference it) through GET /api/home. */
export async function ensureProfile(h: Harness, user: TestUser, now?: string): Promise<void> {
  const res = await read(h, api.home, '/api/home', user, now ? { now } : {})
  expect(res.status, JSON.stringify(res.body)).toBe(200)
}

/** Sets how many streak freezes a learner holds (the shop caps them at 2). */
export async function setFreezes(h: Harness, userId: string, freezes: number): Promise<void> {
  await h.sql`
    INSERT INTO public.streaks (user_id, freezes) VALUES (${userId}, ${freezes})
    ON CONFLICT (user_id) DO UPDATE SET freezes = ${freezes}`
}

/** Takes `n` hearts through wrong-attempt events on a fresh lesson at `now`. */
export async function loseHearts(h: Harness, user: TestUser, n: number, now: string) {
  const s = await start(h, user, { now })
  for (let i = 0; i < n; i++)
    expect((await wrongEvent(h, user, s.sessionId, i, { now })).status).toBe(200)
}

export async function expectBalanced(h: Harness, userId: string, coins?: number) {
  const c = await coinsOf(h, userId)
  expect(c.wallet, 'wallet = ledger sum').toBe(c.ledger)
  expect(c.wallet).toBeGreaterThanOrEqual(0)
  if (coins !== undefined) expect(c.wallet).toBe(coins)
  return c.wallet
}

export const purchase = (
  h: Harness,
  user: TestUser,
  item: 'streak_freeze' | 'heart_refill',
  purchaseId: string,
  o: { now: string; flags?: Record<string, boolean> },
) =>
  h.call(api.purchase, {
    path: '/api/shop/purchase',
    user,
    now: o.now,
    flags: o.flags ?? { shop: true },
    body: { item, purchaseId },
  })

export const refill = (
  h: Harness,
  user: TestUser,
  purchaseId: string,
  o: { now: string; flags?: Record<string, boolean> },
) =>
  h.call(api.refill, {
    path: '/api/lives/refill',
    user,
    now: o.now,
    flags: o.flags ?? { shop: true },
    body: { purchaseId },
  })

/** A guest who has finished every MVP level of the fixture unit, so u01-t1 is current. */
export async function reachT1(h: Harness, now: string): Promise<TestUser> {
  const u = await h.guest()
  await play(h, u, { now })
  await play(h, u, { levelId: 'u01-l1', now })
  await play(h, u, { levelId: 'u01-l2', now })
  await play(h, u, { kind: 'practice', levelId: 'u01-p1', now })
  await play(h, u, { kind: 'unit_review', levelId: 'u01-r1', now })
  return u
}

/** Starts u01-t1 with the given flags. */
export async function startT1(
  h: Harness,
  user: TestUser,
  now: string,
  flags: Record<string, boolean>,
): Promise<StartedSession> {
  const res = await h.call(api.createSession, {
    path: '/api/sessions',
    user,
    now,
    flags,
    body: { courseId: 'fixture', kind: 'lesson', levelId: 'u01-t1', tz: 'UTC' },
  })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as StartedSession
}

/** What a learner who knows the answer sends for the P2 types (a clean trace for letter_trace). */
export function p2Correct(c: Challenge): ChallengeResponse {
  switch (c.type) {
    case 'translate_type':
    case 'listen_type':
    case 'cloze_type':
      return { kind: 'text', value: canonicalTokens(c.graph).join(' ') }
    case 'letter_trace':
      return { kind: 'trace', coverage: 0.95, precision: 0.95 }
    default:
      throw new Error(`not a P2 challenge: ${c.type}`)
  }
}

export interface Attempt {
  index: number
  attemptSeq: number
  response: ChallengeResponse
  verdict: 'correct' | 'wrong' | 'skipped'
  ms: number
  hinted: boolean
}

/** One first-try attempt per challenge, with `override` replacing some responses. */
export function attempts(
  s: StartedSession,
  override: Partial<Record<Challenge['type'], ChallengeResponse>> = {},
): Attempt[] {
  return s.challenges.map((c, i) => ({
    index: c.index,
    attemptSeq: i,
    response: override[c.type] ?? p2Correct(c),
    verdict: 'correct',
    ms: 2500,
    hinted: false,
  }))
}

export function completeWith(
  h: Harness,
  user: TestUser,
  s: StartedSession,
  answers: Attempt[],
  o: { now: string; graderVersion?: number; flags?: Record<string, boolean> },
) {
  return h.call<Json>(api.complete, {
    path: `/api/sessions/${s.sessionId}/complete`,
    params: { id: s.sessionId },
    user,
    now: o.now,
    ...(o.flags ? { flags: o.flags } : {}),
    body: { answers, completedAt: o.now, graderVersion: o.graderVersion ?? s.graderVersion },
  })
}

/** An ISO instant `minutes` after `iso`. */
export const plusMinutes = (iso: string, minutes: number) =>
  new Date(Date.parse(iso) + minutes * 60_000).toISOString()
