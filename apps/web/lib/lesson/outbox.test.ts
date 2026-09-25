import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  bySession,
  classify,
  MAX_ATTEMPTS,
  Outbox,
  OutboxPermanentError,
  STALE_ENTRY_MS,
  type OutboxDelivery,
  type OutboxSender,
} from './outbox'
import { MemoryOutboxStore, type OutboxEntry } from './stores'
import { lives, SESSION_ID, testResult, USER_ID } from './test-support'

class CodedError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

const OTHER_SESSION = '7c1f2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f'
const OTHER_USER = '99999999-2222-4333-8444-555555555555'

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

/** A zod error, as the API client throws when a 2xx body does not match the contract. */
const parseError = () => {
  const r = z.object({ a: z.string() }).safeParse({})
  return r.success ? new Error('unreachable') : r.error
}

function setup(opts: { online?: () => boolean; user?: string | null } = {}) {
  const store = new MemoryOutboxStore()
  const log: string[] = []
  let online = opts.online ?? (() => true)
  let user: string | null = opts.user === undefined ? USER_ID : opts.user
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
    currentUserId: () => user,
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
    setUser: (u: string | null) => {
      user = u
    },
    advance: (ms: number) => {
      clock += ms
    },
  }
}

describe('outbox: delivery and ordering', () => {
  it('sends a session FIFO (events, then completion) and removes delivered entries', async () => {
    const { outbox, log, store } = setup()
    await outbox.enqueueEvent(USER_ID, SESSION_ID, ev(0))
    await outbox.enqueueEvent(USER_ID, SESSION_ID, ev(2))
    await outbox.enqueueComplete(USER_ID, SESSION_ID, COMPLETE_BODY)
    const report = await outbox.flush()
    expect(report).toEqual({ delivered: 3, dropped: 0, dead: 0, stalled: false, remaining: 0 })
    expect(log).toEqual([
      `event:${SESSION_ID}:0`,
      `event:${SESSION_ID}:2`,
      `complete:${SESSION_ID}`,
    ])
    expect(store.rows.size).toBe(0)
  })

  it("puts a session's completion after its events even if it was stored first", () => {
    const base = { userId: USER_ID, createdAt: 0, attempts: 0 }
    const entries: OutboxEntry[] = [
      { ...base, id: 'c', seq: 1, sessionId: 'a', kind: 'complete', body: COMPLETE_BODY },
      { ...base, id: 'e', seq: 2, sessionId: 'a', kind: 'event', body: ev(0) },
      { ...base, id: 'x', seq: 3, sessionId: 'b', kind: 'event', body: ev(0) },
    ]
    expect(bySession(entries).map((g) => g.map((e) => e.id))).toEqual([['e', 'c'], ['x']])
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

  it('keeps entries while offline (without counting toward the cap), backs off, replays in order', async () => {
    const t = setup({ online: () => false })
    await t.outbox.enqueueEvent(USER_ID, SESSION_ID, ev(0))
    await t.outbox.enqueueComplete(USER_ID, SESSION_ID, COMPLETE_BODY)
    const r1 = await t.outbox.flush()
    expect(r1).toMatchObject({ stalled: true, delivered: 0, remaining: 2 })
    // the complete was never attempted: a session's events go first
    expect(t.send.complete).not.toHaveBeenCalled()
    expect(t.timers.map((x) => x.ms)).toEqual([1000])
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) await t.outbox.flush()
    expect([...t.store.rows.values()].map((e) => [e.attempts, e.dead])).toEqual([
      [0, undefined],
      [0, undefined],
    ])
    expect(t.timers).toHaveLength(1) // one timer at a time

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

  it('a stuck session never blocks another session', async () => {
    const t = setup()
    t.send.event = vi.fn(async (sessionId: string, body: { attemptSeq: number }) => {
      if (sessionId === SESSION_ID) throw new CodedError('internal')
      t.log.push(`event:${sessionId}:${body.attemptSeq}`)
      return { lives: lives(4), duplicate: false }
    })
    await t.outbox.enqueueEvent(USER_ID, SESSION_ID, ev(0))
    await t.outbox.enqueueComplete(USER_ID, SESSION_ID, COMPLETE_BODY)
    await t.outbox.enqueueEvent(USER_ID, OTHER_SESSION, ev(0))
    await t.outbox.enqueueComplete(USER_ID, OTHER_SESSION, COMPLETE_BODY)
    const report = await t.outbox.flush()
    expect(report).toMatchObject({ delivered: 2, stalled: true, remaining: 2 })
    expect(t.log).toEqual([`event:${OTHER_SESSION}:0`, `complete:${OTHER_SESSION}`])
    expect(t.send.complete).toHaveBeenCalledTimes(1) // the stuck session's completion waits
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

  it('a 2xx whose body does not parse counts as delivered', async () => {
    const t = setup()
    t.send.event = vi.fn(async () => {
      throw parseError()
    })
    t.send.complete = vi.fn(async () => {
      throw parseError()
    })
    await t.outbox.enqueueEvent(USER_ID, SESSION_ID, ev(0))
    await expect(t.outbox.submitComplete(USER_ID, SESSION_ID, COMPLETE_BODY)).resolves.toEqual({
      status: 'saved',
    })
    expect(t.store.rows.size).toBe(0)
    expect(t.deliveries).toMatchObject([
      { type: 'event', response: null },
      { type: 'complete', result: null },
    ])
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

describe('outbox: failures', () => {
  it('classifies errors', () => {
    for (const c of ['network', 'unauthorized', 'upgrade_required', 'rate_limited'])
      expect(classify(new CodedError(c))).toBe('wait')
    expect(classify(new CodedError('internal'))).toBe('retry')
    expect(classify(new Error('no code'))).toBe('retry')
    for (const c of ['gone', 'conflict', 'validation', 'not_found', 'forbidden'])
      expect(classify(new CodedError(c))).toBe('permanent')
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

  it.each(['network', 'unauthorized', 'rate_limited', 'upgrade_required'])(
    '%s waits and never gives up',
    async (code) => {
      const t = setup()
      t.send.event = vi.fn(async () => {
        throw new CodedError(code)
      })
      await t.outbox.enqueueEvent(USER_ID, SESSION_ID, ev(0))
      for (let i = 0; i < MAX_ATTEMPTS * 2; i++) await t.outbox.flush()
      const entry = [...t.store.rows.values()][0]!
      expect([entry.attempts, entry.dead]).toEqual([0, undefined])
    },
  )

  it(`a repeating server error is retried ${MAX_ATTEMPTS} times, then dead-lettered and reported`, async () => {
    const t = setup()
    t.send.complete = vi.fn(async () => {
      throw new Error('500 with no code')
    })
    await t.outbox.enqueueComplete(USER_ID, SESSION_ID, COMPLETE_BODY)
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      await t.outbox.flush()
      expect([...t.store.rows.values()][0]!.attempts).toBe(i)
    }
    const report = await t.outbox.flush()
    expect(report).toMatchObject({ dead: 1, stalled: false })
    const entry = [...t.store.rows.values()][0]!
    expect(entry.dead).toMatchObject({ code: 'internal', message: '500 with no code' })
    expect(t.deliveries.at(-1)).toMatchObject({ type: 'dead', code: 'internal' })
    // kept for support, but never sent again
    await t.outbox.flush()
    expect(t.send.complete).toHaveBeenCalledTimes(MAX_ATTEMPTS)
  })

  it('a resubmitted completion does not see the previous attempt outcome', async () => {
    const t = setup()
    t.send.complete = vi.fn(async () => {
      throw new CodedError('validation')
    })
    await expect(
      t.outbox.submitComplete(USER_ID, SESSION_ID, COMPLETE_BODY),
    ).rejects.toBeInstanceOf(OutboxPermanentError)
    t.setOnline(() => false)
    t.send.complete = vi.fn(async () => {
      throw new CodedError('network')
    })
    await expect(t.outbox.submitComplete(USER_ID, SESSION_ID, COMPLETE_BODY)).resolves.toEqual({
      status: 'queued',
    })
  })
})

describe('outbox: identity', () => {
  it("only sends the signed-in user's entries and never drops another user's", async () => {
    const t = setup({ user: OTHER_USER })
    await t.outbox.enqueueEvent(USER_ID, SESSION_ID, ev(0))
    const report = await t.outbox.flush()
    expect(report).toMatchObject({ delivered: 0, dropped: 0, remaining: 1, stalled: false })
    expect(t.send.event).not.toHaveBeenCalled()
    t.setUser(null)
    expect((await t.outbox.flush()).delivered).toBe(0)
    t.setUser(USER_ID)
    expect((await t.outbox.flush()).delivered).toBe(1)
  })

  it('re-checks the user before every entry (the token is read at send time)', async () => {
    const t = setup()
    const original = t.send.event
    t.send.event = vi.fn(
      async (sessionId: string, body: { attemptSeq: number; index: number; kind: 'wrong' }) => {
        const r = await original(sessionId, body)
        t.setUser(OTHER_USER) // signed out / switched after the first send
        return r
      },
    )
    await t.outbox.enqueueEvent(USER_ID, SESSION_ID, ev(0))
    await t.outbox.enqueueEvent(USER_ID, OTHER_SESSION, ev(0))
    const report = await t.outbox.flush()
    expect(report).toMatchObject({ delivered: 1, remaining: 1 })
    expect(t.send.event).toHaveBeenCalledTimes(1)
  })

  it('an error while the identity changed is never permanent (the entry is kept)', async () => {
    const t = setup()
    t.send.complete = vi.fn(async () => {
      t.setUser(OTHER_USER)
      throw new CodedError('not_found') // user A's session sent with user B's token
    })
    await t.outbox.enqueueComplete(USER_ID, SESSION_ID, COMPLETE_BODY)
    const report = await t.outbox.flush()
    expect(report).toMatchObject({ dropped: 0, remaining: 1 })
    expect(t.store.rows.size).toBe(1)
    expect(t.deliveries).toEqual([])
    expect([...t.store.rows.values()][0]!.attempts).toBe(0)
  })

  it('retagUser moves a guest’s pending entries to the account they merged into', async () => {
    const t = setup({ user: OTHER_USER })
    await t.outbox.enqueueEvent(USER_ID, SESSION_ID, ev(0))
    await t.outbox.enqueueComplete(USER_ID, SESSION_ID, COMPLETE_BODY)
    await t.outbox.enqueueEvent(OTHER_USER, OTHER_SESSION, ev(0))
    expect(await t.outbox.retagUser(USER_ID, OTHER_USER)).toBe(2)
    expect(await t.outbox.retagUser(USER_ID, USER_ID)).toBe(0)
    expect([...t.store.rows.values()].every((e) => e.userId === OTHER_USER)).toBe(true)
    expect((await t.outbox.flush()).delivered).toBe(3)
  })

  it("prunes old dead letters and other users' old entries, never the current user's", async () => {
    const t = setup()
    await t.outbox.enqueueEvent(USER_ID, SESSION_ID, ev(0))
    await t.outbox.enqueueEvent(OTHER_USER, OTHER_SESSION, ev(0))
    await t.store.add({
      id: 'dead',
      seq: 1,
      userId: USER_ID,
      sessionId: 'x',
      createdAt: 0,
      attempts: MAX_ATTEMPTS,
      dead: { code: 'internal', message: 'x', at: 0 },
      kind: 'event',
      body: ev(9),
    })
    t.advance(STALE_ENTRY_MS + 10)
    await t.outbox.enqueueEvent(OTHER_USER, OTHER_SESSION, ev(5)) // recent: kept
    expect(await t.outbox.prune()).toBe(2)
    expect([...t.store.rows.keys()].sort()).toEqual(
      [`event:${OTHER_SESSION}:5`, `event:${SESSION_ID}:0`].sort(),
    )
  })
})
