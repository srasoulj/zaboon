'use client'
import clsx from 'clsx'
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react'
import { Icon } from '../icons'

export type ChoiceState = 'correct' | 'wrong'

export interface ChoiceCardProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'> {
  /** 1–9: the keyboard shortcut shown in the corner. Omit to hide the hint. */
  index?: number
  selected?: boolean
  /** Graded state after CHECK; adds an icon so feedback never relies on color alone. */
  state?: ChoiceState | undefined
  onSelect?: () => void
  /** Optional picture/illustration area above the label (select_image challenges). */
  media?: ReactNode
  children: ReactNode
  ref?: Ref<HTMLButtonElement>
}

/** A multiple-choice option: an outline 3D card (`card-3d`) that toggles `aria-pressed`. */
export function ChoiceCard({
  index,
  selected = false,
  state,
  onSelect,
  media,
  className,
  children,
  disabled,
  ...rest
}: ChoiceCardProps) {
  const hint = index !== undefined && index >= 1 && index <= 9 ? String(index) : undefined
  return (
    <button
      type="button"
      className={clsx(
        'card-3d zb-choice',
        media !== undefined && 'zb-choice--media',
        state && `zb-choice--${state}`,
        className,
      )}
      aria-pressed={selected}
      aria-keyshortcuts={hint}
      data-state={state}
      disabled={disabled}
      onClick={() => onSelect?.()}
      {...rest}
    >
      {hint && (
        <kbd className="zb-choice__hint" aria-hidden="true">
          {hint}
        </kbd>
      )}
      {media !== undefined && <span className="zb-choice__media">{media}</span>}
      <span className="zb-choice__label">{children}</span>
      {state && (
        <span className="zb-choice__state">
          <Icon name={state === 'correct' ? 'check' : 'cross'} size={20} />
          <span className="zb-sr-only">{state === 'correct' ? ', correct' : ', incorrect'}</span>
        </span>
      )}
    </button>
  )
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return (
    el.isContentEditable ||
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT'
  )
}

/**
 * Digit shortcuts (§8): pressing 1–`count` calls `onPick(index)` with a 1-based index. Ignored while
 * typing in a field, with modifier keys, or during IME composition.
 */
export function useDigitShortcuts(
  count: number,
  onPick: (index: number) => void,
  enabled = true,
): void {
  const pick = useRef(onPick)
  useEffect(() => {
    pick.current = onPick
  })
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return
      const m = /^Digit([1-9])$/.exec(e.code) ?? /^Numpad([1-9])$/.exec(e.code)
      const n = m ? Number(m[1]) : /^[1-9]$/.test(e.key) ? Number(e.key) : NaN
      if (Number.isNaN(n) || n > count) return
      e.preventDefault()
      pick.current(n)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [count, enabled])
}
