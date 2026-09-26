import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { resetServerEnv } from './env'
import { ApiError } from './errors'
import {
  LOCAL_DEV_SIGNING_SECRET,
  MAX_TOKEN_LENGTH,
  MIN_SIGNING_SECRET_LENGTH,
  SigningUnavailableError,
  sign,
  verify,
} from './signing'

const SECRET = 'signing-unit-test-secret-0123456789abcdef' // pragma: allowlist secret
const OTHER_SECRET = 'another-unit-test-secret-0123456789abcdef' // pragma: allowlist secret
// Dates far from the real clock: expiry must follow the caller's `now` only.
const NOW = new Date('2020-01-01T12:00:00.000Z')
const EXPIRES = new Date('2020-01-02T12:00:00.000Z')
const payload = { s: '11111111-2222-4333-8444-555555555555', i: 3, h: 'digest', fa: 'سلام' }
const TOKEN_SHAPE = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/

const saved = { ...process.env }
afterEach(() => {
  process.env = { ...saved }
  resetServerEnv()
})

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  resetServerEnv()
}
const local = (secret?: string) =>
  setEnv({
    AUTH_MODE: 'local',
    VERCEL_ENV: undefined,
    DATABASE_URL_APP_SERVER: undefined,
    APP_SIGNING_SECRET: secret,
  })
const production = (secret?: string) =>
  setEnv({
    AUTH_MODE: 'supabase',
    NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
    DATABASE_URL_APP_SERVER: 'postgres://u@db:5432/x',
    APP_SIGNING_SECRET: secret,
  })

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
const parts = (token: string) => token.split('.') as [string, string, string]
/** Signs a raw body like the module does (the format is part of the token contract). */
function signRaw(secret: string, purpose: string, body: string): string {
  const key = createHmac('sha256', secret).update(`zaboon:signing:v1:${purpose}`).digest()
  return `v1.${body}.${createHmac('sha256', key).update(`v1.${body}`).digest('base64url')}`
}

describe('signed tokens (signing.ts)', () => {
  it('round-trip: the payload comes back for its purpose until it expires', () => {
    production(SECRET)
    const token = sign('speak', payload, { expiresAt: EXPIRES })
    expect(token).toMatch(TOKEN_SHAPE)
    expect(verify('speak', token, NOW)).toEqual(payload)
    const justBefore = new Date(EXPIRES.getTime() - 1)
    expect(verify('speak', token, justBefore)).toEqual(payload)
    // The same payload signs to the same token (no clock, no randomness).
    expect(sign('speak', payload, { expiresAt: EXPIRES })).toBe(token)
  })

  it('the signed JSON carries the purpose and the expiry (signed, not encrypted)', () => {
    production(SECRET)
    const [, body] = parts(sign('speak', payload, { expiresAt: EXPIRES }))
    expect(JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))).toEqual({
      ...payload,
      purpose: 'speak',
      exp: EXPIRES.getTime(),
    })
  })

  it('an expired token is rejected (exp is exclusive)', () => {
    production(SECRET)
    const token = sign('speak', payload, { expiresAt: EXPIRES })
    expect(verify('speak', token, EXPIRES)).toBeNull()
    expect(verify('speak', token, new Date(EXPIRES.getTime() + 60_000))).toBeNull()
    // Already expired when signed: never valid.
    const stale = sign('speak', payload, { expiresAt: NOW })
    expect(verify('speak', stale, NOW)).toBeNull()
  })

  it('a tampered payload is rejected', () => {
    production(SECRET)
    const [v, body, sig] = parts(sign('speak', payload, { expiresAt: EXPIRES }))
    const forged = b64({ ...payload, i: 4, purpose: 'speak', exp: EXPIRES.getTime() })
    expect(verify('speak', `${v}.${forged}.${sig}`, NOW)).toBeNull()
    const longer = b64({ ...payload, purpose: 'speak', exp: EXPIRES.getTime() + 86_400_000 })
    expect(verify('speak', `${v}.${longer}.${sig}`, NOW)).toBeNull()
    const flipped = body.slice(0, 5) + (body[5] === 'A' ? 'B' : 'A') + body.slice(6)
    expect(verify('speak', `${v}.${flipped}.${sig}`, NOW)).toBeNull()
  })

  it('a tampered signature is rejected, including a non-canonical encoding of the right one', () => {
    production(SECRET)
    const token = sign('speak', payload, { expiresAt: EXPIRES })
    const [v, body, sig] = parts(token)
    const flip = (s: string, i: number) =>
      s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1)
    expect(verify('speak', `${v}.${body}.${flip(sig, 0)}`, NOW)).toBeNull()
    expect(verify('speak', `${v}.${body}.${flip(sig, 20)}`, NOW)).toBeNull()
    const [, , otherSig] = parts(sign('speak', { ...payload, i: 4 }, { expiresAt: EXPIRES }))
    expect(verify('speak', `${v}.${body}.${otherSig}`, NOW)).toBeNull()
    // The last base64url character carries 2 unused bits: other values decode to the same bytes,
    // but only the canonical encoding verifies.
    // The base64url alphabet by 6-bit value: the first character of the byte `value << 2`.
    const alphabet = Array.from(
      { length: 64 },
      (_, value) => Buffer.from([value << 2]).toString('base64url')[0],
    ).join('')
    const last = alphabet.indexOf(sig.at(-1)!)
    const variant = sig.slice(0, -1) + alphabet[last ^ 1]
    expect(Buffer.from(variant, 'base64url').equals(Buffer.from(sig, 'base64url'))).toBe(true)
    expect(verify('speak', `${v}.${body}.${variant}`, NOW)).toBeNull()
  })

  it('a token signed for another purpose, or with another key, is rejected', () => {
    production(SECRET)
    const token = sign('speak', payload, { expiresAt: EXPIRES })
    expect(verify('other', token, NOW)).toBeNull()
    // Each purpose has its own key: a payload claiming this purpose but signed with another
    // purpose's key is rejected; the same payload under this purpose's key verifies.
    const claims = b64({ ...payload, purpose: 'other', exp: EXPIRES.getTime() })
    expect(verify('other', signRaw(SECRET, 'speak', claims), NOW)).toBeNull()
    expect(verify('other', signRaw(SECRET, 'other', claims), NOW)).toEqual(payload)
    production(OTHER_SECRET)
    expect(verify('speak', token, NOW)).toBeNull()
  })

  it('malformed tokens are rejected', () => {
    production(SECRET)
    const token = sign('speak', payload, { expiresAt: EXPIRES })
    const [, body, sig] = parts(token)
    const exp = EXPIRES.getTime()
    const malformed = [
      '',
      'v1',
      'v1.',
      `v1.${body}`,
      `v1..${sig}`,
      `v2.${body}.${sig}`,
      `V1.${body}.${sig}`,
      `${token}.x`,
      `${token}=`,
      ` ${token}`,
      `v1.${body}!.${sig}`,
      `v1.${body}.${sig.slice(1)}`,
      'x'.repeat(MAX_TOKEN_LENGTH + 1),
      // Correctly signed, but not a payload this module signs:
      signRaw(SECRET, 'speak', Buffer.from('not json', 'utf8').toString('base64url')),
      signRaw(SECRET, 'speak', b64([1, 2])),
      signRaw(SECRET, 'speak', b64('speak')),
      signRaw(SECRET, 'speak', b64({ ...payload, purpose: 'speak' })),
      signRaw(SECRET, 'speak', b64({ ...payload, purpose: 'speak', exp: String(exp) })),
      signRaw(SECRET, 'speak', b64({ ...payload, exp })),
      signRaw(SECRET, 'speak', b64({ ...payload, purpose: 'other', exp })),
    ]
    for (const bad of malformed) expect(verify('speak', bad, NOW), bad.slice(0, 40)).toBeNull()
    // A body signed exactly like the module signs verifies (the format is the contract).
    expect(verify('speak', signRaw(SECRET, 'speak', body), NOW)).toEqual(payload)
    expect(verify('speak', undefined as unknown as string, NOW)).toBeNull()
  })

  it('local mode signs with a fixed dev key when APP_SIGNING_SECRET is unset', () => {
    local()
    const token = sign('speak', payload, { expiresAt: EXPIRES })
    expect(verify('speak', token, NOW)).toEqual(payload)
    expect(LOCAL_DEV_SIGNING_SECRET.length).toBeGreaterThanOrEqual(MIN_SIGNING_SECRET_LENGTH)
    const [, body] = parts(token)
    expect(token).toBe(signRaw(LOCAL_DEV_SIGNING_SECRET, 'speak', body))
    // A configured secret wins, so dev-key tokens stop verifying.
    local(SECRET)
    expect(verify('speak', token, NOW)).toBeNull()
    expect(verify('speak', sign('speak', payload, { expiresAt: EXPIRES }), NOW)).toEqual(payload)
  })

  it('production without a usable secret throws unavailable (503), never signs with a default', () => {
    for (const missing of [undefined, '', 'too-short-secret']) {
      production(missing)
      const signing = () => sign('speak', payload, { expiresAt: EXPIRES })
      expect(signing).toThrow(SigningUnavailableError)
      expect(signing).toThrow(expect.objectContaining({ code: 'unavailable', status: 503 }))
      try {
        signing()
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError)
        expect((e as ApiError).message).not.toMatch(/APP_SIGNING_SECRET/) // nothing about config
        expect((e as SigningUnavailableError).reason).toMatch(/APP_SIGNING_SECRET/)
      }
      expect(() => verify('speak', `v1.${b64({})}.${'A'.repeat(43)}`, NOW)).toThrow(
        SigningUnavailableError,
      )
    }
    // Local mode rejects an explicitly configured short secret too.
    local('too-short-secret')
    expect(() => sign('speak', payload, { expiresAt: EXPIRES })).toThrow(SigningUnavailableError)
  })

  it('rejects programming errors: reserved keys, bad purposes, invalid dates', () => {
    production(SECRET)
    expect(() => sign('speak', { exp: 1 }, { expiresAt: EXPIRES })).toThrow(/reserved/)
    expect(() => sign('speak', { purpose: 'x' }, { expiresAt: EXPIRES })).toThrow(/reserved/)
    for (const purpose of ['', 'Speak', 'speak now', '1speak', 'x'.repeat(41)]) {
      expect(() => sign(purpose, payload, { expiresAt: EXPIRES }), purpose).toThrow(/purpose/)
      expect(() => verify(purpose, 'v1.a.b', NOW), purpose).toThrow(/purpose/)
    }
    expect(() => sign('speak', payload, { expiresAt: new Date('nope') })).toThrow(/expiresAt/)
    const token = sign('speak', payload, { expiresAt: EXPIRES })
    expect(() => verify('speak', token, new Date('nope'))).toThrow(/now/)
  })
})
