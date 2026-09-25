import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '@zaboon/contracts'
import { queryKeys } from '@/lib/api-client'
import { SettingsScreen } from './SettingsScreen'
import { apiError, fakeApi, home, renderWith } from './test-support'

afterEach(() => cleanup())

const META = {
  contentVersion: 1,
  minAppVersion: '0.1.0',
  graderVersions: [1],
  authMode: 'local' as const,
}

function setup(opts: { keyboard?: boolean; fail?: boolean } = {}) {
  let current: Settings = { ...DEFAULT_SETTINGS }
  const fake = fakeApi({
    settings: () => current,
    home: () => home({ settings: current }),
    meta: () => ({ ...META, flags: { persianKeyboard: opts.keyboard ?? false } }),
    updateSettings: (o) => {
      if (opts.fail) throw apiError('internal', 500)
      current = { ...current, ...(o.body as Partial<Settings>) }
      return current
    },
  })
  const utils = renderWith(<SettingsScreen />, { api: fake.api })
  // Something on screen reads home (the shell): its cache must be refreshed after each change.
  utils.queryClient.setQueryData(queryKeys.home, home())
  return { ...fake, ...utils }
}

const group = (name: string) => screen.getByRole('group', { name })

describe('SettingsScreen', () => {
  it('shows the current settings', async () => {
    setup()
    await screen.findByRole('heading', { name: 'Settings' })
    await waitFor(() => expect(screen.getByLabelText('Regular · 20 XP a day')).toBeChecked())
    expect(within(group('Transliteration')).getByLabelText('Auto')).toBeChecked()
    expect(within(group('Vowel marks')).getByLabelText('Auto')).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Sound effects' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Reduce motion' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('link', { name: /sign-in and your data/ })).toHaveAttribute(
      'href',
      '/settings/account',
    )
  })

  it('each change is one PATCH that invalidates home and settings', async () => {
    const { called, queryClient } = setup()
    await waitFor(() => expect(screen.getByLabelText('Serious · 30 XP a day')).toBeInTheDocument())
    const changes: [() => void, Partial<Settings>][] = [
      [() => fireEvent.click(screen.getByLabelText('Serious · 30 XP a day')), { dailyGoalXp: 30 }],
      [() => fireEvent.click(within(group('Transliteration')).getByLabelText('Off')), { transliteration: 'off' }],
      [() => fireEvent.click(within(group('Vowel marks')).getByLabelText('On')), { vowelMarks: 'on' }],
      [() => fireEvent.click(screen.getByRole('switch', { name: 'Sound effects' })), { sound: false }],
      [() => fireEvent.click(screen.getByRole('switch', { name: 'Reduce motion' })), { motion: 'reduced' }],
    ]
    for (const [act, body] of changes) {
      queryClient.setQueryData(queryKeys.home, home())
      act()
      await waitFor(() => expect(called('updateSettings').at(-1)).toEqual({ body }))
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved.'))
      await waitFor(() => expect(queryClient.getQueryState(queryKeys.home)?.isInvalidated).toBe(true))
    }
    expect(called('updateSettings')).toHaveLength(changes.length)
    expect(screen.getByLabelText('Serious · 30 XP a day')).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Reduce motion' })).toHaveAttribute('aria-checked', 'true')
  })

  it('shows the keyboard layout only behind the persianKeyboard flag', async () => {
    setup()
    await screen.findByLabelText('Regular · 20 XP a day')
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Persian keyboard' })).toBeNull())
    cleanup()
    const { called } = setup({ keyboard: true })
    fireEvent.click(within(await screen.findByRole('group', { name: 'Persian keyboard' })).getByLabelText('Phonetic'))
    await waitFor(() => expect(called('updateSettings')).toEqual([{ body: { keyboardLayout: 'phonetic' } }]))
  })

  it('rolls back and explains a failed save', async () => {
    setup({ fail: true })
    fireEvent.click(await screen.findByRole('switch', { name: 'Sound effects' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't save that change.")
    expect(screen.getByRole('switch', { name: 'Sound effects' })).toHaveAttribute('aria-checked', 'true')
  })
})
