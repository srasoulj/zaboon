import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/lib/api-client'
import { AGE_BLOCK_KEY } from './age-gate'
import { Onboarding, firstStop } from './Onboarding'
import { fakeApi, fakeAuth, home, noopNavigate, renderWith } from './test-support'

beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

function setup(opts: { onboarded?: boolean } = {}) {
  const onboardedHome = home({ user: { ...home().user, onboarded: true, ageConfirmed: true } })
  const fake = fakeApi({
    home: () => home({ user: { ...home().user, onboarded: opts.onboarded ?? false } }),
    onboarding: () => onboardedHome,
  })
  const navigate = vi.fn<(href: string) => void>()
  const utils = renderWith(<Onboarding navigate={navigate} />, { api: fake.api })
  return { ...utils, ...fake, navigate, onboardedHome }
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))

async function answerUpToAge(level: RegExp = /new to Persian/) {
  await screen.findByRole('heading', { name: 'Welcome to Zaboon' })
  click('Get started')
  expect(screen.getByRole('heading', { name: 'Why are you learning Persian?' })).toBeInTheDocument()
  // Continue is locked until something is chosen.
  expect(screen.getByRole('button', { name: 'Continue' })).toHaveAttribute('aria-disabled', 'true')
  click('Travel')
  click('Continue')
  expect(screen.getByRole('heading', { name: 'How much Persian do you know?' })).toBeInTheDocument()
  click(level)
  click('Continue')
  expect(screen.getByRole('heading', { name: 'Pick a daily goal' })).toBeInTheDocument()
  click(/Serious · 30 XP/)
  click('Continue')
  expect(screen.getByRole('heading', { name: 'How old are you?' })).toBeInTheDocument()
}

describe('Onboarding', () => {
  it('asks the questions in order and posts them with the timezone and the age confirmation', async () => {
    const { called, navigate, queryClient, onboardedHome } = setup()
    await answerUpToAge()
    fireEvent.change(screen.getByLabelText('Your age'), { target: { value: '34' } })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).not.toHaveAttribute('aria-disabled'),
    )
    // Home must be seeded before navigating (the shell would bounce back to /onboarding).
    // Capture the cache as navigate() sees it (an expect thrown inside onSuccess would be swallowed).
    const homeAtNavigation: unknown[] = []
    navigate.mockImplementation(() => {
      homeAtNavigation.push(queryClient.getQueryData(queryKeys.home))
    })
    click('Continue')
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
    expect(homeAtNavigation).toEqual([onboardedHome])
    expect(called('onboarding')).toEqual([
      {
        body: {
          reason: 'travel',
          selfLevel: 'new',
          dailyGoalXp: 30,
          ageConfirmed: true,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      },
    ])
    expect(navigate).toHaveBeenCalledWith('/lesson?course=fa-en&kind=lesson&level=u01-l1')
  })

  it('sends "I speak but can\'t read" learners to the Letters tab (heritage fast track)', async () => {
    const { navigate } = setup()
    await answerUpToAge(/speak Persian but can't read/)
    fireEvent.change(screen.getByLabelText('Your age'), { target: { value: '40' } })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).not.toHaveAttribute('aria-disabled'),
    )
    click('Continue')
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/letters'))
  })

  it('never posts for a learner under 13 and remembers the block on the device', async () => {
    const { called, navigate, unmount } = setup()
    await answerUpToAge()
    fireEvent.change(screen.getByLabelText('Your age'), { target: { value: '12' } })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).not.toHaveAttribute('aria-disabled'),
    )
    click('Continue')
    expect(await screen.findByTestId('age-blocked')).toBeInTheDocument()
    expect(called('onboarding')).toEqual([])
    expect(navigate).not.toHaveBeenCalled()
    expect(localStorage.getItem(AGE_BLOCK_KEY)).toBe('1')

    // Coming back shows the block straight away.
    unmount()
    setup()
    expect(await screen.findByTestId('age-blocked')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Get started' })).toBeNull()
  })

  it('Enter in the age field posts once, even when pressed twice', async () => {
    let resolve: (v: unknown) => void = () => {}
    const fake = fakeApi({
      home: () => home(),
      onboarding: () => new Promise((r) => (resolve = r)),
    })
    const navigate = vi.fn<(href: string) => void>()
    renderWith(<Onboarding navigate={navigate} />, { api: fake.api })
    await answerUpToAge()
    const input = screen.getByLabelText('Your age')
    fireEvent.change(input, { target: { value: '30' } })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).not.toHaveAttribute('aria-disabled'),
    )
    fireEvent.submit(input.closest('form')!)
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => expect(fake.called('onboarding')).toHaveLength(1))
    resolve(home({ user: { ...home().user, onboarded: true } }))
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
    expect(fake.called('onboarding')).toHaveLength(1)
  })

  // The shell signs a first-time visitor in as a guest on arrival; these start with that having
  // failed (production: anonymous sign-ins were off), so the age step still has no session.
  it('signs the visitor in as a guest itself when the shell could not, then posts', async () => {
    const auth = fakeAuth(null)
    const onboardedHome = home({ user: { ...home().user, onboarded: true, ageConfirmed: true } })
    let sessionAtPost: unknown = 'not posted'
    const fake = fakeApi({
      home: () => home(),
      onboarding: () => {
        sessionAtPost = auth.current
        return onboardedHome
      },
    })
    const navigate = vi.fn<(href: string) => void>()
    renderWith(<Onboarding navigate={navigate} />, { api: fake.api, auth })
    await answerUpToAge()
    fireEvent.change(screen.getByLabelText('Your age'), { target: { value: '34' } })
    // A missing session is fixed by Continue, not hidden behind a locked button.
    expect(screen.getByRole('button', { name: 'Continue' })).not.toHaveAttribute('aria-disabled')
    click('Continue')
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/lesson?course=fa-en&kind=lesson&level=u01-l1'),
    )
    expect(auth.calls).toEqual(['signInAsGuest'])
    expect(sessionAtPost).toMatchObject({ isAnonymous: true })
    expect(fake.called('onboarding')).toHaveLength(1)
  })

  it('says so when the guest sign-in fails, and Continue tries again', async () => {
    const auth = fakeAuth(null)
    const signIn = auth.signInAsGuest
    let refuse = true
    auth.signInAsGuest = async () => {
      if (!refuse) return signIn()
      auth.calls.push('signInAsGuest:refused')
      throw Object.assign(new Error('Anonymous sign-ins are disabled'), {
        code: 'anonymous_provider_disabled',
        status: 422,
      })
    }
    const fake = fakeApi({
      home: () => home(),
      onboarding: () => home({ user: { ...home().user, onboarded: true, ageConfirmed: true } }),
    })
    const navigate = vi.fn<(href: string) => void>()
    renderWith(<Onboarding navigate={navigate} />, { api: fake.api, auth })
    await answerUpToAge()
    fireEvent.change(screen.getByLabelText('Your age'), { target: { value: '34' } })
    click('Continue')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn't sign you in as a guest/)
    expect(within(alert).getByRole('link', { name: 'sign in with your email' })).toHaveAttribute(
      'href',
      '/sign-in',
    )
    expect(fake.called('onboarding')).toEqual([])
    expect(navigate).not.toHaveBeenCalled()
    const button = screen.getByRole('button', { name: 'Continue' })
    expect(button).not.toHaveAttribute('aria-disabled')
    expect(button).not.toHaveAttribute('aria-busy')

    refuse = false
    click('Continue')
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
    expect(auth.calls).toEqual(['signInAsGuest:refused', 'signInAsGuest'])
    expect(fake.called('onboarding')).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('never signs an under-13 visitor in', async () => {
    const auth = fakeAuth(null)
    const fake = fakeApi({ home: () => home() })
    renderWith(<Onboarding navigate={noopNavigate()} />, { api: fake.api, auth })
    await answerUpToAge()
    fireEvent.change(screen.getByLabelText('Your age'), { target: { value: '12' } })
    click('Continue')
    expect(await screen.findByTestId('age-blocked')).toBeInTheDocument()
    expect(auth.calls).toEqual([])
    expect(fake.calls).toEqual([])
  })

  it('a home fetch started by the guest sign-in cannot overwrite the seeded home', async () => {
    const auth = fakeAuth(null)
    const onboardedHome = home({ user: { ...home().user, onboarded: true, ageConfirmed: true } })
    // Signing in enables the home query, whose fetch starts while the POST is on the wire (a real
    // POST takes a round trip); its answer only arrives after the flow has finished.
    let releaseHome: (v: unknown) => void = () => {}
    const fake = fakeApi({
      home: () => new Promise((r) => (releaseHome = r)),
      onboarding: () => new Promise((r) => setTimeout(() => r(onboardedHome), 30)),
    })
    const navigate = vi.fn<(href: string) => void>()
    const { queryClient } = renderWith(<Onboarding navigate={navigate} />, { api: fake.api, auth })
    await answerUpToAge()
    fireEvent.change(screen.getByLabelText('Your age'), { target: { value: '34' } })
    click('Continue')
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
    expect(fake.called('home')).toHaveLength(1)
    await act(async () => {
      releaseHome(home()) // the stale "not onboarded" answer lands late
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(queryClient.getQueryData(queryKeys.home)).toEqual(onboardedHome)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('rejects an age that is not a number', async () => {
    setup()
    await answerUpToAge()
    fireEvent.change(screen.getByLabelText('Your age'), { target: { value: 'ten' } })
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('goes back a step and keeps the answer', async () => {
    setup()
    await answerUpToAge()
    click('Back')
    expect(screen.getByRole('button', { name: /Serious · 30 XP/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('picks options with the number keys', async () => {
    setup()
    await screen.findByRole('heading', { name: 'Welcome to Zaboon' })
    click('Get started')
    fireEvent.keyDown(window, { key: '2', code: 'Digit2' })
    expect(screen.getByRole('button', { name: /partner/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('sends learners who already onboarded to /learn', async () => {
    const { navigate } = setup({ onboarded: true })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/learn'))
  })

  it('shows an error and stays when the POST fails', async () => {
    const fake = fakeApi({
      home: () => home(),
      onboarding: () => {
        throw Object.assign(new Error('offline'), { code: 'network' })
      },
    })
    const navigate = vi.fn<(href: string) => void>()
    renderWith(<Onboarding navigate={navigate} />, { api: fake.api })
    await answerUpToAge()
    fireEvent.change(screen.getByLabelText('Your age'), { target: { value: '20' } })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).not.toHaveAttribute('aria-disabled'),
    )
    click('Continue')
    expect(await screen.findByRole('alert')).toHaveTextContent(/offline/)
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('firstStop', () => {
  it('falls back to /learn when the course has no current level', () => {
    const h = home({ course: { id: 'fa-en', contentVersion: 1, currentLevelId: null } })
    expect(firstStop('basics', h)).toBe('/learn')
    expect(firstStop('speak_not_read', h)).toBe('/letters')
  })
})
