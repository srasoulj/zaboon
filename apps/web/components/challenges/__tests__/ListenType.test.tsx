import { screen, within } from '@testing-library/react'
import { ZWNJ } from '@zaboon/farsi'
import { describe, expect, it } from 'vitest'
import { fixture, persianOf, renderChallenge } from '../testing'

// «چای می‌خوای؟» ("Do you want tea?") from the fixture's u01-t1.
const c = fixture('listen_type')
const box = () => screen.getByRole('textbox', { name: 'What you hear, in Persian' })

describe('listen_type', () => {
  it('plays the clip (and the slow clip) and asks for typed Persian', async () => {
    const h = renderChallenge(c)
    expect(screen.getByRole('heading', { name: 'Type what you hear' })).toBeInTheDocument()
    expect(box()).toHaveAttribute('lang', 'fa')
    expect(box()).toHaveAttribute('dir', 'rtl')
    await h.user.click(screen.getByRole('button', { name: 'Play audio' }))
    expect(h.audio.play).toHaveBeenCalledWith(c.audio.normal)
    await h.user.click(screen.getByRole('button', { name: 'Play slowly' }))
    expect(h.audio.play).toHaveBeenLastCalledWith(c.audio.normal, { slow: true })
    // No transcript while answering (it would give the answer away).
    expect(screen.queryByRole('group', { name: 'Transcript' })).toBeNull()
  })

  it('autoplays once when sound is on', () => {
    const h = renderChallenge(c, { display: { sound: true } })
    expect(h.audio.play).toHaveBeenCalledTimes(1)
  })

  it('a correct transcript grades correct, without punctuation or half-space', async () => {
    const h = renderChallenge(c)
    await h.user.type(box(), 'چای میخوای')
    expect(h.last()).toEqual({ kind: 'text', value: 'چای میخوای' })
    expect(h.verdict()).toBe('correct')
  })

  it('a wrong transcript grades wrong; blank clears the draft', async () => {
    const h = renderChallenge(c)
    await h.user.type(box(), `نون می${ZWNJ}خوام`)
    expect(h.verdict()).toBe('wrong')
    await h.user.clear(box())
    expect(h.last()).toBeNull()
  })

  it('types with the in-app keyboard and checks with Enter', async () => {
    const h = renderChallenge(c, { display: { persianKeyboard: true } })
    const kb = screen.getByRole('group', { name: 'Persian keyboard' })
    for (const ch of 'چای') await h.user.click(within(kb).getByRole('button', { name: ch }))
    expect(box()).toHaveValue('چای')
    await h.user.click(box())
    await h.user.keyboard('{Enter}')
    expect(h.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('shows the transcript in feedback and locks the field', async () => {
    const h = renderChallenge(c)
    await h.user.type(box(), 'چای')
    h.check()
    const transcript = screen.getByRole('group', { name: 'Transcript' })
    expect(persianOf(transcript)).toHaveTextContent('چای')
    expect(box()).toHaveAttribute('readonly')
    expect(box()).toHaveAttribute('data-state', 'wrong')
    await h.user.type(box(), 'x')
    expect(box()).toHaveValue('چای')
  })
})
