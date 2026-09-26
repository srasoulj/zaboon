/**
 * The database's size caps (20260926100000_hardening.sql, tested on their own in
 * supabase/tests/006_hardening.sql) never refuse what the API contract accepts: the largest valid
 * answer responses and item ref are stored.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ChallengeResponse,
  CreateReportRequest,
  MAX_TILE_LENGTH,
  MAX_TILES,
} from '@zaboon/contracts'
import { repos, withUser, withUserLock } from './index'
import { createTestContext, type TestContext } from './testing'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(() => ctx.close())

/** Counts once towards a zod max() but takes 3 bytes in UTF-8: the widest a capped string gets. */
const WIDE = '界'

describe('database caps ↔ contract bounds', () => {
  it('stores the largest answer responses the contract accepts', async () => {
    const userId = await ctx.newUser()
    const session = await withUserLock(ctx.h.db, userId, (tx) =>
      repos.sessions.createSession(tx, userId, {
        courseId: 'fixture',
        levelId: 'u01-l1',
        kind: 'lesson',
        contentVersion: 1,
        seed: 's',
        challengeRefs: [],
        tz: 'UTC',
        startedAt: '2026-09-25T10:00:00.000Z',
        expiresAt: '2026-09-26T10:00:00.000Z',
        graderVersion: 1,
      }),
    )
    const tile = WIDE.repeat(MAX_TILE_LENGTH)
    const largest = [
      { kind: 'tiles', value: Array.from({ length: MAX_TILES }, () => tile) },
      { kind: 'audio', transcript: WIDE.repeat(500), token: WIDE.repeat(400) },
      { kind: 'text', value: WIDE.repeat(500) },
    ].map((r) => ChallengeResponse.parse(r))
    const stored = await withUserLock(ctx.h.db, userId, (tx) =>
      repos.sessions.insertSessionAnswers(
        tx,
        userId,
        session.id,
        largest.map((response, i) => ({
          idx: i,
          attemptSeq: i,
          challengeType: 'translate_bank',
          itemRefs: [],
          response,
          verdict: 'wrong' as const,
          ms: 900,
        })),
      ),
    )
    expect(stored).toBe(largest.length)
    const sizes = await ctx.admin<{ size: number }[]>`
      SELECT pg_column_size(response) AS size FROM public.session_answers
      WHERE session_id = ${session.id} ORDER BY idx`
    expect(sizes).toHaveLength(largest.length)
    for (const { size } of sizes) expect(size).toBeLessThanOrEqual(8192)
  })

  it('stores the longest item ref the contract accepts', async () => {
    const userId = await ctx.newUser()
    const itemRef = `lexeme:lx_${'a'.repeat(90)}` // 100 characters
    expect(CreateReportRequest.safeParse({ itemRef: `${itemRef}a`, kind: 'other' }).success).toBe(
      false,
    )
    const input = CreateReportRequest.parse({ itemRef, kind: 'other' })
    const { id } = await withUser(ctx.h.db, userId, (tx) =>
      repos.reports.createReport(tx, userId, input),
    )
    const [row] = await ctx.admin<{ item_ref: string }[]>`
      SELECT item_ref FROM public.reports WHERE id = ${id}`
    expect(row!.item_ref).toBe(itemRef)
  })
})
