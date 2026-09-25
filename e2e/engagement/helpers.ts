/**
 * Helpers for the P2 engagement specs. The local e2e database is shared and never reset, so every
 * spec plays in a league week of its own: an unused week in the past (a future week would make the
 * rollover, which closes every ended week, close the real current week under the other specs). Coins for shop specs are granted
 * straight in the database (ledger + wallet together, like a grant), because earning 100+ coins
 * through lessons would take a dozen sessions.
 */
import type { APIRequestContext } from '@playwright/test'
import { randomInt } from 'node:crypto'
import postgres from 'postgres'
import { answersFor } from '../../apps/web/tests/api/play'
import { expect, flagsHeader } from '../fixtures'
import type { User } from '../pages/helpers'

export const ENGAGEMENT_ON = { leagues: true, quests: true, shop: true, practiceHub: true }

const DB_URL = `postgres://supabase_admin@127.0.0.1:${process.env.ZABOON_DB_PORT ?? 54322}/${
  process.env.ZABOON_DB_NAME ?? 'zaboon'
}`

const WEEK_MS = 7 * 86_400_000
/** Monday 1900-01-01 00:00 UTC. */
const EPOCH = Date.parse('1900-01-01T00:00:00.000Z')

/**
 * A league week of the 20th century that nobody has used yet (checked in the database), with
 * Wednesday noon of it as `now`. A used week may already be closed by an earlier rollover.
 */
export async function randomPastWeek() {
  const sql = postgres(DB_URL, { max: 1, onnotice: () => {} })
  try {
    for (;;) {
      const startsAt = EPOCH + randomInt(0, 5200) * WEEK_MS
      const iso = new Date(startsAt).toISOString()
      const used = await sql`SELECT 1 FROM public.league_weeks WHERE starts_at = ${iso}`
      if (used.length > 0) continue
      return {
        startsAt: iso,
        endsAt: new Date(startsAt + WEEK_MS).toISOString(),
        now: new Date(startsAt + 2.5 * 86_400_000).toISOString(),
        /** One minute after the week ends. */
        after: new Date(startsAt + WEEK_MS + 60_000).toISOString(),
      }
    }
  } finally {
    await sql.end()
  }
}

export interface PlayOptions {
  flags?: Record<string, boolean>
  now?: string
  wrong?: number[]
}

/** Plays the fixture's short first lesson over HTTP (like a human, 2 s per answer); returns the result. */
export async function playLesson(request: APIRequestContext, user: User, o: PlayOptions = {}) {
  const headers = {
    ...user.headers,
    ...(o.flags ? flagsHeader(o.flags) : {}),
    ...(o.now ? { 'x-test-now': o.now } : {}),
  }
  const started = await request.post('/api/sessions', {
    headers,
    data: { courseId: 'fixture', kind: 'lesson', levelId: 'u01-s0', tz: 'UTC' },
  })
  expect(started.status(), await started.text()).toBe(200)
  const s = (await started.json()) as {
    sessionId: string
    graderVersion: number
    challenges: Parameters<typeof answersFor>[0]
  }
  const done = await request.post(`/api/sessions/${s.sessionId}/complete`, {
    headers,
    data: {
      answers: answersFor(s.challenges, o.wrong ? { wrong: o.wrong } : {}),
      completedAt: o.now ?? new Date().toISOString(),
      graderVersion: s.graderVersion,
    },
  })
  expect(done.status(), await done.text()).toBe(200)
  return (await done.json()) as {
    xp: { total: number }
    coins?: { earned: number; total: number }
    league?: { tier: string; weeklyXp: number; rank: number | null; joinedNow: boolean }
    quests?: { id: string; justCompleted: boolean }[]
  }
}

/** Takes `n` hearts through wrong-attempt events on a fresh lesson. */
export async function loseHearts(request: APIRequestContext, user: User, n: number) {
  const started = await request.post('/api/sessions', {
    headers: user.headers,
    data: { courseId: 'fixture', kind: 'lesson', levelId: 'u01-s0', tz: 'UTC' },
  })
  expect(started.status()).toBe(200)
  const { sessionId } = (await started.json()) as { sessionId: string }
  for (let i = 0; i < n; i++) {
    const res = await request.post(`/api/sessions/${sessionId}/events`, {
      headers: user.headers,
      data: { attemptSeq: i, index: 0, kind: 'wrong' },
    })
    expect(res.status()).toBe(200)
  }
}

/** Credits coins (one ledger row + the wallet, in one transaction), as a grant would. */
export async function grantCoins(userId: string, amount: number): Promise<void> {
  const sql = postgres(DB_URL, { max: 1, onnotice: () => {} })
  try {
    await sql.begin(async (tx) => {
      await tx`INSERT INTO public.coin_ledger (user_id, amount, reason, ref)
               VALUES (${userId}, ${amount}, 'e2e_grant', ${crypto.randomUUID()})`
      await tx`INSERT INTO public.wallet (user_id, coins) VALUES (${userId}, ${amount})
               ON CONFLICT (user_id) DO UPDATE SET coins = public.wallet.coins + ${amount}`
    })
  } finally {
    await sql.end()
  }
}
