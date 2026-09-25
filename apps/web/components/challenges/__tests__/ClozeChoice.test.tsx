import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fixture, renderChallenge, startsWith, persianOf } from '../testing'

const c = fixture('cloze_choice')
const correct = c.choices[c.answer]!
const wrongIndex = c.choices.findIndex((_, i) => i !== c.answer)
const wrong = c.choices[wrongIndex]!

describe('cloze_choice', () => {
  it('shows the sentence with a blank between whole words, and the translation', () => {
    renderChallenge(c)
    expect(screen.getByRole('heading', { name: 'Fill in the blank' })).toBeInTheDocument()
    const sentence = persianOf(screen.getByRole('group', { name: 'Sentence' }))
    expect(sentence).toHaveTextContent(c.before[0]!.surface)
    expect(sentence).toHaveTextContent(c.after[0]!.surface)
    expect(screen.getByText(c.translation)).toBeInTheDocument()
    for (const w of sentence.querySelectorAll('.zb-fa__word')) expect(w.childNodes).toHaveLength(1)
  })

  it('the right word is graded correct and fills the blank', async () => {
    const h = renderChallenge(c)
    await h.user.click(screen.getByRole('button', { name: correct }))
    expect(h.last()).toEqual({ kind: 'choice', value: c.answer })
    expect(h.verdict()).toBe('correct')
    expect(screen.getByTestId('cloze-blank')).toHaveTextContent(correct)
  })

  it('a wrong word is graded wrong', async () => {
    const h = renderChallenge(c)
    await h.user.keyboard(String(wrongIndex + 1))
    expect(h.last()).toEqual({ kind: 'choice', value: wrongIndex })
    expect(h.verdict()).toBe('wrong')
  })

  it('Persian choices carry lang/dir', () => {
    renderChallenge(c)
    const choice = screen.getByRole('button', { name: correct })
    expect(choice.querySelector('[lang="fa"][dir="rtl"]')).not.toBeNull()
  })

  it('feedback locks and highlights', async () => {
    const h = renderChallenge(c)
    await h.user.click(screen.getByRole('button', { name: wrong }))
    h.check()
    expect(screen.getByRole('button', { name: startsWith(correct) })).toHaveAttribute(
      'data-state',
      'correct',
    )
    expect(screen.getByRole('button', { name: startsWith(wrong) })).toHaveAttribute(
      'data-state',
      'wrong',
    )
    await h.user.keyboard(String(c.answer + 1))
    expect(h.onResponse).toHaveBeenCalledTimes(1)
  })
})
