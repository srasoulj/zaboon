import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// Admin tools are never indexed (robots.txt disallows them too).
export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false, nocache: true },
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl bg-bg px-4 py-8 text-ink">{children}</main>
  )
}
