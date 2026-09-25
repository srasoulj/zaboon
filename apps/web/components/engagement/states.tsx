'use client'
/** Loading and "not available" states shared by the engagement pages. */
import { ButtonLink } from '@/components/pages/ButtonLink'

export function PageLoading({ label }: { label: string }) {
  return (
    <p role="status" className="text-stone font-bold">
      {label}
    </p>
  )
}

/** A flagged page opened while its feature is off (e.g. an old link). */
export function FeatureOff({ title }: { title: string }) {
  return (
    <section className="flex flex-col items-center gap-4 text-center" data-testid="feature-off">
      <h1 className="text-[24px] font-extrabold">{title}</h1>
      <p className="text-stone font-bold">This isn&apos;t available yet.</p>
      <ButtonLink href="/learn">Back to learning</ButtonLink>
    </section>
  )
}
