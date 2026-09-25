'use client'
/**
 * The lesson player's services: persistence (snapshots + outbox on IndexedDB), audio and the
 * renderer lookup. Created once per page load and shared, so the outbox keeps replaying while the
 * learner moves around; tests render the player inside <LessonServicesProvider> with fakes.
 */
import { createContext, useContext, useEffect, type ReactNode } from 'react'
import type { Challenge } from '@zaboon/contracts'
import type { ApiClient } from '../../lib/api-client'
import type { ChallengeRenderer } from '../../lib/challenge-registry'
import type { LessonAudio } from '../../lib/lesson/audio'
import { openLessonStores } from '../../lib/lesson/idb'
import { Outbox, type OutboxSender } from '../../lib/lesson/outbox'
import type { SnapshotStore } from '../../lib/lesson/stores'

export type RendererResolver = <T extends Challenge['type']>(
  type: T,
) => ChallengeRenderer<Extract<Challenge, { type: T }>> | null

export interface LessonServices {
  snapshots: SnapshotStore
  outbox: Outbox
  audio: LessonAudio
  resolveRenderer: RendererResolver
}

const Ctx = createContext<LessonServices | null>(null)

export function LessonServicesProvider({
  value,
  children,
}: {
  value: LessonServices
  children: ReactNode
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLessonServices(): LessonServices {
  const s = useContext(Ctx)
  if (!s) throw new Error('LessonServicesProvider is missing')
  return s
}

// --------------------------------------------------------------------------- shared browser outbox
export function apiSender(api: ApiClient): OutboxSender {
  return {
    event: (id, body) => api('sessionEvent', { params: { id }, body }),
    complete: (id, body) => api('completeSession', { params: { id }, body }),
  }
}

let outboxUser: string | null = null
let shared: Promise<{ snapshots: SnapshotStore; outbox: Outbox }> | null = null
let sharedApi: ApiClient | null = null

/** The page-wide stores and outbox (IndexedDB when available). */
export function sharedLessonStores(
  api: ApiClient,
): Promise<{ snapshots: SnapshotStore; outbox: Outbox }> {
  if (!shared || sharedApi !== api) {
    sharedApi = api
    shared = openLessonStores().then(({ snapshots, outbox }) => ({
      snapshots,
      outbox: new Outbox({ store: outbox, send: apiSender(api), currentUserId: () => outboxUser }),
    }))
  }
  return shared
}

/**
 * Replays the outbox for the signed-in user: now (app start), whenever the browser comes back
 * online, and with backoff after failures (inside Outbox). Mount it wherever lesson writes may be
 * pending; the lesson page does, and the app shell should (see the PR's contract change request).
 */
export function useOutboxReplay(api: ApiClient, userId: string | null): void {
  useEffect(() => {
    outboxUser = userId
    if (!userId) return
    let alive = true
    let outbox: Outbox | null = null
    const flush = () => void outbox?.flush()
    void sharedLessonStores(api).then((s) => {
      if (!alive) return
      outbox = s.outbox
      flush()
    })
    window.addEventListener('online', flush)
    return () => {
      alive = false
      window.removeEventListener('online', flush)
    }
  }, [api, userId])
}

/** Drop-in component form of useOutboxReplay. */
export function OutboxReplayer({ api, userId }: { api: ApiClient; userId: string | null }) {
  useOutboxReplay(api, userId)
  return null
}
