import type { Metadata } from 'next'
import { QuestsScreen } from '@/components/engagement/QuestsScreen'

export const metadata: Metadata = { title: 'Quests' }

export default function QuestsPage() {
  return <QuestsScreen />
}
