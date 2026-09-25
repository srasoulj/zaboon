/**
 * The parked guest merge (identity.ts) and its notice: no loss window, no resurrection after a
 * sign-out, one request per device at a time (Web Locks, or a single-flight fallback).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/lib/api-client'
import { AppServicesProvider } from '@/lib/app-services'
import * as identity from './identity'
import { MergeDroppedNotice } from './MergeDroppedNotice'
import {
  GUEST_ID,
  MEMBER_ID,
  apiError,
  fakeApi,
  fakeAuth,
  fakeOutbox,
  home,
  session,
} from './test-support'

const { MERGE_DROPPED_KEY, PENDING_MERGE_KEY } = identity
const GUEST = session()
const MEMBER = session({
  userId: MEMBER_ID,
  isAnonymous: false,
  email: 'sara@example.com',
  accessToken: `member-token-${'m'.repeat(24)}`,
})

/** A minimal Web Locks manager with `ifAvailable` semantics (jsdom has none). */
function fakeLocks() {
  const held = new Set<string>()
  return {
    async request<T>(
      name: string,
      _opts: { ifAvailable: true },
      cb: (lock: unknown) => Promise<T>,
    ): Promise<T> {
      if (held.has(name)) return cb(null)
      held.add(name)
      try {
        return await cb({ name })
      } finally {
        held.delete(name)
      }
    },
  }
}

function park(over: Record<string, unknown> = {}) {
  localStorage.setItem(
    PENDING_MERGE_KEY,
    JSON.stringify({
      guestToken: GUEST.accessToken,
      guestUserId: GUEST_ID,
      expiresAt: Date.now() + 60_000,
      nonce: 'n1',
      ...over,
    }),
  )
}

const stored = () => localStorage.getItem(PENDING_MERGE_KEY)
const dropped = () => localStorage.getItem(MERGE_DROPPED_KEY)

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

for (const mode of ['web locks', 'single-flight fallback'] as const) {
  describe(`completePendingMerge (${mode})`, () => {
    // Each test is a fresh page load: a fresh module (and its single-flight state).
    let mod: typeof identity
    beforeEach(async () => {
      if (mode === 'web locks') vi.stubGlobal('navigator', { ...navigator, locks: fakeLocks() })
      else expect((navigator as { locks?: unknown }).locks).toBeUndefined()
      vi.resetModules()
      mod = await import('./identity')
    })

    it('a StrictMode double run sends exactly one request', async () => {
      park()
      const fake = fakeApi({ mergeAccount: async () => ({ merged: true, home: home() }) })
      const deps = { auth: fakeAuth(MEMBER), api: fake.api, outbox: fakeOutbox([]) }
      const results = await Promise.all([
        mod.completePendingMerge(deps),
        mod.completePendingMerge(deps),
      ])
      expect(fake.called('mergeAccount')).toHaveLength(1)
      expect(results.filter((r) => r !== null)).toHaveLength(1)
      expect(stored()).toBeNull()
    })

    it('keeps the entry while the request runs, so a tab that dies mid-request loses nothing', async () => {
      park()
      const never = deferred<never>()
      const dying = fakeApi({ mergeAccount: () => never.promise })
      void mod.completePendingMerge({
        auth: fakeAuth(MEMBER),
        api: dying.api,
        outbox: fakeOutbox([]),
      })
      await vi.waitFor(() => expect(dying.called('mergeAccount')).toHaveLength(1))
      expect(stored()).toContain(GUEST.accessToken)

      // The tab is gone; the next load (a fresh module, a fresh lock) retries the same entry.
      vi.resetModules()
      if (mode === 'web locks') vi.stubGlobal('navigator', { ...navigator, locks: fakeLocks() })
      const fresh = await import('./identity')
      const next = fakeApi({ mergeAccount: async () => ({ merged: true, home: home() }) })
      expect(
        await fresh.completePendingMerge({
          auth: fakeAuth(MEMBER),
          api: next.api,
          outbox: fakeOutbox([]),
        }),
      ).toEqual(home())
      expect(next.called('mergeAccount')).toEqual([{ body: { guestToken: GUEST.accessToken } }])
      expect(stored()).toBeNull()
    })

    it('a transient failure leaves the entry for the next load, without a notice', async () => {
      park()
      let fail = true
      const fake = fakeApi({
        mergeAccount: () => {
          if (fail) throw new ApiClientError('network', 0, 'offline')
          return { merged: true, home: home() }
        },
      })
      const deps = { auth: fakeAuth(MEMBER), api: fake.api, outbox: fakeOutbox([]) }
      expect(await mod.completePendingMerge(deps)).toBeNull()
      expect(stored()).toContain(GUEST.accessToken)
      expect(dropped()).toBeNull()
      fail = false
      expect(await mod.completePendingMerge(deps)).toEqual(home())
      expect(stored()).toBeNull()
    })

    it('a sign-out during an in-flight transient failure wins: nothing is restored', async () => {
      park()
      const req = deferred<never>()
      const fake = fakeApi({ mergeAccount: () => req.promise })
      const auth = fakeAuth(MEMBER)
      const run = mod.completePendingMerge({ auth, api: fake.api, outbox: fakeOutbox([]) })
      await vi.waitFor(() => expect(fake.called('mergeAccount')).toHaveLength(1))
      await mod.leaveThenSignOut({ auth, navigate: () => {}, currentPath: () => '/' })
      req.reject(apiError('internal', 500))
      expect(await run).toBeNull()
      expect(stored()).toBeNull()
      expect(dropped()).toBeNull()
    })

    it('a newer entry saved during the request is left alone, even on a permanent refusal', async () => {
      park()
      const req = deferred<never>()
      const fake = fakeApi({ mergeAccount: () => req.promise })
      const run = mod.completePendingMerge({
        auth: fakeAuth(MEMBER),
        api: fake.api,
        outbox: fakeOutbox([]),
      })
      await vi.waitFor(() => expect(fake.called('mergeAccount')).toHaveLength(1))
      park({ guestToken: `newer-guest-${'z'.repeat(24)}`, nonce: 'n2' })
      req.reject(apiError('forbidden', 403))
      await run
      expect(stored()).toContain('newer-guest-')
      expect(dropped()).toBeNull()
    })

    it('a permanent refusal removes the entry and notes it for that member', async () => {
      for (const code of ['unauthorized', 'forbidden', 'validation'] as const) {
        localStorage.clear()
        park()
        const fake = fakeApi({
          mergeAccount: () => {
            throw apiError(code, 400)
          },
        })
        await mod.completePendingMerge({
          auth: fakeAuth(MEMBER),
          api: fake.api,
          outbox: fakeOutbox([]),
        })
        expect(stored(), code).toBeNull()
        expect(mod.droppedMergeFor(dropped()), code).toBe(MEMBER_ID)
      }
    })

    it('an expired guest token is dropped without calling the server', async () => {
      park({ expiresAt: Date.now() - 1 })
      const fake = fakeApi({})
      expect(
        await mod.completePendingMerge({
          auth: fakeAuth(MEMBER),
          api: fake.api,
          outbox: fakeOutbox([]),
        }),
      ).toBeNull()
      expect(fake.calls).toEqual([])
      expect(stored()).toBeNull()
      expect(mod.droppedMergeFor(dropped())).toBe(MEMBER_ID)
    })

    it('does nothing for a guest or when signed out', async () => {
      park()
      const fake = fakeApi({})
      for (const auth of [fakeAuth(GUEST), fakeAuth(null)])
        await mod.completePendingMerge({ auth, api: fake.api, outbox: fakeOutbox([]) })
      expect(fake.calls).toEqual([])
      expect(stored()).toContain(GUEST.accessToken)
    })
  })
}

describe('signInAndMerge (local mode)', () => {
  it('parks a merge that failed for a transient reason and surfaces the error', async () => {
    const fake = fakeApi({
      mergeAccount: () => {
        throw apiError('internal', 500)
      },
    })
    const err = await identity
      .signInAndMerge({ auth: fakeAuth(GUEST), api: fake.api, outbox: fakeOutbox([]) }, 's@x.io')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(identity.MergeFailedError)
    expect((err as identity.MergeFailedError).willRetry).toBe(true)
    expect(stored()).toContain(GUEST.accessToken)
    expect(JSON.parse(stored()!)).toMatchObject({
      expiresAt: GUEST.expiresAt,
      nonce: expect.any(String),
    })
  })

  it('does not park a refused merge', async () => {
    const fake = fakeApi({
      mergeAccount: () => {
        throw apiError('forbidden', 403)
      },
    })
    const err = await identity
      .signInAndMerge({ auth: fakeAuth(GUEST), api: fake.api, outbox: fakeOutbox([]) }, 's@x.io')
      .catch((e: unknown) => e)
    expect((err as identity.MergeFailedError).willRetry).toBe(false)
    expect(stored()).toBeNull()
  })
})

describe('MergeDroppedNotice', () => {
  function renderNotice(auth = fakeAuth(MEMBER)) {
    return render(
      <AppServicesProvider auth={auth} api={fakeApi({}).api}>
        <MergeDroppedNotice />
      </AppServicesProvider>,
    )
  }

  it('appears when a drop is noted in this tab, for that member only, and can be dismissed', async () => {
    park({ expiresAt: Date.now() - 1 })
    renderNotice()
    expect(screen.queryByTestId('merge-dropped')).toBeNull()
    await act(async () => {
      await identity.completePendingMerge({
        auth: fakeAuth(MEMBER),
        api: fakeApi({}).api,
        outbox: fakeOutbox([]),
      })
    })
    expect(await screen.findByTestId('merge-dropped')).toHaveTextContent(/as a guest/)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('merge-dropped')).toBeNull()
    expect(dropped()).toBeNull()
  })

  it('is not shown to another member or a guest', async () => {
    localStorage.setItem(MERGE_DROPPED_KEY, JSON.stringify({ userId: 'someone-else' }))
    renderNotice()
    await act(async () => {})
    expect(screen.queryByTestId('merge-dropped')).toBeNull()
    cleanup()
    localStorage.setItem(MERGE_DROPPED_KEY, JSON.stringify({ userId: GUEST_ID }))
    renderNotice(fakeAuth(GUEST))
    await act(async () => {})
    expect(screen.queryByTestId('merge-dropped')).toBeNull()
  })

  it('follows other tabs (storage event) and disappears on sign-out', async () => {
    const auth = fakeAuth(MEMBER)
    renderNotice(auth)
    await act(async () => {
      localStorage.setItem(MERGE_DROPPED_KEY, JSON.stringify({ userId: MEMBER_ID }))
      window.dispatchEvent(new StorageEvent('storage', { key: MERGE_DROPPED_KEY }))
    })
    expect(await screen.findByTestId('merge-dropped')).toBeInTheDocument()
    await act(async () => {
      await identity.leaveThenSignOut({ auth, navigate: () => {}, currentPath: () => '/' })
    })
    expect(screen.queryByTestId('merge-dropped')).toBeNull()
    expect(dropped()).toBeNull()
  })
})
