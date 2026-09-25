'use client'
/** Small hooks shared by the ws-pages screens. */
import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { MetaResponse } from '@zaboon/contracts'
import { sharedLessonStores } from '@/components/lesson/services'
import { queryKeys } from '@/lib/api-client'
import { useApi } from '@/lib/app-services'
import type { FlushOutbox } from './identity'

/** Flushes the page-wide lesson outbox (the one the app replays; see components/lesson/services). */
export function useFlushOutbox(): FlushOutbox {
  const api = useApi()
  return useCallback(async () => (await sharedLessonStores(api)).outbox.flush(), [api])
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
