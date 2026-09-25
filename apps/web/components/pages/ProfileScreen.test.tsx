import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { queryKeys } from '@/lib/api-client'
import { ProfileScreen, joinedLabel, usernameProblem } from './ProfileScreen'
import { MEMBER_ID, apiError, fakeApi, fakeAuth, home, profile, renderWith, session } from './test-support'

afterEach(() => cleanup())

const WORDS = {
  words: [
    { lexemeId: 'lx_salam', fa: 'سلام', translit: 'salām', gloss: 'hello', strength: 2, dueAt: null },
    { lexemeId: 'lx_ab', fa: 'آب', translit: 'āb', gloss: 'water', strength: 1, dueAt: null },
  ],
}

function member() {
  return profile({ id: MEMBER_ID, isAnonymous: false, displayName: 'Sara', username: 'sara' })
}

function setup(p = member(), updateProfile?: (body: unknown) => unknown) {
  const fake = fakeApi({
    profile: () => p,
    words: () => WORDS,
    home: () => home(),
    updateProfile: (o) => (updateProfile ? updateProfile(o.body) : { ...p, ...(o.body as object) }),
  })
  const auth = fakeAuth(
    p.isAnonymous ? session() : session({ userId: MEMBER_ID, isAnonymous: false, email: 's@x.io' }),
  )
  return { ...fake, ...renderWith(<ProfileScreen />, { api: fake.api, auth }) }
}

describe('ProfileScreen', () => {
  it('shows the name, @username, joined date and stats', async () => {
    setup()
    expect(await screen.findByRole('heading', { name: 'Sara' })).toBeInTheDocument()
    expect(screen.getByText('@sara')).toBeInTheDocument()
    expect(screen.getByText('Joined September 2026')).toBeInTheDocument()
    const stat = (label: string) => screen.getByText(label).closest('div')!.textContent
    expect(stat('Total XP')).toContain('120')
    expect(stat('Day streak')).toContain('3')
    await waitFor(() => expect(stat('Words learned')).toContain('2'))
    expect(screen.queryByRole('link', { name: 'Create a profile' })).toBeNull()
  })

  it('checks the username against the contract rule before saving', async () => {
    const { called } = setup()
    const input = await screen.findByLabelText('Username')
    fireEvent.change(input, { target: { value: 'ab' } })
    expect(screen.getByRole('alert')).toHaveTextContent(/3–20 lowercase letters/)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.change(input, { target: { value: 'bad-name' } })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(called('updateProfile')).toEqual([])
  })

  it('saves a new username and refreshes home', async () => {
    const { called, queryClient } = setup()
    queryClient.setQueryData(queryKeys.home, home())
    const input = await screen.findByLabelText('Username')
    fireEvent.change(input, { target: { value: 'Sara_Fa' } })
    expect(input).toHaveValue('sara_fa')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.')
    expect(called('updateProfile')).toEqual([{ body: { username: 'sara_fa' } }])
    expect(screen.getByText('@sara_fa')).toBeInTheDocument()
    expect(queryClient.getQueryState(queryKeys.home)?.isInvalidated).toBe(true)
  })

  it('says "That username is taken" on a conflict', async () => {
    setup(member(), () => {
      throw apiError('conflict', 409)
    })
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'taken_one' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That username is taken')
  })

  it('explains a 403 (a guest cannot pick a username)', async () => {
    setup(member(), () => {
      throw apiError('forbidden', 403)
    })
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'guesty' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Create a profile before/)
  })

  it('offers guests "Create a profile" and no username field', async () => {
    const { called } = setup(profile())
    expect(await screen.findByRole('heading', { name: 'Guest learner' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create a profile' })).toHaveAttribute(
      'href',
      '/settings/account',
    )
    expect(screen.queryByLabelText('Username')).toBeNull()
    // A guest can still set a display name.
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ali' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('status')
    expect(called('updateProfile')).toEqual([{ body: { displayName: 'Ali' } }])
  })
})

describe('profile helpers', () => {
  it('validates usernames like the contract', () => {
    expect(usernameProblem('sara_99')).toBeNull()
    expect(usernameProblem('sa')).not.toBeNull()
    expect(usernameProblem('a'.repeat(21))).not.toBeNull()
    expect(usernameProblem('Sara')).not.toBeNull()
  })

  it('formats the joined date in UTC', () => {
    expect(joinedLabel('2026-01-01T00:30:00Z')).toBe('Joined January 2026')
  })
})
