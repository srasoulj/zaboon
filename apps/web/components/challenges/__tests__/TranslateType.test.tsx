import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fixture, renderChallenge } from '../testing'

const c = fixture('translate_type')
const box = () => screen.getByRole('textbox', { name: 'Your answer in English' })

describe('translate_type', () => {
  it('shows the instruction, the Persian prompt and an English LTR textarea', () => {
    renderChallenge(c)
    expect(screen.getByRole('heading', { name: 'Type this in English' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Prompt' })).toHaveTextContent(c.prompt.text)
    expect(box()).toHaveAttribute('lang', 'en')
    expect(box()).toHaveAttribute('dir', 'ltr')
  })

  it('typing the translation reports a text draft graded correct', async () => {
    const h = renderChallenge(c)
    await h.user.type(box(), 'Mom is good')
    expect(h.last()).toEqual({ kind: 'text', value: 'Mom is good' })
    expect(h.verdict()).toBe('correct')
  })

  it('a wrong translation is graded wrong; a blank answer clears the draft', async () => {
    const h = renderChallenge(c)
    await h.user.type(box(), 'Dad is tea')
    expect(h.verdict()).toBe('wrong')
    await h.user.clear(box())
    expect(h.last()).toBeNull()
    await h.user.type(box(), '   ')
    expect(h.last()).toBeNull()
  })

  it('Enter asks the player to check; Shift+Enter adds a new line', async () => {
    const h = renderChallenge(c)
    await h.user.click(box())
    await h.user.keyboard('{Enter}')
    expect(h.onSubmit).not.toHaveBeenCalled() // nothing typed yet
    await h.user.keyboard('Mom is{Shift>}{Enter}{/Shift}good')
    expect(h.onSubmit).not.toHaveBeenCalled()
    expect(box()).toHaveValue('Mom is\ngood')
    await h.user.keyboard('{Enter}')
    expect(h.onSubmit).toHaveBeenCalledTimes(1)
    expect(box()).toHaveValue('Mom is\ngood')
  })

  it('is read-only in feedback', async () => {
    const h = renderChallenge(c)
    await h.user.type(box(), 'Mom is good')
    h.check()
    expect(box()).toHaveAttribute('readonly')
    expect(box()).toHaveAttribute('data-state', 'correct')
    await h.user.type(box(), '!')
    await h.user.keyboard('{Enter}')
    expect(box()).toHaveValue('Mom is good')
    expect(h.onSubmit).not.toHaveBeenCalled()
  })
})
