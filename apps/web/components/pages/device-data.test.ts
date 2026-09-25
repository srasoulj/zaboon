import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { describe, expect, it, vi } from 'vitest'
import { LESSON_DB, openLessonStores } from '@/lib/lesson/idb'
import { MemorySnapshotStore, type LessonSnapshot, type OutboxEntry } from '@/lib/lesson/stores'
import { forgetLessonData } from './device-data'

const GONE = 'user-deleted'
const KEPT = 'user-kept'

// Only the fields the stores index or key on matter here.
const snapshot = (userId: string, sessionId: string) =>
  ({
    v: 1,
    sessionId,
    userId,
    key: 'fixture|lesson|u01-s0',
    savedAt: 1,
  }) as unknown as LessonSnapshot
const entry = (userId: string, id: string, seq: number) =>
  ({
    id,
    userId,
    seq,
    kind: 'complete',
    sessionId: id,
    attempts: 0,
    createdAt: 1,
  }) as unknown as OutboxEntry

describe('forgetLessonData', () => {
  it("removes the user's snapshots and queued writes from IndexedDB and closes its connection", async () => {
    const stores = await openLessonStores()
    expect(stores.persistent).toBe(true)
    await stores.snapshots.save(snapshot(GONE, 's-gone-1'))
    await stores.snapshots.save(snapshot(GONE, 's-gone-2'))
    await stores.snapshots.save(snapshot(KEPT, 's-kept'))
    await stores.outbox.add(entry(GONE, 'complete:s-gone-1', 1))
    await stores.outbox.add(entry(KEPT, 'complete:s-kept', 2))

    const closed = vi.fn()
    await forgetLessonData(GONE, stores.snapshots, async () => {
      const db = await openDB(LESSON_DB)
      const close = db.close.bind(db)
      db.close = () => {
        closed()
        close()
      }
      return db
    })

    expect(closed).toHaveBeenCalledTimes(1)
    expect(await stores.snapshots.find(GONE, 'fixture|lesson|u01-s0')).toBeNull()
    expect(await stores.snapshots.find(KEPT, 'fixture|lesson|u01-s0')).toMatchObject({
      sessionId: 's-kept',
    })
    expect((await stores.outbox.list()).map((e) => e.userId)).toEqual([KEPT])
  })

  it('closes the connection even when the deletion fails', async () => {
    const stores = await openLessonStores()
    const closed = vi.fn()
    await expect(
      forgetLessonData(GONE, stores.snapshots, async () => {
        const db = await openDB(LESSON_DB)
        db.close = closed
        db.transaction = () => {
          throw new Error('boom')
        }
        return db
      }),
    ).rejects.toThrow('boom')
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('covers the in-memory fallback', async () => {
    const memory = new MemorySnapshotStore()
    await memory.save(snapshot(GONE, 'm-gone'))
    await memory.save(snapshot(KEPT, 'm-kept'))
    const open = vi.fn()
    await forgetLessonData(GONE, memory, open)
    expect([...memory.rows.keys()]).toEqual(['m-kept'])
    expect(open).not.toHaveBeenCalled()
  })
})
