/**
 * Per-user rate limits (429 + error envelope + retry-after) and outdated clients (426), against the
 * running app's default AppConfig (ARCHITECTURE §7). Buckets are keyed per user, so each test uses
 * fresh learners and never slows down other specs.
 */
import { expect, test } from '@playwright/test'
import { APP_VERSION, call, expectEnvelope, guest, plusHours, read200 } from './support'

// A far-future clock per test keeps the token bucket's window deterministic (x-test-now drives it).
const T0 = '2034-01-01T12:00:00.000Z'

test('reports: the 11th report in a minute is 429 with retry-after; other buckets and users are unaffected', async ({
  request,
}) => {
  const alice = await guest(request)
  const bob = await guest(request)
  // The limit applies before validation, so even refused (400) requests use up the budget.
  const statuses: number[] = []
  for (let i = 0; i < 10; i++)
    statuses.push((await call(request, alice, '/api/reports', { now: T0, data: {} })).status)
  expect(statuses).toEqual(Array(10).fill(400))

  const limited = await call(request, alice, '/api/reports', {
    now: T0,
    data: { itemRef: 'lexeme:lx_ab', kind: 'other' },
  })
  expectEnvelope(limited, 429, 'rate_limited')
  const retryAfter = Number(limited.headers['retry-after'])
  expect(retryAfter).toBeGreaterThanOrEqual(1)
  expect(retryAfter).toBeLessThanOrEqual(60)

  // Another bucket of the same user, and the same bucket of another user, still work.
  await read200(request, alice, '/api/home', T0)
  expect((await call(request, bob, '/api/reports', { now: T0, data: {} })).status).toBe(400)

  // After the window the bucket has refilled.
  const later = await call(request, alice, '/api/reports', {
    now: plusHours(T0, 1 / 60 + 1 / 3600),
    data: { itemRef: 'lexeme:lx_ab', kind: 'other' },
  })
  expect(later.status, JSON.stringify(later.body)).toBe(200)
})

test('sessions: the 21st session request in a minute is 429', async ({ request }) => {
  const alice = await guest(request)
  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      call(request, alice, '/api/sessions', { now: T0, data: { kind: 'nope' } }),
    ),
  )
  expect(results.map((r) => r.status)).toEqual(Array(20).fill(400))
  expectEnvelope(
    await call(request, alice, '/api/sessions', {
      now: T0,
      data: { courseId: 'fixture', kind: 'practice', tz: 'UTC' },
    }),
    429,
    'rate_limited',
  )
})

test('an outdated app version gets 426 with the envelope; current, newer and absent versions pass', async ({
  request,
}) => {
  const alice = await guest(request)
  const meta = await read200(request, alice, '/api/meta')
  const min = String(meta.minAppVersion)
  const [major, minor, patch] = min.split('.').map(Number) as [number, number, number]
  const older =
    patch > 0
      ? `${major}.${minor}.${patch - 1}`
      : minor > 0
        ? `${major}.${minor - 1}.99`
        : `${major - 1}.99.99`

  for (const path of ['/api/home', '/api/path', '/api/settings']) {
    const res = await call(request, alice, path, { headers: { [APP_VERSION]: older } })
    expectEnvelope(res, 426, 'upgrade_required')
    expect(String((res.body.error as { message: string }).message)).toContain(min)
  }
  // Writes too: an old client must not commit a lesson.
  expectEnvelope(
    await call(request, alice, '/api/sessions', {
      headers: { [APP_VERSION]: older },
      data: { courseId: 'fixture', kind: 'practice', tz: 'UTC' },
    }),
    426,
    'upgrade_required',
  )
  for (const version of [min, `${major}.${minor}.${patch + 1}`, `${major + 1}.0.0`])
    expect(
      (await call(request, alice, '/api/home', { headers: { [APP_VERSION]: version } })).status,
    ).toBe(200)
  expect((await call(request, alice, '/api/home')).status).toBe(200)
})
