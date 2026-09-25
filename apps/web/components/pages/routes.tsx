'use client'
/** Client entry points for the ws-pages routes that navigate (the screens take `navigate` for tests). */
import { useRouter } from 'next/navigation'
import { AccountScreen } from './AccountScreen'
import { Onboarding } from './Onboarding'
import { SignInScreen } from './SignInScreen'

export function OnboardingRoute() {
  const router = useRouter()
  return <Onboarding navigate={router.replace} />
}

export function AccountRoute() {
  const router = useRouter()
  return <AccountScreen navigate={router.replace} />
}

export function SignInRoute() {
  const router = useRouter()
  return <SignInScreen navigate={router.replace} />
}
