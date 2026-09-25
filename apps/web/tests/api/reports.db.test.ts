/** POST /api/reports, GET /api/admin/reports and PATCH /api/admin/reports/:id. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, start } from './flows'
import { createHarness, type Harness, type TestUser } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h?.close()
})

const report = (user: TestUser, body: Record<string, unknown>) =>
  h.call(api.createReport, { path: '/api/reports', user, body })
const list = (user: TestUser, query = '') =>
  h.call(api.adminReports, { path: `/api/admin/reports${query}`, user })
const triage = (user: TestUser, id: string, status: string) =>
  h.call(api.adminUpdateReport, {
    method: 'PATCH',
    path: `/api/admin/reports/${id}`,
    params: { id },
    user,
    body: { status },
  })

describe('POST /api/reports', () => {
  it('files a report, and an identical open report is not duplicated', async () => {
    const alice = await h.guest()
    const s = await start(h, alice)
    const body = {
      itemRef: 'sentence:s_u01_0006',
      kind: 'answer_should_be_accepted',
      sessionId: s.sessionId,
      answer: 'Dad is good',
    }
    const first = await report(alice, body)
    expect(first.status).toBe(200)
    expect(first.body.id).toEqual(expect.any(String))
    expect((await report(alice, body)).body.id).toBe(first.body.id)
    const different = await report(alice, { ...body, answer: 'Dad is fine' })
    expect(different.body.id).not.toBe(first.body.id)
  })

  it("rejects bad item refs and another learner's session (IDOR)", async () => {
    const alice = await h.guest()
    const bob = await h.guest()
    const s = await start(h, alice)
    expect((await report(bob, { itemRef: 'nonsense', kind: 'other' })).status).toBe(400)
    const idor = await report(bob, {
      itemRef: 'lexeme:lx_ab',
      kind: 'other',
      sessionId: s.sessionId,
    })
    expect(idor.status).toBe(404)
    const [n] = await h.sql`SELECT count(*)::int AS n FROM reports WHERE user_id = ${bob.id}`
    expect(n!.n).toBe(0)
  })
})

describe('admin reports', () => {
  it('lists, filters and triages reports for admins only', async () => {
    const alice = await h.guest()
    const admin = await h.admin()
    const { body: a } = await report(alice, {
      itemRef: 'lexeme:lx_ab',
      kind: 'audio_problem',
      text: 'quiet',
    })
    const { body: b } = await report(alice, { itemRef: 'lexeme:lx_nun', kind: 'content_error' })

    const all = await list(admin)
    expect(all.status).toBe(200)
    expect(all.body.reports.map((r: { id: string }) => r.id)).toEqual(
      expect.arrayContaining([a.id, b.id]),
    )

    const accepted = await triage(admin, a.id, 'accepted')
    expect(accepted.status).toBe(200)
    expect(accepted.body).toMatchObject({
      id: a.id,
      status: 'accepted',
      itemRef: 'lexeme:lx_ab',
      text: 'quiet',
    })
    expect((await triage(admin, a.id, 'accepted')).body.status).toBe('accepted') // idempotent

    const onlyNew = await list(admin, '?status=new')
    const ids = onlyNew.body.reports.map((r: { id: string }) => r.id)
    expect(ids).toContain(b.id)
    expect(ids).not.toContain(a.id)
    expect((await list(admin, '?limit=1')).body.reports).toHaveLength(1)
    expect((await list(admin, '?status=bogus')).status).toBe(400)
    expect((await list(admin, '?limit=0')).status).toBe(400)
    expect((await list(admin, '?before=yesterday')).status).toBe(400)
  })

  it('refuses learners (403) and unknown reports (404)', async () => {
    const alice = await h.guest()
    const member = await h.member()
    const admin = await h.admin()
    const { body } = await report(alice, { itemRef: 'lexeme:lx_ab', kind: 'other' })
    expect((await list(alice)).status).toBe(403)
    expect((await list(member)).status).toBe(403)
    // Nobody but an admin can change a report, not even its author.
    const own = await triage(alice, body.id, 'accepted')
    expect(own.status).toBe(403)
    const [row] = await h.sql`SELECT status FROM reports WHERE id = ${body.id}`
    expect(row!.status).toBe('new')
    expect((await triage(admin, '00000000-0000-4000-8000-000000000000', 'rejected')).status).toBe(
      404,
    )
    expect((await triage(admin, 'not-a-uuid', 'rejected')).status).toBe(404)
    expect((await triage(admin, body.id, 'maybe')).status).toBe(400)
  })
})
