import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FlushReport } from '@/lib/lesson/outbox'
import { AccountScreen } from './AccountScreen'
import {
  OUTBOX_BLOCKED_MESSAGE,
  PENDING_MERGE_KEY,
  completePendingMerge,
  ensureOutboxDelivered,
  signInAndMerge,
} from './identity'
import { MEMBER_ID, apiError, fakeApi, fakeAuth, home, renderWith, session, type FakeAuth } from './test-support'

beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

const DELIVERED: FlushReport = { delivered: 2, dropped: 0, stalled: false, remaining: 0 }
const STALLED: FlushReport = { delivered: 0, dropped: 0, stalled: true, remaining: 2 }
const GUEST = session()
const MEMBER = session({
  userId: MEMBER_ID,
  isAnonymous: false,
  email: 'sara@example.com',
  accessToken: `member-token-${'m'.repeat(24)}`,
})

function setup(opts: {
  auth?: FakeAuth
  flush?: FlushReport | 'throws'
  merge?: () => unknown
}) {
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
  const flushOutbox = vi.fn(async () => {
    auth.calls.push('flush')
    if (opts.flush === 'throws') throw new Error('idb broken')
    return opts.flush ?? DELIVERED
  })
  const navigate = vi.fn<(href: string) => void>()
  const saveFile = vi.fn<(data: unknown, filename: string) => void>()
  const utils = renderWith(
    <AccountScreen navigate={navigate} flushOutbox={flushOutbox} saveFile={saveFile} />,
    { api: fake.api, auth },
  )
  return { ...utils, ...fake, auth, flushOutbox, navigate, saveFile }
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
    expect(auth.calls).toEqual(['flush', 'link:new@example.com'])
    expect(auth.current).toMatchObject({ isAnonymous: false, email: 'new@example.com' })
  })

  it('an email that already has an account: flush → link → sign in → merge with the guest token', async () => {
    const auth = fakeAuth(GUEST, { link: () => ({ status: 'identity_already_exists' }) })
    const { called } = setup({ auth })
    await submitEmail('sara@example.com', 'Create a profile')
    expect(await screen.findByRole('status')).toHaveTextContent(/guest progress was added/)
    expect(auth.calls).toEqual([
      'flush',
      'link:sara@example.com',
      'signIn:sara@example.com',
      'merge',
    ])
    expect(called('mergeAccount')).toEqual([{ body: { guestToken: GUEST.accessToken } }])
  })

  it('refuses to switch while the outbox cannot be delivered', async () => {
    const { auth, called } = setup({ flush: STALLED })
    await submitEmail('new@example.com', 'Create a profile')
    expect(await screen.findByRole('alert')).toHaveTextContent(OUTBOX_BLOCKED_MESSAGE)
    expect(auth.calls).toEqual(['flush'])
    expect(auth.current).toEqual(GUEST)
    expect(called('mergeAccount')).toEqual([])
  })

  it('also refuses when the outbox itself fails', async () => {
    const { auth } = setup({ flush: 'throws' })
    await submitEmail('new@example.com', 'Create a profile')
    expect(await screen.findByRole('alert')).toHaveTextContent(OUTBOX_BLOCKED_MESSAGE)
    expect(auth.calls).toEqual(['flush'])
  })

  it('"I already have an account" signs in and merges the guest', async () => {
    const { auth, called } = setup({})
    fireEvent.click(await screen.findByRole('button', { name: 'I already have an account' }))
    await submitEmail('sara@example.com', 'Sign in')
    expect(await screen.findByRole('status')).toHaveTextContent(/guest progress was added/)
    expect(auth.calls).toEqual(['flush', 'signIn:sara@example.com', 'merge'])
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
    expect(screen.getByRole('button', { name: 'Create a profile' })).toHaveAttribute('aria-disabled', 'true')
    expect(auth.calls).toEqual([])
  })
})

describe('AccountScreen: a member', () => {
  it('signs out after the outbox is delivered and goes home', async () => {
    const { auth, navigate } = setup({ auth: fakeAuth(MEMBER) })
    expect(await screen.findByText('sara@example.com')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'))
    expect(auth.calls).toEqual(['flush', 'signOut'])
  })

  it('stays signed in while the outbox is stuck', async () => {
    const { auth, navigate } = setup({ auth: fakeAuth(MEMBER), flush: STALLED })
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(OUTBOX_BLOCKED_MESSAGE)
    expect(auth.calls).toEqual(['flush'])
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

  it('deletes only after the typed confirmation, then signs out and goes to /', async () => {
    const { auth, navigate, called } = setup({})
    const del = await screen.findByRole('button', { name: 'Delete my account' })
    fireEvent.click(del)
    expect(called('deleteAccount')).toEqual([])
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'delete' } })
    fireEvent.click(del)
    expect(called('deleteAccount')).toEqual([])
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } })
    fireEvent.click(del)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'))
    expect(auth.calls).toEqual(['delete', 'signOut'])
  })
})

describe('identity helpers', () => {
  it('ensureOutboxDelivered accepts a clean flush and dropped entries', async () => {
    await expect(ensureOutboxDelivered(async () => DELIVERED)).resolves.toBeUndefined()
    await expect(
      ensureOutboxDelivered(async () => ({ delivered: 0, dropped: 1, stalled: false, remaining: 0 })),
    ).resolves.toBeUndefined()
    await expect(ensureOutboxDelivered(async () => STALLED)).rejects.toThrow(OUTBOX_BLOCKED_MESSAGE)
  })

  it('an emailed sign-in link keeps the guest token and merges once the member arrives', async () => {
    const auth = fakeAuth(GUEST, { signIn: () => ({ status: 'email_sent' }) })
    const merged = home({ xpTotal: 99 })
    const fake = fakeApi({ mergeAccount: () => ({ merged: true, home: merged }) })
    const r = await signInAndMerge({ auth, api: fake.api, flush: async () => DELIVERED }, 's@x.io')
    expect(r).toEqual({ status: 'email_sent' })
    expect(localStorage.getItem(PENDING_MERGE_KEY)).toContain(GUEST.accessToken)
    // Still the guest: nothing to do yet.
    expect(await completePendingMerge({ auth, api: fake.api })).toBeNull()
    expect(fake.called('mergeAccount')).toEqual([])
    // The link was opened: now a member.
    auth.current = MEMBER
    expect(await completePendingMerge({ auth, api: fake.api })).toEqual(merged)
    expect(fake.called('mergeAccount')).toEqual([{ body: { guestToken: GUEST.accessToken } }])
    expect(localStorage.getItem(PENDING_MERGE_KEY)).toBeNull()
    expect(await completePendingMerge({ auth, api: fake.api })).toBeNull()
  })

  it('a plain sign-in without a guest does not merge', async () => {
    const auth = fakeAuth(null)
    const fake = fakeApi({})
    const r = await signInAndMerge({ auth, api: fake.api, flush: async () => DELIVERED }, 's@x.io')
    expect(r).toEqual({ status: 'merged', home: null })
    expect(fake.calls).toEqual([])
  })
})
