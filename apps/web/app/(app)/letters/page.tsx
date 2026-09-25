import type { Metadata } from 'next'
import { LettersTab } from '@/components/letters/LettersTab'

export const metadata: Metadata = { title: 'Letters' }

export default function LettersPage() {
  return <LettersTab />
}
