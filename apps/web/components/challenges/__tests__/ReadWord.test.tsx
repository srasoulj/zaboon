import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ChallengeOf } from '@zaboon/contracts'
import { fixture, renderChallenge, startsWith, persianOf } from '../testing'

const c = fixture('read_word')
const correct = c.choices[c.answer]!
const wrongIndex = c.choices.findIndex((_, i) => i !== c.answer)
const wrong = c.choices[wrongIndex]!

describe('read_word', () => {
  it('shows the word (lang/dir) without its transliteration, and romanized choices', () => {
    expect(c.ask).toBe('translit')
    renderChallenge(c, { display: { transliteration: true } })
    expect(screen.getByRole('heading', { name: 'How do you read this word?' })).toBeInTheDocument()
    const word = persianOf(screen.getByRole('group', { name: 'Word' }))
    expect(word).toHaveTextContent(c.word.fa)
    expect(word).not.toHaveTextContent(c.word.translit)
    expect(
      screen.getByRole('button', { name: correct }).querySelector('[lang="fa-Latn"]'),
    ).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Play audio' })).toBeNull()
  })

  it('the right reading is graded correct, another wrong', async () => {
    const h = renderChallenge(c)
    await h.user.click(screen.getByRole('button', { name: correct }))
    expect(h.last()).toEqual({ kind: 'choice', value: c.answer })
    expect(h.verdict()).toBe('correct')
    await h.user.keyboard(String(wrongIndex + 1))
    expect(h.verdict()).toBe('wrong')
  })

  it('asks for the meaning in English when ask is "meaning"', async () => {
    const meaning: ChallengeOf<'read_word'> = {
      ...c,
      ask: 'meaning',
      choices: ['dad', 'tea', 'bread', 'apple'],
      answer: 0,
    }
    const h = renderChallenge(meaning)
    expect(screen.getByRole('heading', { name: 'What does this word mean?' })).toBeInTheDocument()
    await h.user.click(screen.getByRole('button', { name: 'dad' }))
    expect(h.verdict()).toBe('correct')
  })

  it('feedback locks, highlights, and offers the word audio', async () => {
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
    await h.user.click(screen.getByRole('button', { name: 'Play audio' }))
    expect(h.audio.play).toHaveBeenCalledWith(c.word.audio!.normal)
    await h.user.keyboard(String(c.answer + 1))
    expect(h.onResponse).toHaveBeenCalledTimes(1)
  })
})
