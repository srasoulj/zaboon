'use client'
/**
 * A typed-Persian answer field (P2, LEARNING-ENGINE §1.3–§1.4): a textarea (or an inline input for
 * the cloze blank) with `lang="fa" dir="rtl"` set explicitly, plus the in-app `PersianKeyboard`
 * while `display.persianKeyboard` is on.
 *
 * - The on-screen keyboard types at the caret, replacing the selection, and stays undoable
 *   (lib/typing/insert.ts). Its keys never take focus from the field on tap.
 * - Physical keys: a Latin key is remapped to the learner's layout by `event.code`; OS Persian
 *   layouts, IMEs (composition, Android's keyCode 229) and shortcuts pass through untouched.
 * - Touch devices get `inputmode="none"` while the in-app keyboard is shown, so the OS keyboard
 *   stays down.
 * - Enter asks the player to CHECK; Shift+Enter is a newline (textarea only).
 * - The learner's text is never normalized here: the grader normalizes both sides.
 */
import { remapPhysicalKey } from '@zaboon/farsi'
import { PersianKeyboard } from '@zaboon/ui'
import {
  useId,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
  type Ref,
  type RefObject,
} from 'react'
import type { ChallengeDisplay } from '@/lib/challenge-registry'
import { deleteBackward, insertAtCaret, type TextField } from '@/lib/typing/insert'
import { styles } from './shared'

const COARSE = '(pointer: coarse)'

function subscribeCoarse(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(COARSE)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/** True on touch-first devices (a coarse primary pointer). */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribeCoarse,
    () => typeof window.matchMedia === 'function' && window.matchMedia(COARSE).matches,
    () => false,
  )
}

export interface PersianFieldProps {
  value: string
  onChange(value: string): void
  /** Enter (and the keyboard's enter key): the host submits if there is an answer. */
  onEnter(): void
  locked: boolean
  display: ChallengeDisplay
  /** English name of the field (rendered as a visually hidden English label). */
  label: string
  /** An inline one-line input (the cloze blank) instead of the textarea. */
  inline?: boolean
  placeholder?: string
  state?: 'correct' | 'wrong'
  className?: string
  /** The field element, for a `KeyboardFor` rendered elsewhere (the inline cloze blank). */
  fieldRef?: RefObject<TextField | null>
}

export function PersianField(props: PersianFieldProps) {
  const { value, onChange, onEnter, locked, display, label, inline = false } = props
  const ownRef = useRef<TextField>(null)
  const ref = props.fieldRef ?? ownRef
  const labelId = useId()
  const layout = display.keyboardLayout ?? 'standard'
  const onScreen = display.persianKeyboard === true
  const coarse = useCoarsePointer()

  useLayoutEffect(() => {
    const el = ref.current
    if (inline || !el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value, inline, ref])

  const onKeyDown = (e: KeyboardEvent<TextField>) => {
    const native = e.nativeEvent
    if (e.key === 'Enter' && !native.isComposing && native.keyCode !== 229) {
      if (e.shiftKey && !inline) return // newline
      e.preventDefault()
      if (!locked) onEnter()
      return
    }
    if (locked) return
    const char = remapPhysicalKey(layout, native)
    if (char === null) return
    e.preventDefault()
    insertAtCaret(e.currentTarget, char)
  }

  const field = {
    ref: ref as Ref<HTMLInputElement & HTMLTextAreaElement>,
    value,
    onChange: (e: { target: { value: string } }) => {
      if (!locked) onChange(e.target.value)
    },
    onKeyDown,
    readOnly: locked,
    'aria-labelledby': labelId,
    placeholder: props.placeholder,
    lang: 'fa',
    dir: 'rtl' as const,
    maxLength: 500,
    autoComplete: 'off',
    autoCorrect: 'off',
    autoCapitalize: 'off',
    spellCheck: false,
    inputMode: onScreen && coarse ? ('none' as const) : undefined,
    'data-state': props.state,
    'data-testid': 'persian-answer',
  }

  const withField = (fn: (el: TextField) => void) => () => {
    const el = ref.current
    if (el && !locked) fn(el)
  }

  return (
    <div className={inline ? styles.persianInline : styles.persianField}>
      <span id={labelId} className={styles.srOnly} lang="en">
        {label}
      </span>
      {inline ? (
        <input
          {...field}
          type="text"
          className={props.className ?? styles.blankInput}
          size={Math.max(4, [...value].length + 1)}
        />
      ) : (
        <textarea
          {...field}
          className={props.className ?? `${styles.textarea} ${styles.textareaFa}`}
          rows={2}
        />
      )}
      {onScreen && !inline && (
        <PersianKeyboard
          layout={layout}
          disabled={locked}
          onKey={(text) => withField((el) => insertAtCaret(el, text))()}
          onBackspace={withField(deleteBackward)}
          onEnter={() => {
            if (!locked) onEnter()
          }}
        />
      )}
    </div>
  )
}

/**
 * The on-screen keyboard for an inline field rendered elsewhere (the cloze blank sits inside the
 * sentence, the keyboard below it): types into the element `target()` returns.
 */
export function KeyboardFor({
  target,
  display,
  locked,
  onEnter,
}: {
  target: () => TextField | null
  display: ChallengeDisplay
  locked: boolean
  onEnter(): void
}) {
  if (display.persianKeyboard !== true) return null
  const run = (fn: (el: TextField) => void) => {
    const el = target()
    if (el && !locked) fn(el)
  }
  return (
    <PersianKeyboard
      layout={display.keyboardLayout ?? 'standard'}
      disabled={locked}
      onKey={(text) => run((el) => insertAtCaret(el, text))}
      onBackspace={() => run(deleteBackward)}
      onEnter={() => {
        if (!locked) onEnter()
      }}
    />
  )
}
