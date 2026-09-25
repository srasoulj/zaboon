import type { Metadata } from 'next'
import { SignInRoute } from '@/components/pages/routes'

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to Zaboon to keep learning Persian (Farsi).',
  alternates: { canonical: '/sign-in' },
  robots: { index: false },
}

export default function SignInPage() {
  return <SignInRoute />
}
