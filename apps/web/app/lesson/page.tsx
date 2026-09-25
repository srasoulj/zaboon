import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LessonRoute } from '@/components/lesson/LessonRoute'
import { LoadingScreen } from '@/components/lesson/StatusScreens'

export const metadata: Metadata = { title: 'Lesson' }

export default function LessonPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <LessonRoute />
    </Suspense>
  )
}
