/**
 * Test helpers for the path, letters and practice screens: renders inside QueryClientProvider +
 * AppServicesProvider with a fake auth client and a fake typed API client.
 */
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { vi } from 'vitest'
import type { RouteName } from '@zaboon/contracts'
import type { ApiClient } from '@/lib/api-client'
import { AppServicesProvider } from '@/lib/app-services'
import type { AuthClient, AuthSession } from '@/lib/auth-client'
import { TEST_USER_ID } from './test-data'

export * from './test-data'

export const TEST_SESSION: AuthSession = {
  accessToken: 'token',
  expiresAt: Date.now() + 3_600_000,
  userId: TEST_USER_ID,
  isAnonymous: true,
  email: null,
}

export function fakeAuth(session: AuthSession | null = TEST_SESSION): AuthClient {
  return {
    mode: 'local',
    getSession: async () => session,
    signInAsGuest: vi.fn(async () => TEST_SESSION),
    signInWithEmail: vi.fn(),
    linkEmail: vi.fn(),
    signOut: vi.fn(),
    subscribe: () => () => {},
  } as unknown as AuthClient
}

type Handlers = Partial<Record<RouteName, (opts: unknown) => unknown>>

/** A fake API client; `calls` records every (route, options) pair. */
export function fakeApi(handlers: Handlers) {
  const calls: { name: RouteName; opts: unknown }[] = []
  const api = vi.fn(async (name: RouteName, opts?: unknown) => {
    calls.push({ name, opts })
    const h = handlers[name]
    if (!h) throw new Error(`unexpected API call ${name}`)
    return h(opts)
  }) as unknown as ApiClient
  return { api, calls }
}

export function renderWithServices(
  ui: ReactElement,
  opts: { handlers?: Handlers; session?: AuthSession | null } = {},
) {
  const { api, calls } = fakeApi(opts.handlers ?? {})
  const auth = fakeAuth(opts.session === undefined ? TEST_SESSION : opts.session)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AppServicesProvider auth={auth} api={api}>
        {ui}
      </AppServicesProvider>
    </QueryClientProvider>,
  )
  return { ...utils, api, calls, auth }
}
