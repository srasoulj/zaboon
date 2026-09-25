import { act, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { fixture, renderChallenge, startsWith, persianOf } from '../testing'

const c = fixture('complete_chat')
const correct = c.choices[c.answer]!.fa
const wrong = c.choices.find((_, i) => i !== c.answer)!.fa

describe('complete_chat', () => {
  it('shows the speaker, their line in a bubble, and the replies', () => {
    renderChallenge(c)
    expect(screen.getByRole('heading', { name: 'Complete the chat' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: c.speaker.name })).toBeInTheDocument()
    const line = persianOf(screen.getByRole('group', { name: `${c.speaker.name} says` }))
    expect(line).toHaveTextContent(c.prompt.fa)
    expect(screen.getByRole('group', { name: 'Replies' })).toBeInTheDocument()
  })

  it('the best reply is graded correct, another wrong', async () => {
    const h = renderChallenge(c)
    await h.user.click(screen.getByRole('button', { name: correct }))
    expect(h.last()).toEqual({ kind: 'choice', value: c.answer })
    expect(h.verdict()).toBe('correct')
    await h.user.click(screen.getByRole('button', { name: wrong }))
    expect(h.verdict()).toBe('wrong')
  })

  it('digit keys pick a reply', async () => {
    const h = renderChallenge(c)
    await h.user.keyboard(String(c.answer + 1))
    expect(h.verdict()).toBe('correct')
  })

  it('lip-syncs only while a clip plays, never under reduced motion', async () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    const h = renderChallenge(c)
    expect(raf).not.toHaveBeenCalled() // nothing polls while no audio plays
    await h.user.click(screen.getByRole('button', { name: 'Play audio' }))
    expect(h.audio.play).toHaveBeenCalledWith(c.prompt.audio!.normal)
    expect(raf).toHaveBeenCalled()
    h.unmount()
    raf.mockClear()
    const r = renderChallenge(c, { display: { reducedMotion: true } })
    await r.user.click(screen.getByRole('button', { name: 'Play audio' }))
    expect(raf).not.toHaveBeenCalled()
    raf.mockRestore()
  })

  it('feedback locks the replies, highlights them and cheers or frowns', async () => {
    const h = renderChallenge(c)
    await h.user.click(screen.getByRole('button', { name: wrong }))
    act(() => h.check())
    expect(screen.getByRole('button', { name: startsWith(correct) })).toHaveAttribute(
      'data-state',
      'correct',
    )
    expect(screen.getByRole('button', { name: startsWith(wrong) })).toHaveAttribute(
      'data-state',
      'wrong',
    )
    expect(screen.getByRole('img', { name: c.speaker.name })).toHaveAttribute('data-mood', 'sad')
    await h.user.click(screen.getByRole('button', { name: startsWith(correct) }))
    expect(h.onResponse).toHaveBeenCalledTimes(1)
  })
})
