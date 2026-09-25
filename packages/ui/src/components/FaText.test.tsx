import '../test-utils'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FaText, splitWords, stripVowelMarks, type FaToken } from './FaText'

const ZWNJ = '\u200C'
const TOKENS: FaToken[] = [
  { surface: 'مَن', translit: 'man', gloss: 'I' },
  { surface: 'آب', translit: 'āb', gloss: 'water' },
  { surface: `می${ZWNJ}خوام`, translit: 'mikhām', gloss: '(I) want' },
]

/** Every element that directly contains Persian letters must contain a whole token. */
function wordElements(root: HTMLElement): Element[] {
  return [...root.querySelectorAll('.zb-fa__word')]
}

describe('FaText', () => {
  it('sets lang="fa" and dir="rtl" on the root', () => {
    const { container } = render(<FaText text="سلام دنیا" />)
    const root = container.firstElementChild!
    expect(root).toHaveAttribute('lang', 'fa')
    expect(root).toHaveAttribute('dir', 'rtl')
  })

  it('renders each whole word as a single text node (never splits a word)', () => {
    const { container } = render(<FaText tokens={TOKENS} translit />)
    const words = wordElements(container as HTMLElement)
    expect(words.map((w) => w.textContent)).toEqual(TOKENS.map((t) => t.surface))
    for (const w of words) {
      expect(w.childNodes).toHaveLength(1)
      expect(w.firstChild?.nodeType).toBe(Node.TEXT_NODE)
    }
  })

  it('keeps ZWNJ compounds intact and preserves the reading text', () => {
    const { container } = render(<FaText text={`من آب می${ZWNJ}خوام`} />)
    expect(container.textContent).toBe(`من آب می${ZWNJ}خوام`)
    expect(splitWords(`  آب\u00A0 می${ZWNJ}خوام `).map((t) => t.surface)).toEqual(['آب', `می${ZWNJ}خوام`])
  })

  it('shows a transliteration line under each token', () => {
    const { container } = render(<FaText tokens={TOKENS} translit />)
    const lines = [...container.querySelectorAll('.zb-fa__translit')]
    expect(lines.map((l) => l.textContent)).toEqual(['man', 'āb', 'mikhām'])
    expect(lines[0]).toHaveAttribute('dir', 'ltr')
    expect(lines[0]).toHaveAttribute('lang', 'fa-Latn')
  })

  it('decides transliteration per token and keeps alignment with blank lines', () => {
    const { container } = render(<FaText tokens={TOKENS} translit={(t) => t.gloss === 'water'} />)
    const lines = [...container.querySelectorAll('.zb-fa__translit')]
    expect(lines.map((l) => l.textContent)).toEqual(['\u00A0', 'āb', '\u00A0'])
    expect(lines[0]).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders no transliteration line when disabled', () => {
    const { container } = render(<FaText tokens={TOKENS} />)
    expect(container.querySelector('.zb-fa__translit')).toBeNull()
  })

  it('strips vowel marks only when vowels={false}', () => {
    const { container, rerender } = render(<FaText text="مَن آبِ" />)
    expect(container.textContent).toBe('مَن آبِ')
    rerender(<FaText text="مَن آبِ" vowels={false} />)
    expect(container.textContent).toBe('من آب')
    expect(stripVowelMarks(`مَن می${ZWNJ}خوام`)).toBe(`من می${ZWNJ}خوام`)
  })

  it('tap-for-hint: each word is a button that reports its token', async () => {
    const onTap = vi.fn()
    render(<FaText tokens={TOKENS} onTokenTap={onTap} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(3)
    const user = userEvent.setup()
    await user.click(buttons[1]!)
    expect(onTap).toHaveBeenCalledWith(TOKENS[1], 1)
    buttons[2]!.focus()
    await user.keyboard('{Enter}')
    expect(onTap).toHaveBeenLastCalledWith(TOKENS[2], 2)
  })

  it('highlights whole words only', () => {
    const { container } = render(<FaText tokens={TOKENS} highlight={[2]} />)
    const marked = container.querySelectorAll('.zb-fa__word--mark')
    expect(marked).toHaveLength(1)
    expect(marked[0]!.textContent).toBe(TOKENS[2]!.surface)
  })

  it('supports block elements and an accessible label', () => {
    const { rerender } = render(<FaText as="p" text="سلام" aria-label="Persian: hello" />)
    const group = screen.getByRole('group', { name: 'Persian: hello' })
    expect(group).toHaveAccessibleName('Persian: hello')
    expect(group.tagName).toBe('P')
    expect(group).toHaveTextContent('سلام')
    rerender(<FaText as="p" text="سلام" />)
    expect(screen.queryByRole('group')).toBeNull()
    expect(screen.getByText('سلام').closest('p')).not.toHaveAttribute('aria-label')
  })
})
