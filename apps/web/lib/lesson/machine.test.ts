import { describe, expect, it, vi } from 'vitest'
import { createActor, fromPromise, waitFor } from 'xstate'
import type { SessionResult } from '@zaboon/contracts'
import {
  currentChallenge,
  lessonMachine,
  type CompleteInput,
  type LessonMachineInput,
  type SoundEffect,
  type StartOutput,
} from './machine'
import type { CompleteOutcome } from './outbox'
import { initialProgress, recordAttempt } from './progress'
import type { LessonSnapshot } from './stores'
import { lives, testResult, testSession, USER_ID } from './test-support'

class CodedError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

interface Harness {
  start?: () => Promise<StartOutput>
  complete?: (input: CompleteInput) => Promise<CompleteOutcome>
  preload?: () => Promise<void>
  input?: Partial<LessonMachineInput>
}

function run(h: Harness = {}) {
  const calls = {
    wrong: [] as { sessionId: string; attemptSeq: number; index: number }[],
    persisted: [] as LessonSnapshot[],
    discarded: [] as (string | null)[],
    sounds: [] as SoundEffect[],
    completed: [] as CompleteInput[],
  }
  let clock = 1_000_000
  const machine = lessonMachine.provide({
    actors: {
      start: fromPromise(h.start ?? (async () => ({ session: testSession(), resume: null }))),
      preload: fromPromise(h.preload ?? (async () => {})),
      complete: fromPromise<CompleteOutcome, CompleteInput>(async ({ input }) => {
        calls.completed.push(input)
        return h.complete ? h.complete(input) : { status: 'delivered', result: testResult() }
      }),
    },
    actions: {
      recordWrong: (_, p) => void calls.wrong.push(p),
      persist: (_, p) => void (p.snapshot && calls.persisted.push(p.snapshot)),
      discard: (_, p) => void calls.discarded.push(p.sessionId),
      sound: (_, p) => void calls.sounds.push(p.effect),
    },
  })
  const actor = createActor(machine, {
    input: {
      request: { courseId: 'fixture', kind: 'lesson', levelId: 'u01-s0' },
      userId: USER_ID,
      now: () => clock,
      ...h.input,
    },
  })
  actor.start()
  const tick = (ms: number) => {
    clock += ms
  }
  return { actor, calls, tick }
}

type Actor = ReturnType<typeof run>['actor']
const ready = (actor: Actor) => waitFor(actor, (s) => s.matches({ playing: 'answering' }))
const idx = (actor: Actor) => currentChallenge(actor.getSnapshot().context)?.index

/** Answers the current challenge correctly (test session: 0 → choice 1, 1 → tiles, 2 → pairs). */
function answerRight(actor: Actor) {
  const i = idx(actor)
  if (i === 0) actor.send({ type: 'RESPONSE', response: { kind: 'choice', value: 1 } })
  if (i === 1)
    actor.send({ type: 'RESPONSE', response: { kind: 'tiles', value: ['hello', 'friend'] } })
  if (i === 2)
    actor.send({
      type: 'RESPONSE',
      response: {
        kind: 'pairs',
        value: [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
      },
    })
  actor.send({ type: 'CHECK' })
}

function answerWrong(actor: Actor) {
  actor.send({ type: 'RESPONSE', response: { kind: 'choice', value: 0 } })
  if (idx(actor) === 1)
    actor.send({ type: 'RESPONSE', response: { kind: 'tiles', value: ['water'] } })
  actor.send({ type: 'CHECK' })
}

describe('lesson machine: happy path', () => {
  it('loads, preloads, then plays every challenge in order and completes', async () => {
    const preload = vi.fn(async () => {})
    const { actor, calls, tick } = run({ preload })
    expect(actor.getSnapshot().value).toBe('loading')
    await ready(actor)
    expect(preload).toHaveBeenCalledTimes(1)
    expect(calls.persisted).toHaveLength(1)

    for (const expected of [0, 1, 2]) {
      expect(idx(actor)).toBe(expected)
      tick(1500)
      answerRight(actor)
      expect(actor.getSnapshot().matches({ playing: 'feedback' })).toBe(true)
      expect(actor.getSnapshot().context.feedback?.verdict).toBe('correct')
      actor.send({ type: 'CONTINUE' })
    }
    await waitFor(actor, (s) => s.matches({ complete: 'summary' }))
    const ctx = actor.getSnapshot().context
    expect(ctx.summary).toMatchObject({ source: 'server', xp: 15 })
    expect(calls.sounds).toEqual(['correct', 'correct', 'correct', 'complete'])
    expect(calls.wrong).toEqual([])
    expect(calls.discarded).toEqual([ctx.session!.sessionId])
    const sent = calls.completed[0]!
    expect(sent.progress.answers.map((a) => [a.index, a.attemptSeq, a.verdict, a.ms])).toEqual([
      [0, 0, 'correct', 1500],
      [1, 1, 'correct', 1500],
      [2, 2, 'correct', 1500],
    ])
    expect(ctx.progress!.bestCombo).toBe(3)
  })

  it('CHECK does nothing until the renderer reports a response; RESPONSE null clears it', async () => {
    const { actor } = run()
    await ready(actor)
    actor.send({ type: 'CHECK' })
    expect(actor.getSnapshot().matches({ playing: 'answering' })).toBe(true)
    actor.send({ type: 'RESPONSE', response: { kind: 'choice', value: 1 } })
    actor.send({ type: 'RESPONSE', response: null })
    actor.send({ type: 'CHECK' })
    expect(actor.getSnapshot().matches({ playing: 'answering' })).toBe(true)
  })

  it('walks the complete sequence: summary → streak → daily goal → exit', async () => {
    const { actor, calls } = run()
    await ready(actor)
    for (let i = 0; i < 3; i++) {
      answerRight(actor)
      actor.send({ type: 'CONTINUE' })
    }
    await waitFor(actor, (s) => s.matches({ complete: 'summary' }))
    actor.send({ type: 'CONTINUE' })
    expect(actor.getSnapshot().matches({ complete: 'streak' })).toBe(true)
    expect(calls.sounds.at(-1)).toBe('streak')
    actor.send({ type: 'CONTINUE' })
    expect(actor.getSnapshot().matches({ complete: 'goal' })).toBe(true)
    actor.send({ type: 'CONTINUE' })
    expect(actor.getSnapshot().status).toBe('done')
    expect(actor.getSnapshot().context.exit).toBe('home')
  })

  it('skips the streak and goal screens when neither changed', async () => {
    const result = testResult({
      streak: { ...testResult().streak, extendedToday: false },
      dailyGoal: { xp: 40, goal: 20, met: true, justMet: false },
    })
    const { actor } = run({ complete: async () => ({ status: 'delivered', result }) })
    await ready(actor)
    for (let i = 0; i < 3; i++) {
      answerRight(actor)
      actor.send({ type: 'CONTINUE' })
    }
    await waitFor(actor, (s) => s.matches({ complete: 'summary' }))
    actor.send({ type: 'CONTINUE' })
    expect(actor.getSnapshot().status).toBe('done')
  })
})

describe('lesson machine: wrong answers, hearts and re-queue', () => {
  it('a wrong answer costs a heart, records an event and is re-queued at the end', async () => {
    const { actor, calls } = run()
    await ready(actor)
    answerWrong(actor) // challenge 0 wrong
    const s = actor.getSnapshot().context
    expect(s.feedback).toMatchObject({ index: 0, verdict: 'wrong', heartLost: true })
    expect(s.hearts!.count).toBe(4)
    expect(calls.wrong).toEqual([{ sessionId: s.session!.sessionId, attemptSeq: 0, index: 0 }])
    expect(calls.sounds).toEqual(['wrong'])
    expect(s.progress!.queue).toEqual([1, 2, 0])
    actor.send({ type: 'CONTINUE' })

    const order: number[] = []
    for (let i = 0; i < 3; i++) {
      order.push(idx(actor)!)
      answerRight(actor)
      actor.send({ type: 'CONTINUE' })
    }
    expect(order).toEqual([1, 2, 0])
    await waitFor(actor, (st) => st.matches('complete'))
    expect(
      calls.completed[0]!.progress.answers.map((a) => [a.index, a.attemptSeq, a.verdict]),
    ).toEqual([
      [0, 0, 'wrong'],
      [1, 1, 'correct'],
      [2, 2, 'correct'],
      [0, 3, 'correct'],
    ])
  })

  it('a retry that is wrong again gets a new attemptSeq and costs another heart', async () => {
    const { actor, calls } = run({
      start: async () => ({
        session: testSession({ challenges: testSession().challenges.slice(0, 1) }),
        resume: null,
      }),
    })
    await ready(actor)
    answerWrong(actor)
    actor.send({ type: 'CONTINUE' })
    expect(idx(actor)).toBe(0)
    answerWrong(actor)
    expect(calls.wrong.map((w) => w.attemptSeq)).toEqual([0, 1])
    expect(actor.getSnapshot().context.hearts!.count).toBe(3)
  })

  it('the combo resets on a wrong answer', async () => {
    const { actor } = run()
    await ready(actor)
    answerRight(actor)
    actor.send({ type: 'CONTINUE' })
    expect(actor.getSnapshot().context.progress!.combo).toBe(1)
    answerWrong(actor)
    expect(actor.getSnapshot().context.progress!.combo).toBe(0)
  })

  it('SKIP shows the solution and re-queues without costing a heart', async () => {
    const { actor, calls } = run()
    await ready(actor)
    actor.send({ type: 'SKIP' })
    const s = actor.getSnapshot().context
    expect(s.feedback).toMatchObject({ verdict: 'skipped', heartLost: false })
    expect(s.hearts!.count).toBe(5)
    expect(calls.wrong).toEqual([])
    expect(s.progress!.queue).toEqual([1, 2, 0])
  })

  it('practice never costs hearts or sends events', async () => {
    const { actor, calls } = run({
      start: async () => ({
        session: testSession({ kind: 'practice', levelId: null }),
        resume: null,
      }),
      input: { request: { courseId: 'fixture', kind: 'practice', levelId: null } },
    })
    await ready(actor)
    answerWrong(actor)
    expect(actor.getSnapshot().context.hearts!.count).toBe(5)
    expect(calls.wrong).toEqual([])
    expect(actor.getSnapshot().context.feedback!.heartLost).toBe(false)
  })

  it('unlimited hearts never run out', async () => {
    const { actor } = run({
      start: async () => ({ session: testSession({ lives: lives(0, 'unlimited') }), resume: null }),
    })
    await ready(actor)
    answerWrong(actor)
    actor.send({ type: 'CONTINUE' })
    expect(actor.getSnapshot().matches({ playing: 'answering' })).toBe(true)
  })

  it('losing the last heart leads to out-of-hearts after CONTINUE; practice or quit exits', async () => {
    const { actor, calls } = run({
      start: async () => ({ session: testSession({ lives: lives(1) }), resume: null }),
    })
    await ready(actor)
    answerWrong(actor)
    expect(actor.getSnapshot().context.hearts!.count).toBe(0)
    actor.send({ type: 'CONTINUE' })
    expect(actor.getSnapshot().value).toBe('outOfHearts')
    expect(calls.discarded).toHaveLength(1)
    actor.send({ type: 'PRACTICE' })
    expect(actor.getSnapshot().status).toBe('done')
    expect(actor.getSnapshot().context.exit).toBe('practice')
  })

  it('out_of_lives when creating the session goes straight to out-of-hearts', async () => {
    const { actor } = run({
      start: async () => {
        throw new CodedError('out_of_lives')
      },
    })
    await waitFor(actor, (s) => s.matches('outOfHearts'))
    actor.send({ type: 'QUIT' })
    expect(actor.getSnapshot().context.exit).toBe('home')
  })

  it('a matching mismatch costs a heart, records a wrong attempt and stays on the challenge', async () => {
    const { actor, calls } = run()
    await ready(actor)
    answerRight(actor)
    actor.send({ type: 'CONTINUE' })
    answerRight(actor)
    actor.send({ type: 'CONTINUE' })
    expect(idx(actor)).toBe(2)
    actor.send({ type: 'MISMATCH' })
    const s = actor.getSnapshot()
    expect(s.matches({ playing: 'answering' })).toBe(true)
    expect(s.context.hearts!.count).toBe(4)
    expect(calls.wrong).toEqual([
      { sessionId: s.context.session!.sessionId, attemptSeq: 2, index: 2 },
    ])
    expect(s.context.progress!.answers.at(-1)).toMatchObject({ index: 2, verdict: 'wrong' })
    expect(idx(actor)).toBe(2)
    answerRight(actor)
    expect(actor.getSnapshot().context.feedback!.attemptSeq).toBe(3)
  })

  it('a mismatch that spends the last heart goes to out-of-hearts', async () => {
    const { actor } = run({
      start: async () => ({
        session: testSession({ lives: lives(1), challenges: testSession().challenges.slice(2) }),
        resume: null,
      }),
    })
    await ready(actor)
    actor.send({ type: 'MISMATCH' })
    expect(actor.getSnapshot().value).toBe('outOfHearts')
  })

  it("applies the server's hearts only for the latest wrong attempt", async () => {
    const { actor } = run()
    await ready(actor)
    answerWrong(actor) // seq 0 → 4 hearts
    actor.send({ type: 'CONTINUE' })
    answerWrong(actor) // seq 1 → 3 hearts
    actor.send({ type: 'LIVES_SYNCED', lives: lives(4), attemptSeq: 0 })
    expect(actor.getSnapshot().context.hearts!.count).toBe(3)
    actor.send({ type: 'LIVES_SYNCED', lives: lives(2), attemptSeq: 1 })
    expect(actor.getSnapshot().context.hearts!.count).toBe(2)
  })
})

describe('lesson machine: quit, expiry, errors', () => {
  it('Escape/X opens the quit dialog; STAY returns to the same phase, CONFIRM_QUIT exits', async () => {
    const { actor, calls } = run()
    await ready(actor)
    answerWrong(actor)
    actor.send({ type: 'QUIT' })
    expect(actor.getSnapshot().value).toBe('quitConfirm')
    actor.send({ type: 'STAY' })
    expect(actor.getSnapshot().matches({ playing: 'feedback' })).toBe(true)
    actor.send({ type: 'QUIT' })
    actor.send({ type: 'CONFIRM_QUIT' })
    expect(actor.getSnapshot().status).toBe('done')
    expect(actor.getSnapshot().context.exit).toBe('home')
    expect(calls.discarded).toEqual([actor.getSnapshot().context.session!.sessionId])
  })

  it('an expired session (gone at completion) shows expired; RESTART loads a new session', async () => {
    let starts = 0
    const { actor } = run({
      start: async () => {
        starts++
        return {
          session: testSession({ challenges: testSession().challenges.slice(0, 1) }),
          resume: null,
        }
      },
      complete: async () => {
        throw new CodedError('gone')
      },
    })
    await ready(actor)
    answerRight(actor)
    actor.send({ type: 'CONTINUE' })
    await waitFor(actor, (s) => s.matches('expired'))
    actor.send({ type: 'RESTART' })
    await ready(actor)
    expect(starts).toBe(2)
    expect(actor.getSnapshot().context.progress!.answers).toEqual([])
  })

  it('EXPIRED from the outbox (an event got 410) interrupts play', async () => {
    const { actor } = run()
    await ready(actor)
    actor.send({ type: 'EXPIRED' })
    expect(actor.getSnapshot().value).toBe('expired')
  })

  it('a load failure shows the error state; RETRY loads again', async () => {
    let n = 0
    const { actor } = run({
      start: async () => {
        if (n++ === 0) throw new CodedError('network')
        return { session: testSession(), resume: null }
      },
    })
    await waitFor(actor, (s) => s.matches('error'))
    expect(actor.getSnapshot().context.error).toMatchObject({ code: 'network', during: 'load' })
    actor.send({ type: 'RETRY' })
    await ready(actor)
  })

  it('a completion failure that is not gone can be retried', async () => {
    let n = 0
    const { actor, calls } = run({
      start: async () => ({
        session: testSession({ challenges: testSession().challenges.slice(0, 1) }),
        resume: null,
      }),
      complete: async () => {
        if (n++ === 0) throw new CodedError('validation')
        return { status: 'delivered', result: testResult() }
      },
    })
    await ready(actor)
    answerRight(actor)
    actor.send({ type: 'CONTINUE' })
    await waitFor(actor, (s) => s.matches('error'))
    expect(actor.getSnapshot().context.error?.during).toBe('complete')
    actor.send({ type: 'RETRY' })
    await waitFor(actor, (s) => s.matches('complete'))
    expect(calls.completed).toHaveLength(2)
  })

  it('a preload failure never blocks the lesson', async () => {
    const { actor } = run({
      preload: async () => {
        throw new Error('404')
      },
    })
    await ready(actor)
  })
})

describe('lesson machine: resume and offline completion', () => {
  it('resumes at the saved queue, answers, hearts and start time', async () => {
    const session = testSession()
    let progress = initialProgress(session.challenges)
    progress = recordAttempt(progress, {
      index: 0,
      response: { kind: 'choice', value: 0 },
      verdict: 'wrong',
      ms: 900,
    }).progress
    progress = recordAttempt(progress, {
      index: 1,
      response: { kind: 'tiles', value: ['hello', 'friend'] },
      verdict: 'correct',
      ms: 900,
    }).progress
    const { actor, calls } = run({
      start: async () => ({ session, resume: { progress, hearts: lives(4), startedAt: 42 } }),
    })
    await ready(actor)
    const ctx = actor.getSnapshot().context
    expect(ctx.resumed).toBe(true)
    expect(ctx.hearts!.count).toBe(4)
    expect(ctx.startedAt).toBe(42)
    expect(idx(actor)).toBe(2)
    answerRight(actor)
    actor.send({ type: 'CONTINUE' })
    answerRight(actor) // the re-queued challenge 0
    actor.send({ type: 'CONTINUE' })
    await waitFor(actor, (s) => s.matches('complete'))
    expect(calls.completed[0]!.progress.answers.map((a) => a.attemptSeq)).toEqual([0, 1, 2, 3])
  })

  it('a resumed session with nothing left goes straight to completing', async () => {
    const session = testSession({ challenges: testSession().challenges.slice(0, 1) })
    const progress = recordAttempt(initialProgress(session.challenges), {
      index: 0,
      response: { kind: 'choice', value: 1 },
      verdict: 'correct',
      ms: 900,
    }).progress
    const { actor, calls } = run({
      start: async () => ({ session, resume: { progress, hearts: lives(5), startedAt: 1 } }),
    })
    await waitFor(actor, (s) => s.matches('complete'))
    expect(calls.completed).toHaveLength(1)
  })

  it('a resumed session with no hearts left shows out-of-hearts', async () => {
    const { actor } = run({
      start: async () => ({
        session: testSession(),
        resume: {
          progress: initialProgress(testSession().challenges),
          hearts: lives(0),
          startedAt: 1,
        },
      }),
    })
    await waitFor(actor, (s) => s.matches('outOfHearts'))
  })

  it('persists a snapshot after every graded attempt', async () => {
    const { actor, calls } = run()
    await ready(actor)
    answerWrong(actor)
    const last = calls.persisted.at(-1)!
    expect(last.progress.queue).toEqual([1, 2, 0])
    expect(last.hearts.count).toBe(4)
    expect(last.key).toBe('fixture|lesson|u01-s0')
  })

  it('offline completion shows a local summary, then reconciles with the server result', async () => {
    const getHome = () => ({
      streak: { current: 2, status: 'at_risk' as const, freezes: 0 },
      dailyGoal: { xp: 15, goal: 20, met: false },
    })
    const { actor } = run({
      start: async () => ({
        session: testSession({ challenges: testSession().challenges.slice(0, 1) }),
        resume: null,
      }),
      complete: async () => ({ status: 'queued' }),
      input: { getHome },
    })
    await ready(actor)
    answerRight(actor)
    actor.send({ type: 'CONTINUE' })
    await waitFor(actor, (s) => s.matches('complete'))
    expect(actor.getSnapshot().context.summary).toMatchObject({
      source: 'local',
      xp: 15,
      accuracy: 1,
      streak: { days: 3, extendedToday: true },
      dailyGoal: { xp: 30, goal: 20, justMet: true },
    })
    const other: SessionResult = testResult({ sessionId: '00000000-0000-4000-8000-000000000000' })
    actor.send({ type: 'RECONCILED', result: other })
    expect(actor.getSnapshot().context.summary!.source).toBe('local')
    actor.send({
      type: 'RECONCILED',
      result: testResult({ xp: { base: 10, bonus: 0, total: 10 } }),
    })
    expect(actor.getSnapshot().context.summary).toMatchObject({ source: 'server', xp: 10 })
  })
})
