'use client'
/**
 * /lesson?course=…&kind=…&level=… : signs a first-time visitor in as a guest, opens the lesson
 * services (IndexedDB stores, outbox, audio) and mounts the player.
 */
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_SETTINGS } from '@zaboon/contracts'
import { rendererFor } from '@/lib/challenge-registry'
import { useApi, useEnsureGuest, useHome } from '@/lib/app-services'
import { createHowlerAudio } from '@/lib/lesson/audio'
import { parseLessonRequest, requestKey } from '@/lib/lesson/request'
import { LessonPlayer } from './LessonPlayer'
import { LessonServicesProvider, sharedLessonStores, useOutboxReplay, type LessonServices } from './services'
import { LoadingScreen } from './StatusScreens'
import { resolveTestRenderer, testRenderersEnabled } from './test-renderers'

export function LessonRoute() {
  const params = useSearchParams()
  const parsed = parseLessonRequest(params)
  const router = useRouter()
  const api = useApi()
  const session = useEnsureGuest()
  const userId = session?.userId ?? null
  const home = useHome(userId !== null)
  useOutboxReplay(api, userId)

  const [services, setServices] = useState<LessonServices | null>(null)
  useEffect(() => {
    let alive = true
    const audio = createHowlerAudio()
    void sharedLessonStores(api).then(({ snapshots, outbox }) => {
      if (!alive) return
      setServices({
        snapshots,
        outbox,
        audio,
        resolveRenderer: testRenderersEnabled() ? resolveTestRenderer : rendererFor,
      })
    })
    return () => {
      alive = false
      audio.dispose()
    }
  }, [api])

  const onExit = useCallback((href: string) => router.replace(href), [router])

  if (!parsed.ok)
    return (
      <section className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center" data-testid="lesson-invalid">
        <h1 className="text-[24px] font-extrabold">We couldn&apos;t open this lesson</h1>
        <p className="text-stone">{parsed.reason}</p>
        <Link href="/learn" className="font-extrabold uppercase text-lajvard-500">
          Back to learning
        </Link>
      </section>
    )
  if (!services || userId === null) return <LoadingScreen />

  const data = home.data
  return (
    <LessonServicesProvider value={services}>
      <LessonPlayer
        key={`${userId}:${requestKey(parsed.request)}`}
        request={parsed.request}
        userId={userId}
        settings={data?.settings ?? DEFAULT_SETTINGS}
        home={data ? { streak: data.streak, dailyGoal: data.dailyGoal } : null}
        onExit={onExit}
      />
    </LessonServicesProvider>
  )
}

