'use client'
/**
 * /quests (flags.quests; DESIGN-SYSTEM §2.3): today's quests in the learner's timezone with their
 * progress bars and a countdown to the reset. Quests are claimed automatically by the lesson that
 * completes them, so there is nothing to tap here.
 */
import { useQuery } from '@tanstack/react-query'
import type { QuestsResponse } from '@zaboon/contracts'
import { Icon } from '@zaboon/ui'
import { queryKeys } from '@/lib/api-client'
import { useApi, useHome, useSession } from '@/lib/app-services'
import { Countdown, QuestList } from './shared'
import { FeatureOff, PageLoading } from './states'

export function QuestsScreen() {
  const api = useApi()
  const session = useSession()
  const home = useHome(session.status === 'signed_in')
  const on = home.data?.flags.quests === true
  const quests = useQuery<QuestsResponse>({
    queryKey: queryKeys.quests,
    queryFn: () => api('quests'),
    enabled: on,
    refetchOnMount: 'always',
  })

  if (!home.data) return <PageLoading label="Loading quests…" />
  if (!on) return <FeatureOff title="Quests" />

  const done = quests.data?.quests.filter((q) => q.completed).length ?? 0
  return (
    <section aria-labelledby="quests-title" className="flex flex-col gap-6">
      <header className="flex items-center gap-4 rounded-[var(--radius-card)] border-2 border-b-4 border-line p-5">
        <Icon name="chest" size={72} className="text-zaferan-500" />
        <div className="flex flex-col gap-1">
          <h1 id="quests-title" className="text-[28px] font-extrabold">
            Daily quests
          </h1>
          <p className="text-stone font-bold">
            Complete quests to earn coins. They&apos;re paid out as soon as you finish them.
          </p>
        </div>
      </header>
      {quests.data ? (
        <section
          aria-labelledby="today-title"
          data-testid="quests-today"
          data-date={quests.data.date}
        >
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="today-title" className="text-[20px] font-extrabold">
              Today · {done} of {quests.data.quests.length} done
            </h2>
            <Countdown until={quests.data.resetsAt} prefix="New quests in" testId="quests-reset" />
          </div>
          <QuestList quests={quests.data.quests} />
        </section>
      ) : quests.isError ? (
        <p role="alert" className="text-stone font-bold">
          We couldn&apos;t load your quests.
        </p>
      ) : (
        <PageLoading label="Loading quests…" />
      )}
    </section>
  )
}
