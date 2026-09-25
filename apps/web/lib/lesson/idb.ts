/**
 * IndexedDB (via `idb`) implementations of the lesson stores. One database, two object stores:
 * `snapshots` (resume after reload, keyed by sessionId) and `outbox` (pending writes, keyed by their
 * idempotency id). Falls back to memory when IndexedDB is unavailable.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import {
  MemoryOutboxStore,
  MemorySnapshotStore,
  staleSnapshot,
  type LessonSnapshot,
  type OutboxEntry,
  type OutboxStore,
  type SnapshotStore,
} from './stores'

export const LESSON_DB = 'zaboon-lesson'
const VERSION = 1

interface LessonDb extends DBSchema {
  snapshots: {
    key: string
    value: LessonSnapshot
    indexes: { byLesson: [string, string] }
  }
  outbox: {
    key: string
    value: OutboxEntry
    indexes: { bySeq: number }
  }
}

function open(): Promise<IDBPDatabase<LessonDb>> {
  return openDB<LessonDb>(LESSON_DB, VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('snapshots')) {
        const s = db.createObjectStore('snapshots', { keyPath: 'sessionId' })
        s.createIndex('byLesson', ['userId', 'key'])
      }
      if (!db.objectStoreNames.contains('outbox')) {
        const o = db.createObjectStore('outbox', { keyPath: 'id' })
        o.createIndex('bySeq', 'seq')
      }
    },
  })
}

export class IdbSnapshotStore implements SnapshotStore {
  constructor(private readonly db: Promise<IDBPDatabase<LessonDb>>) {}
  async save(s: LessonSnapshot) {
    await (await this.db).put('snapshots', s)
  }
  async find(userId: string, key: string) {
    const rows = await (await this.db).getAllFromIndex('snapshots', 'byLesson', [userId, key])
    let best: LessonSnapshot | null = null
    for (const s of rows) if (!best || s.savedAt > best.savedAt) best = s
    return best
  }
  async remove(sessionId: string) {
    await (await this.db).delete('snapshots', sessionId)
  }
  async prune(savedBefore: number, now: number) {
    const tx = (await this.db).transaction('snapshots', 'readwrite')
    let n = 0
    for (let cursor = await tx.store.openCursor(); cursor; cursor = await cursor.continue())
      if (staleSnapshot(cursor.value, savedBefore, now)) {
        await cursor.delete()
        n++
      }
    await tx.done
    return n
  }
}

export class IdbOutboxStore implements OutboxStore {
  constructor(private readonly db: Promise<IDBPDatabase<LessonDb>>) {}
  async add(e: OutboxEntry) {
    const tx = (await this.db).transaction('outbox', 'readwrite')
    const exists = (await tx.store.getKey(e.id)) !== undefined
    if (!exists) await tx.store.add(e)
    await tx.done
    return !exists
  }
  async update(e: OutboxEntry) {
    const tx = (await this.db).transaction('outbox', 'readwrite')
    if ((await tx.store.getKey(e.id)) !== undefined) await tx.store.put(e)
    await tx.done
  }
  async remove(id: string) {
    await (await this.db).delete('outbox', id)
  }
  async list() {
    return (await this.db).getAllFromIndex('outbox', 'bySeq')
  }
}

export interface LessonStores {
  snapshots: SnapshotStore
  outbox: OutboxStore
  persistent: boolean
}

/** IndexedDB-backed stores, or in-memory ones when IndexedDB is missing or blocked. */
export async function openLessonStores(): Promise<LessonStores> {
  if (typeof indexedDB !== 'undefined') {
    try {
      const db = open()
      await db
      return {
        snapshots: new IdbSnapshotStore(db),
        outbox: new IdbOutboxStore(db),
        persistent: true,
      }
    } catch (e) {
      console.warn('[lesson] IndexedDB unavailable; progress will not survive a reload', e)
    }
  }
  return {
    snapshots: new MemorySnapshotStore(),
    outbox: new MemoryOutboxStore(),
    persistent: false,
  }
}
