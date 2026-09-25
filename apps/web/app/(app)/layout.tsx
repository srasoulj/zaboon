// Orchestrator-owned: every screen in (app) gets the shell (guest bootstrap, onboarding redirect,
// navigation and stats). Screens themselves are owned by their workstreams.
import type { ReactNode } from 'react'
import { AppShell } from '@/components/shell/AppShell'

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>
}
