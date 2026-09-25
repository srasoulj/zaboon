import { screen, within } from '@testing-library/react'
import { ZWNJ } from '@zaboon/farsi'
import { describe, expect, it } from 'vitest'
import { correctResponse } from '../fixtures/samples'
import { fixture, renderChallenge, tabTo } from '../testing'

// «من سیب می‌خوام» with one word blanked, from the fixture's u01-t1.
const c = fixture('cloze_type')
const answer =
  correctResponse(c).kind === 'text' ? (correctResponse(c) as { value: string }).value : ''
const blank = () => screen.getByRole('textbox', { name: 'The missing word' })

describe('cloze_type', () => {
  it('renders whole-word tokens around an inline RTL blank, and the translation', () => {
    renderChallenge(c)
    expect(screen.getByRole('heading', { name: 'Type the missing word' })).toBeInTheDocument()
    const sentence = screen.getByRole('group', { name: 'Sentence' })
    const fa = sentence.querySelector('[lang="fa"]')!
    expect(fa).toHaveAttribute('dir', 'rtl')
    expect(fa).toContainElement(blank())
    expect(blank()).toHaveAttribute('lang', 'fa')
    expect(blank()).toHaveAttribute('dir', 'rtl')
    // Every other word is shown whole, and never inside the blank.
    for (const t of [...c.before, ...c.after])
      expect(within(sentence).getByText(t.surface)).toBeInTheDocument()
    expect(screen.getByText(c.translation)).toHaveAttribute('lang', 'en')
    // The blank sits between the tokens in document order.
    const words = [...sentence.querySelectorAll('[lang="fa"] *')].map((el) => el.textContent)
    expect(words.join(' ')).not.toContain(answer)
  })

  it('typing the missing word grades correct; another word grades wrong', async () => {
    const h = renderChallenge(c)
    await h.user.type(blank(), answer)
    expect(h.last()).toEqual({ kind: 'text', value: answer })
    expect(h.verdict()).toBe('correct')
    await h.user.clear(blank())
    expect(h.last()).toBeNull()
    await h.user.type(blank(), 'نون')
    expect(h.verdict()).toBe('wrong')
  })

  it('the in-app keyboard below the sentence types into the blank; Enter checks', async () => {
    const h = renderChallenge(c, { display: { persianKeyboard: true } })
    const kb = screen.getByRole('group', { name: 'Persian keyboard' })
    for (const ch of answer)
      await h.user.click(within(kb).getByRole('button', { name: ch === ZWNJ ? 'half-space' : ch }))
    expect(blank()).toHaveValue(answer)
    expect(h.verdict()).toBe('correct')
    await h.user.click(within(kb).getByRole('button', { name: 'enter' }))
    expect(h.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('keyboard-only: Tab to the blank, type, Enter checks', async () => {
    const h = renderChallenge(c)
    await tabTo(h.user, blank())
    await h.user.keyboard('نون{Enter}')
    expect(h.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('locks in feedback', async () => {
    const h = renderChallenge(c, { display: { persianKeyboard: true } })
    await h.user.type(blank(), answer)
    h.check()
    expect(blank()).toHaveAttribute('readonly')
    expect(blank()).toHaveAttribute('data-state', 'correct')
    const kb = screen.getByRole('group', { name: 'Persian keyboard' })
    expect(within(kb).getByRole('button', { name: 'ب' })).toBeDisabled()
    await h.user.type(blank(), 'x{Enter}')
    expect(blank()).toHaveValue(answer)
    expect(h.onSubmit).not.toHaveBeenCalled()
  })
})
