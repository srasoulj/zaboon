// Onboarding (no chrome: the app shell renders /onboarding bare). Step 1 is plain /onboarding.
import type { Metadata } from 'next'
import { OnboardingRoute } from '@/components/pages/routes'

export const metadata: Metadata = { title: 'Get started', robots: { index: false } }

export default function OnboardingPage() {
  return <OnboardingRoute />
}
