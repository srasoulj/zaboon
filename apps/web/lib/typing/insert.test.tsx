import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ZWNJ } from '@zaboon/farsi'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteBackward, insertAtCaret } from './insert'

// vitest runs without globals, so Testing Library cannot register its automatic cleanup.
afterEach(() => cleanup())

function Field({ onValue }: { onValue(v: string): void }) {
  const [value, setValue] = useState('')
  return (
    <textarea
      aria-label="answer"
      value={value}
      onChange={(e) => {
        setValue(e.target.value)
        onValue(e.target.value)
      }}
    />
  )
}

const box = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'answer' })

describe('insertAtCaret / deleteBackward', () => {
  it('insert at the caret, replace the selection and notify React (onChange)', async () => {
    const onValue = vi.fn()
    render(<Field onValue={onValue} />)
    insertAtCaret(box(), 'نون')
    expect(box()).toHaveValue('نون')
    expect(onValue).toHaveBeenLastCalledWith('نون')
    box().setSelectionRange(1, 1)
    insertAtCaret(box(), ZWNJ)
    expect(box()).toHaveValue(`ن${ZWNJ}ون`)
    expect(box().selectionStart).toBe(2)
    box().setSelectionRange(0, 4)
    insertAtCaret(box(), 'آب')
    expect(box()).toHaveValue('آب')
  })

  it('delete the selection, else one character before the caret', async () => {
    const onValue = vi.fn()
    render(<Field onValue={onValue} />)
    await userEvent.setup().type(box(), 'سیب')
    deleteBackward(box())
    expect(box()).toHaveValue('سی')
    box().setSelectionRange(0, 0)
    deleteBackward(box()) // nothing before the caret
    expect(box()).toHaveValue('سی')
    box().setSelectionRange(0, 2)
    deleteBackward(box())
    expect(box()).toHaveValue('')
    expect(onValue).toHaveBeenLastCalledWith('')
  })

  it('does nothing on a read-only field', () => {
    render(<textarea aria-label="answer" readOnly defaultValue="x" />)
    insertAtCaret(box(), 'y')
    deleteBackward(box())
    expect(box()).toHaveValue('x')
  })
})
