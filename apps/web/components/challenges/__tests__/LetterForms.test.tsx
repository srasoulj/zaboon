import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { formPosition } from '../LetterForms'
import { fixture, renderChallenge } from '../testing'

const ZWJ = '‍'
const c = fixture('letter_forms')
const letters = () => screen.getByRole('group', { name: 'Letters' })
const forms = () => screen.getByRole('group', { name: 'Joined forms' })
const formName = (form: string) => `${form.replaceAll(ZWJ, '')}, ${formPosition(form)} form`

describe('letter_forms', () => {
  it('shows letters and joined forms, each form as one Persian text run', () => {
    renderChallenge(c)
    expect(
      screen.getByRole('heading', { name: 'Match the letter to its joined form' }),
    ).toBeInTheDocument()
    expect(within(letters()).getAllByRole('button')).toHaveLength(c.pairs.length)
    for (const p of c.pairs) {
      const b = within(forms()).getByRole('button', { name: formName(p.right) })
      const run = b.querySelector('[lang="fa"][dir="rtl"]')!
      expect(run.textContent).toBe(p.right)
      expect(run.childNodes).toHaveLength(1)
    }
  })

  it('matching every pair reports pairs graded correct and submits', async () => {
    const h = renderChallenge(c)
    for (const p of c.pairs) {
      await h.user.click(within(letters()).getByRole('button', { name: p.left }))
      await h.user.click(within(forms()).getByRole('button', { name: formName(p.right) }))
    }
    expect(h.last()).toEqual({ kind: 'pairs', value: c.pairs.map((_, i) => [i, i]) })
    expect(h.verdict()).toBe('correct')
    expect(h.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('a wrong pair calls onMismatch; an incomplete draft would grade wrong', async () => {
    const h = renderChallenge(c)
    await h.user.click(within(letters()).getByRole('button', { name: c.pairs[0]!.left }))
    await h.user.click(within(forms()).getByRole('button', { name: formName(c.pairs[1]!.right) }))
    expect(h.onMismatch).toHaveBeenCalledTimes(1)
    expect(h.onResponse).not.toHaveBeenCalled()
  })

  it('works with the keyboard alone', async () => {
    const h = renderChallenge(c)
    for (const p of c.pairs) {
      within(letters()).getByRole('button', { name: p.left }).focus()
      await h.user.keyboard('{Enter}')
      within(forms())
        .getByRole('button', { name: formName(p.right) })
        .focus()
      await h.user.keyboard('{Enter}')
    }
    expect(h.verdict()).toBe('correct')
  })

  it('is locked in feedback', async () => {
    const h = renderChallenge(c, { phase: 'feedback' })
    await h.user.click(within(letters()).getByRole('button', { name: c.pairs[0]!.left }))
    await h.user.click(within(forms()).getByRole('button', { name: formName(c.pairs[1]!.right) }))
    expect(h.onMismatch).not.toHaveBeenCalled()
  })

  it('names forms by position', () => {
    expect(formPosition(`ب${ZWJ}`)).toBe('start')
    expect(formPosition(`${ZWJ}ب${ZWJ}`)).toBe('middle')
    expect(formPosition(`${ZWJ}ب`)).toBe('end')
    expect(formPosition('ب')).toBe('alone')
  })
})
