import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FlushReport } from '@/lib/lesson/outbox'
import { OUTBOX_BLOCKED_MESSAGE } from './identity'
import { SignInScreen } from './SignInScreen'
import { MEMBER_ID, fakeApi, fakeAuth, home, renderWith, session } from './test-support'

afterEach(() => cleanup())

const ok: FlushReport = { delivered: 0, dropped: 0, stalled: false, remaining: 0 }

function setup(auth = fakeAuth(session()), flush: FlushReport = ok) {
  const fake = fakeApi({
    mergeAccount: () => {
      auth.calls.push('merge')
      return { merged: true, home: home({ xpTotal: 40 }) }
    },
  })
  const navigate = vi.fn<(href: string) => void>()
  const flushOutbox = vi.fn(async () => {
    auth.calls.push('flush')
    return flush
  })
  renderWith(<SignInScreen navigate={navigate} flushOutbox={flushOutbox} />, { api: fake.api, auth })
  return { auth, navigate, ...fake }
}

async function signIn(email: string) {
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: email } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('SignInScreen', () => {
  it('merges the guest on this device into the account, then opens the app', async () => {
    const { auth, navigate } = setup()
    await signIn('sara@example.com')
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/learn'))
    expect(auth.calls).toEqual(['flush', 'signIn:sara@example.com', 'merge'])
  })

  it('without a guest it only signs in', async () => {
    const { auth, navigate } = setup(fakeAuth(null))
    await signIn('sara@example.com')
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/learn'))
    expect(auth.calls).toEqual(['flush', 'signIn:sara@example.com'])
  })

  it('is blocked while lesson writes are stuck in the outbox', async () => {
    const { auth, navigate } = setup(fakeAuth(session()), { ...ok, stalled: true, remaining: 1 })
    await signIn('sara@example.com')
    expect(await screen.findByRole('alert')).toHaveTextContent(OUTBOX_BLOCKED_MESSAGE)
    expect(auth.calls).toEqual(['flush'])
    expect(navigate).not.toHaveBeenCalled()
  })

  it('tells the learner to check their email when a link was sent', async () => {
    setup(fakeAuth(session(), { signIn: () => ({ status: 'email_sent' }) }))
    await signIn('sara@example.com')
    expect(await screen.findByRole('status')).toHaveTextContent('sign-in link to sara@example.com')
  })

  it('a member is offered to continue', async () => {
    setup(fakeAuth(session({ userId: MEMBER_ID, isAnonymous: false, email: 'm@example.com' })))
    expect(await screen.findByText('m@example.com')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continue learning' })).toHaveAttribute('href', '/learn')
  })
})
