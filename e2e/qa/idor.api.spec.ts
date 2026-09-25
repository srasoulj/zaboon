/**
 * IDOR sweep (ARCHITECTURE §9, §15; CLAUDE.md rule 3): every `:id` route and every user-scoped read
 * is called by a second learner with the first learner's ids. The answer is always 404/403 and never
 * the other learner's data, and nothing of the first learner changes.
 */
import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  admin,
  answersFor,
  call,
  expectEnvelope,
  finish,
  finishRaw,
  guest,
  link,
  read200,
  start,
  wrongEvent,
  type Session,
  type User,
} from './support'

/** Alice with some history: a completed lesson with a mistake, an open session and a report. */
async function aliceWithHistory(request: APIRequestContext) {
  const alice = await guest(request)
  const done = await start(request, alice)
  expect((await wrongEvent(request, alice, done.sessionId, 0)).status).toBe(200)
  await finish(request, alice, done, { wrong: [0] })
  const open = await start(request, alice, { kind: 'practice' })
  const report = await call(request, alice, '/api/reports', {
    data: { itemRef: 'lexeme:lx_ab', kind: 'other', sessionId: done.sessionId, text: 'qa' },
  })
  expect(report.status, JSON.stringify(report.body)).toBe(200)
  return { alice, done, open, reportId: report.body.id as string }
}

/** Every user-scoped read of `user`, keyed by path. */
async function reads(request: APIRequestContext, user: User) {
  const out: Record<string, unknown> = {}
  for (const path of [
    '/api/home',
    '/api/path',
    '/api/letters',
    '/api/words',
    '/api/profile',
    '/api/settings',
  ])
    out[path] = await read200(request, user, path)
  return out
}

test('sessions: another learner can neither record events on nor complete my session', async ({
  request,
}) => {
  const { alice, done, open } = await aliceWithHistory(request)
  const bob = await guest(request)
  const before = await reads(request, alice)

  for (const s of [done, open] as Session[]) {
    expectEnvelope(await wrongEvent(request, bob, s.sessionId, 1000), 404, 'not_found')
    const complete = await finishRaw(request, bob, s, { answers: answersFor(s.challenges) })
    expectEnvelope(complete, 404, 'not_found')
    // The body of the refusal says nothing about the session.
    expect(JSON.stringify(complete.body)).not.toContain(s.sessionId)
  }

  // Bob's attempts changed nothing of Alice's (hearts, XP, streak, progress)…
  expect(await reads(request, alice)).toEqual(before)
  // …and nothing of Bob's either.
  expect(await read200(request, bob, '/api/home')).toMatchObject({
    xpTotal: 0,
    lives: { count: 5 },
    streak: { current: 0 },
  })
  // Alice's open session still works for Alice.
  expect((await finishRaw(request, alice, open)).status).toBe(200)
})

test("reports: I can't attach another learner's session, and learners can't triage", async ({
  request,
}) => {
  const { alice, done, reportId } = await aliceWithHistory(request)
  const bob = await guest(request)

  const idor = await call(request, bob, '/api/reports', {
    data: { itemRef: 'lexeme:lx_ab', kind: 'other', sessionId: done.sessionId },
  })
  expectEnvelope(idor, 404, 'not_found')

  // Admin triage routes: learners get 403 whatever the id, and see no reports.
  for (const user of [alice, bob]) {
    expectEnvelope(await call(request, user, '/api/admin/reports'), 403, 'forbidden')
    expectEnvelope(
      await call(request, user, `/api/admin/reports/${reportId}`, {
        method: 'PATCH',
        data: { status: 'rejected' },
      }),
      403,
      'forbidden',
    )
  }
  // The report was not triaged by those attempts.
  const boss = await admin(request)
  const list = await read200(request, boss, '/api/admin/reports?status=new&limit=500')
  expect((list.reports as { id: string }[]).map((r) => r.id)).toContain(reportId)
  // Unknown ids are 404 for admins, never 500.
  expectEnvelope(
    await call(request, boss, `/api/admin/reports/${crypto.randomUUID()}`, {
      method: 'PATCH',
      data: { status: 'accepted' },
    }),
    404,
    'not_found',
  )
})

test("user-scoped reads never contain another learner's data", async ({ request }) => {
  const { alice, done, open, reportId } = await aliceWithHistory(request)
  const bob = await guest(request)
  const bobReads = await reads(request, bob)
  const exported = await read200(request, bob, '/api/account/export')
  const everything = JSON.stringify({ bobReads, exported })

  for (const id of [alice.id, done.sessionId, open.sessionId, reportId])
    expect(everything, `leaked ${id}`).not.toContain(id)
  expect(bobReads['/api/home']).toMatchObject({ xpTotal: 0, streak: { current: 0 } })
  expect(bobReads['/api/words']).toMatchObject({ words: [] })
  expect(exported).toMatchObject({ user: { id: bob.id } })

  // Alice's own export does contain her history (so the check above is meaningful).
  const mine = JSON.stringify(await read200(request, alice, '/api/account/export'))
  for (const id of [done.sessionId, open.sessionId, reportId]) expect(mine).toContain(id)
})

test('unknown and malformed session ids are 404, never a server error', async ({ request }) => {
  const bob = await guest(request)
  for (const id of [crypto.randomUUID(), 'not-a-uuid', '1', "x' OR '1'='1"]) {
    const path = `/api/sessions/${encodeURIComponent(id)}`
    expectEnvelope(
      await call(request, bob, `${path}/events`, {
        data: { attemptSeq: 0, index: 0, kind: 'wrong' },
      }),
      404,
      'not_found',
    )
    expectEnvelope(
      await call(request, bob, `${path}/complete`, {
        data: {
          answers: [
            {
              index: 0,
              attemptSeq: 0,
              response: { kind: 'none' },
              verdict: 'correct',
              ms: 1000,
              hinted: false,
            },
          ],
          completedAt: new Date().toISOString(),
          graderVersion: 1,
        },
      }),
      404,
      'not_found',
    )
  }
})

test("account merge: members can't merge another member, guests can't merge at all", async ({
  request,
}) => {
  const carol = await guest(request)
  const carolMember = await link(request, carol)
  const { alice } = await aliceWithHistory(request)
  const aliceMember = await link(request, alice)

  // Merging a linked member's token is refused: only guests can be merged.
  const res = await call(request, carolMember, '/api/account/merge', {
    data: { guestToken: aliceMember.token },
  })
  expectEnvelope(res, 403, 'forbidden')
  // Alice keeps her progress.
  expect(await read200(request, aliceMember, '/api/home')).toMatchObject({ xpTotal: 10 })

  // A guest token that is not a valid token is 401.
  expectEnvelope(
    await call(request, carolMember, '/api/account/merge', {
      data: { guestToken: 'x'.repeat(40) },
    }),
    401,
    'unauthorized',
  )
  // A guest can't call merge at all (members only).
  const dave = await guest(request)
  expectEnvelope(
    await call(request, dave, '/api/account/merge', { data: { guestToken: dave.token } }),
    403,
    'forbidden',
  )
})
