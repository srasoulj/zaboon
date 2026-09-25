import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ChallengeOf } from '@zaboon/contracts'
import { fixture, renderChallenge, startsWith } from '../testing'

const c = fixture('letter_sound')
const correct = c.choices[c.answer]!
const wrongIndex = c.choices.findIndex((_, i) => i !== c.answer)
const wrong = c.choices[wrongIndex]!
/** The same letter asked the other way round (the builder picks the mode per variant). */
const reverse: ChallengeOf<'letter_sound'> = {
  ...c,
  mode: 'sound_to_letter',
  choices: ['د', 'ب', 'ر', 'ا'],
  answer: 1,
}

describe('letter_sound (letter → sound)', () => {
  it('shows the letter and romanized sound choices', () => {
    expect(c.mode).toBe('letter_to_sound')
    renderChallenge(c)
    expect(
      screen.getByRole('heading', { name: 'What sound does this letter make?' }),
    ).toBeInTheDocument()
    const letter = screen.getByRole('group', { name: 'Letter' })
    expect(letter).toHaveAttribute('lang', 'fa')
    expect(letter).toHaveTextContent(c.letter.letter)
    expect(
      within(screen.getByRole('group', { name: 'Choices' })).getAllByRole('button'),
    ).toHaveLength(c.choices.length)
  })

  it('the right sound is graded correct, another wrong', async () => {
    const h = renderChallenge(c)
    await h.user.click(screen.getByRole('button', { name: correct }))
    expect(h.last()).toEqual({ kind: 'choice', value: c.answer })
    expect(h.verdict()).toBe('correct')
    await h.user.keyboard(String(wrongIndex + 1))
    expect(h.verdict()).toBe('wrong')
  })

  it('plays the letter on demand and does not autoplay the answer', async () => {
    const h = renderChallenge(c, { display: { sound: true } })
    expect(h.audio.play).not.toHaveBeenCalled()
    await h.user.click(screen.getByRole('button', { name: 'Play the letter' }))
    expect(h.audio.play).toHaveBeenCalledWith(c.letter.audio)
  })

  it('feedback locks and highlights', async () => {
    const h = renderChallenge(c)
    await h.user.click(screen.getByRole('button', { name: wrong }))
    h.check()
    expect(screen.getByRole('button', { name: startsWith(correct) })).toHaveAttribute(
      'data-state',
      'correct',
    )
    await h.user.click(screen.getByRole('button', { name: startsWith(correct) }))
    expect(h.onResponse).toHaveBeenCalledTimes(1)
  })
})

describe('letter_sound (sound → letter)', () => {
  it('shows the big speaker and turtle, autoplays, and offers Persian letters', async () => {
    const h = renderChallenge(reverse, { display: { sound: true } })
    expect(
      screen.getByRole('heading', { name: 'Which letter makes this sound?' }),
    ).toBeInTheDocument()
    expect(h.audio.play).toHaveBeenCalledTimes(1)
    await h.user.click(screen.getByRole('button', { name: 'Play slowly' }))
    expect(h.audio.play).toHaveBeenLastCalledWith(c.letter.audio, { slow: true })
    const choice = screen.getByRole('button', { name: 'ب' })
    expect(choice.querySelector('[lang="fa"][dir="rtl"]')).not.toBeNull()
    await h.user.click(choice)
    expect(h.verdict()).toBe('correct')
  })
})
