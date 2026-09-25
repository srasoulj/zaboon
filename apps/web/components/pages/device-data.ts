/**
 * Removes what this device holds for a user whose account was deleted: their mid-lesson snapshots
 * and their queued lesson writes (lib/lesson stores, owned by ws-player).
 *
 * - IndexedDB (the normal case): opens its own connection to the lesson database at its current
 *   version (the shared stores have already created and upgraded it), deletes that user's rows from
 *   both object stores in one transaction, and always closes the connection.
 * - In-memory fallback (IndexedDB missing or blocked): deletes the user's snapshots from the shared
 *   store. The shared Outbox's in-memory queue is private to it; that user's entries in it are never
 *   sent (the outbox only sends for the signed-in user, and the account no longer exists) and are
 *   gone on the next page load.
 */
import { openDB, type IDBPDatabase } from 'idb'
import { LESSON_DB } from '@/lib/lesson/idb'
import { MemorySnapshotStore, type SnapshotStore } from '@/lib/lesson/stores'

const LESSON_STORES = ['snapshots', 'outbox'] as const

export async function forgetLessonData(
  userId: string,
  snapshots: SnapshotStore,
  openLessonDb: () => Promise<IDBPDatabase> = () => openDB(LESSON_DB),
): Promise<void> {
  if (snapshots instanceof MemorySnapshotStore) {
    for (const [id, s] of snapshots.rows) if (s.userId === userId) snapshots.rows.delete(id)
    return
  }
  const db = await openLessonDb()
  try {
    const stores = LESSON_STORES.filter((name) => db.objectStoreNames.contains(name))
    if (stores.length === 0) return
    const tx = db.transaction(stores, 'readwrite')
    for (const name of stores)
      for (let c = await tx.objectStore(name).openCursor(); c; c = await c.continue())
        if ((c.value as { userId?: unknown }).userId === userId) await c.delete()
    await tx.done
  } finally {
    db.close()
  }
}
