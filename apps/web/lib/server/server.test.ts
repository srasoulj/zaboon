import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { FLAG_DEFAULTS, type Challenge } from '@zaboon/contracts'
import { compile } from '@zaboon/grader'
import { userFromClaims } from './auth/claims'
import { cronAuthorized } from './auth/cron'
import { signLocalToken, verifyLocalToken } from './auth/local'
import { requestNow } from './clock'
import { resetServerEnv, serverEnv } from './env'
import { ApiError } from './errors'
import { parseTestFlags, requestFlags } from './flags'
import { serverVerdict } from './grading'
import { sessionFeatures } from './sessions'

const USER = '11111111-2222-4333-8444-555555555555'
const saved = { ...process.env }

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  resetServerEnv()
}

beforeAll(() => {
  process.env.ZABOON_DEV_AUTH_SECRET = 'unit-test-secret-unit-test-secret' // pragma: allowlist secret
})
afterEach(() => {
  process.env = { ...saved, ZABOON_DEV_AUTH_SECRET: 'unit-test-secret-unit-test-secret' } // pragma: allowlist secret
  resetServerEnv()
})

describe('serverEnv guards (ADR 0009)', () => {
  it('refuses local mode on Vercel', () => {
    setEnv({ AUTH_MODE: 'local', VERCEL_ENV: 'preview', DATABASE_URL_APP_SERVER: undefined })
    expect(() => serverEnv()).toThrow(/Vercel/)
  })

  it('refuses local mode against a non-loopback database', () => {
    setEnv({
      AUTH_MODE: 'local',
      VERCEL_ENV: undefined,
      DATABASE_URL_APP_SERVER: 'postgres://u@db.example.com:5432/x',
    })
    expect(() => serverEnv()).toThrow(/loopback/)
  })

  it('requires the Supabase URL in production mode and rejects unknown modes', () => {
    setEnv({
      AUTH_MODE: undefined,
      NEXT_PUBLIC_SUPABASE_URL: undefined,
      DATABASE_URL_APP_SERVER: 'postgres://u@db:5432/x',
    })
    expect(() => serverEnv()).toThrow(/SUPABASE_URL/)
    setEnv({ AUTH_MODE: 'weird' })
    expect(() => serverEnv()).toThrow(/AUTH_MODE/)
  })

  it('enables dev auth only in local mode with the flag', () => {
    setEnv({
      AUTH_MODE: 'local',
      VERCEL_ENV: undefined,
      DATABASE_URL_APP_SERVER: undefined,
      ZABOON_DEV_AUTH: '1',
    })
    expect(serverEnv()).toMatchObject({ authMode: 'local', devAuth: true })
    setEnv({
      AUTH_MODE: 'supabase',
      ZABOON_DEV_AUTH: '1',
      NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
      DATABASE_URL_APP_SERVER: 'postgres://u@db:5432/x',
    })
    expect(serverEnv()).toMatchObject({ authMode: 'supabase', devAuth: false })
  })
})

describe('local tokens', () => {
  it('round-trip with Supabase-shaped claims', async () => {
    const { accessToken, expiresAt } = await signLocalToken({
      userId: USER,
      isAnonymous: false,
      email: 'a@b.test',
      isAdmin: true,
    })
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now())
    const claims = await verifyLocalToken(accessToken)
    expect(claims).toMatchObject({
      sub: USER,
      role: 'authenticated',
      aud: 'authenticated',
      is_anonymous: false,
    })
    expect(userFromClaims(claims)).toEqual({
      id: USER,
      isAnonymous: false,
      email: 'a@b.test',
      isAdmin: true,
    })
  })

  it('reject tampered and expired tokens', async () => {
    const { accessToken } = await signLocalToken({ userId: USER, isAnonymous: true, email: null })
    const [h, p, s] = accessToken.split('.') as [string, string, string]
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(p, 'base64url').toString()),
        sub: USER.replace('1', '9'),
      }),
    ).toString('base64url')
    await expect(verifyLocalToken(`${h}.${forged}.${s}`)).rejects.toBeInstanceOf(ApiError)
    const old = await signLocalToken({
      userId: USER,
      isAnonymous: true,
      email: null,
      now: new Date(Date.now() - 2 * 3_600_000),
    })
    await expect(verifyLocalToken(old.accessToken)).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('only accept signed-in user claims', () => {
    expect(() => userFromClaims({ sub: USER, role: 'anon', aud: 'authenticated' })).toThrow(
      ApiError,
    )
    expect(() =>
      userFromClaims({ sub: 'not-a-uuid', role: 'authenticated', aud: 'authenticated' }),
    ).toThrow(ApiError)
    expect(
      userFromClaims({
        sub: USER,
        role: 'authenticated',
        aud: 'authenticated',
        is_anonymous: true,
      }),
    ).toEqual({
      id: USER,
      isAnonymous: true,
      email: null,
      isAdmin: false,
    })
  })
})

describe('clock', () => {
  const req = (now?: string) =>
    new Request('http://x/', { headers: now ? { 'x-test-now': now } : {} })

  it('honors x-test-now only in local mode', () => {
    setEnv({ AUTH_MODE: 'local', VERCEL_ENV: undefined, DATABASE_URL_APP_SERVER: undefined })
    expect(requestNow(req('2030-01-02T03:04:05Z')).toISOString()).toBe('2030-01-02T03:04:05.000Z')
    expect(() => requestNow(req('yesterday'))).toThrow(ApiError)
    setEnv({
      AUTH_MODE: 'supabase',
      NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
      DATABASE_URL_APP_SERVER: 'postgres://u@db:5432/x',
    })
    expect(requestNow(req('2030-01-02T03:04:05Z')).getFullYear()).not.toBe(2030)
  })
})

describe('feature flags (x-test-flags)', () => {
  const configured = { ...FLAG_DEFAULTS }
  const req = (flags?: string) =>
    new Request('http://x/', { headers: flags === undefined ? {} : { 'x-test-flags': flags } })

  it('merges the header over the configured flags in local mode', () => {
    setEnv({ AUTH_MODE: 'local', VERCEL_ENV: undefined, DATABASE_URL_APP_SERVER: undefined })
    expect(requestFlags(req(), configured)).toEqual(configured)
    expect(requestFlags(req('{"leagues":true,"shop":true}'), configured)).toEqual({
      ...configured,
      leagues: true,
      shop: true,
    })
    expect(requestFlags(req('{"leagues":false}'), { ...configured, leagues: true }).leagues).toBe(
      false,
    )
    expect(requestFlags(req(''), configured)).toEqual(configured)
  })

  it('rejects malformed values and unknown flags with a 400', () => {
    setEnv({ AUTH_MODE: 'local', VERCEL_ENV: undefined, DATABASE_URL_APP_SERVER: undefined })
    for (const bad of ['{', '[true]', 'true', 'null', '{"leagues":1}', '{"leagues":"on"}'])
      expect(() => requestFlags(req(bad), configured), bad).toThrow(
        expect.objectContaining({ code: 'validation', status: 400 }),
      )
    expect(() => requestFlags(req('{"leauges":true}'), configured)).toThrow(/unknown flag/)
    // A flag that exists only in app_config is known too.
    expect(parseTestFlags('{"experiment":true}', { experiment: false })).toEqual({
      experiment: true,
    })
  })

  it('is ignored in production mode, even when malformed', () => {
    setEnv({
      AUTH_MODE: 'supabase',
      NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
      DATABASE_URL_APP_SERVER: 'postgres://u@db:5432/x',
    })
    expect(requestFlags(req('{"leagues":true}'), configured)).toEqual(configured)
    expect(requestFlags(req('{'), configured)).toEqual(configured)
    setEnv({ AUTH_MODE: undefined })
    expect(requestFlags(req('{"shop":true}'), configured).shop).toBe(false)
  })
})

describe('session features from flags', () => {
  it('turns engine features on only for their flags', () => {
    const off = { persianTyping: false, letterTrace: false }
    expect(sessionFeatures()).toEqual(off)
    expect(sessionFeatures({ ...FLAG_DEFAULTS })).toEqual(off)
    expect(sessionFeatures({ ...FLAG_DEFAULTS, leagues: true, shop: true })).toEqual(off)
    expect(sessionFeatures({ ...FLAG_DEFAULTS, persianKeyboard: true })).toEqual({
      persianTyping: true,
      letterTrace: false,
    })
    expect(sessionFeatures({ letterTrace: true })).toEqual({
      persianTyping: false,
      letterTrace: true,
    })
  })
})

describe('cron secret (Vercel Cron)', () => {
  it('accepts exactly "Bearer <secret>"', () => {
    const secret = 'cron-secret-for-tests' // pragma: allowlist secret
    expect(cronAuthorized(`Bearer ${secret}`, secret)).toBe(true)
    expect(cronAuthorized(`Bearer ${secret}x`, secret)).toBe(false)
    expect(cronAuthorized(`Bearer ${secret.slice(0, -1)}`, secret)).toBe(false)
    expect(cronAuthorized(secret, secret)).toBe(false)
    expect(cronAuthorized(`bearer ${secret}`, secret)).toBe(false)
    expect(cronAuthorized('', secret)).toBe(false)
    expect(cronAuthorized(null, secret)).toBe(false)
  })

  it('fails closed when no secret is configured', () => {
    expect(cronAuthorized('Bearer ', null)).toBe(false)
    expect(cronAuthorized('Bearer ', '')).toBe(false)
    expect(cronAuthorized('Bearer null', null)).toBe(false)
  })
})

describe('serverVerdict (gradeResponse)', () => {
  const ref = { type: 'translate_bank' as const, items: ['s_x'] }
  const graph = compile(["[I want/I'd like] [some/] water"], { lang: 'en' })
  const bank: Challenge = {
    index: 0,
    ref,
    isNew: false,
    type: 'translate_bank',
    direction: 'fa_en',
    prompt: { lang: 'fa', text: 'من آب می‌خوام' },
    answerLang: 'en',
    bank: ['I', 'want', 'some', 'water', 'bread'],
    graph,
  }
  const choice: Challenge = {
    index: 1,
    ref: { type: 'select_translation', items: ['s_x'] },
    isNew: false,
    type: 'select_translation',
    direction: 'fa_en',
    prompt: { lang: 'fa', text: 'سلام' },
    choices: [
      { lang: 'en', text: 'Hello' },
      { lang: 'en', text: 'Bread' },
    ],
    answer: 0,
  }
  const pairs: Challenge = {
    index: 2,
    ref: { type: 'match_pairs', items: ['lx_a', 'lx_b', 'lx_c'] },
    isNew: false,
    type: 'match_pairs',
    pairs: [
      { fa: { fa: 'آب', translit: 'āb' }, en: 'water' },
      { fa: { fa: 'نون', translit: 'nun' }, en: 'bread' },
      { fa: { fa: 'چای', translit: 'chāy' }, en: 'tea' },
    ],
  }

  it('grades word banks, choices and pairs', () => {
    expect(serverVerdict(bank, { kind: 'tiles', value: ['I', 'want', 'water'] })).toBe('correct')
    expect(serverVerdict(bank, { kind: 'tiles', value: ['I', 'want', 'bread'] })).toBe('wrong')
    expect(serverVerdict(choice, { kind: 'choice', value: 0 })).toBe('correct')
    expect(serverVerdict(choice, { kind: 'choice', value: 1 })).toBe('wrong')
    expect(
      serverVerdict(pairs, {
        kind: 'pairs',
        value: [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
      }),
    ).toBe('correct')
    expect(
      serverVerdict(pairs, {
        kind: 'pairs',
        value: [
          [0, 1],
          [1, 0],
          [2, 2],
        ],
      }),
    ).toBe('wrong')
    expect(
      serverVerdict(pairs, {
        kind: 'pairs',
        value: [
          [0, 0],
          [0, 0],
          [2, 2],
        ],
      }),
    ).toBe('wrong')
  })

  it('treats skips as skipped and mismatched response kinds as wrong', () => {
    expect(serverVerdict(bank, { kind: 'skip' })).toBe('skipped')
    expect(serverVerdict(bank, { kind: 'choice', value: 0 })).toBe('wrong')
    expect(serverVerdict(choice, { kind: 'text', value: 'Hello' })).toBe('wrong')
  })
})
