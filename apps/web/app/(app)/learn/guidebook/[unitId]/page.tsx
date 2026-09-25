import type { Metadata } from 'next'
import { GuidebookView } from '@/components/path/GuidebookView'

export const metadata: Metadata = { title: 'Guidebook' }

export default async function GuidebookPage({
  params,
  searchParams,
}: {
  params: Promise<{ unitId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { unitId } = await params
  const { course } = await searchParams
  return (
    <GuidebookView
      unitId={unitId}
      courseId={typeof course === 'string' && course ? course : null}
    />
  )
}
