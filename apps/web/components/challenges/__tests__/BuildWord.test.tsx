import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fixture, renderChallenge } from '../testing'

const c = fixture('build_word')
const letters = () => screen.getByRole('group', { name: 'Letters' })
const tile = (letter: string) => within(letters()).getByRole('button', { name: letter })

describe('build_word', () => {
  it('shows the target meaning and the letter tiles', () => {
    renderChallenge(c)
    expect(
      screen.getByRole('heading', { name: `Build the word for “${c.target.en}”` }),
    ).toBeInTheDocument()
    expect(within(letters()).getAllByRole('button')).toHaveLength(c.tiles.length)
    for (const b of within(letters()).getAllByRole('button'))
      expect(b).toHaveAttribute('lang', 'fa')
    expect(screen.queryByTestId('assembled-word')).toBeNull()
  })

  it('placed letters join into ONE text run and are graded correct', async () => {
    const h = renderChallenge(c)
    for (const l of c.answer) await h.user.click(tile(l))
    expect(h.last()).toEqual({ kind: 'tiles', value: c.answer })
    expect(h.verdict()).toBe('correct')
    const word = screen.getByTestId('assembled-word')
    expect(word.textContent).toBe(c.target.fa)
    expect(word.childNodes).toHaveLength(1)
    expect(word.children).toHaveLength(0)
    expect(word).toHaveAttribute('lang', 'fa')
    expect(word).toHaveAttribute('dir', 'rtl')
    expect(tile(c.answer[0]!)).toHaveAttribute('aria-pressed', 'true')
  })

  it('a wrong spelling is graded wrong', async () => {
    const h = renderChallenge(c)
    await h.user.click(tile('س'))
    await h.user.click(tile('ب'))
    expect(h.last()).toEqual({ kind: 'tiles', value: ['س', 'ب'] })
    expect(h.verdict()).toBe('wrong')
  })

  it('tapping a placed tile takes it out; Undo removes the last letter; empty clears the draft', async () => {
    const h = renderChallenge(c)
    for (const l of c.answer) await h.user.click(tile(l))
    await h.user.click(tile('ی'))
    expect(h.last()).toEqual({ kind: 'tiles', value: ['س', 'ب'] })
    await h.user.click(screen.getByRole('button', { name: 'Remove last letter' }))
    expect(h.last()).toEqual({ kind: 'tiles', value: ['س'] })
    await h.user.click(tile('س'))
    expect(h.last()).toBeNull()
  })

  it('works with the keyboard alone (Enter places, Backspace removes)', async () => {
    const h = renderChallenge(c)
    for (const l of c.answer) {
      tile(l).focus()
      await h.user.keyboard('{Enter}')
    }
    expect(h.verdict()).toBe('correct')
    await h.user.keyboard('{Backspace}')
    expect(h.last()).toEqual({ kind: 'tiles', value: ['س', 'ی'] })
  })

  it('is locked in feedback', async () => {
    const h = renderChallenge(c)
    for (const l of c.answer) await h.user.click(tile(l))
    h.check()
    await h.user.click(tile('ن'))
    tile('ب').focus()
    await h.user.keyboard('{Backspace}')
    await h.user.click(screen.getByRole('button', { name: 'Remove last letter' }))
    expect(h.onResponse).toHaveBeenCalledTimes(c.answer.length)
    expect(screen.getByTestId('assembled-word')).toHaveTextContent(c.target.fa)
  })
})
