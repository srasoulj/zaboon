import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Queryable } from '@zaboon/db'
import {
  contentCacheSize,
  currentVersion,
  requireCurrentVersion,
  resetContentCache,
} from './content'

// The database knows one published course, `fixture` (vi.mock is hoisted above the imports).
const lookup = vi.hoisted(() =>
  vi.fn(async (_q: unknown, courseId: string) =>
    courseId === 'fixture' ? { courseId, version: 3, bundlePath: 'fixture/v3' } : null,
  ),
)
vi.mock('@zaboon/db', () => ({ repos: { content: { getCurrentContentVersion: lookup } } }))

const q = {} as Queryable

beforeEach(() => {
  resetContentCache()
  lookup.mockClear()
})

describe('currentVersion cache', () => {
  it('does not cache misses: unknown course ids never grow the cache', async () => {
    for (let i = 0; i < 100; i++) expect(await currentVersion(q, `nope-${i}`)).toBeNull()
    expect(contentCacheSize()).toBe(0)
    // Nothing was remembered: asking again looks it up again.
    expect(await currentVersion(q, 'nope-0')).toBeNull()
    expect(lookup).toHaveBeenCalledTimes(101)
    await expect(requireCurrentVersion(q, 'nope-0')).rejects.toMatchObject({ code: 'not_found' })
    expect(contentCacheSize()).toBe(0)
  })

  it('caches hits', async () => {
    const fixture = { courseId: 'fixture', version: 3, bundlePath: 'fixture/v3' }
    expect(await currentVersion(q, 'fixture')).toEqual(fixture)
    expect(await currentVersion(q, 'fixture')).toEqual(fixture)
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(contentCacheSize()).toBe(1)
  })
})
