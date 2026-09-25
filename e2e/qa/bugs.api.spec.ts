/**
 * Regression tests for bugs QA found in the API. Each one is marked `test.fail()` until its issue
 * is fixed: when a fix lands the test starts passing, Playwright reports it, and the `test.fail()`
 * line must be removed (the test then guards the fix).
 */
import { expect, test } from '@playwright/test'
import { call, expectEnvelope, finishRaw, guest, start } from './support'

// https://github.com/srasoulj/zaboon/issues/27
test("a deleted account's token is refused with 401 on every user route, never 500", async ({
  request,
}) => {
  test.fail() // #27: the profile insert fails on the auth.users foreign key → 500
  const alice = await guest(request)
  const s = await start(request, alice, { kind: 'practice' })
  expect((await call(request, alice, '/api/account', { method: 'DELETE' })).status).toBe(200)

  const statuses: Record<string, number> = {}
  for (const [path, o] of [
    ['/api/home', {}],
    ['/api/profile', {}],
    ['/api/settings', {}],
    ['/api/settings', { method: 'PATCH', data: { sound: false } }],
    ['/api/sessions', { data: { courseId: 'fixture', kind: 'practice', tz: 'UTC' } }],
    [`/api/sessions/${s.sessionId}/events`, { data: { attemptSeq: 0, index: 0, kind: 'wrong' } }],
    ['/api/reports', { data: { itemRef: 'lexeme:lx_ab', kind: 'other' } }],
  ] as const) {
    const res = await call(request, alice, path, o)
    statuses[`${'method' in o ? o.method : 'data' in o ? 'POST' : 'GET'} ${path}`] = res.status
  }
  for (const [route, status] of Object.entries(statuses))
    expect.soft(status, route).toBeLessThan(500)
  expectEnvelope(await call(request, alice, '/api/home'), 401, 'unauthorized')
})

// https://github.com/srasoulj/zaboon/issues/28
test('a completion whose server clock is before the session start still commits', async ({
  request,
}) => {
  test.fail() // #28: durationMs comes out negative and the result fails its contract → 500
  const alice = await guest(request)
  const s = await start(request, alice, { now: '2032-01-01T12:00:00.000Z' })
  const res = await finishRaw(request, alice, s, { now: '2032-01-01T11:59:00.000Z' })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  expect(res.body).toMatchObject({ durationMs: 0, localDate: '2032-01-01', xp: { total: 15 } })
})
