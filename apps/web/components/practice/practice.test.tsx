/** DOM tests for the Practice page: START link, the word list and its empty state. */
import { act, cleanup, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { WordsResponse } from '@zaboon/contracts'
import { renderWithServices, testHome } from '../path/test-support'
import { PracticeHub } from './PracticeHub'

afterEach(() => {
  cleanup()
})

const WORDS: WordsResponse = {
  words: [
    {
      lexemeId: 'lx_salam',
      fa: 'سلام',
      translit: 'salām',
      gloss: 'hello',
      strength: 1,
      dueAt: '2026-09-24T10:00:00.000Z',
      audio: '/content/s.mp3',
    },
    {
      lexemeId: 'lx_mikham',
      fa: 'می‌خوام',
      translit: 'mikhām',
      gloss: '(I) want',
      strength: 4,
      dueAt: null,
    },
  ],
}

describe('PracticeHub', () => {
  it('has exactly one "Practice" heading and makes no request before a session exists', async () => {
    const { calls } = renderWithServices(<PracticeHub />, {
      session: null,
      handlers: { home: () => testHome(), words: () => WORDS },
    })
    await act(async () => {})
    expect(calls).toEqual([])
    expect(screen.getAllByRole('heading', { name: /practice/i })).toHaveLength(1)
    // START waits for the course.
    expect(screen.queryByRole('link', { name: 'Start' })).toBeNull()
  })

  it('START opens a practice session for the active course', async () => {
    renderWithServices(<PracticeHub />, {
      handlers: { home: () => testHome('fixture'), words: () => WORDS },
    })
    expect(await screen.findByRole('link', { name: 'Start' })).toHaveAttribute(
      'href',
      '/lesson?course=fixture&kind=practice',
    )
    expect(screen.getAllByRole('heading', { name: /practice/i })).toHaveLength(1)
  })

  it('lists the words in the order the API sends (due first) with strength and Persian markup', async () => {
    renderWithServices(<PracticeHub />, {
      handlers: { home: () => testHome(), words: () => WORDS },
    })
    const list = await screen.findByTestId('words-list')
    const items = [...list.querySelectorAll<HTMLElement>('li')]
    expect(items.map((i) => i.dataset.lexeme)).toEqual(['lx_salam', 'lx_mikham'])
    expect(within(items[0]!).getByText('salām')).toBeInTheDocument()
    expect(within(items[0]!).getByText('hello')).toBeInTheDocument()
    expect(within(items[0]!).getByRole('img', { name: 'Strength 1 of 4' })).toBeInTheDocument()
    expect(within(items[0]!).getByRole('button', { name: 'Listen: hello' })).toBeInTheDocument()
    expect(within(items[1]!).queryByRole('button')).toBeNull()
    const fa = items[1]!.querySelector('[lang="fa"]')!
    expect(fa).toHaveAttribute('dir', 'rtl')
    expect(fa.querySelectorAll('.zb-fa__word')).toHaveLength(1)
    expect(fa.textContent).toBe('می‌خوام')
  })

  it('shows an empty state without words', async () => {
    renderWithServices(<PracticeHub />, {
      handlers: { home: () => testHome(), words: () => ({ words: [] }) },
    })
    expect(await screen.findByTestId('words-empty')).toHaveTextContent(/no words yet/i)
  })
})
