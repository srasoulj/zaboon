import type { ReactNode } from 'react'

// The lesson player is full-screen: no app chrome, centered, max width ~640px (DESIGN-SYSTEM §2.2).
export default function LessonLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-bg text-ink">{children}</div>
}
