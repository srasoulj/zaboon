import type { Metadata } from 'next'
import { AccountRoute } from '@/components/pages/routes'

export const metadata: Metadata = { title: 'Account', robots: { index: false } }

export default function AccountPage() {
  return <AccountRoute />
}
