import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { joinedForm } from '../LetterIntro'
import { fixture, renderChallenge } from '../testing'

const ZWJ = '‍'
const c = fixture('letter_intro')

describe('letter_intro', () => {
  it('reports {kind:"none"} immediately, which is graded correct', () => {
    const h = renderChallenge(c)
    expect(h.onResponse).toHaveBeenCalledTimes(1)
    expect(h.last()).toEqual({ kind: 'none' })
    expect(h.verdict()).toBe('correct')
  })

  it('shows the letter, its name and sound, and the four forms joined with ZWJ', () => {
    renderChallenge(c)
    expect(screen.getByRole('heading', { name: 'New letter' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: `The letter ${c.letter.name}` })).toHaveTextContent(
      c.letter.letter,
    )
    expect(screen.getByRole('group', { name: 'Forms' })).toBeInTheDocument()
    const text = (p: string) => document.querySelector(`[data-form="${p}"]`)!
    expect(text('initial').textContent).toBe(`${c.letter.letter}${ZWJ}`)
    expect(text('medial').textContent).toBe(`${ZWJ}${c.letter.letter}${ZWJ}`)
    expect(text('final').textContent).toBe(`${ZWJ}${c.letter.letter}`)
    for (const p of ['isolated', 'initial', 'medial', 'final']) {
      expect(text(p).childNodes).toHaveLength(1) // one text run each
      expect(text(p)).toHaveAttribute('lang', 'fa')
    }
  })

  it('plays the letter and each example word', async () => {
    const h = renderChallenge(c)
    await h.user.click(screen.getByRole('button', { name: `Play the letter ${c.letter.name}` }))
    expect(h.audio.play).toHaveBeenLastCalledWith(c.letter.audio)
    const examples = screen.getByRole('list', { name: 'Example words' })
    expect(within(examples).getAllByRole('listitem')).toHaveLength(c.examples.length)
    const ex = c.examples[0]!
    await h.user.click(within(examples).getByRole('button', { name: `Play ${ex.translit}` }))
    expect(h.audio.play).toHaveBeenLastCalledWith(ex.audio!.normal)
    expect(within(examples).getByText(ex.en)).toBeInTheDocument()
  })

  it('audio buttons work from the keyboard', async () => {
    const h = renderChallenge(c)
    await h.user.tab()
    expect(screen.getByRole('button', { name: `Play the letter ${c.letter.name}` })).toHaveFocus()
    await h.user.keyboard('{Enter}')
    expect(h.audio.play).toHaveBeenCalledWith(c.letter.audio)
  })

  it('does not report again when the draft is already set (feedback)', () => {
    const h = renderChallenge(c, { phase: 'feedback', response: { kind: 'none' } })
    expect(h.onResponse).not.toHaveBeenCalled()
  })
})

describe('joinedForm', () => {
  it('adds ZWJs only where missing, respecting non-joining letters', () => {
    expect(joinedForm('ب', 'initial', true)).toBe(`ب${ZWJ}`)
    expect(joinedForm('ب', 'medial', true)).toBe(`${ZWJ}ب${ZWJ}`)
    expect(joinedForm('ب', 'final', true)).toBe(`${ZWJ}ب`)
    expect(joinedForm('د', 'initial', false)).toBe('د')
    expect(joinedForm('د', 'medial', false)).toBe(`${ZWJ}د`)
    expect(joinedForm(`${ZWJ}ب`, 'final', true)).toBe(`${ZWJ}ب`)
    expect(joinedForm('ب', 'isolated', true)).toBe('ب')
  })
})
