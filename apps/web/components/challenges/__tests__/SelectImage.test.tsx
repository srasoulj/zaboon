import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fixture, renderChallenge, startsWith, persianOf } from '../testing'

const c = fixture('select_image')
const correct = c.choices[c.answer]!.label
const wrong = c.choices.find((_, i) => i !== c.answer)!.label

describe('select_image', () => {
  it('shows the heading, the Persian word and a 2×2 grid of picture cards', () => {
    renderChallenge(c)
    expect(screen.getByRole('heading', { name: 'Select the correct image' })).toBeInTheDocument()
    const word = persianOf(screen.getByRole('group', { name: 'Word' }))
    expect(word).toHaveTextContent(c.prompt.fa)
    const cards = within(screen.getByRole('group', { name: 'Choices' })).getAllByRole('button')
    expect(cards).toHaveLength(4)
    expect(cards[0]!.querySelector('img')).toHaveAttribute('src', c.choices[0]!.image)
    // CORS mode, so CDN images are cacheable by the service worker (an opaque response is not).
    for (const card of cards)
      expect(card.querySelector('img')).toHaveAttribute('crossorigin', 'anonymous')
    expect(cards.map((b) => b.getAttribute('aria-keyshortcuts'))).toEqual(['1', '2', '3', '4'])
  })

  it('tapping the right picture reports a choice graded correct', async () => {
    const h = renderChallenge(c)
    await h.user.click(screen.getByRole('button', { name: correct }))
    expect(h.last()).toEqual({ kind: 'choice', value: c.answer })
    expect(h.verdict()).toBe('correct')
    expect(screen.getByRole('button', { name: correct })).toHaveAttribute('aria-pressed', 'true')
  })

  it('a wrong picture is graded wrong', async () => {
    const h = renderChallenge(c)
    await h.user.click(screen.getByRole('button', { name: wrong }))
    expect(h.verdict()).toBe('wrong')
  })

  it('works with the keyboard alone (digits and Tab + Enter)', async () => {
    const h = renderChallenge(c)
    await h.user.keyboard(String(c.answer + 1))
    expect(h.last()).toEqual({ kind: 'choice', value: c.answer })
    await h.user.tab() // the prompt's speaker
    await h.user.tab() // the first card
    expect(screen.getAllByRole('button', { name: /./ })[1]).toHaveFocus()
    await h.user.keyboard('{Enter}')
    expect(h.last()).toEqual({ kind: 'choice', value: 0 })
  })

  it('plays the word when the speaker is pressed', async () => {
    const h = renderChallenge(c)
    await h.user.click(screen.getByRole('button', { name: 'Play audio' }))
    expect(h.audio.play).toHaveBeenCalledWith(c.prompt.audio!.normal)
  })

  it('autoplays the word once when sound is on', () => {
    const h = renderChallenge(c, { display: { sound: true } })
    expect(h.audio.play).toHaveBeenCalledTimes(1)
  })

  it('locks in feedback and highlights the chosen and the correct card', async () => {
    const h = renderChallenge(c)
    await h.user.click(screen.getByRole('button', { name: wrong }))
    h.check()
    expect(screen.getByRole('button', { name: startsWith(wrong) })).toHaveAttribute(
      'data-state',
      'wrong',
    )
    expect(screen.getByRole('button', { name: startsWith(correct) })).toHaveAttribute(
      'data-state',
      'correct',
    )
    await h.user.click(screen.getByRole('button', { name: startsWith(correct) }))
    await h.user.keyboard('1')
    expect(h.onResponse).toHaveBeenCalledTimes(1)
  })

  it('never highlights before CHECK', async () => {
    const h = renderChallenge(c)
    await h.user.click(screen.getByRole('button', { name: wrong }))
    expect(document.querySelector('[data-state]')).toBeNull()
  })
})
