import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ReportDto } from '@zaboon/contracts'
import { NotFoundError, ScopeError, repos, withSystem, withUser, withUserLock } from '../index'
import { createTestContext, type TestContext } from '../testing'
import type { NewReport } from './reports'

const { reports, sessions } = repos

let ctx: TestContext
let alice: string
let bob: string
let aliceSession: string
let bobSession: string

const baseSession = {
  courseId: 'fixture',
  levelId: 'u01-l1',
  kind: 'lesson' as const,
  contentVersion: 1,
  seed: 's',
  challengeRefs: [],
  tz: 'UTC',
  startedAt: '2026-09-25T10:00:00.000Z',
  expiresAt: '2026-09-26T10:00:00.000Z',
  graderVersion: 1,
}

beforeAll(async () => {
  ctx = await createTestContext()
  alice = await ctx.newUser()
  bob = await ctx.newUser()
  aliceSession = (
    await withUserLock(ctx.h.db, alice, (tx) => sessions.createSession(tx, alice, baseSession))
  ).id
  bobSession = (
    await withUserLock(ctx.h.db, bob, (tx) => sessions.createSession(tx, bob, baseSession))
  ).id
})
afterAll(() => ctx.close())

describe('reports repository', () => {
  it('creates reports and lists them as ReportDto', async () => {
    const { id } = await withUser(ctx.h.db, alice, (tx) =>
      reports.createReport(tx, alice, {
        itemRef: 'sentence:s_12',
        kind: 'answer_should_be_accepted',
        sessionId: aliceSession,
        answer: 'man khubam',
      }),
    )
    await withUser(ctx.h.db, alice, (tx) =>
      reports.createReport(tx, alice, { itemRef: 'lexeme:lx_ab', kind: 'audio_problem' }),
    )
    const mine = await withUser(ctx.h.db, alice, (tx) => reports.listReportsForUser(tx, alice))
    expect(mine).toHaveLength(2)
    for (const r of mine) expect(() => ReportDto.parse(r)).not.toThrow()
    const first = mine.find((r) => r.id === id)!
    expect(first).toEqual({
      id,
      itemRef: 'sentence:s_12',
      kind: 'answer_should_be_accepted',
      sessionId: aliceSession,
      answer: 'man khubam',
      status: 'new',
      createdAt: first.createdAt,
    })
  })

  it("rejects a report naming another user's session", async () => {
    await expect(
      withUser(ctx.h.db, alice, (tx) =>
        reports.createReport(tx, alice, {
          itemRef: 'lexeme:lx_ab',
          kind: 'other',
          sessionId: bobSession,
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("does not show a user another user's reports", async () => {
    await withUser(ctx.h.db, bob, (tx) =>
      reports.createReport(tx, bob, {
        itemRef: 'lexeme:lx_zz',
        kind: 'content_error',
        sessionId: bobSession,
      }),
    )
    expect(await withUser(ctx.h.db, alice, (tx) => reports.listReportsForUser(tx, bob))).toEqual([])
  })

  describe('admin triage', () => {
    it('requires system scope', async () => {
      await expect(
        withUser(ctx.h.db, alice, (tx) => reports.adminListReports(tx)),
      ).rejects.toBeInstanceOf(ScopeError)
      await expect(
        withUser(ctx.h.db, alice, (tx) =>
          reports.adminUpdateReport(tx, '00000000-0000-4000-8000-000000000000', 'accepted'),
        ),
      ).rejects.toBeInstanceOf(ScopeError)
      await expect(
        ctx.h.db.transaction((tx) => reports.adminListReports(tx)),
      ).rejects.toBeInstanceOf(ScopeError)
    })

    it('lists all users’ reports newest first, filters by status and updates status', async () => {
      const all = await withSystem(ctx.h.db, (tx) => reports.adminListReports(tx))
      expect(all).toHaveLength(3)
      expect(all.map((r) => r.createdAt)).toEqual([...all.map((r) => r.createdAt)].sort().reverse())

      const target = all.find((r) => r.itemRef === 'lexeme:lx_zz')!
      const updated = await withSystem(ctx.h.db, (tx) =>
        reports.adminUpdateReport(tx, target.id, 'accepted'),
      )
      expect(updated).toMatchObject({ id: target.id, status: 'accepted' })
      expect(
        await withSystem(ctx.h.db, (tx) => reports.adminListReports(tx, { status: 'accepted' })),
      ).toHaveLength(1)
      expect(
        await withSystem(ctx.h.db, (tx) => reports.adminListReports(tx, { status: 'new' })),
      ).toHaveLength(2)
      expect(
        await withSystem(ctx.h.db, (tx) => reports.adminListReports(tx, { limit: 1 })),
      ).toHaveLength(1)
      expect(
        await withSystem(ctx.h.db, (tx) => reports.adminUpdateReport(tx, 'nope', 'rejected')),
      ).toBeNull()
      expect(
        await withSystem(ctx.h.db, (tx) =>
          reports.adminUpdateReport(tx, '00000000-0000-4000-8000-000000000000', 'rejected'),
        ),
      ).toBeNull()
    })
  })
})

// After the admin triage block, which counts every report in the database.
describe('reports repository: findOpenReport (the POST /api/reports dedupe)', () => {
  it("finds only the caller's identical open report; an absent field matches only an absent one", async () => {
    const carol = await ctx.newUser()
    const session = (
      await withUserLock(ctx.h.db, carol, (tx) => sessions.createSession(tx, carol, baseSession))
    ).id
    const find = (input: NewReport, userId = carol) =>
      withUser(ctx.h.db, userId, (tx) => reports.findOpenReport(tx, userId, input))
    const create = (input: NewReport) =>
      withUser(ctx.h.db, carol, (tx) => reports.createReport(tx, carol, input))

    const bare: NewReport = { itemRef: 'lexeme:lx_dedupe', kind: 'other' }
    expect(await find(bare)).toBeNull()
    const { id } = await create(bare)
    expect(await find(bare)).toEqual({ id })
    const others: NewReport[] = [
      { ...bare, kind: 'audio_problem' },
      { ...bare, itemRef: 'lexeme:lx_other' },
      { ...bare, sessionId: session },
      { ...bare, answer: '' },
      { ...bare, text: 'too quiet' },
    ]
    for (const other of others) expect(await find(other), JSON.stringify(other)).toBeNull()

    const full: NewReport = { ...bare, sessionId: session, answer: '', text: 'too quiet' }
    const { id: fullId } = await create(full)
    expect(await find(full)).toEqual({ id: fullId })
    expect(await find({ ...full, answer: undefined })).toBeNull()
    expect(await find(bare)).toEqual({ id })
    expect(await find({ ...bare, sessionId: 'not-a-uuid' })).toBeNull()

    // Another learner's reports are not the caller's, and a triaged report is no longer open.
    expect(await find(bare, await ctx.newUser())).toBeNull()
    await withSystem(ctx.h.db, (tx) => reports.adminUpdateReport(tx, id, 'rejected'))
    expect(await find(bare)).toBeNull()
  })
})
