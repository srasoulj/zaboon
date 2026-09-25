import type { Metadata } from 'next'
import { PracticeHub } from '@/components/practice/PracticeHub'

export const metadata: Metadata = { title: 'Practice' }

export default function PracticePage() {
  return <PracticeHub />
}
