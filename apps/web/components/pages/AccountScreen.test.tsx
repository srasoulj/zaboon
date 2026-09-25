import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { ApiClientError } from '@/lib/api-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountScreen } from './AccountScreen'
import {
  MERGE_DROPPED_KEY,
  MergeFailedError,
  OUTBOX_BLOCKED_MESSAGE,
  PENDING_MERGE_KEY,
  completePendingMerge,
  leaveThenSignOut,
  ensureOutboxDelivered,
  signInAndMerge,
} from './identity'
import {
  GUEST_ID,
  MEMBER_ID,
  apiError,
  fakeApi,
  fakeAuth,
  fakeOutbox,
  home,
  renderWith,
  session,
  type FakeAuth,
} from './test-support'

beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

// fakeOutbox logs `flush:<first 4 chars of the user id>`.
const FLUSH_GUEST = `flush:${GUEST_ID.slice(0, 4)}`
const FLUSH_MEMBER = `flush:${MEMBER_ID.slice(0, 4)}`
const GUEST = session()
const MEMBER = session({
  userId: MEMBER_ID,
  isAnonymous: false,
  email: 'sara@example.com',
  accessToken: `member-token-${'m'.repeat(24)}`,
})

function setup(opts: { auth?: FakeAuth; waiting?: number | 'throws'; merge?: () => unknown }) {
  const auth = opts.auth ?? fakeAuth(GUEST)
  const merged = home({ xpTotal: 250 })
  const fake = fakeApi({
    mergeAccount: (o) => {
      auth.calls.push('merge')
      return opts.merge ? opts.merge() : { merged: true, home: merged, _o: o }
    },
    exportAccount: () => ({ profile: { id: auth.current?.userId }, sessions: [] }),
    deleteAccount: () => {
      auth.calls.push('delete')
      return { deleted: true }
    },
  })
  const outbox = fakeOutbox(auth.calls, { waiting: opts.waiting ?? 0 })
  // The URL changes only when the app navigates (the sign-out must wait for it).
  let path = '/settings/account'
  const navigate = vi.fn<(href: string) => void>((href) => {
    auth.calls.push(`navigate:${href}`)
    path = href
  })
  const saveFile = vi.fn<(data: unknown, filename: string) => void>()
  const utils = renderWith(
    <AccountScreen
      navigate={navigate}
      outbox={outbox}
      saveFile={saveFile}
      currentPath={() => path}
    />,
    { api: fake.api, auth },
  )
  return { ...utils, ...fake, auth, outbox, navigate, saveFile }
}

async function submitEmail(email: string, button: string) {
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: email } })
  fireEvent.click(screen.getByRole('button', { name: button }))
}

describe('AccountScreen: a guest creates a profile', () => {
  it('flushes the outbox, then links the email', async () => {
    const { auth } = setup({})
    await submitEmail('new@example.com', 'Create a profile')
    expect(await screen.findByRole('status')).toHaveTextContent(
      "Profile created. You're signed in as new@example.com.",
    )
    expect(auth.calls).toEqual([FLUSH_GUEST, 'link:new@example.com'])
    expect(auth.current).toMatchObject({ isAnonymous: false, email: 'new@example.com' })
  })

  it('an email that already has an account: flush → link → sign in → merge → re-tag the queue', async () => {
    const auth = fakeAuth(GUEST, { link: () => ({ status: 'identity_already_exists' }) })
    const { called, outbox } = setup({ auth })
    await submitEmail('sara@example.com', 'Create a profile')
    expect(await screen.findByRole('status')).toHaveTextContent(/guest progress was added/)
    expect(auth.calls).toEqual([
      FLUSH_GUEST,
      'link:sara@example.com',
      FLUSH_GUEST,
      'signIn:sara@example.com',
      'merge',
      'retag',
    ])
    expect(called('mergeAccount')).toEqual([{ body: { guestToken: GUEST.accessToken } }])
    expect(outbox.retagged).toEqual([[GUEST_ID, MEMBER_ID]])
  })

  it('refuses to switch while the outbox cannot be delivered', async () => {
    const { auth, called } = setup({ waiting: 2 })
    await submitEmail('new@example.com', 'Create a profile')
    expect(await screen.findByRole('alert')).toHaveTextContent(OUTBOX_BLOCKED_MESSAGE)
    expect(auth.calls).toEqual([FLUSH_GUEST])
    expect(auth.current).toEqual(GUEST)
    expect(called('mergeAccount')).toEqual([])
  })

  it('also refuses when the outbox itself fails', async () => {
    const { auth } = setup({ waiting: 'throws' })
    await submitEmail('new@example.com', 'Create a profile')
    expect(await screen.findByRole('alert')).toHaveTextContent(OUTBOX_BLOCKED_MESSAGE)
    expect(auth.calls).toEqual([FLUSH_GUEST])
  })

  it('"I already have an account" signs in and merges the guest', async () => {
    const { auth, called } = setup({})
    fireEvent.click(await screen.findByRole('button', { name: 'I already have an account' }))
    await submitEmail('sara@example.com', 'Sign in')
    expect(await screen.findByRole('status')).toHaveTextContent(/guest progress was added/)
    expect(auth.calls).toEqual([FLUSH_GUEST, 'signIn:sara@example.com', 'merge', 'retag'])
    expect(called('mergeAccount')).toEqual([{ body: { guestToken: GUEST.accessToken } }])
  })

  it('shows the error when the merge fails', async () => {
    const auth = fakeAuth(GUEST, { link: () => ({ status: 'identity_already_exists' }) })
    setup({
      auth,
      merge: () => {
        throw apiError('forbidden', 403)
      },
    })
    await submitEmail('sara@example.com', 'Create a profile')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('does not submit an invalid email', async () => {
    const { auth } = setup({})
    await submitEmail('not-an-email', 'Create a profile')
    expect(screen.getByRole('button', { name: 'Create a profile' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(auth.calls).toEqual([])
  })
})

describe('AccountScreen: a member', () => {
  it('delivers the outbox, leaves for the home page, then signs out', async () => {
    const { auth } = setup({ auth: fakeAuth(MEMBER) })
    expect(await screen.findByText('sara@example.com')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    // Signing out while an app screen is mounted would make the shell create a new guest.
    await waitFor(() => expect(auth.calls).toEqual([FLUSH_MEMBER, 'navigate:/', 'signOut']))
    expect(auth.current).toBeNull()
  })

  it('stays signed in while the outbox is stuck', async () => {
    const { auth, navigate } = setup({ auth: fakeAuth(MEMBER), waiting: 1 })
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(OUTBOX_BLOCKED_MESSAGE)
    expect(auth.calls).toEqual([FLUSH_MEMBER])
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('AccountScreen: your data', () => {
  it('downloads the GDPR export as JSON', async () => {
    const { saveFile } = setup({})
    fireEvent.click(await screen.findByRole('button', { name: 'Download my data' }))
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
    const [data, name] = saveFile.mock.calls[0]!
    expect(data).toEqual({ profile: { id: GUEST.userId }, sessions: [] })
    expect(name).toMatch(/^zaboon-export-\d{4}-\d{2}-\d{2}\.json$/)
  })

  it('deletes only after the typed confirmation, then goes to / and signs out', async () => {
    const { auth, called, outbox } = setup({})
    const del = await screen.findByRole('button', { name: 'Delete my account' })
    fireEvent.click(del)
    expect(called('deleteAccount')).toEqual([])
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'delete' },
    })
    fireEvent.click(del)
    expect(called('deleteAccount')).toEqual([])
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    })
    fireEvent.click(del)
    await waitFor(() => expect(auth.calls).toEqual(['delete', 'forget', 'navigate:/', 'signOut']))
    // The deleted user's queued lesson writes are dropped from this device.
    expect(outbox.forgotten).toEqual([GUEST_ID])
  })
})

describe('identity helpers', () => {
  it("blocks only on the signed-in user's undelivered entries", async () => {
    const log: string[] = []
    const auth = fakeAuth(GUEST)
    await expect(ensureOutboxDelivered({ auth, outbox: fakeOutbox(log) })).resolves.toBeUndefined()
    await expect(
      ensureOutboxDelivered({ auth, outbox: fakeOutbox(log, { waiting: 1 }) }),
    ).rejects.toThrow(OUTBOX_BLOCKED_MESSAGE)
    expect(log).toEqual([FLUSH_GUEST, FLUSH_GUEST])
    // Signed out: there is nobody whose writes could be stranded.
    await expect(
      ensureOutboxDelivered({ auth: fakeAuth(null), outbox: fakeOutbox(log, { waiting: 3 }) }),
    ).resolves.toBeUndefined()
  })

  it('an emailed sign-in link keeps the guest token and merges once the member arrives', async () => {
    const auth = fakeAuth(GUEST, { signIn: () => ({ status: 'email_sent' }) })
    const merged = home({ xpTotal: 99 })
    const fake = fakeApi({ mergeAccount: () => ({ merged: true, home: merged }) })
    const outbox = fakeOutbox([])
    const r = await signInAndMerge({ auth, api: fake.api, outbox }, 's@x.io')
    expect(r).toEqual({ status: 'email_sent' })
    expect(localStorage.getItem(PENDING_MERGE_KEY)).toContain(GUEST.accessToken)
    // Still the guest: nothing to do yet.
    expect(await completePendingMerge({ auth, api: fake.api, outbox })).toBeNull()
    expect(fake.called('mergeAccount')).toEqual([])
    // The link was opened: now a member.
    auth.current = MEMBER
    expect(await completePendingMerge({ auth, api: fake.api, outbox })).toEqual(merged)
    expect(fake.called('mergeAccount')).toEqual([{ body: { guestToken: GUEST.accessToken } }])
    expect(outbox.retagged).toEqual([[GUEST_ID, MEMBER_ID]])
    expect(localStorage.getItem(PENDING_MERGE_KEY)).toBeNull()
    expect(await completePendingMerge({ auth, api: fake.api, outbox })).toBeNull()
  })

  it('a plain sign-in without a guest does not merge', async () => {
    const auth = fakeAuth(null)
    const fake = fakeApi({})
    const r = await signInAndMerge({ auth, api: fake.api, outbox: fakeOutbox([]) }, 's@x.io')
    expect(r).toEqual({ status: 'merged', home: null })
    expect(fake.calls).toEqual([])
  })

  const park = (over: Record<string, unknown> = {}) =>
    localStorage.setItem(
      PENDING_MERGE_KEY,
      JSON.stringify({
        guestToken: GUEST.accessToken,
        guestUserId: GUEST_ID,
        expiresAt: Date.now() + 60_000,
        ...over,
      }),
    )

  it('keeps a pending merge after a transient failure and retries it next time', async () => {
    park()
    let fail = true
    const fake = fakeApi({
      mergeAccount: () => {
        if (fail) throw new ApiClientError('network', 0, 'offline')
        return { merged: true, home: home() }
      },
    })
    const deps = { auth: fakeAuth(MEMBER), api: fake.api, outbox: fakeOutbox([]) }
    expect(await completePendingMerge(deps)).toBeNull()
    expect(localStorage.getItem(PENDING_MERGE_KEY)).toContain(GUEST.accessToken)
    expect(localStorage.getItem(MERGE_DROPPED_KEY)).toBeNull()
    fail = false
    expect(await completePendingMerge(deps)).toEqual(home())
    expect(localStorage.getItem(PENDING_MERGE_KEY)).toBeNull()
    expect(fake.called('mergeAccount')).toHaveLength(2)
  })

  it('drops a pending merge the server refuses for good, with a notice', async () => {
    for (const code of ['unauthorized', 'forbidden', 'validation'] as const) {
      localStorage.clear()
      park()
      const fake = fakeApi({
        mergeAccount: () => {
          throw apiError(code, 400)
        },
      })
      await completePendingMerge({ auth: fakeAuth(MEMBER), api: fake.api, outbox: fakeOutbox([]) })
      expect(localStorage.getItem(PENDING_MERGE_KEY), code).toBeNull()
      expect(localStorage.getItem(MERGE_DROPPED_KEY), code).toBe('1')
    }
  })

  it('drops an expired guest token without calling the server', async () => {
    park({ expiresAt: Date.now() - 1 })
    const fake = fakeApi({})
    expect(
      await completePendingMerge({ auth: fakeAuth(MEMBER), api: fake.api, outbox: fakeOutbox([]) }),
    ).toBeNull()
    expect(fake.calls).toEqual([])
    expect(localStorage.getItem(PENDING_MERGE_KEY)).toBeNull()
    expect(localStorage.getItem(MERGE_DROPPED_KEY)).toBe('1')
  })

  it('two concurrent finishers merge only once (StrictMode runs effects twice)', async () => {
    park()
    const fake = fakeApi({ mergeAccount: async () => ({ merged: true, home: home() }) })
    const deps = { auth: fakeAuth(MEMBER), api: fake.api, outbox: fakeOutbox([]) }
    const results = await Promise.all([completePendingMerge(deps), completePendingMerge(deps)])
    expect(fake.called('mergeAccount')).toHaveLength(1)
    expect(results.filter((r) => r !== null)).toHaveLength(1)
  })

  it('a local-mode merge that fails after the sign-in is surfaced, and parked when retryable', async () => {
    const transient = fakeApi({
      mergeAccount: () => {
        throw apiError('internal', 500)
      },
    })
    const err = await signInAndMerge(
      { auth: fakeAuth(GUEST), api: transient.api, outbox: fakeOutbox([]) },
      's@x.io',
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MergeFailedError)
    expect((err as MergeFailedError).willRetry).toBe(true)
    expect(localStorage.getItem(PENDING_MERGE_KEY)).toContain(GUEST.accessToken)

    localStorage.clear()
    const refused = fakeApi({
      mergeAccount: () => {
        throw apiError('forbidden', 403)
      },
    })
    const err2 = await signInAndMerge(
      { auth: fakeAuth(GUEST), api: refused.api, outbox: fakeOutbox([]) },
      's@x.io',
    ).catch((e: unknown) => e)
    expect((err2 as MergeFailedError).willRetry).toBe(false)
    expect(localStorage.getItem(PENDING_MERGE_KEY)).toBeNull()
  })

  it('signing out forgets a parked guest token', async () => {
    park()
    const auth = fakeAuth(MEMBER)
    await leaveThenSignOut({ auth, navigate: () => {}, currentPath: () => '/' })
    expect(localStorage.getItem(PENDING_MERGE_KEY)).toBeNull()
    expect(auth.current).toBeNull()
  })
})

describe('AccountScreen: a dropped merge', () => {
  it('shows a notice that can be dismissed', async () => {
    localStorage.setItem(MERGE_DROPPED_KEY, '1')
    setup({ auth: fakeAuth(MEMBER) })
    const notice = await screen.findByTestId('merge-dropped')
    expect(notice).toHaveTextContent(/couldn't add the progress you made as a guest/)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('merge-dropped')).toBeNull()
    expect(localStorage.getItem(MERGE_DROPPED_KEY)).toBeNull()
  })
})
