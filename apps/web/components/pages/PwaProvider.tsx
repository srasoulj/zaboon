'use client'
/**
 * Registers the Serwist service worker (/serwist/sw.js) in production builds only: in development
 * the worker would serve stale bundles. It never reloads on reconnect (the lesson outbox handles
 * coming back online) and never caches navigations (pages are per-learner). Mounted by the
 * orchestrator in app/providers.tsx.
 */
import { SerwistProvider } from '@serwist/turbopack/react'
import type { ReactNode } from 'react'

export function PwaProvider({
  children,
  disable = process.env.NODE_ENV !== 'production',
}: {
  children: ReactNode
  /** Defaults to "not a production build". */
  disable?: boolean
}) {
  return (
    <SerwistProvider
      swUrl="/serwist/sw.js"
      disable={disable}
      reloadOnOnline={false}
      cacheOnNavigation={false}
    >
      {children}
    </SerwistProvider>
  )
}
