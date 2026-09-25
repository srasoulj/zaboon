/**
 * The lesson session as an XState v5 machine (framework-free; the React player only renders it).
 *
 *   loading ──► preloading ──► playing ─────────────────────────────► completing ──► complete
 *   (create or    (all session   ├ answering ⇄ checking ► feedback ┤   (outbox)       ├ summary
 *    resume)       audio)        └ (history) ◄── quitConfirm        │                  ├ streak
 *                                            outOfHearts ◄──────────┘                  └ goal
 *   expired (session gone) · error (load/complete failed) · exited (final: leave the player)
 *
 * Side effects are named actions/actors that the player provides (`machine.provide`): creating or
 * resuming the session, preloading audio, the outbox (wrong-attempt events and completion),
 * snapshots for resume after reload, and sounds. Grading is local and synchronous.
 */
import {
  type ChallengeResponse,
  type CreateSessionResponse,
  type LivesView,
  type SessionResult,
  type Verdict,
} from '@zaboon/contracts'
import type { ResponseGrade } from '@zaboon/session-engine'
import { assign, enqueueActions, fromPromise, setup } from 'xstate'
import { gradeAttempt, sessionLexicon } from './grading'
import type { CompleteOutcome } from './outbox'
import {
  costsHeart,
  countsAsWrong,
  currentIndex,
  finishEarly,
  maxAnswers,
  mustFinish,
  initialProgress,
  isFinished,
  loseHeart,
  outOfHearts,
  passes,
  recordAttempt,
  recordMismatch,
  type Progress,
} from './progress'
import { requestKey, type LessonRequest } from './request'
import type { LessonSnapshot } from './stores'
import { localSummary, summaryFromResult, type CompleteSummary, type HomeBefore } from './summary'

// ------------------------------------------------------------------------------------------- types
export interface LessonMachineInput {
  request: LessonRequest
  userId: string
  /** Epoch ms (injectable for tests). */
  now?: () => number
  /** The learner's streak and daily goal before the lesson (for the offline summary). */
  getHome?: () => HomeBefore | null
}

export interface StartInput {
  request: LessonRequest
  userId: string
}

/** A fresh session, or one resumed from a snapshot. */
export interface StartOutput {
  session: CreateSessionResponse
  resume: { progress: Progress; hearts: LivesView; startedAt: number } | null
}

export interface CompleteInput {
  userId: string
  session: CreateSessionResponse
  progress: Progress
  completedAt: string
}

export interface LessonError {
  code: string
  message: string
  during: 'load' | 'complete'
}

export interface Feedback {
  index: number
  attemptSeq: number
  response: ChallengeResponse
  verdict: Verdict
  grade: ResponseGrade
  /** Hearts were spent on this attempt. */
  heartLost: boolean
}

export type SoundEffect = 'correct' | 'wrong' | 'complete' | 'streak'
export type LessonExit = 'home' | 'practice'

export interface LessonContext {
  request: LessonRequest
  userId: string
  now: () => number
  getHome: () => HomeBefore | null
  session: CreateSessionResponse | null
  lexicon: string[]
  progress: Progress | null
  hearts: LivesView | null
  draft: ChallengeResponse | null
  shownAt: number
  startedAt: number
  feedback: Feedback | null
  /** attemptSeq of the latest wrong attempt (to apply the server's hearts for it). */
  lastWrongSeq: number
  summary: CompleteSummary | null
  result: SessionResult | null
  resumed: boolean
  error: LessonError | null
  exit: LessonExit | null
}

export type LessonEvent =
  | { type: 'RESPONSE'; response: ChallengeResponse | null }
  | { type: 'CHECK' }
  | { type: 'SKIP' }
  | { type: 'MISMATCH' }
  | { type: 'CONTINUE' }
  | { type: 'QUIT' }
  | { type: 'STAY' }
  | { type: 'CONFIRM_QUIT' }
  | { type: 'PRACTICE' }
  | { type: 'RETRY' }
  | { type: 'RESTART' }
  /** The server said the session is gone (an outbox event got 410). */
  | { type: 'EXPIRED' }
  /** The server's hearts after it recorded wrong attempt `attemptSeq`. */
  | { type: 'LIVES_SYNCED'; lives: LivesView; attemptSeq: number }
  /** The outbox delivered a completion that was queued offline. */
  | { type: 'RECONCILED'; result: SessionResult }

// ------------------------------------------------------------------------------------------ errors
/** Error code of an API/outbox error (ApiClientError, OutboxPermanentError), else `internal`. */
export function codeOf(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string')
    return error.code
  return 'internal'
}

function toError(error: unknown, during: LessonError['during']): LessonError {
  return {
    code: codeOf(error),
    message: error instanceof Error ? error.message : 'Something went wrong',
    during,
  }
}

const notProvided = (name: string) => () => {
  throw new Error(`lesson machine: ${name} not provided`)
}

// ----------------------------------------------------------------------------------------- helpers
export function snapshotOf(ctx: LessonContext): LessonSnapshot | null {
  if (!ctx.session || !ctx.progress || !ctx.hearts) return null
  return {
    v: 1,
    sessionId: ctx.session.sessionId,
    userId: ctx.userId,
    key: requestKey(ctx.request),
    session: ctx.session,
    progress: ctx.progress,
    hearts: ctx.hearts,
    startedAt: ctx.startedAt,
    savedAt: ctx.now(),
  }
}

export function currentChallenge(ctx: LessonContext) {
  if (!ctx.session || !ctx.progress) return null
  const i = ctx.feedback?.index ?? currentIndex(ctx.progress)
  return i === null ? null : (ctx.session.challenges.find((c) => c.index === i) ?? null)
}

const initialContext = (input: LessonMachineInput): LessonContext => ({
  request: input.request,
  userId: input.userId,
  now: input.now ?? Date.now,
  getHome: input.getHome ?? (() => null),
  session: null,
  lexicon: [],
  progress: null,
  hearts: null,
  draft: null,
  shownAt: 0,
  startedAt: 0,
  feedback: null,
  lastWrongSeq: -1,
  summary: null,
  result: null,
  resumed: false,
  error: null,
  exit: null,
})

// ----------------------------------------------------------------------------------------- machine
export const lessonMachine = setup({
  types: {
    context: {} as LessonContext,
    events: {} as LessonEvent,
    input: {} as LessonMachineInput,
  },
  actors: {
    start: fromPromise<StartOutput, StartInput>(notProvided('start')),
    preload: fromPromise<void, { session: CreateSessionResponse }>(async () => {}),
    complete: fromPromise<CompleteOutcome, CompleteInput>(notProvided('complete')),
  },
  actions: {
    /** Queue the wrong-attempt event (hearts) in the outbox. */
    recordWrong: (_, _params: { sessionId: string; attemptSeq: number; index: number }) => {},
    /** Save the resume snapshot. */
    persist: (_, _params: { snapshot: LessonSnapshot | null }) => {},
    /** Forget the resume snapshot (lesson finished or abandoned). */
    discard: (_, _params: { sessionId: string | null }) => {},
    sound: (_, _params: { effect: SoundEffect }) => {},
    markShown: assign({ shownAt: ({ context }) => context.now(), draft: null }),
    finishEarly: assign({
      progress: ({ context }) => finishEarly(context.progress!),
      feedback: null,
    }),
  },
  guards: {
    hasDraft: ({ context }) => context.draft !== null,
    finished: ({ context }) => context.progress !== null && isFinished(context.progress),
    /** The attempt cap of /complete is reached: end the lesson now (never a 400 at the end). */
    atAttemptCap: ({ context }) =>
      context.progress !== null && mustFinish(context.progress, maxAnswers()),
    noHearts: ({ context }) =>
      context.hearts !== null &&
      context.session !== null &&
      outOfHearts(context.session.kind, context.hearts),
    showStreak: ({ context }) => context.summary?.streak.extendedToday === true,
    showGoal: ({ context }) => context.summary?.dailyGoal.justMet === true,
  },
}).createMachine({
  id: 'lesson',
  context: ({ input }) => initialContext(input),
  initial: 'loading',
  states: {
    loading: {
      entry: assign({ error: null }),
      invoke: {
        src: 'start',
        input: ({ context }) => ({ request: context.request, userId: context.userId }),
        onDone: {
          target: 'preloading',
          actions: [
            assign(({ context, event }) => {
              const { session, resume } = event.output
              return {
                session,
                lexicon: sessionLexicon(session.challenges),
                progress: resume?.progress ?? initialProgress(session.challenges),
                hearts: resume?.hearts ?? session.lives,
                startedAt: resume?.startedAt ?? context.now(),
                resumed: resume !== null,
                feedback: null,
                draft: null,
                summary: null,
                result: null,
                lastWrongSeq: -1,
              }
            }),
            { type: 'persist', params: ({ context }) => ({ snapshot: snapshotOf(context) }) },
          ],
        },
        onError: [
          {
            guard: ({ event }) => codeOf(event.error) === 'out_of_lives',
            target: 'outOfHearts',
          },
          {
            target: 'error',
            actions: assign({ error: ({ event }) => toError(event.error, 'load') }),
          },
        ],
      },
    },

    preloading: {
      invoke: {
        src: 'preload',
        input: ({ context }) => ({ session: context.session! }),
        onDone: 'route',
        // Missing audio never blocks the lesson.
        onError: 'route',
      },
    },

    /** Where a (possibly resumed) session continues. */
    route: {
      always: [
        { guard: 'finished', target: 'completing' },
        { guard: 'noHearts', target: 'outOfHearts' },
        { guard: 'atAttemptCap', target: 'completing', actions: 'finishEarly' },
        { target: 'playing', actions: 'markShown' },
      ],
    },

    playing: {
      initial: 'answering',
      on: {
        QUIT: 'quitConfirm',
        EXPIRED: 'expired',
        LIVES_SYNCED: {
          guard: ({ context, event }) => event.attemptSeq === context.lastWrongSeq,
          actions: assign({ hearts: ({ event }) => event.lives }),
        },
      },
      states: {
        answering: {
          on: {
            RESPONSE: { actions: assign({ draft: ({ event }) => event.response }) },
            CHECK: { guard: 'hasDraft', target: 'checking' },
            SKIP: { target: 'checking', actions: assign({ draft: { kind: 'skip' } }) },
            MISMATCH: 'mismatched',
          },
        },
        /** A wrong tap in a matching challenge: a wrong attempt, but the learner stays on it. */
        mismatched: {
          entry: enqueueActions(({ context, enqueue }) => {
            const session = context.session!
            const index = currentIndex(context.progress!)!
            const recorded = recordMismatch(
              context.progress!,
              index,
              context.now() - context.shownAt,
            )
            const heartLost = costsHeart(session.kind, context.hearts!)
            const next = {
              progress: recorded.progress,
              hearts: heartLost ? loseHeart(context.hearts!) : context.hearts,
              lastWrongSeq: recorded.answer.attemptSeq,
            }
            enqueue.assign(next)
            if (session.kind !== 'practice')
              enqueue({
                type: 'recordWrong',
                params: {
                  sessionId: session.sessionId,
                  attemptSeq: recorded.answer.attemptSeq,
                  index,
                },
              })
            enqueue({ type: 'persist', params: { snapshot: snapshotOf({ ...context, ...next }) } })
            enqueue({ type: 'sound', params: { effect: 'wrong' } })
          }),
          always: [
            { guard: 'noHearts', target: '#lesson.outOfHearts' },
            { guard: 'atAttemptCap', target: '#lesson.completing', actions: 'finishEarly' },
            { target: 'answering' },
          ],
        },
        checking: {
          entry: [
            assign(({ context }) => {
              const session = context.session!
              const progress = context.progress!
              const index = currentIndex(progress)!
              const challenge = session.challenges.find((c) => c.index === index)!
              const response = context.draft ?? { kind: 'skip' as const }
              const grade = gradeAttempt(challenge, response, context.lexicon)
              const recorded = recordAttempt(progress, {
                index,
                response,
                verdict: grade.verdict,
                ms: context.now() - context.shownAt,
              })
              const heartLost =
                countsAsWrong(grade.verdict) && costsHeart(session.kind, context.hearts!)
              return {
                progress: recorded.progress,
                hearts: heartLost ? loseHeart(context.hearts!) : context.hearts,
                lastWrongSeq: countsAsWrong(grade.verdict)
                  ? recorded.answer.attemptSeq
                  : context.lastWrongSeq,
                feedback: {
                  index,
                  attemptSeq: recorded.answer.attemptSeq,
                  response,
                  verdict: grade.verdict,
                  grade,
                  heartLost,
                },
              }
            }),
            enqueueActions(({ context, enqueue }) => {
              const f = context.feedback!
              if (countsAsWrong(f.verdict) && context.session!.kind !== 'practice')
                enqueue({
                  type: 'recordWrong',
                  params: {
                    sessionId: context.session!.sessionId,
                    attemptSeq: f.attemptSeq,
                    index: f.index,
                  },
                })
            }),
            { type: 'persist', params: ({ context }) => ({ snapshot: snapshotOf(context) }) },
            {
              type: 'sound',
              params: ({ context }) => ({
                effect: passes(context.feedback!.verdict) ? 'correct' : 'wrong',
              }),
            },
          ],
          always: 'feedback',
        },
        feedback: {
          on: {
            CONTINUE: [
              {
                guard: 'noHearts',
                target: '#lesson.outOfHearts',
                actions: assign({ feedback: null }),
              },
              {
                guard: 'finished',
                target: '#lesson.completing',
                actions: assign({ feedback: null }),
              },
              { guard: 'atAttemptCap', target: '#lesson.completing', actions: 'finishEarly' },
              { target: 'answering', actions: [assign({ feedback: null }), 'markShown'] },
            ],
          },
        },
        hist: { type: 'history' },
      },
    },

    quitConfirm: {
      on: {
        STAY: 'playing.hist',
        CONFIRM_QUIT: {
          target: 'exited',
          actions: [
            {
              type: 'discard',
              params: ({ context }) => ({ sessionId: context.session?.sessionId ?? null }),
            },
            assign({ exit: 'home' }),
          ],
        },
        EXPIRED: 'expired',
      },
    },

    outOfHearts: {
      entry: {
        type: 'discard',
        params: ({ context }) => ({ sessionId: context.session?.sessionId ?? null }),
      },
      on: {
        PRACTICE: { target: 'exited', actions: assign({ exit: 'practice' }) },
        QUIT: { target: 'exited', actions: assign({ exit: 'home' }) },
        CONFIRM_QUIT: { target: 'exited', actions: assign({ exit: 'home' }) },
      },
    },

    completing: {
      invoke: {
        src: 'complete',
        input: ({ context }) => ({
          userId: context.userId,
          session: context.session!,
          progress: context.progress!,
          completedAt: new Date(context.now()).toISOString(),
        }),
        onDone: {
          target: 'complete',
          actions: [
            assign(({ context, event }) =>
              event.output.status === 'delivered'
                ? { result: event.output.result, summary: summaryFromResult(event.output.result) }
                : {
                    result: null,
                    summary: localSummary({
                      kind: context.session!.kind,
                      progress: context.progress!,
                      durationMs: context.now() - context.startedAt,
                      home: context.getHome(),
                    }),
                  },
            ),
            {
              type: 'discard',
              params: ({ context }) => ({ sessionId: context.session!.sessionId }),
            },
          ],
        },
        onError: [
          {
            guard: ({ event }) => codeOf(event.error) === 'gone',
            target: 'expired',
          },
          {
            target: 'error',
            actions: assign({ error: ({ event }) => toError(event.error, 'complete') }),
          },
        ],
      },
    },

    complete: {
      entry: { type: 'sound', params: { effect: 'complete' } },
      initial: 'summary',
      on: {
        RECONCILED: {
          guard: ({ context, event }) => event.result.sessionId === context.session?.sessionId,
          actions: assign({
            result: ({ event }) => event.result,
            summary: ({ event }) => summaryFromResult(event.result),
          }),
        },
      },
      states: {
        summary: {
          on: {
            CONTINUE: [
              { guard: 'showStreak', target: 'streak' },
              { guard: 'showGoal', target: 'goal' },
              { target: '#lesson.exited', actions: assign({ exit: 'home' }) },
            ],
          },
        },
        streak: {
          entry: { type: 'sound', params: { effect: 'streak' } },
          on: {
            CONTINUE: [
              { guard: 'showGoal', target: 'goal' },
              { target: '#lesson.exited', actions: assign({ exit: 'home' }) },
            ],
          },
        },
        goal: {
          on: { CONTINUE: { target: '#lesson.exited', actions: assign({ exit: 'home' }) } },
        },
      },
    },

    expired: {
      entry: {
        type: 'discard',
        params: ({ context }) => ({ sessionId: context.session?.sessionId ?? null }),
      },
      on: {
        RESTART: 'loading',
        QUIT: { target: 'exited', actions: assign({ exit: 'home' }) },
        CONFIRM_QUIT: { target: 'exited', actions: assign({ exit: 'home' }) },
      },
    },

    error: {
      // Completion only fails here for good (the outbox keeps transient failures): don't resume
      // into the same failure after a reload.
      entry: enqueueActions(({ context, enqueue }) => {
        if (context.error?.during === 'complete')
          enqueue({ type: 'discard', params: { sessionId: context.session?.sessionId ?? null } })
      }),
      on: {
        RETRY: [
          { guard: ({ context }) => context.error?.during === 'complete', target: 'completing' },
          { target: 'loading' },
        ],
        QUIT: { target: 'exited', actions: assign({ exit: 'home' }) },
        CONFIRM_QUIT: { target: 'exited', actions: assign({ exit: 'home' }) },
      },
    },

    exited: { type: 'final' },
  },
})

export type LessonMachine = typeof lessonMachine
