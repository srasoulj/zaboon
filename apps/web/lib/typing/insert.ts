/**
 * Editing a Persian text field from the in-app keyboard or a remapped physical key
 * (LEARNING-ENGINE §1.4): text goes in at the caret, replacing the selection, and stays on the
 * browser's undo stack (Ctrl/Cmd+Z undoes a key like any typed character).
 *
 * `document.execCommand('insertText' | 'delete')` is the only standard way to edit a field AND
 * keep native undo; it fires a real `input` event, so React's onChange runs. It needs the field
 * focused, so it is skipped while focus is on an on-screen key (focus stays where a keyboard user
 * is), and it may be missing or refuse (jsdom). Then `setRangeText` edits the value and an `input`
 * event is dispatched by hand (React notices the change because `setRangeText` bypasses its value
 * tracker).
 */
export type TextField = HTMLInputElement | HTMLTextAreaElement

/** The on-screen keyboard's root (packages/ui PersianKeyboard). */
const KEYBOARD_SELECTOR = '.zb-kbd'

/**
 * Runs an editing command on `el` when it may take focus: it already has it, or focus is not on an
 * on-screen key (a keyboard or screen-reader user typing key by key keeps focus on the keys; they
 * get the `setRangeText` edit, without native undo). Returns execCommand's own answer: `true`
 * means the browser performed the edit, even when the value comes out the same (ن over ن).
 */
function exec(el: TextField, command: 'insertText' | 'delete', text?: string): boolean {
  if (typeof document.execCommand !== 'function') return false
  if (document.activeElement !== el) {
    if (document.activeElement?.closest(KEYBOARD_SELECTOR)) return false
    el.focus({ preventScroll: true })
    if (document.activeElement !== el) return false
  }
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

/** Types `text` at the caret of `el` (replacing the selection), never past `maxLength`. */
export function insertAtCaret(el: TextField, text: string): void {
  if (el.readOnly || el.disabled) return
  if (exec(el, 'insertText', text)) return
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? start
  // Like typing: at maxLength nothing more goes in (the answer contract caps text at 500).
  const room = el.maxLength >= 0 ? el.maxLength - (el.value.length - (end - start)) : Infinity
  const fits = room >= text.length ? text : text.slice(0, Math.max(0, room))
  if (fits === '' && start === end) return
  fallback(el, fits, start, end)
}

/** Deletes the selection, or the character before the caret (one code point: a mark or ZWNJ first). */
export function deleteBackward(el: TextField): void {
  if (el.readOnly || el.disabled) return
  if (exec(el, 'delete')) return
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? start
  if (start !== end) return fallback(el, '', start, end)
  if (start === 0) return
  // Surrogate pairs are one character (none in Persian, but emoji may be pasted).
  const cut = /[\uDC00-\uDFFF]/.test(el.value[start - 1] ?? '') && start >= 2 ? 2 : 1
  fallback(el, '', start - cut, start)
}
