import type { Metadata } from 'next'
import { LearnPath } from '@/components/path/LearnPath'

export const metadata: Metadata = { title: 'Learn' }

export default function LearnPage() {
  return <LearnPath />
}
