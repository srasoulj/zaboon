'use client'
// Onboarding (no chrome: the app shell renders /onboarding bare). Step 1 is plain /onboarding.
import { useRouter } from 'next/navigation'
import { Onboarding } from '@/components/pages/Onboarding'

export default function OnboardingPage() {
  const router = useRouter()
  return <Onboarding navigate={router.replace} />
}
