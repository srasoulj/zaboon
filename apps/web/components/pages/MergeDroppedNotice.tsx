'use client'
/** Tells the learner when a parked guest merge had to be given up (identity.ts). */
import { useState } from 'react'
import { useHydrated } from '@/lib/app-services'
import { dismissDroppedMerge, hasDroppedMerge } from './identity'

export function MergeDroppedNotice() {
  const hydrated = useHydrated()
  const [dismissed, setDismissed] = useState(false)
  // localStorage is read after hydration only (the server can't see it).
  if (!hydrated || dismissed || !hasDroppedMerge()) return null
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
      <button
        type="button"
        onClick={() => {
          dismissDroppedMerge()
          setDismissed(true)
        }}
        className="shrink-0 underline"
      >
        Dismiss
      </button>
    </div>
  )
}
