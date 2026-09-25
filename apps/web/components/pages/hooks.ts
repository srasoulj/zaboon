'use client'
/** Small hooks shared by the ws-pages screens. */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { MetaResponse } from '@zaboon/contracts'
import { retagOutboxUser, sharedLessonStores } from '@/components/lesson/services'
import { queryKeys } from '@/lib/api-client'
import { useApi } from '@/lib/app-services'
import type { OutboxPort } from './identity'

/** The page-wide lesson outbox (the one the app replays; see components/lesson/services). */
export function useOutboxPort(): OutboxPort {
  const api = useApi()
  return useMemo(
    () => ({
      deliver: async (userId) => {
        const { outbox } = await sharedLessonStores(api)
        await outbox.flush()
        // Dead letters are never sent again, so they don't hold anything up.
        return (await outbox.pending()).filter((e) => e.userId === userId && !e.dead).length
      },
      retag: (from, to) => retagOutboxUser(api, from, to),
    }),
    [api],
  )
}

/** GET /api/meta (public): feature flags and versions. */
export function useMeta() {
  const api = useApi()
  return useQuery<MetaResponse>({ queryKey: queryKeys.meta, queryFn: () => api('meta') })
}

/** The browser's IANA timezone (UTC when the runtime can't tell). */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** A user-facing message for a failed API call. */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code
    if (code === 'network') return 'You seem to be offline. Check your connection and try again.'
    if (code === 'rate_limited') return 'Too many tries. Please wait a minute and try again.'
  }
  return fallback
}
