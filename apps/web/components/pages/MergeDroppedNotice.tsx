'use client'
/**
 * Tells a member that the progress they made as a guest could not be merged into their account
 * (identity.ts gives up only on a permanent refusal or an expired guest token). Self-contained, for
 * the app shell: it reads storage, follows other tabs (`storage` event) and this tab
 * (MERGE_DROPPED_EVENT), and shows only to the member the note is for.
 */
import { useSyncExternalStore } from 'react'
import { useSession } from '@/lib/app-services'
import {
  MERGE_DROPPED_EVENT,
  MERGE_DROPPED_KEY,
  clearDroppedMerge,
  droppedMergeFor,
  readDroppedMerge,
} from './identity'

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === MERGE_DROPPED_KEY) onChange()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(MERGE_DROPPED_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(MERGE_DROPPED_EVENT, onChange)
  }
}

const serverSnapshot = () => null

export function MergeDroppedNotice() {
  const raw = useSyncExternalStore(subscribe, readDroppedMerge, serverSnapshot)
  const session = useSession()
  const member =
    session.status === 'signed_in' && !session.session.isAnonymous ? session.session.userId : null
  if (!member || droppedMergeFor(raw) !== member) return null
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-4 rounded-[var(--radius-card)] bg-wrong-bg p-4 font-bold text-wrong-fg"
      data-testid="merge-dropped"
    >
      <p>
        We couldn&apos;t add the progress you made as a guest to this account: the guest session had
        expired or was refused. Your account itself is fine.
      </p>
      <button type="button" onClick={clearDroppedMerge} className="shrink-0 underline">
        Dismiss
      </button>
    </div>
  )
}
