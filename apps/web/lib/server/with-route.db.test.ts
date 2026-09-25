import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { RouteDef } from '@zaboon/contracts'
import { NotFoundError, createDb, repos, withSystem } from '@zaboon/db'
import { createTestDatabase, type TestDatabase } from '@zaboon/db/testing'
import { signLocalToken } from './auth/local'
import { resetRuntimeConfig } from './config'
import { resetServerEnv } from './env'
import { withRoute } from './with-route'

const USER = '11111111-2222-4333-8444-555555555555'
let tdb: TestDatabase

beforeAll(async () => {
  tdb = await createTestDatabase()
  Object.assign(process.env, {
    AUTH_MODE: 'local',
    DATABASE_URL_APP_SERVER: tdb.appUrl,
    ZABOON_DEV_AUTH_SECRET: 'db-test-secret-db-test-secret-db', // pragma: allowlist secret
  })
  delete process.env.VERCEL_ENV
  delete process.env.ZABOON_DEV_AUTH
  resetServerEnv()
  const h = createDb(tdb.appUrl, { max: 1 })
  await withSystem(h.db, (tx) =>
    repos.content.setAppConfig(tx, 'rateLimits', { tiny: { perMinute: 2 } }),
  )
  await h.close()
})
afterAll(async () => {
  await tdb.drop()
})

const Body = z.object({ n: z.number().int() })
const Ok = z.object({ ok: z.literal(true), user: z.string().nullable(), now: z.string() })
const def = <const A extends RouteDef['auth']>(auth: A, bucket = 'default') =>
  ({
    method: 'POST',
    path: '/api/test',
    auth,
    phase: 'mvp',
    bucket,
    request: Body,
    response: Ok,
  }) as const

const bearer = async (opts: { anonymous?: boolean; admin?: boolean } = {}) =>
  `Bearer ${(await signLocalToken({ userId: USER, isAnonymous: opts.anonymous ?? true, email: null, isAdmin: opts.admin ?? false })).accessToken}`

const call = (
  handler: (req: Request, ctx: { params?: Promise<Record<string, string>> }) => Promise<Response>,
  init: RequestInit = {},
) =>
  handler(
    new Request('http://localhost/api/test', {
      method: 'POST',
      body: JSON.stringify({ n: 1 }),
      ...init,
    }),
    {},
  )

const echo = withRoute(def('user'), async ({ user, now }) => ({
  ok: true as const,
  user: user.id,
  now: now.toISOString(),
}))

describe('withRoute', () => {
  it('passes the verified user, parsed body and clock to the handler', async () => {
    const res = await call(echo, {
      headers: { authorization: await bearer(), 'x-test-now': '2031-05-06T07:08:09Z' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ ok: true, user: USER, now: '2031-05-06T07:08:09.000Z' })
  })

  it('answers 401 without or with a bad token, 403 for members-only and admin routes', async () => {
    expect((await call(echo)).status).toBe(401)
    expect((await call(echo, { headers: { authorization: 'Bearer x.y.z' } })).status).toBe(401)
    const member = withRoute(def('member'), async () => ({
      ok: true as const,
      user: null,
      now: '',
    }))
    const admin = withRoute(def('admin'), async () => ({ ok: true as const, user: null, now: '' }))
    expect((await call(member, { headers: { authorization: await bearer() } })).status).toBe(403)
    expect(
      (await call(member, { headers: { authorization: await bearer({ anonymous: false }) } }))
        .status,
    ).toBe(200)
    expect(
      (await call(admin, { headers: { authorization: await bearer({ anonymous: false }) } }))
        .status,
    ).toBe(403)
    expect(
      (
        await call(admin, {
          headers: { authorization: await bearer({ anonymous: false, admin: true }) },
        })
      ).status,
    ).toBe(200)
  })

  it('hides dev routes unless dev auth is enabled', async () => {
    const dev = withRoute(def('dev'), async () => ({ ok: true as const, user: null, now: '' }))
    const res = await call(dev)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'not found' } })
  })

  it('validates requests and responses against the contract', async () => {
    const auth = { authorization: await bearer() }
    const badJson = await call(echo, { headers: auth, body: '{' })
    expect(badJson.status).toBe(400)
    const badShape = await call(echo, { headers: auth, body: JSON.stringify({ n: 'one' }) })
    expect(badShape.status).toBe(400)
    expect(await badShape.json()).toMatchObject({
      error: { code: 'validation', details: [{ path: 'n' }] },
    })
    const liar = withRoute(
      def('user'),
      async () => ({ ok: false }) as unknown as z.input<typeof Ok>,
    )
    expect((await call(liar, { headers: auth })).status).toBe(500)
  })

  it('maps repository errors and rejects outdated clients', async () => {
    const auth = { authorization: await bearer() }
    const missing = withRoute(def('user'), async () => {
      throw new NotFoundError('session')
    })
    expect((await call(missing, { headers: auth })).status).toBe(404)
    const old = await call(echo, { headers: { ...auth, 'x-zaboon-app-version': '0.0.1' } })
    expect(old.status).toBe(426)
  })

  it('rate-limits per bucket and caller with Retry-After', async () => {
    const tiny = withRoute(def('user', 'tiny'), async ({ now }) => ({
      ok: true as const,
      user: null,
      now: now.toISOString(),
    }))
    const auth = {
      authorization: await bearer({ anonymous: false }),
      'x-test-now': '2031-01-01T00:00:00Z',
    }
    expect((await call(tiny, { headers: auth })).status).toBe(200)
    expect((await call(tiny, { headers: auth })).status).toBe(200)
    const limited = await call(tiny, { headers: auth })
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('authenticates cron routes with the secret and fails closed without one', async () => {
    const cron = withRoute(
      {
        method: 'GET',
        path: '/api/cron/test',
        auth: 'cron',
        phase: 'p2',
        bucket: 'cron',
        request: undefined,
        response: Ok,
      } as const,
      async ({ user }) => ({ ok: true as const, user: user?.id ?? null, now: '' }),
    )
    const get = (authorization?: string) =>
      call(cron, {
        method: 'GET',
        body: undefined,
        headers: authorization === undefined ? {} : { authorization },
      })
    const secret = 'with-route-cron-secret' // pragma: allowlist secret
    try {
      delete process.env.CRON_SECRET
      resetServerEnv()
      expect((await get('Bearer ')).status).toBe(401) // no secret configured: fail closed
      expect((await get()).status).toBe(401)
      process.env.CRON_SECRET = secret
      resetServerEnv()
      expect((await get()).status).toBe(401)
      expect((await get(`Bearer ${secret}-`)).status).toBe(401)
      expect((await get(await bearer({ anonymous: false }))).status).toBe(401) // a user token
      const ok = await get(`Bearer ${secret}`)
      expect(ok.status).toBe(200)
      expect(await ok.json()).toEqual({ ok: true, user: null, now: '' })
    } finally {
      delete process.env.CRON_SECRET
      resetServerEnv()
    }
  })

  it('exposes the flags: configured, then x-test-flags on top (local mode)', async () => {
    const Flagged = z.object({ quests: z.boolean(), shop: z.boolean() })
    const flagged = withRoute(
      { ...def('user'), response: Flagged } as const,
      async ({ flags }) => ({ quests: flags.quests === true, shop: flags.shop === true }),
    )
    const auth = { authorization: await bearer() }
    const read = async (extra: Record<string, string> = {}) => {
      const res = await call(flagged, { headers: { ...auth, ...extra } })
      expect(res.status).toBe(200)
      return res.json()
    }
    expect(await read()).toEqual({ quests: false, shop: false })
    expect(await read({ 'x-test-flags': '{"shop":true}' })).toEqual({ quests: false, shop: true })
    const bad = await call(flagged, { headers: { ...auth, 'x-test-flags': '{"shop":"yes"}' } })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ error: { code: 'validation' } })

    const h = createDb(tdb.appUrl, { max: 1 })
    try {
      await withSystem(h.db, (tx) => repos.content.setAppConfig(tx, 'flags', { quests: true }))
      expect(await read()).toEqual({ quests: false, shop: false }) // cached for 30 s
      resetRuntimeConfig()
      expect(await read()).toEqual({ quests: true, shop: false })
      expect(await read({ 'x-test-flags': '{"quests":false}' })).toEqual({
        quests: false,
        shop: false,
      })
    } finally {
      await withSystem(h.db, (tx) => repos.content.setAppConfig(tx, 'flags', {}))
      await h.close()
      resetRuntimeConfig()
    }
  })
})
