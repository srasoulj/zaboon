'use client'
/**
 * App-wide services (orchestrator-owned): the auth client, the typed API client and the hooks every
 * screen uses. Tests render components inside <AppServicesProvider> with fakes.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import type { HomeResponse } from '@zaboon/contracts'
import type { AuthClient, AuthSession } from './auth-client'
import { queryKeys, type ApiClient } from './api-client'

interface Services {
  auth: AuthClient
  api: ApiClient
}

const ServicesContext = createContext<Services | null>(null)

export function AppServicesProvider({ auth, api, children }: Services & { children: ReactNode }) {
  return <ServicesContext.Provider value={{ auth, api }}>{children}</ServicesContext.Provider>
}

function useServices(): Services {
  const s = useContext(ServicesContext)
  if (!s) throw new Error('AppServicesProvider is missing')
  return s
}

export const useAuth = (): AuthClient => useServices().auth
export const useApi = (): ApiClient => useServices().api

type SessionState =
  { status: 'loading' } | { status: 'signed_out' } | { status: 'signed_in'; session: AuthSession }

/** The auth session, kept in sync with sign-in/out and refreshes. */
export function useSession(): SessionState {
  const auth = useAuth()
  const [state, setState] = useState<SessionState>({ status: 'loading' })
  useEffect(() => {
    let alive = true
    void auth.getSession().then((s) => {
      if (alive) setState(s ? { status: 'signed_in', session: s } : { status: 'signed_out' })
    })
    const unsubscribe = auth.subscribe((s) =>
      setState(s ? { status: 'signed_in', session: s } : { status: 'signed_out' }),
    )
    return () => {
      alive = false
      unsubscribe()
    }
  }, [auth])
  return state
}

/**
 * Like useSession, but signs a first-time visitor in as a guest (Duolingo lets you start without an
 * account). Returns null until a session exists.
 */
export function useEnsureGuest(): AuthSession | null {
  const auth = useAuth()
  const state = useSession()
  const creating = useRef(false)
  useEffect(() => {
    if (state.status !== 'signed_out' || creating.current) return
    creating.current = true
    void auth.signInAsGuest().finally(() => {
      creating.current = false
    })
  }, [auth, state.status])
  return state.status === 'signed_in' ? state.session : null
}

/** GET /api/home for the signed-in learner (stats bar, settings, onboarding state). */
export function useHome(enabled = true) {
  const api = useApi()
  return useQuery<HomeResponse>({ queryKey: queryKeys.home, queryFn: () => api('home'), enabled })
}

const noopSubscribe = () => () => {}
/** True after hydration (avoid SSR/CSR mismatches for browser-only state). */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  )
}
