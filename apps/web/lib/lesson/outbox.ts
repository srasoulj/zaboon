/**
 * The offline-tolerant outbox for lesson writes (ARCHITECTURE §10.2, §12): wrong-attempt events and
 * session completion are stored first, then sent. Entries are idempotent on (sessionId, attemptSeq)
 * / sessionId, both locally (same id = one entry) and on the server (events `ON CONFLICT DO
 * NOTHING`, /complete replays the stored result), so retrying is always safe.
 *
 * Ordering is per session: a session's entries go in FIFO order, so its events always reach the
 * server before its completion, and a session that is stuck never blocks another one.
 *
 * Identity: an entry is only ever sent while its own user is signed in (the check is repeated before
 * every send, because the token is read at send time). Other users' entries are skipped, never
 * dropped, and an error that happens while the identity changed is never treated as permanent.
 * After a guest merges into an account, `retagUser` moves the guest's pending entries over.
 *
 * Failures:
 * - offline, 401, 426, 429: wait and retry (backoff, back online, next app start), however long;
 * - other retryable failures (5xx, unknown errors): retried up to MAX_ATTEMPTS times, then the entry
 *   is dead-lettered (kept, never sent again) and reported;
 * - permanent refusals (the session expired, was already completed, invalid): dropped and reported;
 * - a 2xx whose body doesn't parse: the server did the write, so it counts as delivered.
 */
import type { SessionEventResponse, SessionResult } from '@zaboon/contracts'
import type { z } from 'zod'
import { completeEntryId, eventEntryId, type OutboxEntry, type OutboxStore } from './stores'

type EventResponse = z.output<typeof SessionEventResponse>
type EntryOf<K extends OutboxEntry['kind']> = Extract<OutboxEntry, { kind: K }>

export interface OutboxSender {
  /** `userId` is the entry's owner: a sender must only send it with that user's token. */
  event(sessionId: string, body: EntryOf<'event'>['body'], userId: string): Promise<EventResponse>
  complete(
    sessionId: string,
    body: EntryOf<'complete'>['body'],
    userId: string,
  ): Promise<SessionResult>
}

export type OutboxDelivery =
  /** `response` is null when the server's answer could not be read. */
  | { type: 'event'; entry: EntryOf<'event'>; response: EventResponse | null }
  /** `result` is null when the server's answer could not be read. */
  | { type: 'complete'; entry: EntryOf<'complete'>; result: SessionResult | null }
  | { type: 'dropped'; entry: OutboxEntry; code: string; message: string }
  | { type: 'dead'; entry: OutboxEntry; code: string; message: string }

/** Retried for as long as it takes: the learner is offline, signed out or must update the app. */
const WAIT = new Set(['network', 'unauthorized', 'upgrade_required', 'rate_limited'])
/** Retried up to MAX_ATTEMPTS times. Unknown errors (no code) count here too. */
const RETRY = new Set(['internal'])
export const MAX_ATTEMPTS = 8
/** Entries of other users (and dead letters) older than this are pruned. */
export const STALE_ENTRY_MS = 30 * 24 * 3_600_000

/** The signed-in user (and so the token) is not the entry's owner: the entry waits for them. */
export const IDENTITY_MISMATCH = 'identity_mismatch'

export class IdentityMismatchError extends Error {
  readonly code = IDENTITY_MISMATCH
  constructor(message = 'the signed-in user is not the owner of this write') {
    super(message)
    this.name = 'IdentityMismatchError'
  }
}

export type FailureKind = 'blocked' | 'wait' | 'retry' | 'permanent'

export function classify(error: unknown): FailureKind {
  const code = errorCode(error)
  if (code === null) return 'retry'
  if (code === IDENTITY_MISMATCH) return 'blocked'
  if (WAIT.has(code)) return 'wait'
  if (RETRY.has(code)) return 'retry'
  return 'permanent'
}

/** A zod validation error: the client could not parse a successful (2xx) response. */
export function isResponseParseError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'ZodError' &&
    'issues' in error &&
    Array.isArray((error as { issues: unknown }).issues)
  )
}

function errorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string')
    return error.code
  return null
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

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
  /** The signed-in user, read before every send; entries of other users wait for them. */
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
  dead: number
  /** Entries left for later: waiting for the network/retry, or belonging to another user. */
  remaining: number
  /** True when a retryable failure happened (a retry is scheduled). */
  stalled: boolean
}

export type CompleteOutcome =
  | { status: 'delivered'; result: SessionResult }
  /** Stored by the server, but its answer could not be read. */
  | { status: 'saved' }
  | { status: 'queued' }

/** Groups entries by session, keeping FIFO order; a session's completion always goes last. */
export function bySession(entries: readonly OutboxEntry[]): OutboxEntry[][] {
  const groups = new Map<string, OutboxEntry[]>()
  for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
    const g = groups.get(e.sessionId) ?? []
    g.push(e)
    groups.set(e.sessionId, g)
  }
  return [...groups.values()].map((g) => [
    ...g.filter((e) => e.kind === 'event'),
    ...g.filter((e) => e.kind === 'complete'),
  ])
}

export class Outbox {
  private readonly store: OutboxStore
  private readonly send: OutboxSender
  private readonly currentUserId: () => string | null
  private readonly now: () => number
  private readonly schedule: (fn: () => void, ms: number) => () => void
  private readonly baseDelayMs: number
  private readonly maxDelayMs: number
  private readonly listeners = new Set<(d: OutboxDelivery) => void>()
  /** Outcomes of completions for submitComplete, cleared when a completion is (re)submitted. */
  private readonly outcomes = new Map<string, CompleteOutcome | OutboxPermanentError>()
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
    this.outcomes.delete(completeEntryId(sessionId))
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
   * Enqueues the completion and tries to deliver it now. Resolves with the server's result, `saved`
   * when the server stored it but its answer couldn't be read, or `queued` when it has to wait;
   * throws OutboxPermanentError when the server refused it for good (e.g. `gone`) or it was
   * dead-lettered.
   */
  async submitComplete(
    userId: string,
    sessionId: string,
    body: EntryOf<'complete'>['body'],
  ): Promise<CompleteOutcome> {
    const id = completeEntryId(sessionId)
    await this.enqueueComplete(userId, sessionId, body)
    await this.flush()
    const outcome = this.outcomes.get(id)
    this.outcomes.delete(id)
    if (outcome instanceof OutboxPermanentError) throw outcome
    return outcome ?? { status: 'queued' }
  }

  /** Sends pending entries. Concurrent calls share one run (then run once more). */
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
      } while (this.again)
      return report
    })()
    this.running = run
    void run.finally(() => {
      if (this.running === run) this.running = null
    })
    return run
  }

  private async flushOnce(): Promise<FlushReport> {
    const report: FlushReport = { delivered: 0, dropped: 0, dead: 0, remaining: 0, stalled: false }
    const live = (await this.store.list()).filter((e) => !e.dead)
    for (const session of bySession(live)) {
      for (let i = 0; i < session.length; i++) {
        const outcome = await this.sendOne(session[i]!, report)
        if (outcome === 'blocked') {
          // A session's later entries wait for its earlier ones (events before completion).
          report.remaining += session.length - i
          break
        }
      }
    }
    if (report.stalled) {
      this.failures++
      this.scheduleRetry()
    } else {
      // Nothing of the current user's is failing (other users' entries wait for their sign-in).
      this.failures = 0
      this.cancelRetry?.()
      this.cancelRetry = null
    }
    return report
  }

  /** Sends one entry; 'blocked' means it (and its session's later entries) stays for later. */
  private async sendOne(entry: OutboxEntry, report: FlushReport): Promise<'done' | 'blocked'> {
    if (this.currentUserId() !== entry.userId) return 'blocked'
    try {
      await this.deliver(entry)
    } catch (error) {
      if (isResponseParseError(error)) {
        this.delivered(entry, null)
      } else if (this.currentUserId() !== entry.userId) {
        return 'blocked' // the identity changed while sending: never blame the entry
      } else {
        const kind = classify(error)
        const code = errorCode(error) ?? 'internal'
        if (kind === 'blocked') return 'blocked' // waits for its user; not a failure
        if (kind === 'wait') {
          report.stalled = true
          return 'blocked'
        }
        if (kind === 'retry') {
          const attempts = entry.attempts + 1
          if (attempts < MAX_ATTEMPTS) {
            await this.store.update({ ...entry, attempts })
            report.stalled = true
            return 'blocked'
          }
          const dead = { code, message: messageOf(error), at: this.now() }
          await this.store.update({ ...entry, attempts, dead })
          report.dead++
          this.fail(entry, 'dead', code, dead.message)
          return 'done'
        }
        await this.store.remove(entry.id)
        report.dropped++
        this.fail(entry, 'dropped', code, messageOf(error))
        return 'done'
      }
    }
    await this.store.remove(entry.id)
    report.delivered++
    return 'done'
  }

  private async deliver(entry: OutboxEntry): Promise<void> {
    if (entry.kind === 'event')
      this.delivered(entry, await this.send.event(entry.sessionId, entry.body, entry.userId))
    else this.delivered(entry, await this.send.complete(entry.sessionId, entry.body, entry.userId))
  }

  private delivered(entry: OutboxEntry, answer: EventResponse | SessionResult | null): void {
    if (entry.kind === 'event')
      this.emit({ type: 'event', entry, response: answer as EventResponse | null })
    else {
      const result = answer as SessionResult | null
      this.outcomes.set(entry.id, result ? { status: 'delivered', result } : { status: 'saved' })
      this.emit({ type: 'complete', entry, result })
    }
  }

  private fail(entry: OutboxEntry, type: 'dropped' | 'dead', code: string, message: string) {
    if (entry.kind === 'complete')
      this.outcomes.set(entry.id, new OutboxPermanentError(code, message))
    this.emit({ type, entry, code, message })
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

  /**
   * Moves `fromUserId`'s pending entries to `toUserId` (a guest merged into an account: their
   * lesson writes now belong to the account). Returns how many entries were re-tagged.
   */
  async retagUser(fromUserId: string, toUserId: string): Promise<number> {
    if (fromUserId === toUserId) return 0
    let n = 0
    for (const e of await this.store.list())
      if (e.userId === fromUserId) {
        await this.store.update({ ...e, userId: toUserId, attempts: 0 })
        n++
      }
    return n
  }

  /** Removes dead letters and other users' entries older than `maxAgeMs`. */
  async prune(maxAgeMs = STALE_ENTRY_MS): Promise<number> {
    const cutoff = this.now() - maxAgeMs
    const user = this.currentUserId()
    let n = 0
    for (const e of await this.store.list())
      if (e.createdAt < cutoff && (e.dead || e.userId !== user)) {
        await this.store.remove(e.id)
        n++
      }
    return n
  }

  /** Entries still waiting (all users, dead letters included). */
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
