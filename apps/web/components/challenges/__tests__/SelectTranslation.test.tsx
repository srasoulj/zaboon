import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { fixture, renderChallenge, startsWith, persianOf } from '../testing'

const c = fixture('select_translation')
const correct = c.choices[c.answer]!.text
const wrongIndex = c.choices.findIndex((_, i) => i !== c.answer)
const wrong = c.choices[wrongIndex]!.text

describe('select_translation', () => {
  it('shows the instruction, the Persian prompt (lang/dir) and English choices', () => {
    renderChallenge(c)
    expect(screen.getByRole('heading', { name: 'Select the correct meaning' })).toBeInTheDocument()
    const prompt = persianOf(screen.getByRole('group', { name: 'Prompt' }))
    expect(prompt).toHaveTextContent(c.prompt.text)
    expect(
      within(screen.getByRole('group', { name: 'Choices' })).getAllByRole('button'),
    ).toHaveLength(c.choices.length)
  })

  it('the right meaning is graded correct, another one wrong', async () => {
    const h = renderChallenge(c)
    await h.user.click(screen.getByRole('button', { name: correct }))
    expect(h.last()).toEqual({ kind: 'choice', value: c.answer })
    expect(h.verdict()).toBe('correct')
    await h.user.click(screen.getByRole('button', { name: wrong }))
    expect(h.last()).toEqual({ kind: 'choice', value: wrongIndex })
    expect(h.verdict()).toBe('wrong')
    expect(screen.getByRole('button', { name: correct })).toHaveAttribute('aria-pressed', 'false')
  })

  it('Enter on the already-selected card reaches the player untouched (it becomes CHECK)', async () => {
    const seen = vi.fn()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') seen(e.defaultPrevented)
    }
    window.addEventListener('keydown', onKey)
    try {
      const h = renderChallenge(c)
      await h.user.click(screen.getByRole('button', { name: correct }))
      expect(screen.getByRole('button', { name: correct })).toHaveFocus()
      expect(screen.getByRole('button', { name: correct })).toHaveAttribute('aria-pressed', 'true')
      await h.user.keyboard('{Enter}')
      expect(seen).toHaveBeenCalledWith(false)
      expect(h.last()).toEqual({ kind: 'choice', value: c.answer }) // the draft is unchanged
    } finally {
      window.removeEventListener('keydown', onKey)
    }
  })

  it('digit keys pick an option', async () => {
    const h = renderChallenge(c)
    await h.user.keyboard(String(c.answer + 1))
    expect(h.verdict()).toBe('correct')
  })

  it('shows transliteration under each word and vowel marks only when asked', () => {
    const { unmount } = renderChallenge(c)
    expect(screen.queryByText('salām')).toBeNull()
    expect(screen.getByRole('group', { name: 'Prompt' })).toHaveTextContent('سلام،')
    unmount()
    renderChallenge(c, { display: { transliteration: true, vowelMarks: true } })
    expect(screen.getByText('salām')).toHaveAttribute('lang', 'fa-Latn')
    expect(screen.getByRole('group', { name: 'Prompt' })).toHaveTextContent('سَلام،')
  })

  it('the speaker plays the prompt audio', async () => {
    const h = renderChallenge(c)
    await h.user.click(screen.getByRole('button', { name: 'Play audio' }))
    expect(h.audio.play).toHaveBeenCalledWith(c.prompt.fa!.audio!.normal)
  })

  it('feedback locks the choices and marks the chosen and correct ones', async () => {
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
    expect(h.onResponse).toHaveBeenCalledTimes(1)
  })
})
