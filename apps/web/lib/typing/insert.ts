/**
 * Editing a Persian text field from the in-app keyboard or a remapped physical key
 * (LEARNING-ENGINE §1.4): text goes in at the caret, replacing the selection, and stays on the
 * browser's undo stack (Ctrl/Cmd+Z undoes a key like any typed character).
 *
 * `document.execCommand('insertText' | 'delete')` is the only standard way to edit a field AND
 * keep native undo; it fires a real `input` event, so React's onChange runs. Where it is missing
 * or refuses (jsdom, a field that isn't focused), `setRangeText` edits the value and an `input`
 * event is dispatched by hand (React notices the change because `setRangeText` bypasses its value
 * tracker).
 */
export type TextField = HTMLInputElement | HTMLTextAreaElement

function exec(el: TextField, command: 'insertText' | 'delete', text?: string): boolean {
  if (typeof document.execCommand !== 'function') return false
  if (document.activeElement !== el) el.focus({ preventScroll: true })
  try {
    return document.execCommand(command, false, text)
  } catch {
    return false
  }
}

function fallback(el: TextField, text: string, start: number, end: number): void {
  el.setRangeText(text, start, end, 'end')
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Types `text` at the caret of `el` (replacing the selection). */
export function insertAtCaret(el: TextField, text: string): void {
  if (el.readOnly || el.disabled) return
  const before = el.value
  if (exec(el, 'insertText', text) && el.value !== before) return
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? start
  fallback(el, text, start, end)
}

/** Deletes the selection, or the character before the caret (one code point: a mark or ZWNJ first). */
export function deleteBackward(el: TextField): void {
  if (el.readOnly || el.disabled) return
  const before = el.value
  if (exec(el, 'delete') && el.value !== before) return
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? start
  if (start !== end) return fallback(el, '', start, end)
  if (start === 0) return
  // Surrogate pairs are one character (none in Persian, but emoji may be pasted).
  const cut = /[\uDC00-\uDFFF]/.test(el.value[start - 1] ?? '') && start >= 2 ? 2 : 1
  fallback(el, '', start - cut, start)
}
