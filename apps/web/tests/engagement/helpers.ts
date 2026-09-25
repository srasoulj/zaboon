/** Route handlers and flows for the P2 engagement route tests (flags per request or per harness). */
import { expect } from 'vitest'
import * as rolloverRoute from '../../app/api/cron/league-rollover/route'
import * as leaderboardRoute from '../../app/api/leaderboard/route'
import * as refillRoute from '../../app/api/lives/refill/route'
import * as practiceRoute from '../../app/api/practice/route'
import * as questsRoute from '../../app/api/quests/route'
import * as purchaseRoute from '../../app/api/shop/purchase/route'
import * as shopRoute from '../../app/api/shop/route'
import { resetServerEnv } from '../../lib/server/env'
import { api as mvp, type StartedSession } from '../api/flows'
import type { Harness, Json, TestUser } from '../api/harness'
import { answersFor } from '../api/play'

export const api = {
  ...mvp,
  leaderboard: leaderboardRoute.GET,
  quests: questsRoute.GET,
  shop: shopRoute.GET,
  purchase: purchaseRoute.POST,
  refill: refillRoute.POST,
  practice: practiceRoute.GET,
  rollover: rolloverRoute.GET,
}

export const ALL_ON = { leagues: true, quests: true, shop: true, practiceHub: true } as const
export const ALL_OFF = { leagues: false, quests: false, shop: false, practiceHub: false } as const
export type Flags = Record<string, boolean>

/** A fixed, clearly fake cron secret for route tests. */
export const TEST_CRON_SECRET = 'engagement-test-cron-secret-not-real' // pragma: allowlist secret

export function useCronSecret(): void {
  process.env.CRON_SECRET = TEST_CRON_SECRET
  resetServerEnv()
}

export const cronAuth = { authorization: `Bearer ${TEST_CRON_SECRET}` }

export interface LessonOptions {
  now: string
  flags?: Flags
  tz?: string
  /** Challenge indexes answered wrong first. */
  wrong?: number[]
  /** Answer time per attempt (under 800 ms flags the session as implausible). */
  ms?: number
  kind?: 'lesson' | 'practice' | 'letters'
  /** Practice hub mode (practice sessions only). */
  mode?: 'mixed' | 'mistakes' | 'listening' | 'typing'
  levelId?: string
  completedAt?: string
}

export async function startLesson(
  h: Harness,
  user: TestUser,
  o: LessonOptions,
): Promise<StartedSession> {
  const kind = o.kind ?? 'lesson'
  const levelId = o.levelId ?? (kind === 'lesson' ? 'u01-s0' : undefined)
  const res = await h.call(api.createSession, {
    path: '/api/sessions',
    user,
    now: o.now,
    ...(o.flags ? { flags: o.flags } : {}),
    body: {
      courseId: 'fixture',
      kind,
      ...(levelId ? { levelId } : {}),
      tz: o.tz ?? 'UTC',
      ...(o.mode ? { mode: o.mode } : {}),
    },
  })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as StartedSession
}

export function completeRaw(h: Harness, user: TestUser, s: StartedSession, o: LessonOptions) {
  return h.call(api.complete, {
    path: `/api/sessions/${s.sessionId}/complete`,
    params: { id: s.sessionId },
    user,
    now: o.now,
    ...(o.flags ? { flags: o.flags } : {}),
    body: {
      answers: answersFor(s.challenges, {
        ...(o.wrong ? { wrong: o.wrong } : {}),
        ...(o.ms ? { ms: o.ms } : {}),
      }),
      completedAt: o.completedAt ?? o.now,
      graderVersion: s.graderVersion,
    },
  })
}

/** Starts and completes a session (perfect unless `wrong`); returns the SessionResult. */
export async function lesson(h: Harness, user: TestUser, o: LessonOptions): Promise<Json> {
  const s = await startLesson(h, user, o)
  const res = await completeRaw(h, user, s, o)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body
}

export const read = (
  h: Harness,
  handler: (typeof api)[keyof typeof api],
  path: string,
  user: TestUser | null,
  o: { now?: string; flags?: Flags; headers?: Record<string, string> } = {},
) =>
  h.call(handler, {
    path,
    user,
    ...(o.now ? { now: o.now } : {}),
    ...(o.flags ? { flags: o.flags } : {}),
    ...(o.headers ? { headers: o.headers } : {}),
  })

/** Gives a user coins the way a grant would (ledger + wallet), as the superuser. */
export async function grantCoins(h: Harness, userId: string, amount: number, ref: string) {
  await h.sql`INSERT INTO public.coin_ledger (user_id, amount, reason, ref) VALUES (${userId}, ${amount}, 'test_grant', ${ref})`
  await h.sql`
    INSERT INTO public.wallet (user_id, coins) VALUES (${userId}, ${amount})
    ON CONFLICT (user_id) DO UPDATE SET coins = public.wallet.coins + ${amount}`
}

/** Wallet balance and ledger sum (they must always be equal). */
export async function coinsOf(
  h: Harness,
  userId: string,
): Promise<{ wallet: number; ledger: number }> {
  const [w] =
    await h.sql`SELECT coalesce((SELECT coins FROM public.wallet WHERE user_id = ${userId}), 0)::int AS n`
  const [l] =
    await h.sql`SELECT coalesce(sum(amount), 0)::int AS n FROM public.coin_ledger WHERE user_id = ${userId}`
  return { wallet: w!.n as number, ledger: l!.n as number }
}

/** Rows a user has in the P2 engagement tables. */
export async function p2Rows(h: Harness, userId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const t of ['wallet', 'coin_ledger', 'league_members', 'user_league', 'user_quests']) {
    const [r] = await h.sql.unsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public."${t}" WHERE user_id = $1`,
      [userId],
    )
    out[t] = r!.n
  }
  return out
}
