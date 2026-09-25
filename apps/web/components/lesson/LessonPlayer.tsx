'use client'
/**
 * The lesson player (DESIGN-SYSTEM §2.2–§2.3, ARCHITECTURE §3.2): renders the lesson machine
 * (lib/lesson/machine.ts) full-screen and wires its side effects to the API, the outbox,
 * IndexedDB snapshots and audio. The player owns the flow; renderers own one challenge each.
 */
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useMachine } from '@xstate/react'
import { fromPromise } from 'xstate'
import { usePrefersReducedMotion } from '@zaboon/ui'
import type { CreateSessionResponse, Settings } from '@zaboon/contracts'
import { GRADER_VERSION } from '@zaboon/grader'
import { queryKeys } from '../../lib/api-client'
import { useApi } from '../../lib/app-services'
import type {
  ChallengeAudio,
  ChallengeDisplay,
  ChallengeRenderer,
  ChallengeRendererProps,
} from '../../lib/challenge-registry'
import { solutionFor } from '../../lib/lesson/grading'
import { createInFlight } from '../../lib/lesson/inflight'
import {
  currentChallenge,
  lessonMachine,
  type CompleteInput,
  type StartInput,
  type StartOutput,
} from '../../lib/lesson/machine'
import { progressValue } from '../../lib/lesson/progress'
import { exitHref, lessonHref, requestKey, type LessonRequest } from '../../lib/lesson/request'
import type { HomeBefore } from '../../lib/lesson/summary'
import { DailyGoalScreen, StreakScreen, SummaryScreen } from './CompleteScreens'
import { OutOfHeartsModal, QuitDialog } from './Dialogs'
import { LessonFeedback } from './LessonFeedback'
import { LessonFooter } from './LessonFooter'
import { ReportSheet } from './ReportSheet'
import { useLessonServices, type RendererResolver } from './services'
import { ErrorScreen, ExpiredScreen, LoadingScreen } from './StatusScreens'
import { TopBar } from './TopBar'

/**
 * Renders the registered renderer for the challenge's type. Renderers come from a static map
 * (lib/challenge-registry.ts, or the test map), so the lookup never creates a component.
 */
function ChallengeSlot({
  resolve,
  props,
}: {
  resolve: RendererResolver
  props: ChallengeRendererProps
}) {
  const Renderer = resolve(props.challenge.type) as ChallengeRenderer | null
  if (!Renderer)
    return (
      <p className="text-center text-stone">
        This kind of challenge isn&apos;t available yet. Skip it for now.
      </p>
    )
  return createElement(Renderer, props)
}

export interface LessonPlayerProps {
  request: LessonRequest
  userId: string
  settings: Pick<Settings, 'sound' | 'transliteration' | 'vowelMarks'>
  /** Streak and daily goal before the lesson (for the offline summary); null while unknown. */
  home: HomeBefore | null
  onExit: (href: string) => void
  now?: () => number
}

/** One createSession per user and lesson at a time (see inflight.ts). */
const creating = createInFlight<CreateSessionResponse>()

const INTERACTIVE =
  'button, a[href], input, textarea, select, [role="button"], [contenteditable="true"]'

/** True when Enter on this element should be left to the element itself. */
export function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.closest(INTERACTIVE) !== null
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

export function LessonPlayer({
  request,
  userId,
  settings,
  home,
  onExit,
  now = Date.now,
}: LessonPlayerProps) {
  const api = useApi()
  const queryClient = useQueryClient()
  const { snapshots, outbox, audio, resolveRenderer } = useLessonServices()
  const reducedMotion = usePrefersReducedMotion()
  const online = useOnline()
  const homeRef = useRef(home)
  useEffect(() => {
    homeRef.current = home
  }, [home])

  const [machine] = useState(() =>
    lessonMachine.provide({
      actors: {
        start: fromPromise<StartOutput, StartInput>(async ({ input }) => {
          const saved = await snapshots
            .find(input.userId, requestKey(input.request))
            .catch(() => null)
          if (saved) {
            if (saved.v === 1 && Date.parse(saved.session.expiresAt) > now())
              return {
                session: saved.session,
                resume: {
                  progress: saved.progress,
                  hearts: saved.hearts,
                  startedAt: saved.startedAt,
                },
              }
            await snapshots.remove(saved.sessionId).catch(() => {})
          }
          const session = await creating.run(`${input.userId}|${requestKey(input.request)}`, () =>
            api('createSession', {
              body: {
                courseId: input.request.courseId,
                kind: input.request.kind,
                ...(input.request.levelId !== null ? { levelId: input.request.levelId } : {}),
                tz: browserTimeZone(),
              },
            }),
          )
          return { session, resume: null }
        }),
        preload: fromPromise(async ({ input }) => audio.preload(input.session.challenges)),
        complete: fromPromise(async ({ input }: { input: CompleteInput }) =>
          outbox.submitComplete(input.userId, input.session.sessionId, {
            answers: input.progress.answers,
            completedAt: input.completedAt,
            graderVersion: GRADER_VERSION,
          }),
        ),
      },
      actions: {
        recordWrong: (_, p) => {
          void outbox
            .enqueueEvent(userId, p.sessionId, {
              attemptSeq: p.attemptSeq,
              index: p.index,
              kind: 'wrong',
            })
            .then(() => outbox.flush())
            .catch((e: unknown) => console.warn('[lesson] could not queue a wrong attempt', e))
        },
        persist: (_, p) => {
          if (p.snapshot) void snapshots.save(p.snapshot).catch(() => {})
        },
        discard: (_, p) => {
          if (p.sessionId) void snapshots.remove(p.sessionId).catch(() => {})
        },
        sound: (_, p) => audio.effect(p.effect),
      },
    }),
  )
  const [state, send, actor] = useMachine(machine, {
    input: { request, userId, now, getHome: () => homeRef.current },
  })
  const ctx = state.context

  // --- sound setting
  useEffect(() => {
    audio.setEnabled(settings.sound)
  }, [audio, settings.sound])
  useEffect(() => () => audio.stop(), [audio])

  const invalidate = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.path }),
        queryClient.invalidateQueries({ queryKey: queryKeys.letters }),
        queryClient.invalidateQueries({ queryKey: queryKeys.words }),
      ]),
    [queryClient],
  )

  // --- outbox deliveries: server hearts, reconciliation, expiry
  useEffect(
    () =>
      outbox.subscribe((d) => {
        const sessionId = actor.getSnapshot().context.session?.sessionId
        if (d.type === 'complete') void invalidate()
        if (!sessionId || d.entry.sessionId !== sessionId) return
        if (d.type === 'event') {
          if (d.response)
            actor.send({
              type: 'LIVES_SYNCED',
              lives: d.response.lives,
              attemptSeq: d.entry.body.attemptSeq,
            })
        } else if (d.type === 'complete') {
          if (d.result) actor.send({ type: 'RECONCILED', result: d.result })
        } else if (d.code === 'gone') actor.send({ type: 'EXPIRED' })
      }),
    [outbox, actor, invalidate],
  )

  const completed = state.matches('complete')
  useEffect(() => {
    if (completed) void invalidate()
  }, [completed, invalidate])

  // --- leaving the player
  const done = state.status === 'done'
  useEffect(() => {
    if (!done) return
    onExit(
      ctx.exit === 'practice'
        ? lessonHref({ courseId: request.courseId, kind: 'practice', levelId: null })
        : exitHref(request.kind),
    )
  }, [done, ctx.exit, onExit, request])

  // --- keyboard (DESIGN-SYSTEM §8): Enter = CHECK / CONTINUE, Escape = quit dialog
  const [reportOpen, setReportOpen] = useState(false)
  const reportOpenRef = useRef(false)
  useEffect(() => {
    reportOpenRef.current = reportOpen
  }, [reportOpen])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || reportOpenRef.current || e.isComposing) return
      const s = actor.getSnapshot()
      if (e.key === 'Escape') {
        if (s.matches('playing')) {
          e.preventDefault()
          actor.send({ type: 'QUIT' })
        }
        return
      }
      if (e.key !== 'Enter' || e.repeat || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return
      // A focused control (a choice card, tile, speaker, Undo, CONTINUE…) handles Enter itself, and
      // text fields submit through the renderer (onSubmit): only an unfocused Enter checks/continues.
      if (isInteractive(e.target)) return
      if (s.matches({ playing: 'answering' })) {
        e.preventDefault()
        actor.send({ type: 'CHECK' })
      } else if (s.matches({ playing: 'feedback' }) || s.matches('complete')) {
        e.preventDefault()
        actor.send({ type: 'CONTINUE' })
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [actor])

  // --- renderer plumbing
  const display: ChallengeDisplay = useMemo(
    () => ({
      transliteration: settings.transliteration !== 'off',
      vowelMarks: settings.vowelMarks !== 'off',
      sound: settings.sound,
      reducedMotion,
    }),
    [settings.transliteration, settings.vowelMarks, settings.sound, reducedMotion],
  )
  const challengeAudio: ChallengeAudio = useMemo(
    () => ({
      play: (url, o) => audio.play(url, o),
      stop: () => audio.stop(),
      mouthOpen: () => audio.mouthOpen(),
    }),
    [audio],
  )

  const challenge = currentChallenge(ctx)

  const exitNow = () => send({ type: 'CONFIRM_QUIT' })

  // --- screens
  if (state.matches('loading') || state.matches('preloading') || state.matches('route'))
    return <LoadingScreen />
  if (state.matches('completing')) return <LoadingScreen label="Saving your progress…" />
  if (state.matches('expired'))
    return <ExpiredScreen onRestart={() => send({ type: 'RESTART' })} onQuit={exitNow} />
  if (state.matches('error'))
    return (
      <ErrorScreen
        code={ctx.error?.code ?? 'internal'}
        onRetry={() => send({ type: 'RETRY' })}
        onQuit={exitNow}
      />
    )
  if (state.matches('complete') && ctx.summary) {
    const next = () => send({ type: 'CONTINUE' })
    if (state.matches({ complete: 'streak' }))
      return <StreakScreen days={ctx.summary.streak.days} onContinue={next} />
    if (state.matches({ complete: 'goal' }))
      return (
        <DailyGoalScreen
          xp={ctx.summary.dailyGoal.xp}
          goal={ctx.summary.dailyGoal.goal}
          onContinue={next}
        />
      )
    return <SummaryScreen summary={ctx.summary} offline={!online} onContinue={next} />
  }
  if (done) return <LoadingScreen label="" />

  // Kept while the quit dialog is open over the feedback bar (the machine's history state).
  const inFeedback = ctx.feedback !== null
  const showFooter = state.matches('playing') || state.matches('quitConfirm')
  const feedback = ctx.feedback

  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col"
      data-testid="lesson-player"
      data-session={ctx.session?.sessionId}
      data-resumed={ctx.resumed ? 'true' : 'false'}
    >
      <div>
        <TopBar
          progress={ctx.progress ? progressValue(ctx.progress) : 0}
          combo={ctx.progress?.combo ?? 0}
          hearts={ctx.hearts}
          onClose={() => send({ type: 'QUIT' })}
        />
      </div>
      <main
        className="flex flex-1 flex-col px-4 py-6"
        data-testid="lesson-challenge"
        data-index={challenge?.index}
        data-type={challenge?.type}
        data-attempt={ctx.progress?.nextSeq}
      >
        {challenge && (
          <ChallengeSlot
            key={`${challenge.index}:${ctx.shownAt}`}
            resolve={resolveRenderer}
            props={{
              challenge,
              response: ctx.draft,
              onResponse: (response) => send({ type: 'RESPONSE', response }),
              onSubmit: () => send({ type: 'CHECK' }),
              phase: inFeedback ? 'feedback' : 'answering',
              verdict: inFeedback ? (feedback?.verdict ?? null) : null,
              display,
              audio: challengeAudio,
              onMismatch: () => send({ type: 'MISMATCH' }),
            }}
          />
        )}
      </main>
      <div className="sticky bottom-0 bg-bg">
        {!showFooter ? null : inFeedback && feedback && challenge ? (
          <LessonFeedback
            verdict={feedback.verdict}
            attemptSeq={feedback.attemptSeq}
            solution={solutionFor(challenge, feedback.grade)}
            onContinue={() => send({ type: 'CONTINUE' })}
            onReport={() => setReportOpen(true)}
          />
        ) : (
          <LessonFooter
            canCheck={ctx.draft !== null && state.matches({ playing: 'answering' })}
            onCheck={() => send({ type: 'CHECK' })}
            onSkip={() => send({ type: 'SKIP' })}
          />
        )}
      </div>
      {challenge && ctx.session && (
        <ReportSheet
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          challenge={challenge}
          sessionId={ctx.session.sessionId}
          response={feedback?.response ?? null}
          submit={(body) => api('createReport', { body })}
        />
      )}
      <QuitDialog
        open={state.matches('quitConfirm')}
        onStay={() => send({ type: 'STAY' })}
        onQuit={exitNow}
      />
      <OutOfHeartsModal
        open={state.matches('outOfHearts')}
        onPractice={() => send({ type: 'PRACTICE' })}
        onQuit={() => send({ type: 'QUIT' })}
      />
    </div>
  )
}
