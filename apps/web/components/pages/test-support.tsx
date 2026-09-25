/**
 * Test doubles for the ws-pages DOM tests: a scripted AuthClient, an ApiClient built from per-route
 * handlers (with a call log), sample DTOs and a render helper with the app's providers.
 */
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  type ErrorCode,
  type HomeResponse,
  type ProfileResponse,
  type RouteName,
} from '@zaboon/contracts'
import { ApiClientError, type ApiClient } from '@/lib/api-client'
import { AppServicesProvider } from '@/lib/app-services'
import type { AuthClient, AuthSession, LinkResult, SignInResult } from '@/lib/auth-client'
import type { OutboxPort } from './identity'

export const GUEST_ID = '11111111-1111-4111-8111-111111111111'
export const MEMBER_ID = '22222222-2222-4222-8222-222222222222'

export function session(over: Partial<AuthSession> = {}): AuthSession {
  return {
    accessToken: `guest-token-${'x'.repeat(24)}`,
    expiresAt: Date.now() + 3_600_000,
    userId: GUEST_ID,
    isAnonymous: true,
    email: null,
    ...over,
  }
}

export interface FakeAuth extends AuthClient {
  current: AuthSession | null
  calls: string[]
}

/** A local-mode-like auth client whose sign-in/link results can be scripted per test. */
export function fakeAuth(
  initial: AuthSession | null = session(),
  script: {
    link?: (email: string) => LinkResult
    signIn?: (email: string) => SignInResult
  } = {},
): FakeAuth {
  const listeners = new Set<(s: AuthSession | null) => void>()
  const auth: FakeAuth = {
    mode: 'local',
    current: initial,
    calls: [],
    getSession: async () => auth.current,
    signInAsGuest: async () => {
      auth.calls.push('signInAsGuest')
      return set(session())
    },
    signInWithEmail: async (email) => {
      auth.calls.push(`signIn:${email}`)
      const r = script.signIn?.(email) ?? {
        status: 'signed_in',
        session: session({
          userId: MEMBER_ID,
          isAnonymous: false,
          email,
          accessToken: `member-token-${'y'.repeat(24)}`,
        }),
      }
      if (r.status === 'signed_in') set(r.session)
      return r
    },
    linkEmail: async (email) => {
      auth.calls.push(`link:${email}`)
      const r = script.link?.(email) ?? {
        status: 'signed_in',
        session: session({ ...auth.current, isAnonymous: false, email }),
      }
      if (r.status === 'signed_in') set(r.session)
      return r
    },
    signOut: async () => {
      auth.calls.push('signOut')
      set(null)
    },
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
  function set(s: AuthSession | null): AuthSession {
    auth.current = s
    for (const l of listeners) l(s)
    return s as AuthSession
  }
  return auth
}

type Handler = (opts: {
  params?: Record<string, string>
  query?: Record<string, string | undefined>
  body?: unknown
}) => unknown

export interface FakeApi {
  api: ApiClient
  calls: { name: RouteName; opts: Parameters<Handler>[0] }[]
  called: (name: RouteName) => Parameters<Handler>[0][]
}

/** An ApiClient answering from `handlers` (async or not); unknown routes throw. */
export function fakeApi(handlers: Partial<Record<RouteName, Handler>>): FakeApi {
  const calls: FakeApi['calls'] = []
  const api = (async (name: RouteName, opts: Parameters<Handler>[0] = {}) => {
    calls.push({ name, opts })
    const h = handlers[name]
    if (!h) throw new Error(`unexpected API call ${name}`)
    return h(opts)
  }) as ApiClient
  return {
    api,
    calls,
    called: (name) => calls.filter((c) => c.name === name).map((c) => c.opts),
  }
}

export function apiError(code: ErrorCode, status: number): ApiClientError {
  return new ApiClientError(code, status, code)
}

export function home(over: Partial<HomeResponse> = {}): HomeResponse {
  return {
    user: {
      id: GUEST_ID,
      isAnonymous: true,
      displayName: null,
      username: null,
      ageConfirmed: false,
      onboarded: false,
    },
    course: { id: 'fa-en', contentVersion: 1, currentLevelId: 'u01-l1' },
    streak: { current: 0, status: 'none', freezes: 1 },
    lives: { policy: 'hearts', count: 5, max: 5, nextRegenAt: null },
    dailyGoal: { xp: 0, goal: 20, met: false },
    xpTotal: 0,
    settings: DEFAULT_SETTINGS,
    flags: {},
    ...over,
  }
}

export function profile(over: Partial<ProfileResponse> = {}): ProfileResponse {
  return {
    id: GUEST_ID,
    username: null,
    displayName: null,
    avatar: null,
    isAnonymous: true,
    createdAt: '2026-09-01T10:00:00.000Z',
    stats: { xpTotal: 120, streakCurrent: 3, streakLongest: 5, lessonsCompleted: 7 },
    ...over,
  }
}

export function newQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

export function renderWith(
  ui: ReactElement,
  { auth = fakeAuth(), api, queryClient = newQueryClient() }: { auth?: AuthClient; api: ApiClient; queryClient?: QueryClient },
) {
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AppServicesProvider auth={auth} api={api}>
        {ui}
      </AppServicesProvider>
    </QueryClientProvider>,
  )
  return { ...utils, queryClient, auth }
}

export const noopNavigate = () => vi.fn<(href: string) => void>()

/**
 * A scripted lesson outbox: `waiting` entries of the current user stay undelivered (or `deliver`
 * throws); every call is logged to `log` (shared with the fake auth, to check the order).
 */
export function fakeOutbox(
  log: string[],
  opts: { waiting?: number | 'throws' } = {},
): OutboxPort & { retagged: [string, string][] } {
  const retagged: [string, string][] = []
  return {
    retagged,
    deliver: async (userId) => {
      log.push(`flush:${userId.slice(0, 4)}`)
      if (opts.waiting === 'throws') throw new Error('idb broken')
      return opts.waiting ?? 0
    },
    retag: async (from, to) => {
      log.push('retag')
      retagged.push([from, to])
      return 0
    },
  }
}
