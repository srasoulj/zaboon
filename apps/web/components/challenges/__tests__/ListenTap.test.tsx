import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fixture, renderChallenge } from '../testing'

const ZWNJ = '‌'
const c = fixture('listen_tap')
const bank = () => screen.getByRole('group', { name: 'Word bank' })
const answer = () => screen.getByRole('group', { name: 'Your answer' })

describe('listen_tap', () => {
  it('shows the instruction, a speaker and a turtle button, and an RTL Persian bank', () => {
    renderChallenge(c)
    expect(screen.getByRole('heading', { name: 'Tap what you hear' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play audio' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play slowly' })).toBeInTheDocument()
    expect(answer()).toHaveAttribute('dir', 'rtl')
    for (const t of within(bank()).getAllByRole('button')) expect(t).toHaveAttribute('lang', 'fa')
    // the transcript would give the answer away before CHECK
    expect(screen.queryByRole('group', { name: 'Transcript' })).toBeNull()
  })

  it('speaker plays the clip; turtle asks for the slow clip', async () => {
    const h = renderChallenge(c)
    await h.user.click(screen.getByRole('button', { name: 'Play audio' }))
    expect(h.audio.play).toHaveBeenLastCalledWith(c.audio.normal)
    await h.user.click(screen.getByRole('button', { name: 'Play slowly' }))
    expect(h.audio.play).toHaveBeenLastCalledWith(c.audio.normal, { slow: true })
  })

  it('autoplays once when sound is on, never when off', () => {
    const on = renderChallenge(c, { display: { sound: true } })
    expect(on.audio.play).toHaveBeenCalledTimes(1)
    on.unmount()
    const off = renderChallenge(c)
    expect(off.audio.play).not.toHaveBeenCalled()
  })

  it('tapping چای · می‌خوای is graded correct; a wrong sentence wrong', async () => {
    const h = renderChallenge(c)
    await h.user.click(within(bank()).getByRole('button', { name: 'چای' }))
    await h.user.click(within(bank()).getByRole('button', { name: `می${ZWNJ}خوای` }))
    expect(h.last()).toEqual({ kind: 'tiles', value: ['چای', `می${ZWNJ}خوای`] })
    expect(h.verdict()).toBe('correct')
    await h.user.click(within(answer()).getByRole('button', { name: `می${ZWNJ}خوای` }))
    await h.user.click(within(bank()).getByRole('button', { name: 'نون' }))
    expect(h.verdict()).toBe('wrong')
  })

  it('works with the keyboard alone', async () => {
    const h = renderChallenge(c)
    within(bank()).getByRole('button', { name: 'چای' }).focus()
    await h.user.keyboard('{Enter}')
    within(bank())
      .getByRole('button', { name: `می${ZWNJ}خوای` })
      .focus()
    await h.user.keyboard(' ')
    expect(h.verdict()).toBe('correct')
  })

  it('locks the tiles and shows the transcript in feedback', async () => {
    const h = renderChallenge(c)
    await h.user.click(within(bank()).getByRole('button', { name: 'چای' }))
    h.check()
    expect(screen.getByRole('group', { name: 'Transcript' })).toHaveTextContent(c.transcript.fa)
    expect(within(bank()).getByRole('button', { name: 'نون' })).toBeDisabled()
  })
})
