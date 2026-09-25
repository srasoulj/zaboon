/** The IndexedDB stores on fake-indexeddb (a fresh database per test). */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openLessonStores, LESSON_DB } from './idb'
import { Outbox } from './outbox'
import { initialProgress } from './progress'
import { MemoryOutboxStore, type LessonSnapshot, type OutboxEntry } from './stores'
import { lives, SESSION_ID, testResult, testSession, USER_ID } from './test-support'

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const snapshot = (over: Partial<LessonSnapshot> = {}): LessonSnapshot => ({
  v: 1,
  sessionId: SESSION_ID,
  userId: USER_ID,
  key: 'fixture|lesson|u01-s0',
  session: testSession(),
  progress: initialProgress(testSession().challenges),
  hearts: lives(4),
  startedAt: 10,
  savedAt: 100,
  ...over,
})

const entry = (over: Partial<OutboxEntry> = {}): OutboxEntry =>
  ({
    id: `event:${SESSION_ID}:0`,
    seq: 1,
    userId: USER_ID,
    sessionId: SESSION_ID,
    createdAt: 1,
    attempts: 0,
    kind: 'event',
    body: { attemptSeq: 0, index: 0, kind: 'wrong' },
    ...over,
  }) as OutboxEntry

describe('IndexedDB lesson stores', () => {
  it('opens a persistent database with both stores', async () => {
    const stores = await openLessonStores()
    expect(stores.persistent).toBe(true)
    const names = await new Promise<string[]>((resolve) => {
      const req = indexedDB.open(LESSON_DB)
      req.onsuccess = () => {
        resolve([...req.result.objectStoreNames])
        req.result.close()
      }
    })
    expect(names.sort()).toEqual(['outbox', 'snapshots'])
  })

  it('falls back to memory stores without IndexedDB', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const stores = await openLessonStores()
    expect(stores.persistent).toBe(false)
    expect(stores.outbox).toBeInstanceOf(MemoryOutboxStore)
  })

  it('snapshots: save, find the newest per user and lesson, remove', async () => {
    const { snapshots, persistent } = await openLessonStores()
    expect(persistent).toBe(true)
    await snapshots.save(snapshot({ sessionId: 'a', savedAt: 1 }))
    await snapshots.save(snapshot({ sessionId: 'b', savedAt: 2 }))
    await snapshots.save(snapshot({ sessionId: 'c', savedAt: 3, userId: 'someone-else' }))
    await snapshots.save(snapshot({ sessionId: 'd', savedAt: 4, key: 'other' }))
    const found = await snapshots.find(USER_ID, 'fixture|lesson|u01-s0')
    expect(found?.sessionId).toBe('b')
    expect(found?.progress.queue).toEqual([0, 1, 2])
    expect(found?.hearts.count).toBe(4)
    await snapshots.remove('b')
    expect((await snapshots.find(USER_ID, 'fixture|lesson|u01-s0'))?.sessionId).toBe('a')
    await snapshots.save(snapshot({ sessionId: 'a', savedAt: 9, hearts: lives(1) })) // upsert
    expect((await snapshots.find(USER_ID, 'fixture|lesson|u01-s0'))?.hearts.count).toBe(1)
    expect(await snapshots.find(USER_ID, 'nope')).toBeNull()
  })

  it('snapshots: prune removes old and expired ones', async () => {
    const { snapshots } = await openLessonStores()
    const expired = testSession({ expiresAt: '2020-01-01T00:00:00.000Z' })
    await snapshots.save(snapshot({ sessionId: 'old', savedAt: 1 }))
    await snapshots.save(snapshot({ sessionId: 'expired', savedAt: 500, session: expired }))
    await snapshots.save(snapshot({ sessionId: 'fresh', savedAt: 500 }))
    expect(await snapshots.prune(100, Date.parse('2026-09-25T00:00:00Z'))).toBe(2)
    expect((await snapshots.find(USER_ID, 'fixture|lesson|u01-s0'))?.sessionId).toBe('fresh')
  })

  it('outbox: add is idempotent, update only touches existing entries, list is FIFO', async () => {
    const { outbox, persistent } = await openLessonStores()
    expect(persistent).toBe(true)
    expect(await outbox.add(entry({ id: 'b', seq: 2 }))).toBe(true)
    expect(await outbox.add(entry({ id: 'a', seq: 1 }))).toBe(true)
    expect(await outbox.add(entry({ id: 'a', seq: 3 }))).toBe(false)
    await outbox.update(entry({ id: 'a', seq: 1, attempts: 2 }))
    await outbox.update(entry({ id: 'missing', seq: 9 }))
    const rows = await outbox.list()
    expect(rows.map((e) => [e.id, e.attempts])).toEqual([
      ['a', 2],
      ['b', 0],
    ])
    await outbox.remove('a')
    expect((await outbox.list()).map((e) => e.id)).toEqual(['b'])
  })

  it('an Outbox on IndexedDB survives a reopen (a reload) and replays', async () => {
    const first = await openLessonStores()
    const offline = new Outbox({
      store: first.outbox,
      send: {
        event: async () => {
          throw Object.assign(new Error('offline'), { code: 'network' })
        },
        complete: async () => {
          throw Object.assign(new Error('offline'), { code: 'network' })
        },
      },
      currentUserId: () => USER_ID,
      schedule: () => () => {},
    })
    await offline.enqueueEvent(USER_ID, SESSION_ID, { attemptSeq: 0, index: 0, kind: 'wrong' })
    await offline.submitComplete(USER_ID, SESSION_ID, {
      answers: [
        {
          index: 0,
          attemptSeq: 1,
          response: { kind: 'skip' },
          verdict: 'skipped',
          ms: 5,
          hinted: false,
        },
      ],
      completedAt: '2026-09-25T10:00:00.000Z',
      graderVersion: 2,
    })

    const reopened = await openLessonStores() // same (fake) database, like after a reload
    const sent: string[] = []
    const online = new Outbox({
      store: reopened.outbox,
      send: {
        event: async (id, body) => {
          sent.push(`event:${id}:${body.attemptSeq}`)
          return { lives: lives(4), duplicate: false }
        },
        complete: async (id) => {
          sent.push(`complete:${id}`)
          return testResult()
        },
      },
      currentUserId: () => USER_ID,
    })
    expect((await online.flush()).delivered).toBe(2)
    expect(sent).toEqual([`event:${SESSION_ID}:0`, `complete:${SESSION_ID}`])
    expect(await reopened.outbox.list()).toEqual([])
  })
})
