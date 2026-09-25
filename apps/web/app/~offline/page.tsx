import type { Metadata } from 'next'
import { ZaBadge } from '@/components/pages/ZaBadge'
import { ReloadButton } from '@/components/pages/ReloadButton'

export const metadata: Metadata = {
  title: "You're offline",
  robots: { index: false, follow: false },
}

/** Precached by the service worker and shown when a page can't load without a connection. */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 bg-bg px-4 text-center text-ink">
      <ZaBadge size={64} />
      <h1 className="text-2xl font-extrabold">You&apos;re offline</h1>
      <p className="text-stone">
        Zaboon needs a connection to load this page. Your finished lessons are saved on this device
        and will be sent as soon as you&apos;re back online.
      </p>
      <ReloadButton />
    </main>
  )
}
