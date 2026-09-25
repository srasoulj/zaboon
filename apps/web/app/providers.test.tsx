import { QueryClient } from '@tanstack/react-query'
import type { HomeResponse } from '@zaboon/contracts'
import { describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/lib/api-client'
import { applyMergedHome } from './providers'

const home = { merged: true } as unknown as HomeResponse
const sessionOf = (userId: string | null) => ({
  getSession: vi.fn(async () => (userId ? ({ userId } as never) : null)),
})

describe('applyMergedHome', () => {
  it('caches the merged home for the member who is still signed in', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    expect(await applyMergedHome(sessionOf('m1'), client, 'm1', home)).toBe(true)
    expect(client.getQueryData(queryKeys.home)).toBe(home)
    expect(invalidate).toHaveBeenCalled()
  })

  it('drops it when that member signed out or someone else signed in meanwhile', async () => {
    for (const now of [null, 'someone-else']) {
      const client = new QueryClient()
      expect(await applyMergedHome(sessionOf(now), client, 'm1', home)).toBe(false)
      expect(client.getQueryData(queryKeys.home)).toBeUndefined()
    }
  })
})
