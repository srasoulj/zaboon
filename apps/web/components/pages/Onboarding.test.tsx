import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/lib/api-client'
import { AGE_BLOCK_KEY } from './age-gate'
import { Onboarding, firstStop } from './Onboarding'
import { fakeApi, home, renderWith } from './test-support'

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
    navigate.mockImplementation(() => {
      expect(queryClient.getQueryData(queryKeys.home)).toEqual(onboardedHome)
    })
    click('Continue')
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
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

  it('rejects an age that is not a number', async () => {
    setup()
    await answerUpToAge()
    fireEvent.change(screen.getByLabelText('Your age'), { target: { value: 'ten' } })
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveAttribute('aria-disabled', 'true')
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
