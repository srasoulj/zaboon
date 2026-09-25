/**
 * The offline-tolerant outbox for lesson writes (ARCHITECTURE §10.2, §12): wrong-attempt events and
 * session completion are stored first, then sent in FIFO order. Entries are idempotent on
 * (sessionId, attemptSeq) / sessionId, both locally (same id = one entry) and on the server (events
 * `ON CONFLICT DO NOTHING`, /complete replays the stored result), so retrying is always safe.
 *
 * A transient failure (offline, 5xx, 429, 401 before a token refresh) stops the flush, so a session's
 * events always reach the server before its completion; it is retried with backoff, when the browser
 * comes back online, and on the next app start. A permanent failure (the session expired, was already
 * completed, or the request is invalid) drops the entry and is reported to listeners.
 */
import type { SessionEventResponse, SessionResult } from '@zaboon/contracts'
import type { z } from 'zod'
import {
  completeEntryId,
  eventEntryId,
  type OutboxEntry,
  type OutboxStore,
} from './stores'

type EventResponse = z.output<typeof SessionEventResponse>
type EntryOf<K extends OutboxEntry['kind']> = Extract<OutboxEntry, { kind: K }>

export interface OutboxSender {
  event(sessionId: string, body: EntryOf<'event'>['body']): Promise<EventResponse>
  complete(sessionId: string, body: EntryOf<'complete'>['body']): Promise<SessionResult>
}

export type OutboxDelivery =
  | { type: 'event'; entry: EntryOf<'event'>; response: EventResponse }
  | { type: 'complete'; entry: EntryOf<'complete'>; result: SessionResult }
  | { type: 'dropped'; entry: OutboxEntry; code: string; message: string }

/** Error codes worth retrying; anything else is permanent for that entry. */
const TRANSIENT = new Set(['network', 'internal', 'rate_limited', 'unauthorized', 'upgrade_required'])

export function isTransient(error: unknown): boolean {
  const code = errorCode(error)
  return code === null || TRANSIENT.has(code)
}

function errorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string')
    return error.code
  return null
}

export class OutboxPermanentError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'OutboxPermanentError'
  }
}

export interface OutboxOptions {
  store: OutboxStore
  send: OutboxSender
  /** The signed-in user; entries of other users wait for them. */
  currentUserId: () => string | null
  now?: () => number
  /** Retry timer (injectable for tests). Returns a cancel function. */
  schedule?: (fn: () => void, ms: number) => () => void
  baseDelayMs?: number
  maxDelayMs?: number
}

export interface FlushReport {
  delivered: number
  dropped: number
  /** True when a transient failure stopped the flush (entries remain). */
  stalled: boolean
  remaining: number
}

export type CompleteOutcome = { status: 'delivered'; result: SessionResult } | { status: 'queued' }

export class Outbox {
  private readonly store: OutboxStore
  private readonly send: OutboxSender
  private readonly currentUserId: () => string | null
  private readonly now: () => number
  private readonly schedule: (fn: () => void, ms: number) => () => void
  private readonly baseDelayMs: number
  private readonly maxDelayMs: number
  private readonly listeners = new Set<(d: OutboxDelivery) => void>()
  private readonly completed = new Map<string, SessionResult>()
  private readonly droppedIds = new Map<string, OutboxPermanentError>()
  private running: Promise<FlushReport> | null = null
  private again = false
  private failures = 0
  private cancelRetry: (() => void) | null = null
  private counter = 0

  constructor(opts: OutboxOptions) {
    this.store = opts.store
    this.send = opts.send
    this.currentUserId = opts.currentUserId
    this.now = opts.now ?? Date.now
    this.schedule =
      opts.schedule ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms)
        return () => clearTimeout(t)
      })
    this.baseDelayMs = opts.baseDelayMs ?? 1_000
    this.maxDelayMs = opts.maxDelayMs ?? 60_000
  }

  subscribe(listener: (d: OutboxDelivery) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private nextSeq(): number {
    this.counter = (this.counter + 1) % 1000
    return this.now() * 1000 + this.counter
  }

  async enqueueEvent(
    userId: string,
    sessionId: string,
    body: EntryOf<'event'>['body'],
  ): Promise<boolean> {
    return this.store.add({
      id: eventEntryId(sessionId, body.attemptSeq),
      seq: this.nextSeq(),
      userId,
      sessionId,
      createdAt: this.now(),
      attempts: 0,
      kind: 'event',
      body,
    })
  }

  async enqueueComplete(
    userId: string,
    sessionId: string,
    body: EntryOf<'complete'>['body'],
  ): Promise<boolean> {
    return this.store.add({
      id: completeEntryId(sessionId),
      seq: this.nextSeq(),
      userId,
      sessionId,
      createdAt: this.now(),
      attempts: 0,
      kind: 'complete',
      body,
    })
  }

  /**
   * Enqueues the completion and tries to deliver it now. Resolves with the server's result, or
   * `queued` when it has to wait for the network; throws OutboxPermanentError when the server
   * refused it for good (e.g. `gone`: the session expired).
   */
  async submitComplete(
    userId: string,
    sessionId: string,
    body: EntryOf<'complete'>['body'],
  ): Promise<CompleteOutcome> {
    const id = completeEntryId(sessionId)
    await this.enqueueComplete(userId, sessionId, body)
    await this.flush()
    const result = this.completed.get(id)
    if (result) return { status: 'delivered', result }
    const dropped = this.droppedIds.get(id)
    if (dropped) throw dropped
    return { status: 'queued' }
  }

  /** Sends pending entries in FIFO order. Concurrent calls share one run (then run once more). */
  flush(): Promise<FlushReport> {
    if (this.running) {
      this.again = true
      return this.running
    }
    const run = (async () => {
      let report: FlushReport
      do {
        this.again = false
        report = await this.flushOnce()
      } while (this.again && !report.stalled)
      return report
    })()
    this.running = run
    void run.finally(() => {
      if (this.running === run) this.running = null
    })
    return run
  }

  private async flushOnce(): Promise<FlushReport> {
    const userId = this.currentUserId()
    const entries = userId ? (await this.store.list()).filter((e) => e.userId === userId) : []
    let delivered = 0
    let dropped = 0
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!
      try {
        await this.deliver(entry)
        await this.store.remove(entry.id)
        delivered++
      } catch (error) {
        if (isTransient(error)) {
          await this.store.update({ ...entry, attempts: entry.attempts + 1 })
          this.failures++
          this.scheduleRetry()
          return { delivered, dropped, stalled: true, remaining: entries.length - i }
        }
        await this.store.remove(entry.id)
        dropped++
        const code = errorCode(error) ?? 'internal'
        const message = error instanceof Error ? error.message : String(error)
        this.droppedIds.set(entry.id, new OutboxPermanentError(code, message))
        this.emit({ type: 'dropped', entry, code, message })
      }
    }
    this.failures = 0
    this.cancelRetry?.()
    this.cancelRetry = null
    return { delivered, dropped, stalled: false, remaining: 0 }
  }

  private async deliver(entry: OutboxEntry): Promise<void> {
    if (entry.kind === 'event') {
      const response = await this.send.event(entry.sessionId, entry.body)
      this.emit({ type: 'event', entry, response })
    } else {
      const result = await this.send.complete(entry.sessionId, entry.body)
      this.completed.set(entry.id, result)
      this.emit({ type: 'complete', entry, result })
    }
  }

  /** Exponential backoff: base · 2^(failures−1), capped. */
  retryDelay(): number {
    return Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** Math.max(0, this.failures - 1))
  }

  private scheduleRetry(): void {
    this.cancelRetry?.()
    this.cancelRetry = this.schedule(() => {
      this.cancelRetry = null
      void this.flush()
    }, this.retryDelay())
  }

  /** Entries still waiting (all users). */
  async pending(): Promise<OutboxEntry[]> {
    return this.store.list()
  }

  private emit(d: OutboxDelivery): void {
    for (const l of this.listeners) {
      try {
        l(d)
      } catch (e) {
        console.error('[outbox] listener failed', e)
      }
    }
  }

  dispose(): void {
    this.cancelRetry?.()
    this.cancelRetry = null
    this.listeners.clear()
  }
}
