/**
 * Persistence interfaces for the lesson player: machine snapshots (resume after reload) and the
 * outbox (offline-tolerant writes). `idb.ts` implements them on IndexedDB; the in-memory versions
 * here back the unit tests and browsers without IndexedDB (private modes), where the lesson still
 * works but does not survive a reload.
 */
import type {
  CompleteSessionRequest,
  CreateSessionResponse,
  LivesView,
  SessionEventRequest,
} from '@zaboon/contracts'
import type { z } from 'zod'
import type { Progress } from './progress'

// ---------------------------------------------------------------------------------------- snapshots
export interface LessonSnapshot {
  v: 1
  sessionId: string
  userId: string
  /** requestKey(): the lesson this session belongs to. */
  key: string
  session: CreateSessionResponse
  progress: Progress
  hearts: LivesView
  /** Epoch ms when the session started on this device (for the lesson time). */
  startedAt: number
  savedAt: number
}

export interface SnapshotStore {
  save(snapshot: LessonSnapshot): Promise<void>
  /** The most recently saved snapshot for this user and lesson, if any. */
  find(userId: string, key: string): Promise<LessonSnapshot | null>
  remove(sessionId: string): Promise<void>
  /** Removes snapshots saved before `savedBefore` or whose session expired before `now`. */
  prune(savedBefore: number, now: number): Promise<number>
}

export const staleSnapshot = (s: LessonSnapshot, savedBefore: number, now: number) =>
  s.savedAt < savedBefore || !(Date.parse(s.session.expiresAt) > now)

export class MemorySnapshotStore implements SnapshotStore {
  readonly rows = new Map<string, LessonSnapshot>()
  async save(s: LessonSnapshot) {
    this.rows.set(s.sessionId, structuredClone(s))
  }
  async find(userId: string, key: string) {
    let best: LessonSnapshot | null = null
    for (const s of this.rows.values())
      if (s.userId === userId && s.key === key && (!best || s.savedAt > best.savedAt)) best = s
    return best ? structuredClone(best) : null
  }
  async remove(sessionId: string) {
    this.rows.delete(sessionId)
  }
  async prune(savedBefore: number, now: number) {
    let n = 0
    for (const [id, s] of this.rows)
      if (staleSnapshot(s, savedBefore, now)) {
        this.rows.delete(id)
        n++
      }
    return n
  }
}

// ------------------------------------------------------------------------------------------- outbox
type EventBody = z.input<typeof SessionEventRequest>
type CompleteBody = z.input<typeof CompleteSessionRequest>

interface EntryBase {
  /** Idempotency key: `event:<sessionId>:<attemptSeq>` or `complete:<sessionId>`. */
  id: string
  /** FIFO order. */
  seq: number
  /** The user who created it; only their own entries are sent (ARCHITECTURE §10.2). */
  userId: string
  sessionId: string
  createdAt: number
  /**
   * Failed deliveries that count toward the dead-letter cap (Outbox MAX_ATTEMPTS). Network
   * failures don't count: an offline learner's writes wait as long as it takes.
   */
  attempts: number
  /** Set when the entry gave up after too many failures: kept for support, never sent again. */
  dead?: { code: string; message: string; at: number } | undefined
}

export type OutboxEntry =
  | (EntryBase & { kind: 'event'; body: EventBody })
  | (EntryBase & { kind: 'complete'; body: CompleteBody })

export interface OutboxStore {
  /** Inserts unless an entry with the same id exists; true when inserted. */
  add(entry: OutboxEntry): Promise<boolean>
  update(entry: OutboxEntry): Promise<void>
  remove(id: string): Promise<void>
  /** All entries in FIFO (seq) order. */
  list(): Promise<OutboxEntry[]>
}

export class MemoryOutboxStore implements OutboxStore {
  readonly rows = new Map<string, OutboxEntry>()
  async add(e: OutboxEntry) {
    if (this.rows.has(e.id)) return false
    this.rows.set(e.id, structuredClone(e))
    return true
  }
  async update(e: OutboxEntry) {
    if (this.rows.has(e.id)) this.rows.set(e.id, structuredClone(e))
  }
  async remove(id: string) {
    this.rows.delete(id)
  }
  async list() {
    return [...this.rows.values()].sort((a, b) => a.seq - b.seq).map((e) => structuredClone(e))
  }
}

export const eventEntryId = (sessionId: string, attemptSeq: number) =>
  `event:${sessionId}:${attemptSeq}`
export const completeEntryId = (sessionId: string) => `complete:${sessionId}`
