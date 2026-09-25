import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { formPosition } from '../LetterForms'
import { fixture, renderChallenge, tabTo } from '../testing'

const ZWJ = '‍'

/** The card in `group` whose Persian run is exactly `form`. */
function card(group: HTMLElement, form: string): HTMLElement {
  const found = within(group)
    .getAllByRole('button')
    .find((b) => b.querySelector('[lang="fa"]')?.textContent === form)
  if (!found) throw new Error(`no card for ${JSON.stringify(form)}`)
  return found
}

describe('letter_forms (several letters)', () => {
  const c = fixture('letter_forms')
  const letters = () => screen.getByRole('group', { name: 'Letters' })
  const forms = () => screen.getByRole('group', { name: 'Joined forms' })

  it('shows letters and joined forms, each form as one Persian text run with an English position', () => {
    renderChallenge(c)
    expect(
      screen.getByRole('heading', { name: 'Match the letter to its joined form' }),
    ).toBeInTheDocument()
    expect(within(letters()).getAllByRole('button')).toHaveLength(c.pairs.length)
    for (const p of c.pairs) {
      const b = card(forms(), p.right)
      expect(b).not.toHaveAttribute('lang')
      const run = b.querySelector('[lang="fa"][dir="rtl"]')!
      expect(run.childNodes).toHaveLength(1)
      expect(b).toHaveAccessibleName(
        expect.stringMatching(new RegExp(`, ${formPosition(p.right)} form$`)),
      )
      expect(b.querySelector('[lang="fa"]')!.textContent).not.toContain(' form')
    }
  })

  it('matching every pair reports pairs graded correct and submits', async () => {
    const h = renderChallenge(c)
    for (const p of c.pairs) {
      await h.user.click(card(letters(), p.left))
      await h.user.click(card(forms(), p.right))
    }
    expect(h.last()).toEqual({ kind: 'pairs', value: c.pairs.map((_, i) => [i, i]) })
    expect(h.verdict()).toBe('correct')
    expect(h.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('a wrong pair calls onMismatch; no draft is reported', async () => {
    const h = renderChallenge(c)
    await h.user.click(card(letters(), c.pairs[0]!.left))
    await h.user.click(card(forms(), c.pairs[1]!.right))
    expect(h.onMismatch).toHaveBeenCalledTimes(1)
    expect(h.onResponse).not.toHaveBeenCalled()
  })

  it('works with the keyboard alone (Tab + Enter)', async () => {
    const h = renderChallenge(c)
    for (const p of c.pairs) {
      await tabTo(h.user, card(letters(), p.left))
      await h.user.keyboard('{Enter}')
      await tabTo(h.user, card(forms(), p.right))
      await h.user.keyboard('{Enter}')
      expect(card(forms(), p.right)).toHaveFocus()
    }
    expect(h.verdict()).toBe('correct')
  })

  it('is locked in feedback', async () => {
    const h = renderChallenge(c, { phase: 'feedback' })
    await h.user.click(card(letters(), c.pairs[0]!.left))
    await h.user.click(card(forms(), c.pairs[1]!.right))
    expect(h.onMismatch).not.toHaveBeenCalled()
  })

  it('names forms by position', () => {
    expect(formPosition(`ب${ZWJ}`)).toBe('start')
    expect(formPosition(`${ZWJ}ب${ZWJ}`)).toBe('middle')
    expect(formPosition(`${ZWJ}ب`)).toBe('end')
    expect(formPosition('ب')).toBe('alone')
  })
})

describe('letter_forms (one letter: position names to shapes)', () => {
  // Recorded from buildChallenge({ type: 'letter_forms', items: ['l_be'] }) (fixture-challenges.test.ts).
  const one = fixture('letter_forms', 1)
  const positions = () => screen.getByRole('group', { name: 'Positions' })
  const shapes = () => screen.getByRole('group', { name: 'Shapes' })
  const LABEL: Record<string, string> = {
    isolated: 'Alone',
    initial: 'Start',
    medial: 'Middle',
    final: 'End',
  }

  it('is what the engine builds for a single-letter ref', () => {
    expect(one.type).toBe('letter_forms')
    expect(one.pairs.map((p) => p.left)).toEqual(['isolated', 'initial', 'medial', 'final'])
  })

  it('shows English position names and Persian shapes, without giving the answer away', () => {
    renderChallenge(one)
    expect(
      screen.getByRole('heading', { name: 'Match each position to its shape' }),
    ).toBeInTheDocument()
    expect(positions()).toHaveAttribute('dir', 'ltr')
    for (const p of one.pairs) {
      const name = within(positions()).getByRole('button', { name: LABEL[p.left] })
      expect(name.querySelector('[lang="fa"]')).toBeNull()
      // The position name is English by inheritance: the nearest lang to the text is the
      // challenge's "en".
      expect(within(name).getByText(LABEL[p.left]!).closest('[lang]')).toHaveAttribute('lang', 'en')
      const shape = card(shapes(), p.right)
      expect(shape).not.toHaveAccessibleName(expect.stringContaining('form'))
    }
    expect(screen.queryByText('isolated')).toBeNull()
  })

  it('matching each position to its shape is graded correct', async () => {
    const h = renderChallenge(one)
    for (const p of one.pairs) {
      await h.user.click(within(positions()).getByRole('button', { name: LABEL[p.left] }))
      await h.user.click(card(shapes(), p.right))
    }
    expect(h.last()).toEqual({ kind: 'pairs', value: one.pairs.map((_, i) => [i, i]) })
    expect(h.verdict()).toBe('correct')
  })

  it('a wrong position is a mismatch', async () => {
    const h = renderChallenge(one)
    await h.user.click(within(positions()).getByRole('button', { name: 'Alone' }))
    await h.user.click(card(shapes(), one.pairs[3]!.right))
    expect(h.onMismatch).toHaveBeenCalledTimes(1)
  })
})
