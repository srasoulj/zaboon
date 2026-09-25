import type { Metadata } from 'next'
import { SettingsScreen } from '@/components/pages/SettingsScreen'

export const metadata: Metadata = { title: 'Settings', robots: { index: false } }

export default function SettingsPage() {
  return <SettingsScreen />
}
