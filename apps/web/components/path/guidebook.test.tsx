/** DOM tests for the Guidebook renderer: sanitizing, <fa> → FaText with audio, tables, fetching. */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GuidebookMarkdown, GuidebookView, textOf } from './GuidebookView'
import { renderWithServices } from './test-support'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const HOSTILE = `
# Title

<script>window.__pwned = true</script>
<img src="x.png" onerror="window.__pwned = true" alt="x">
<a href="javascript:alert(1)" onclick="window.__pwned = true">link</a>
<fa audio="/content/fixture/assets/audio/a.0123456789.mp3" onclick="window.__pwned = true" style="color:red">سلام، خوبی؟</fa>
<iframe src="https://example.com"></iframe>
<div onmouseover="x" style="position:fixed">styled</div>
`

describe('GuidebookMarkdown', () => {
  it('strips scripts, event handlers, styles and javascript: links', () => {
    const { container } = render(<GuidebookMarkdown markdown={HOSTILE} />)
    expect(container.querySelector('script, iframe')).toBeNull()
    const all = [...container.querySelectorAll('*')]
    for (const el of all) {
      for (const attr of el.getAttributeNames())
        expect(attr, `${el.tagName} ${attr}`).not.toMatch(/^on|^style$/)
    }
    expect(container.querySelector('a')?.getAttribute('href') ?? '').not.toMatch(/javascript/i)
    expect((window as { __pwned?: boolean }).__pwned).toBeUndefined()
  })

  it('renders <fa> as FaText (lang="fa" dir="rtl") with a speaker that plays the audio', async () => {
    const play = vi.fn(() => Promise.resolve())
    const AudioMock = vi.fn(function (this: { play: typeof play; pause(): void }, _url: string) {
      this.play = play
      this.pause = () => {}
    })
    vi.stubGlobal('Audio', AudioMock)
    const { container } = render(<GuidebookMarkdown markdown={HOSTILE} />)
    const phrase = screen.getByTestId('guidebook-phrase')
    const fa = phrase.querySelector('[lang="fa"]')
    expect(fa).toHaveAttribute('dir', 'rtl')
    // Whole words, each one text node in its own element.
    expect([...fa!.querySelectorAll('.zb-fa__word')].map((w) => w.textContent)).toEqual([
      'سلام،',
      'خوبی؟',
    ])
    expect(container.querySelector('fa')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Listen' }))
    expect(AudioMock).toHaveBeenCalledWith('/content/fixture/assets/audio/a.0123456789.mp3')
    expect(play).toHaveBeenCalled()
  })

  it('an <fa> without resolvable audio has no speaker; ZWNJ stays inside its word', () => {
    render(<GuidebookMarkdown markdown={'Say <fa audio="">می‌خوام</fa> today.'} />)
    expect(screen.queryByRole('button', { name: 'Listen' })).toBeNull()
    const words = [...document.querySelectorAll('.zb-fa__word')].map((w) => w.textContent)
    expect(words).toEqual(['می‌خوام'])
  })

  it('renders GFM tables and moves headings down one level', () => {
    const md =
      '# Top\n\n## Sub\n\n| Persian | English |\n|---|---|\n| <fa audio="">آب</fa> | water |\n'
    render(<GuidebookMarkdown markdown={md} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Top' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Sub' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    const table = screen.getByRole('table')
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
      'Persian',
      'English',
    ])
    expect(table.querySelector('td [lang="fa"]')).toHaveTextContent('آب')
  })
})

describe('textOf', () => {
  it('flattens nested children to text', () => {
    expect(textOf(['a', <b key="b">b</b>, 3])).toBe('ab3')
  })
})

describe('GuidebookView', () => {
  const RESPONSE = {
    courseId: 'fixture',
    contentVersion: 1,
    unitId: 'u01-fixture',
    title: 'Fixture unit',
    markdown: '# Hello\n\n<fa audio="">سلام</fa>',
  }

  it('waits for a session, then fetches the unit for the given course', async () => {
    const guidebook = vi.fn(() => RESPONSE)
    const { calls } = renderWithServices(
      <GuidebookView unitId="u01-fixture" courseId="fixture" />,
      {
        session: null,
        handlers: { guidebook },
      },
    )
    await act(async () => {})
    expect(calls).toEqual([])
    cleanup()
    const second = renderWithServices(<GuidebookView unitId="u01-fixture" courseId="fixture" />, {
      handlers: { guidebook },
    })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Guidebook: Fixture unit' }),
    ).toBeInTheDocument()
    expect(second.calls).toEqual([
      {
        name: 'guidebook',
        opts: { params: { unitId: 'u01-fixture' }, query: { courseId: 'fixture' } },
      },
    ])
    expect(screen.getByRole('link', { name: /back to the path/i })).toHaveAttribute(
      'href',
      '/learn',
    )
    expect(screen.getByText('سلام').closest('[lang="fa"]')).toHaveAttribute('dir', 'rtl')
  })

  it('shows a message when the guidebook is missing', async () => {
    renderWithServices(<GuidebookView unitId="u99-x" courseId={null} />, {
      handlers: {
        guidebook: () => {
          throw new Error('not found')
        },
      },
    })
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/isn.t available/))
  })
})
