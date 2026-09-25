/** internal.* housekeeping functions run by pg_cron (docs/ARCHITECTURE.md §8). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { repos, withUserLock } from './index'
import { createTestContext, type TestContext } from './testing'
import type { SessionAnswerInput } from './repos/sessions'

let ctx: TestContext
let alice: string

const NOW = '2026-09-25T12:00:00.000Z'

async function newSession(userId: string, overrides: { expiresAt?: string; contentVersion?: number } = {}) {
  return withUserLock(ctx.h.db, userId, (tx) =>
    repos.sessions.createSession(tx, userId, {
      courseId: 'fixture',
      levelId: 'u01-l1',
      kind: 'lesson',
      contentVersion: overrides.contentVersion ?? 1,
      seed: 's',
      challengeRefs: [],
      tz: 'UTC',
      startedAt: '2026-09-24T10:00:00.000Z',
      expiresAt: overrides.expiresAt ?? '2026-09-25T10:00:00.000Z',
      graderVersion: 1,
    }),
  )
}

const ans = (
  idx: number,
  verdict: SessionAnswerInput['verdict'],
  response: SessionAnswerInput['response'],
  itemRefs = ['sentence:s_1'],
): SessionAnswerInput => ({ idx, attemptSeq: idx, challengeType: 'translate_type', itemRefs, response, verdict, ms: 1000 })

beforeAll(async () => {
  ctx = await createTestContext()
  alice = await ctx.newUser()
})
afterAll(() => ctx.close())

describe('internal.expire_stale_sessions', () => {
  it('expires started sessions past their TTL only', async () => {
    const stale = await newSession(alice, { expiresAt: '2026-09-25T11:00:00.000Z' })
    const fresh = await newSession(alice, { expiresAt: '2026-09-25T13:00:00.000Z' })
    const done = await newSession(alice, { expiresAt: '2026-09-25T11:00:00.000Z' })
    await withUserLock(ctx.h.db, alice, (tx) => repos.sessions.completeSession(tx, alice, done.id, { result: {}, completedAt: NOW }))

    const [r] = await ctx.admin`SELECT internal.expire_stale_sessions(${NOW}::timestamptz) AS n`
    expect(r!.n).toBe(1)
    const rows = await ctx.admin`SELECT id, status FROM public.sessions WHERE id IN (${stale.id}, ${fresh.id}, ${done.id})`
    const status = Object.fromEntries(rows.map((x) => [x.id, x.status]))
    expect(status).toEqual({ [stale.id]: 'expired', [fresh.id]: 'started', [done.id]: 'completed' })
    const [again] = await ctx.admin`SELECT internal.expire_stale_sessions(${NOW}::timestamptz) AS n`
    expect(again!.n).toBe(0)
  })
})

describe('internal.rollup_item_stats', () => {
  it('rolls answers up incrementally per item × content version', async () => {
    const s1 = await newSession(alice, { contentVersion: 1 })
    const s2 = await newSession(alice, { contentVersion: 1 })
    await withUserLock(ctx.h.db, alice, async (tx) => {
      await repos.sessions.insertSessionAnswers(tx, alice, s1.id, [
        ans(0, 'wrong', { kind: 'text', value: 'man khoobam' }),
        ans(1, 'correct', { kind: 'text', value: 'man khubam' }),
        ans(2, 'wrong', { kind: 'tiles', value: ['man', 'khoob', 'am'] }, ['sentence:s_1', 'lexeme:lx_khub']),
        ans(3, 'skipped', { kind: 'skip' }),
      ])
      await repos.sessions.insertSessionAnswers(tx, alice, s2.id, [ans(0, 'wrong', { kind: 'text', value: 'man khoobam' })])
    })

    const [r] = await ctx.admin`SELECT internal.rollup_item_stats(${NOW}::timestamptz) AS n`
    expect(r!.n).toBe(5)
    const stats = await ctx.admin`SELECT * FROM public.item_stats ORDER BY item_ref`
    expect(stats.map((s) => [s.item_ref, s.content_version, s.attempts, s.wrong])).toEqual([
      ['lexeme:lx_khub', 1, 1, 1],
      ['sentence:s_1', 1, 4, 3],
    ])
    expect(stats[1]!.error_rate).toBeCloseTo(0.75)
    expect(stats[1]!.top_wrong_answers).toEqual([
      { answer: 'man khoobam', count: 2 },
      { answer: 'man khoob am', count: 1 },
    ])

    // Nothing new → nothing changes; new answers are added on top.
    const [none] = await ctx.admin`SELECT internal.rollup_item_stats(${NOW}::timestamptz) AS n`
    expect(none!.n).toBe(0)
    const s3 = await newSession(alice, { contentVersion: 1 })
    await withUserLock(ctx.h.db, alice, (tx) =>
      repos.sessions.insertSessionAnswers(tx, alice, s3.id, [
        ans(0, 'correct', { kind: 'text', value: 'man khubam' }),
        ans(1, 'wrong', { kind: 'text', value: 'man khoob am' }),
      ]),
    )
    await ctx.admin`SELECT internal.rollup_item_stats(${NOW}::timestamptz)`
    const [s] = await ctx.admin`SELECT * FROM public.item_stats WHERE item_ref = 'sentence:s_1'`
    expect([s!.attempts, s!.wrong]).toEqual([6, 4])
    expect(s!.top_wrong_answers).toEqual([
      { answer: 'man khoob am', count: 2 },
      { answer: 'man khoobam', count: 2 },
    ])
  })
})

describe('internal.prune_session_answers', () => {
  it('deletes answers older than 90 days after rolling them up', async () => {
    const s = await newSession(alice, { contentVersion: 2 })
    await withUserLock(ctx.h.db, alice, (tx) =>
      repos.sessions.insertSessionAnswers(tx, alice, s.id, [
        ans(0, 'wrong', { kind: 'choice', value: 3 }, ['lexeme:lx_old']),
        ans(1, 'correct', { kind: 'choice', value: 1 }, ['lexeme:lx_old']),
      ]),
    )
    await ctx.admin`UPDATE public.session_answers SET created_at = ${NOW}::timestamptz - interval '91 days'
                    WHERE session_id = ${s.id} AND idx = 0`
    const [r] = await ctx.admin`SELECT internal.prune_session_answers(${NOW}::timestamptz) AS n`
    expect(r!.n).toBe(1)
    const left = await ctx.admin`SELECT idx FROM public.session_answers WHERE session_id = ${s.id}`
    expect(left.map((x) => x.idx)).toEqual([1])
    const [stat] = await ctx.admin`SELECT attempts, wrong, top_wrong_answers FROM public.item_stats WHERE item_ref = 'lexeme:lx_old' AND content_version = 2`
    expect(stat).toEqual({ attempts: 2, wrong: 1, top_wrong_answers: [{ answer: 'choice:3', count: 1 }] })
  })
})

describe('internal.prune_rate_limits / prune_webhook_events', () => {
  it('delete stale rows only', async () => {
    await ctx.admin`INSERT INTO public.rate_limits (key, tokens, updated_at) VALUES
      ('old', 1, ${NOW}::timestamptz - interval '2 hours'), ('new', 1, ${NOW}::timestamptz)`
    await ctx.admin`INSERT INTO public.webhook_events (event_id, type, received_at) VALUES
      ('evt_old', 'x', ${NOW}::timestamptz - interval '31 days'), ('evt_new', 'x', ${NOW}::timestamptz)`
    const [a] = await ctx.admin`SELECT internal.prune_rate_limits(${NOW}::timestamptz) AS n`
    const [b] = await ctx.admin`SELECT internal.prune_webhook_events(${NOW}::timestamptz) AS n`
    expect([a!.n, b!.n]).toEqual([1, 1])
    expect((await ctx.admin`SELECT key FROM public.rate_limits`).map((x) => x.key)).toEqual(['new'])
    expect((await ctx.admin`SELECT event_id FROM public.webhook_events`).map((x) => x.event_id)).toEqual(['evt_new'])
  })
})

describe('pg_cron schedules', () => {
  // scripts/db-local.sh always installs pg_cron and points cron.database_name at the main database,
  // mirroring Supabase, so the jobs must exist there. (Per-test clones can't host pg_cron.)
  it('are installed and registered in the cron database, owned by the migration role', async () => {
    const main = postgres({
      host: '127.0.0.1',
      port: Number(process.env.ZABOON_DB_PORT ?? 54322),
      user: 'supabase_admin',
      database: process.env.ZABOON_DB_NAME ?? 'zaboon',
      max: 1,
      onnotice: () => {},
    })
    try {
      const [cfg] = await main`
        SELECT current_setting('cron.database_name', true) AS cron_db,
               current_database() AS db,
               EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') AS available,
               EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') AS installed`
      expect(cfg).toEqual({ cron_db: cfg!.db, db: cfg!.db, available: true, installed: true })
      const jobs = await main`
        SELECT jobname, schedule, command, username, active FROM cron.job
        WHERE jobname LIKE 'zaboon-%' ORDER BY jobname`
      expect(jobs.map((j) => ({ ...j }))).toEqual([
        { jobname: 'zaboon-expire-stale-sessions', schedule: '*/15 * * * *', command: 'SELECT internal.expire_stale_sessions()', username: 'postgres', active: true },
        { jobname: 'zaboon-prune-rate-limits', schedule: '20 * * * *', command: 'SELECT internal.prune_rate_limits()', username: 'postgres', active: true },
        { jobname: 'zaboon-prune-session-answers', schedule: '40 3 * * *', command: 'SELECT internal.prune_session_answers()', username: 'postgres', active: true },
        { jobname: 'zaboon-prune-webhook-events', schedule: '50 3 * * *', command: 'SELECT internal.prune_webhook_events()', username: 'postgres', active: true },
        { jobname: 'zaboon-rollup-item-stats', schedule: '10 3 * * *', command: 'SELECT internal.rollup_item_stats()', username: 'postgres', active: true },
      ])
    } finally {
      await main.end()
    }
  })
})
