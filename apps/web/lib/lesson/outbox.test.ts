import { describe, expect, it, vi } from 'vitest'
import { Outbox, OutboxPermanentError, type OutboxDelivery, type OutboxSender } from './outbox'
import { MemoryOutboxStore } from './stores'
import { lives, SESSION_ID, testResult, USER_ID } from './test-support'

class CodedError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

const COMPLETE_BODY = {
  answers: [
    {
      index: 0,
      attemptSeq: 0,
      response: { kind: 'choice' as const, value: 1 },
      verdict: 'correct' as const,
      ms: 900,
      hinted: false,
    },
  ],
  completedAt: '2026-09-25T10:00:00.000Z',
  graderVersion: 2,
}
const ev = (attemptSeq: number) => ({ attemptSeq, index: 0, kind: 'wrong' as const })

function setup(opts: { online?: () => boolean; user?: string | null } = {}) {
  const store = new MemoryOutboxStore()
  const log: string[] = []
  let online = opts.online ?? (() => true)
  const send: OutboxSender = {
    event: vi.fn(async (sessionId: string, body: { attemptSeq: number }) => {
      if (!online()) throw new CodedError('network')
      log.push(`event:${sessionId}:${body.attemptSeq}`)
      return { lives: lives(4), duplicate: false }
    }),
    complete: vi.fn(async (sessionId: string) => {
      if (!online()) throw new CodedError('network')
      log.push(`complete:${sessionId}`)
      return testResult()
    }),
  }
  const timers: { fn: () => void; ms: number }[] = []
  let clock = 1000
  const outbox = new Outbox({
    store,
    send,
    currentUserId: () => (opts.user === undefined ? USER_ID : opts.user),
    now: () => clock++,
    schedule: (fn, ms) => {
      const t = { fn, ms }
      timers.push(t)
      return () => timers.splice(timers.indexOf(t), 1)
    },
  })
  const deliveries: OutboxDelivery[] = []
  outbox.subscribe((d) => deliveries.push(d))
  return {
    store,
    send,
    log,
    outbox,
    timers,
    deliveries,
    setOnline: (f: () => boolean) => {
      online = f
    },
  }
}

describe('outbox', () => {
  it('sends entries FIFO and removes them once delivered', async () => {
    const { outbox, log, store } = setup()
    await outbox.enqueueEvent(USER_ID, SESSION_ID, ev(0))
    await outbox.enqueueEvent(USER_ID, SESSION_ID, ev(2))
    await outbox.enqueueComplete(USER_ID, SESSION_ID, COMPLETE_BODY)
    const report = await outbox.flush()
    expect(report).toEqual({ delivered: 3, dropped: 0, stalled: false, remaining: 0 })
    expect(log).toEqual([
      `event:${SESSION_ID}:0`,
      `event:${SESSION_ID}:2`,
      `complete:${SESSION_ID}`,
    ])
    expect(store.rows.size).toBe(0)
  })

  it('is idempotent by (sessionId, attemptSeq) and by sessionId for completion', async () => {
    const { outbox, store, log } = setup({ online: () => false })
    expect(await outbox.enqueueEvent(USER_ID, SESSION_ID, ev(1))).toBe(true)
    expect(await outbox.enqueueEvent(USER_ID, SESSION_ID, ev(1))).toBe(false)
    expect(await outbox.enqueueComplete(USER_ID, SESSION_ID, COMPLETE_BODY)).toBe(true)
    expect(await outbox.enqueueComplete(USER_ID, SESSION_ID, COMPLETE_BODY)).toBe(false)
    expect(store.rows.size).toBe(2)
    expect(log).toEqual([])
  })

  it('keeps entries while offline, backs off, and replays them in order when back online', async () => {
    const t = setup({ online: () => false })
    await t.outbox.enqueueEvent(USER_ID, SESSION_ID, ev(0))
    await t.outbox.enqueueComplete(USER_ID, SESSION_ID, COMPLETE_BODY)
    const r1 = await t.outbox.flush()
    expect(r1).toMatchObject({ stalled: true, delivered: 0, remaining: 2 })
    // the complete was never attempted: a session's events go first
    expect(t.send.complete).not.toHaveBeenCalled()
    expect(t.timers.map((x) => x.ms)).toEqual([1000])
    expect([...t.store.rows.values()][0]!.attempts).toBe(1)

    await t.outbox.flush()
    expect(t.timers.map((x) => x.ms)).toEqual([2000]) // exponential backoff, one timer at a time

    t.setOnline(() => true)
    t.timers[0]!.fn() // the retry timer fires
    await vi.waitFor(() => expect(t.store.rows.size).toBe(0))
    expect(t.log).toEqual([`event:${SESSION_ID}:0`, `complete:${SESSION_ID}`])
    expect(t.deliveries.map((d) => d.type)).toEqual(['event', 'complete'])
  })

  it('caps the backoff delay', async () => {
    const t = setup({ online: () => false })
    await t.outbox.enqueueEvent(USER_ID, SESSION_ID, ev(0))
    for (let i = 0; i < 12; i++) await t.outbox.flush()
    expect(t.outbox.retryDelay()).toBe(60_000)
  })

  it('submitComplete returns the server result when online', async () => {
    const { outbox } = setup()
    await expect(outbox.submitComplete(USER_ID, SESSION_ID, COMPLETE_BODY)).resolves.toEqual({
      status: 'delivered',
      result: testResult(),
    })
  })

  it('submitComplete reports queued when offline; the replay delivers the result later', async () => {
    const t = setup({ online: () => false })
    await expect(t.outbox.submitComplete(USER_ID, SESSION_ID, COMPLETE_BODY)).resolves.toEqual({
      status: 'queued',
    })
    t.setOnline(() => true)
    await t.outbox.flush()
    const d = t.deliveries.find((x) => x.type === 'complete')
    expect(d).toMatchObject({ type: 'complete', result: { sessionId: SESSION_ID } })
  })

  it('drops permanently refused entries and reports them; submitComplete throws', async () => {
    const t = setup()
    t.send.complete = vi.fn(async () => {
      throw new CodedError('gone')
    })
    t.send.event = vi.fn(async () => {
      throw new CodedError('conflict')
    })
    await t.outbox.enqueueEvent(USER_ID, SESSION_ID, ev(0))
    const err = await t.outbox
      .submitComplete(USER_ID, SESSION_ID, COMPLETE_BODY)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OutboxPermanentError)
    expect((err as OutboxPermanentError).code).toBe('gone')
    expect(t.store.rows.size).toBe(0)
    expect(t.deliveries.map((d) => (d.type === 'dropped' ? d.code : d.type))).toEqual([
      'conflict',
      'gone',
    ])
  })

  it.each(['network', 'internal', 'rate_limited', 'unauthorized'])(
    '%s is retried, not dropped',
    async (code) => {
      const t = setup()
      t.send.event = vi.fn(async () => {
        throw new CodedError(code)
      })
      await t.outbox.enqueueEvent(USER_ID, SESSION_ID, ev(0))
      await t.outbox.flush()
      expect(t.store.rows.size).toBe(1)
    },
  )

  it("only sends the signed-in user's entries", async () => {
    const t = setup({ user: 'someone-else' })
    await t.outbox.enqueueEvent(USER_ID, SESSION_ID, ev(0))
    const report = await t.outbox.flush()
    expect(report.delivered).toBe(0)
    expect(t.store.rows.size).toBe(1)
    const none = setup({ user: null })
    await none.outbox.enqueueEvent(USER_ID, SESSION_ID, ev(0))
    expect((await none.outbox.flush()).delivered).toBe(0)
  })

  it('concurrent flushes share one run and pick up entries added meanwhile', async () => {
    const t = setup()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const original = t.send.event
    t.send.event = vi.fn(
      async (sessionId: string, body: { attemptSeq: number; index: number; kind: 'wrong' }) => {
        await gate
        return original(sessionId, body)
      },
    )
    await t.outbox.enqueueEvent(USER_ID, SESSION_ID, ev(0))
    const a = t.outbox.flush()
    await t.outbox.enqueueEvent(USER_ID, SESSION_ID, ev(1))
    const b = t.outbox.flush()
    release()
    await Promise.all([a, b])
    expect(t.log).toEqual([`event:${SESSION_ID}:0`, `event:${SESSION_ID}:1`])
    expect(t.send.event).toHaveBeenCalledTimes(2)
  })

  it('a throwing listener does not break delivery', async () => {
    const t = setup()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    t.outbox.subscribe(() => {
      throw new Error('boom')
    })
    await t.outbox.enqueueEvent(USER_ID, SESSION_ID, ev(0))
    await t.outbox.flush()
    expect(t.store.rows.size).toBe(0)
    spy.mockRestore()
  })
})
