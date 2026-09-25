import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OUTBOX_BLOCKED_MESSAGE } from './identity'
import { SignInScreen } from './SignInScreen'
import {
  GUEST_ID,
  MEMBER_ID,
  fakeApi,
  fakeAuth,
  fakeOutbox,
  home,
  renderWith,
  session,
} from './test-support'

afterEach(() => cleanup())

const FLUSH_GUEST = `flush:${GUEST_ID.slice(0, 4)}`

function setup(auth = fakeAuth(session()), waiting = 0) {
  const fake = fakeApi({
    mergeAccount: () => {
      auth.calls.push('merge')
      return { merged: true, home: home({ xpTotal: 40 }) }
    },
  })
  const navigate = vi.fn<(href: string) => void>()
  const outbox = fakeOutbox(auth.calls, { waiting })
  renderWith(<SignInScreen navigate={navigate} outbox={outbox} />, { api: fake.api, auth })
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
    expect(auth.calls).toEqual([FLUSH_GUEST, 'signIn:sara@example.com', 'merge', 'retag'])
  })

  it('without a guest it only signs in', async () => {
    const { auth, navigate } = setup(fakeAuth(null))
    await signIn('sara@example.com')
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/learn'))
    // Nobody signed in: nothing to flush.
    expect(auth.calls).toEqual(['signIn:sara@example.com'])
  })

  it('is blocked while lesson writes are stuck in the outbox', async () => {
    const { auth, navigate } = setup(fakeAuth(session()), 1)
    await signIn('sara@example.com')
    expect(await screen.findByRole('alert')).toHaveTextContent(OUTBOX_BLOCKED_MESSAGE)
    expect(auth.calls).toEqual([FLUSH_GUEST])
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
