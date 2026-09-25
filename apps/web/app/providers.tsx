'use client'
/** Client providers for the whole app (orchestrator-owned). */
import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionPreferenceProvider } from '@zaboon/ui'
import { createApiClient } from '@/lib/api-client'
import { createAuthClient } from '@/lib/auth-client'
import { AppServicesProvider, useHome, useSession } from '@/lib/app-services'

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
        <MotionFromSettings>{children}</MotionFromSettings>
      </AppServicesProvider>
    </QueryClientProvider>
  )
}
