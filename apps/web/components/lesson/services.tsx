'use client'
/**
 * The lesson player's services: persistence (snapshots + outbox on IndexedDB), audio and the
 * renderer lookup. Created once per page load and shared, so the outbox keeps replaying while the
 * learner moves around; tests render the player inside <LessonServicesProvider> with fakes.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Toast } from '@zaboon/ui'
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

/**
 * Who the outbox sends for: the user of the most recently mounted replayer that is still mounted
 * (the app shell and the lesson page both mount one). Null when none is mounted.
 */
const mountedUsers: string[] = []
export const outboxUser = (): string | null => mountedUsers.at(-1) ?? null

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
      outbox: new Outbox({ store: outbox, send: apiSender(api), currentUserId: outboxUser }),
    }))
  }
  return shared
}

/**
 * After a guest merged into an existing account: moves the guest's pending lesson writes to the
 * account, then sends them. Call it once the merge succeeded, before or after the identity switch.
 */
export async function retagOutboxUser(
  api: ApiClient,
  guestUserId: string,
  accountUserId: string,
): Promise<number> {
  const { outbox } = await sharedLessonStores(api)
  const n = await outbox.retagUser(guestUserId, accountUserId)
  void outbox.flush()
  return n
}

/** Snapshots older than this are pruned (sessions expire after a day anyway). */
const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 3_600_000

/**
 * Replays the outbox for the signed-in user: now (app start), whenever the browser comes back
 * online, and with backoff after failures (inside Outbox). Returns true once an entry gave up
 * (dead-lettered), for a quiet notice.
 */
export function useOutboxReplay(api: ApiClient, userId: string | null): boolean {
  const [gaveUp, setGaveUp] = useState(false)
  useEffect(() => {
    if (!userId) return
    mountedUsers.push(userId)
    let alive = true
    let outbox: Outbox | null = null
    let unsubscribe = () => {}
    const flush = () => void outbox?.flush()
    void sharedLessonStores(api).then((s) => {
      if (!alive) return
      outbox = s.outbox
      unsubscribe = s.outbox.subscribe((d) => {
        if (d.type === 'dead' && d.entry.userId === userId) setGaveUp(true)
      })
      void s.outbox.prune().catch(() => 0)
      void s.snapshots.prune(Date.now() - SNAPSHOT_MAX_AGE_MS, Date.now()).catch(() => 0)
      flush()
    })
    window.addEventListener('online', flush)
    return () => {
      alive = false
      unsubscribe()
      window.removeEventListener('online', flush)
      const i = mountedUsers.lastIndexOf(userId)
      if (i >= 0) mountedUsers.splice(i, 1)
    }
  }, [api, userId])
  return gaveUp && userId !== null
}

/** Drop-in component form of useOutboxReplay, with a quiet notice when a write gave up. */
export function OutboxReplayer({ api, userId }: { api: ApiClient; userId: string | null }) {
  const gaveUp = useOutboxReplay(api, userId)
  const [dismissed, setDismissed] = useState(false)
  if (!gaveUp || dismissed) return null
  return (
    <div
      className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
      data-testid="outbox-notice"
    >
      <Toast
        tone="error"
        duration={8000}
        onDismiss={() => setDismissed(true)}
        message="Some lesson progress couldn't be saved. Your next lessons will still count."
      />
    </div>
  )
}
