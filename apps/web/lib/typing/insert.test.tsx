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

  it('stops at maxLength (the answer contract caps text), like typing does', () => {
    render(<textarea aria-label="answer" maxLength={5} defaultValue="abcd" />)
    box().setSelectionRange(4, 4)
    insertAtCaret(box(), 'xyz')
    expect(box()).toHaveValue('abcdx')
    insertAtCaret(box(), 'q')
    expect(box()).toHaveValue('abcdx')
    // Replacing a selection frees room.
    box().setSelectionRange(0, 2)
    insertAtCaret(box(), 'پپپ')
    expect(box()).toHaveValue('پپcdx')
  })
})

describe('with a browser execCommand', () => {
  /** A stand-in for the browser's insertText: edits the focused field, answers true. */
  function fakeExec(command: string, _ui?: boolean, text?: string): boolean {
    const el = document.activeElement
    if (!(el instanceof HTMLTextAreaElement)) return false
    const start = el.selectionStart
    const end = el.selectionEnd
    if (command === 'insertText') el.setRangeText(text ?? '', start, end, 'end')
    else if (command === 'delete')
      el.setRangeText('', start === end ? Math.max(0, start - 1) : start, end, 'end')
    else return false
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }

  // jsdom has no execCommand at all: install one for these tests.
  const install = () => {
    const exec = vi.fn(fakeExec)
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
    return exec
  }
  afterEach(() => {
    Reflect.deleteProperty(document, 'execCommand')
  })

  it('trusts execCommand: replacing a letter with the same letter inserts once', () => {
    const exec = install()
    render(<Field onValue={() => {}} />)
    insertAtCaret(box(), 'نون')
    box().setSelectionRange(2, 3) // the last ن
    insertAtCaret(box(), 'ن')
    expect(box()).toHaveValue('نون')
    expect(exec).toHaveBeenCalledTimes(2)
  })

  it('never moves focus off an on-screen key (keyboard users stay on the keys)', () => {
    const exec = install()
    render(
      <>
        <Field onValue={() => {}} />
        <div className="zb-kbd">
          <button type="button">ب</button>
        </div>
      </>,
    )
    const key = screen.getByRole('button', { name: 'ب' })
    key.focus()
    insertAtCaret(box(), 'ب')
    deleteBackward(box())
    insertAtCaret(box(), 'ب')
    expect(box()).toHaveValue('ب')
    expect(key).toHaveFocus()
    expect(exec).not.toHaveBeenCalled()
  })
})
