'use client'
/** Client providers for the whole app (orchestrator-owned). */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { MotionPreferenceProvider } from '@zaboon/ui'
import { OutboxReplayer } from '@/components/lesson/services'
import { useOutboxPort } from '@/components/pages/hooks'
import { completePendingMerge } from '@/components/pages/identity'
import { PwaProvider } from '@/components/pages/PwaProvider'
import { createApiClient, queryKeys } from '@/lib/api-client'
import { createAuthClient } from '@/lib/auth-client'
import { AppServicesProvider, useApi, useAuth, useHome, useSession } from '@/lib/app-services'

/**
 * Replays lesson writes queued offline (events, completions) on every page, not only /lesson:
 * at app start, when the browser comes back online and with backoff (ARCHITECTURE §10.2).
 */
function OutboxAtAppStart() {
  const api = useApi()
  const session = useSession()
  return (
    <OutboxReplayer
      api={api}
      userId={session.status === 'signed_in' ? session.session.userId : null}
    />
  )
}

/**
 * Query keys are not per user, so when the signed-in identity changes (sign-in or out, a guest
 * linking an email or merging into an account) every cached query is reset: nothing from the
 * previous identity stays on screen, and active queries refetch with the new token.
 */
function QueriesFollowIdentity() {
  const session = useSession()
  const queryClient = useQueryClient()
  const identity =
    session.status === 'signed_in'
      ? `${session.session.userId}:${session.session.isAnonymous ? 'guest' : 'member'}`
      : session.status
  const previous = useRef<string | null>(null)
  useEffect(() => {
    if (identity === 'loading') return
    if (previous.current !== null && previous.current !== identity) void queryClient.resetQueries()
    previous.current = identity
  }, [identity, queryClient])
  return null
}

/**
 * Supabase mode: a guest who links an email that already belongs to an account signs in through the
 * emailed link, so the merge finishes here, when that member session appears (ws-pages'
 * `completePendingMerge`; a no-op when nothing is pending, and local mode merges immediately).
 */
function PendingMergeFinisher() {
  const auth = useAuth()
  const api = useApi()
  const outbox = useOutboxPort()
  const session = useSession()
  const queryClient = useQueryClient()
  const memberId =
    session.status === 'signed_in' && !session.session.isAnonymous ? session.session.userId : null
  useEffect(() => {
    if (!memberId) return
    let alive = true
    void completePendingMerge({ auth, api, outbox }).then((home) => {
      if (!alive || !home) return
      queryClient.setQueryData(queryKeys.home, home)
      void queryClient.invalidateQueries()
    })
    return () => {
      alive = false
    }
  }, [auth, api, outbox, memberId, queryClient])
  return null
}

/** Applies the learner's in-app motion setting once their settings are known. */
function MotionFromSettings({ children }: { children: ReactNode }) {
  const session = useSession()
  const home = useHome(session.status === 'signed_in')
  return (
    <MotionPreferenceProvider reduce={home.data?.settings.motion === 'reduced'}>
      {children}
    </MotionPreferenceProvider>
  )
}

export function Providers({ children }: { children: ReactNode }) {
  const [services] = useState(() => {
    const auth = createAuthClient()
    const api = createApiClient({
      getAccessToken: async () => (await auth.getSession())?.accessToken ?? null,
    })
    return { auth, api }
  })
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (count, err) =>
              count < 2 &&
              !(
                err instanceof Error &&
                'status' in err &&
                (err as { status: number }).status < 500
              ),
          },
        },
      }),
  )
  return (
    <QueryClientProvider client={queryClient}>
      <AppServicesProvider auth={services.auth} api={services.api}>
        <OutboxAtAppStart />
        <QueriesFollowIdentity />
        <PendingMergeFinisher />
        <MotionFromSettings>
          {/* Registers the service worker in production builds only (ws-pages). */}
          <PwaProvider>{children}</PwaProvider>
        </MotionFromSettings>
      </AppServicesProvider>
    </QueryClientProvider>
  )
}
