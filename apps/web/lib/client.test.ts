import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiClientError,
  createApiClient,
  queryKeys,
  TEST_FLAGS_KEY,
  TEST_NOW_KEY,
} from './api-client'
import { createAuthClient, createLocalAuthClient, LOCAL_SESSION_KEY } from './auth-client'

const USER = '11111111-2222-4333-8444-555555555555'

class MemoryStorage {
  private m = new Map<string, string>()
  getItem = (k: string) => this.m.get(k) ?? null
  setItem = (k: string, v: string) => void this.m.set(k, v)
  removeItem = (k: string) => void this.m.delete(k)
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const token = (expiresInMs: number, id = USER) => ({
  accessToken: `tok-${expiresInMs}-${'x'.repeat(24)}`,
  expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  user: { id, isAnonymous: true, email: null },
})

describe('api client', () => {
  it('builds the request from the route registry and validates the response', async () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', 'local')
    localStorage.setItem(TEST_NOW_KEY, '2031-01-02T00:00:00Z')
    localStorage.setItem(TEST_FLAGS_KEY, '{"shop":true}')
    const fetchMock = vi.fn(async () => json(200, { deleted: true }))
    const api = createApiClient({ getAccessToken: async () => 'abc', fetch: fetchMock })
    await expect(api('deleteAccount')).resolves.toEqual({ deleted: true })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/account')
    expect(init.method).toBe('DELETE')
    expect(init.headers).toMatchObject({
      authorization: 'Bearer abc',
      'x-zaboon-app-version': '0.1.0',
      'x-test-now': '2031-01-02T00:00:00Z',
      'x-test-flags': '{"shop":true}',
    })
  })

  it('sends no test headers in local mode when nothing is stored', async () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', 'local')
    localStorage.setItem(TEST_FLAGS_KEY, '')
    const fetchMock = vi.fn(async () => json(200, { deleted: true }))
    const api = createApiClient({ getAccessToken: async () => 'abc', fetch: fetchMock })
    await api('deleteAccount')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).not.toHaveProperty('x-test-now')
    expect(init.headers).not.toHaveProperty('x-test-flags')
  })

  it('fills path params, sends JSON bodies and never sends test headers outside local mode', async () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', 'supabase')
    localStorage.setItem(TEST_NOW_KEY, '2031-01-02T00:00:00Z')
    localStorage.setItem(TEST_FLAGS_KEY, '{"shop":true}')
    const fetchMock = vi.fn(async () =>
      json(200, {
        lives: { policy: 'hearts', count: 4, max: 5, nextRegenAt: null },
        duplicate: false,
      }),
    )
    const api = createApiClient({ getAccessToken: async () => null, fetch: fetchMock })
    await api('sessionEvent', {
      params: { id: 'abc' },
      body: { attemptSeq: 1, index: 0, kind: 'wrong' },
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/sessions/abc/events')
    expect(JSON.parse(init.body as string)).toEqual({ attemptSeq: 1, index: 0, kind: 'wrong' })
    expect(init.headers).not.toHaveProperty('x-test-now')
    expect(init.headers).not.toHaveProperty('x-test-flags')
    expect(init.headers).not.toHaveProperty('authorization')
  })

  it('appends query parameters and leaves out undefined ones', async () => {
    const fetchMock = vi.fn(async () => json(200, { reports: [] }))
    const api = createApiClient({ getAccessToken: async () => 'abc', fetch: fetchMock })
    await api('adminReports', { query: { status: 'open', before: undefined, limit: '20' } })
    await api('adminReports')
    const urls = fetchMock.mock.calls.map((c) => (c as unknown as [string])[0])
    expect(urls).toEqual(['/api/admin/reports?status=open&limit=20', '/api/admin/reports'])
  })

  it('turns error envelopes, bad responses and network failures into ApiClientError', async () => {
    const envelope = createApiClient({
      getAccessToken: async () => null,
      fetch: async () => json(409, { error: { code: 'out_of_lives', message: 'no hearts left' } }),
    })
    await expect(envelope('home')).rejects.toMatchObject({ code: 'out_of_lives', status: 409 })
    const garbage = createApiClient({
      getAccessToken: async () => null,
      fetch: async () => json(502, 'oops'),
    })
    await expect(garbage('home')).rejects.toMatchObject({ code: 'internal', status: 502 })
    const offline = createApiClient({
      getAccessToken: async () => null,
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    await expect(offline('home')).rejects.toBeInstanceOf(ApiClientError)
    await expect(offline('home')).rejects.toMatchObject({ code: 'network' })
  })
})

describe('local auth client', () => {
  it('signs in a guest, persists the session and notifies subscribers', async () => {
    const fetchMock = vi.fn(async () => json(200, token(3_600_000)))
    const auth = createLocalAuthClient(fetchMock)
    const seen: unknown[] = []
    auth.subscribe((s) => seen.push(s?.userId ?? null))
    const s = await auth.signInAsGuest()
    expect(s).toMatchObject({ userId: USER, isAnonymous: true })
    expect(JSON.parse(localStorage.getItem(LOCAL_SESSION_KEY)!)).toMatchObject({ userId: USER })
    expect(await auth.getSession()).toEqual(s)
    expect(seen).toEqual([USER])
    await auth.signOut()
    expect(await auth.getSession()).toBeNull()
  })

  it('refreshes a session that is about to expire, once for concurrent callers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, token(10_000)))
      .mockResolvedValueOnce(json(200, token(3_600_000)))
    const auth = createLocalAuthClient(fetchMock)
    await auth.signInAsGuest()
    const [a, b] = await Promise.all([auth.getSession(), auth.getSession()])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/dev/auth/refresh')
    expect(a).toEqual(b)
    expect(a!.expiresAt - Date.now()).toBeGreaterThan(60_000)
  })

  it('reports identity_already_exists when linking an email that belongs to another account', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, token(3_600_000)))
      .mockResolvedValueOnce(
        json(409, { error: { code: 'identity_already_exists', message: 'taken' } }),
      )
    const auth = createLocalAuthClient(fetchMock)
    await auth.signInAsGuest()
    await expect(auth.linkEmail('a@b.test')).resolves.toEqual({ status: 'identity_already_exists' })
  })
})

describe('createAuthClient', () => {
  it('picks the local client in local mode', () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', 'local')
    expect(createAuthClient().mode).toBe('local')
  })

  it('in supabase mode, checks the configuration at the first auth call, not when created', async () => {
    // Providers create the client while rendering, which also happens on the server (static
    // prerendering at build time included), where the browser's configuration need not exist.
    vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', 'supabase')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '')
    const auth = createAuthClient()
    expect(auth.mode).toBe('supabase')
    await expect(auth.getSession()).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
    expect(() => auth.subscribe(() => {})).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })
})

describe('query keys', () => {
  it('has one distinct key per read, including the P2 reads', () => {
    for (const k of ['leaderboard', 'quests', 'shop', 'practice'] as const)
      expect(queryKeys[k]).toEqual([k])
    const flat = Object.values(queryKeys).flatMap((k) =>
      typeof k === 'function' ? [k('x').join('/')] : [k.join('/')],
    )
    expect(new Set(flat).size).toBe(flat.length)
  })
})
