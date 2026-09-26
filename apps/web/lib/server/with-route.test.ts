import { isIP } from 'node:net'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DEFAULT_APP_CONFIG, type AppConfig } from '@zaboon/contracts'
import { resetServerEnv, serverEnv } from './env'
import { ApiError } from './errors'
import { bucketLimit, clientIp, readBody } from './with-route'

const Body = z.object({ n: z.number().int() })
const LIMIT = 64

/** A JSON body of exactly `bytes` bytes (UTF-8): `{"n":1,"pad":"…"}` padded with `ch`. */
function body(bytes: number, ch = 'x'): string {
  const head = '{"n":1,"pad":"'
  const room = bytes - head.length - '"}'.length
  const size = new TextEncoder().encode(ch).length
  if (room < 0 || room % size !== 0) throw new Error(`cannot pad to ${bytes} bytes with ${ch}`)
  return `${head}${ch.repeat(room / size)}"}`
}

const post = (content: string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/test', {
    method: 'POST',
    body: content,
    headers,
    duplex: 'half',
  } as RequestInit)

async function refused(promise: Promise<unknown>): Promise<void> {
  const err: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(ApiError)
  expect(err).toMatchObject({
    code: 'validation',
    status: 400,
    message: `request body is larger than ${LIMIT} bytes`,
  })
}

describe('readBody: the request body cap', () => {
  it('accepts a body of exactly the limit, and one just under it', async () => {
    expect(new TextEncoder().encode(body(LIMIT)).length).toBe(LIMIT)
    expect(await readBody(post(body(LIMIT)), Body, LIMIT)).toEqual({ n: 1 })
    expect(await readBody(post(body(LIMIT - 1)), Body, LIMIT)).toEqual({ n: 1 })
    const declared = post(body(LIMIT), { 'content-length': String(LIMIT) })
    expect(await readBody(declared, Body, LIMIT)).toEqual({ n: 1 })
  })

  it('refuses a declared content-length over the limit without reading the body', async () => {
    const req = post(body(20), { 'content-length': String(LIMIT + 1) })
    await refused(readBody(req, Body, LIMIT))
    expect(req.bodyUsed).toBe(false)
  })

  it('refuses a body over the limit when it declares no length, or a false one', async () => {
    await refused(readBody(post(body(LIMIT + 1)), Body, LIMIT))
    await refused(readBody(post(body(LIMIT + 1), { 'content-length': '10' }), Body, LIMIT))
  })

  it('counts bytes, not characters', async () => {
    const persian = body(LIMIT + 2, 'س') // 2 bytes each: fewer than LIMIT characters
    expect(persian.length).toBeLessThan(LIMIT)
    await refused(readBody(post(persian), Body, LIMIT))
    expect(await readBody(post(body(LIMIT, 'س')), Body, LIMIT)).toEqual({ n: 1 })
  })

  it('stops reading an endless body at the limit and cancels it', async () => {
    let pulled = 0
    let cancelled = false
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 16
        controller.enqueue(new Uint8Array(16).fill(0x20))
      },
      cancel() {
        cancelled = true
      },
    })
    await refused(readBody(post(endless), Body, LIMIT))
    expect(cancelled).toBe(true)
    expect(pulled).toBeLessThanOrEqual(LIMIT + 16 * 2)
  })

  it('still reads an empty body as {} and refuses JSON that does not match', async () => {
    expect(await readBody(post(''), z.object({}), LIMIT)).toEqual({})
    await expect(readBody(post('{'), Body, LIMIT)).rejects.toMatchObject({
      code: 'validation',
      message: 'request body is not valid JSON',
    })
    await expect(readBody(post('{"n":"one"}'), Body, LIMIT)).rejects.toMatchObject({
      code: 'validation',
      details: [{ path: 'n' }],
    })
  })
})

describe('bucketLimit', () => {
  const config = (rateLimits: AppConfig['rateLimits']): AppConfig => ({
    ...DEFAULT_APP_CONFIG,
    rateLimits,
  })

  it('uses the configured entry of the bucket', () => {
    expect(bucketLimit(DEFAULT_APP_CONFIG, 'export')).toEqual({ perMinute: 3 })
    expect(bucketLimit(config({ export: { perMinute: 1 } }), 'export')).toEqual({ perMinute: 1 })
  })

  it('falls back to the built-in bucket, then to the default bucket, never to no limit', () => {
    const old = config({ default: { perMinute: 50 } }) // a config from before the bucket existed
    expect(bucketLimit(old, 'export')).toEqual(DEFAULT_APP_CONFIG.rateLimits.export)
    expect(bucketLimit(old, 'no-such-bucket')).toEqual({ perMinute: 50 })
    expect(bucketLimit(config({}), 'no-such-bucket')).toEqual(DEFAULT_APP_CONFIG.rateLimits.default)
  })
})

const req = (headers: Record<string, string> = {}) => new Request('http://localhost/', { headers })
const trusted = (headers: Record<string, string> = {}) => clientIp(req(headers), true)

describe('clientIp (per-IP rate-limit keys)', () => {
  it('takes a valid IPv4 or IPv6 address from X-Forwarded-For, trimmed', () => {
    expect(trusted({ 'x-forwarded-for': '203.0.113.7' })).toBe('203.0.113.7')
    expect(trusted({ 'x-forwarded-for': '  203.0.113.7  ' })).toBe('203.0.113.7')
    expect(trusted({ 'x-forwarded-for': '2001:db8::1' })).toBe('2001:db8::1')
    expect(trusted({ 'x-forwarded-for': '::ffff:192.0.2.128' })).toBe('::ffff:192.0.2.128')
  })

  it('uses only the first entry of a list', () => {
    expect(trusted({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' })).toBe('203.0.113.7')
    expect(trusted({ 'x-forwarded-for': '2001:db8::1,10.0.0.1' })).toBe('2001:db8::1')
    // An invalid first entry is not skipped in favour of a later one.
    expect(trusted({ 'x-forwarded-for': 'garbage, 10.0.0.1' })).toBe('unknown')
  })

  it('rejects garbage', () => {
    const garbage = ['not-an-ip', 'deadbeef', 'abc', '1.2.3.4 OR 1=1', '<script>', '1.2.3.4:80']
    for (const bad of [...garbage, '[::1]', '01.2.3.4', '256.1.1.1', '', ' , ']) {
      expect(trusted({ 'x-forwarded-for': bad })).toBe('unknown')
      expect(trusted({ 'x-real-ip': bad })).toBe('unknown')
    }
  })

  it('rejects very long values, including IPv6 zone IDs that isIP accepts at any length', () => {
    expect(trusted({ 'x-forwarded-for': '1'.repeat(10_000) })).toBe('unknown')
    expect(trusted({ 'x-forwarded-for': `203.0.113.7${' '.repeat(10_000)}x` })).toBe('unknown')
    const zoned = `fe80::1%${'a'.repeat(300)}`
    expect(isIP(zoned)).toBe(6)
    expect(trusted({ 'x-forwarded-for': zoned })).toBe('unknown')
    expect(trusted({ 'x-real-ip': zoned })).toBe('unknown')
  })

  it('falls back to X-Real-IP, then to "unknown"', () => {
    expect(trusted()).toBe('unknown')
    expect(trusted({ 'x-real-ip': '198.51.100.4' })).toBe('198.51.100.4')
    expect(trusted({ 'x-forwarded-for': 'x'.repeat(10_000), 'x-real-ip': '2001:db8::2' })).toBe(
      '2001:db8::2',
    )
    expect(trusted({ 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '198.51.100.4' })).toBe(
      '203.0.113.7',
    )
    expect(trusted({ 'x-real-ip': 'not-an-ip' })).toBe('unknown')
    expect(trusted({ 'x-forwarded-for': 'nope', 'x-real-ip': 'x'.repeat(10_000) })).toBe('unknown')
  })

  it('ignores the headers when no trusted proxy sets them', () => {
    expect(clientIp(req(), false)).toBe('local')
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.7' }), false)).toBe('local')
    expect(clientIp(req({ 'x-real-ip': '198.51.100.4' }), false)).toBe('local')
    expect(clientIp(req({ 'x-forwarded-for': 'x'.repeat(10_000) }), false)).toBe('local')
  })

  it('always returns "local", "unknown" or an IP of at most 45 characters', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string({ maxLength: 300 }), { nil: undefined }),
        fc.option(fc.string({ maxLength: 300 }), { nil: undefined }),
        fc.boolean(),
        (xff, realIp, trust) => {
          const headers: Record<string, string> = {}
          // Header values cannot hold control characters or non-Latin-1 text.
          const clean = (s: string) => s.replace(/[^\x20-\x7e]/g, '')
          if (xff !== undefined) headers['x-forwarded-for'] = clean(xff)
          if (realIp !== undefined) headers['x-real-ip'] = clean(realIp)
          const ip = clientIp(req(headers), trust)
          if (!trust) return ip === 'local'
          return ip === 'unknown' || (ip.length <= 45 && isIP(ip) !== 0)
        },
      ),
    )
  })
})

describe('serverEnv().trustProxy', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
    resetServerEnv()
  })
  const trustWith = (vars: Record<string, string>) => {
    for (const k of ['VERCEL', 'VERCEL_ENV', 'ZABOON_TRUST_PROXY']) delete process.env[k]
    Object.assign(process.env, {
      AUTH_MODE: 'supabase',
      DATABASE_URL_APP_SERVER: 'postgres://app_server@db.example.test:6543/postgres',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      ...vars,
    })
    resetServerEnv()
    return serverEnv().trustProxy
  }

  it('trusts the proxy headers only on Vercel or with ZABOON_TRUST_PROXY=1', () => {
    expect(trustWith({})).toBe(false)
    expect(trustWith({ ZABOON_TRUST_PROXY: 'true' })).toBe(false)
    expect(trustWith({ ZABOON_TRUST_PROXY: '1' })).toBe(true)
    expect(trustWith({ VERCEL: '1' })).toBe(true)
    expect(trustWith({ VERCEL_ENV: 'production' })).toBe(true)
    const loopback = 'postgres://app_server@127.0.0.1:54322/zaboon'
    expect(trustWith({ AUTH_MODE: 'local', DATABASE_URL_APP_SERVER: loopback })).toBe(false)
  })
})
