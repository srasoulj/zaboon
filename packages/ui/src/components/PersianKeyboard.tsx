'use client'
/**
 * The in-app Persian keyboard (DESIGN-SYSTEM §6, LEARNING-ENGINE §1.4, P2): the `standard`
 * (ISIRI 9147) and `phonetic` layouts from `@zaboon/farsi`, a one-shot Shift, long-press variants
 * (phonetic), and dedicated half-space, space, backspace and enter keys. The host owns the text
 * field and the caret: the keyboard only reports what to type.
 *
 * Focus stays in the host's field when keys are tapped: every key cancels `pointerdown` and
 * `mousedown`. Keyboard-only use: every key is a plain `<button>` in the tab order (no roving
 * tabindex, so arrow keys never compete with the field or the variant shortcut) and activates with
 * Enter/Space. On a key with variants, ArrowUp or the ContextMenu key opens the variants and focuses
 * the first; ArrowLeft/ArrowRight/Home/End move between them, Enter/Space types one, and Escape or
 * ArrowDown closes the row and returns focus to the key.
 */
import { HALF_SPACE_CODE, KEYBOARD_LAYOUTS, KEYBOARD_ROWS, keyChar, ZWJ, ZWNJ } from '@zaboon/farsi'
import clsx from 'clsx'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from 'react'
import { Icon } from '../icons'
import { usePrefersReducedMotion } from '../motion-preference'

export type PersianKeyboardLayout = 'standard' | 'phonetic'

export interface PersianKeyboardProps {
  layout: PersianKeyboardLayout
  /** Types text at the caret: a letter, a space, or ZWNJ (U+200C) from the half-space key. */
  onKey(text: string): void
  onBackspace(): void
  /** The enter key (the host submits). */
  onEnter(): void
  disabled?: boolean
  /** Accessible name of the keyboard group. Default "Persian keyboard". */
  label?: string
  className?: string
}

/** How long a pointer must stay down on a key before its variants open. */
export const LONG_PRESS_MS = 450

/** English names of the combining marks the layouts type (harakat and friends). */
const MARK_NAMES: Readonly<Record<string, string>> = {
  'ً': 'fathatan',
  'ٌ': 'dammatan',
  'ٍ': 'kasratan',
  'َ': 'fatha',
  'ُ': 'damma',
  'ِ': 'kasra',
  'ّ': 'shadda',
  'ْ': 'sukun',
  'ٓ': 'maddah above',
  'ٔ': 'hamza above',
  'ٕ': 'hamza below',
  'ٰ': 'superscript alef',
}

const DOTTED_CIRCLE = '◌'
const TATWEEL = 'ـ'

/**
 * What a key shows and how it is announced. Visible characters are drawn in a `lang="fa"` span and
 * are their own accessible name; invisible or combining characters get an English `label` (put on
 * the button, which is `lang="en"`), and combining marks are drawn on a dotted circle.
 */
export interface KeyFace {
  text: string
  lang: 'fa' | 'en'
  /** English accessible name, when the character itself would not announce well. */
  label?: string
}

export function keyFace(ch: string): KeyFace {
  if (ch === ZWNJ) return { text: 'ZWNJ', lang: 'en', label: 'zero-width non-joiner (ZWNJ)' }
  if (ch === ZWJ) return { text: 'ZWJ', lang: 'en', label: 'zero-width joiner (ZWJ)' }
  if (ch === TATWEEL) return { text: ch, lang: 'fa', label: 'tatweel' }
  if (/^\p{Mn}$/u.test(ch)) return { text: DOTTED_CIRCLE + ch, lang: 'fa', label: MARK_NAMES[ch] ?? 'combining mark' }
  return { text: ch, lang: 'fa' }
}

/** Popover alignment so the variant row never leaves the keyboard on a narrow phone. */
function alignFor(index: number, count: number): 'start' | 'center' | 'end' {
  if (index < count / 3) return 'start'
  if (index >= (count * 2) / 3) return 'end'
  return 'center'
}

/** Keeps the host's text field focused when a key is tapped with a pointer. */
function keepFocus(e: SyntheticEvent) {
  e.preventDefault()
}

interface Press {
  code: string
  variants: readonly string[]
  timer: ReturnType<typeof setTimeout>
  long: boolean
}

export function PersianKeyboard({
  layout,
  onKey,
  onBackspace,
  onEnter,
  disabled = false,
  label = 'Persian keyboard',
  className,
}: PersianKeyboardProps) {
  const reduce = usePrefersReducedMotion()
  const [shift, setShift] = useState(false)
  // The key whose variants are open, tagged with its layout so a layout switch closes it.
  const [open, setOpen] = useState<{ layout: PersianKeyboardLayout; code: string } | null>(null)
  const openCode = open?.layout === layout && !disabled ? open.code : null

  const keyEls = useRef(new Map<string, HTMLButtonElement>())
  const popoverRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<string | null>(null)
  const press = useRef<Press | null>(null)
  // Set by a long press so the click that ends it (on the key) does not type the base letter.
  const suppressClick = useRef(false)

  const defs = KEYBOARD_LAYOUTS[layout].keys
  const rows = KEYBOARD_ROWS[layout].filter((row) => !row.includes(HALF_SPACE_CODE))
  const cols = Math.max(...rows.map((row) => row.length))

  const setKeyEl = (code: string) => (el: HTMLButtonElement | null) => {
    if (el) keyEls.current.set(code, el)
    else keyEls.current.delete(code)
  }

  // Focus moves after the render that shows (or removes) the variant row.
  useEffect(() => {
    const target = pendingFocus.current
    if (target === null) return
    const el = target === '' ? popoverRef.current?.querySelector('button') : keyEls.current.get(target)
    if (el) {
      pendingFocus.current = null
      el.focus({ preventScroll: true })
    }
  })

  // A pointer press anywhere outside the open variant row closes it.
  useEffect(() => {
    if (openCode === null) return
    const onDown = (e: PointerEvent) => {
      const t = e.target
      if (t instanceof Element && t.closest('.zb-kbd__slot[data-open]')) return
      setOpen(null)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [openCode])

  useEffect(
    () => () => {
      if (press.current) clearTimeout(press.current.timer)
    },
    [],
  )

  const focusInPopover = () => popoverRef.current?.contains(document.activeElement) ?? false

  const closeVariants = (returnFocusTo: string | null) => {
    if (returnFocusTo !== null) pendingFocus.current = returnFocusTo
    setOpen(null)
  }

  const type = (text: string) => {
    if (disabled) return
    if (openCode !== null) closeVariants(focusInPopover() ? openCode : null)
    setShift(false)
    onKey(text)
  }

  const openVariants = (code: string, focusFirst: boolean) => {
    if (focusFirst) pendingFocus.current = ''
    setOpen({ layout, code })
  }

  const onCharClick = (code: string) => {
    if (suppressClick.current) return
    const ch = keyChar(layout, code, { shift })
    if (ch !== null) type(ch)
  }

  const onCharPointerDown = (code: string, variants: readonly string[] | undefined) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    if (disabled || !variants?.length || e.button > 0) return
    // Touch pointers are captured by the key they started on; release so the pointer can end on
    // a variant (the release target is then whatever is under the finger).
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (press.current) clearTimeout(press.current.timer)
    suppressClick.current = false
    const p: Press = {
      code,
      variants,
      long: false,
      timer: setTimeout(() => {
        p.long = true
        suppressClick.current = true
        openVariants(code, false)
      }, LONG_PRESS_MS),
    }
    press.current = p
    const end = (ev: PointerEvent) => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      clearTimeout(p.timer)
      if (press.current === p) press.current = null
      if (!p.long) return
      if (ev.type === 'pointerup') {
        const under =
          typeof document.elementFromPoint === 'function' ? document.elementFromPoint(ev.clientX, ev.clientY) : null
        const hit = [under, ev.target]
          .map((t) => (t instanceof Element ? t.closest('[data-variant-index]') : null))
          .find((el) => el !== null && popoverRef.current?.contains(el))
        const index = hit ? Number(hit.getAttribute('data-variant-index')) : -1
        const v = p.variants[index]
        if (v !== undefined) {
          setShift(false)
          setOpen(null)
          onKey(v)
        }
      }
      // Let the click that follows this release pass (and be ignored) first.
      setTimeout(() => {
        suppressClick.current = false
      }, 0)
    }
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const onCharPointerLeave = () => {
    const p = press.current
    if (p && !p.long) {
      clearTimeout(p.timer)
      press.current = null
    }
  }

  const onCharKeyDown = (code: string, hasVariants: boolean) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!hasVariants || disabled) return
    if (e.key === 'ArrowUp' || e.key === 'ContextMenu') {
      e.preventDefault()
      openVariants(code, true)
    }
  }

  const onPopoverKeyDown = (code: string) => (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(popoverRef.current?.querySelectorAll('button') ?? [])]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const moveTo = (i: number) => buttons[(i + buttons.length) % buttons.length]?.focus()
    switch (e.key) {
      case 'Escape':
      case 'ArrowDown':
        e.preventDefault()
        // The host may bind Escape (e.g. the quit dialog); this Escape only closes the row.
        e.stopPropagation()
        closeVariants(code)
        break
      case 'ArrowRight':
        e.preventDefault()
        moveTo(at + 1)
        break
      case 'ArrowLeft':
        e.preventDefault()
        moveTo(at - 1)
        break
      case 'Home':
        e.preventDefault()
        moveTo(0)
        break
      case 'End':
        e.preventDefault()
        moveTo(-1)
        break
    }
  }

  const onPopoverBlur = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget
    if (next instanceof Node && e.currentTarget.contains(next)) return
    // Focus left the row by Tab or a click elsewhere: close it without stealing focus back.
    if (pendingFocus.current === null) setOpen(null)
  }

  const onVariantClick = (v: string) => {
    if (suppressClick.current) return
    type(v)
  }

  const style = { '--zb-kbd-cols': cols } as CSSProperties

  return (
    <div
      role="group"
      aria-label={label}
      lang="en"
      dir="ltr"
      className={clsx('zb-kbd', className)}
      data-layout={layout}
      data-shift={shift || undefined}
      data-reduce-motion={reduce || undefined}
      style={style}
    >
      {rows.map((row, r) => (
        <div key={r} className="zb-kbd__row">
          {row.map((code, i) => {
            const def = defs[code]
            if (!def) return null
            const ch = shift ? (def.shift ?? def.base) : def.base
            const face = keyFace(ch)
            const variants = layout === 'phonetic' && def.variants?.length ? def.variants : undefined
            const isOpen = variants !== undefined && openCode === code
            return (
              <div
                key={code}
                className="zb-kbd__slot"
                data-open={isOpen || undefined}
                data-align={variants ? alignFor(i, row.length) : undefined}
              >
                <button
                  ref={setKeyEl(code)}
                  type="button"
                  className="card-3d zb-kbd__key"
                  aria-label={face.label}
                  aria-haspopup={variants ? 'true' : undefined}
                  aria-expanded={variants ? isOpen : undefined}
                  data-code={code}
                  disabled={disabled}
                  onPointerDown={onCharPointerDown(code, variants)}
                  onPointerLeave={onCharPointerLeave}
                  onMouseDown={keepFocus}
                  onContextMenu={keepFocus}
                  onKeyDown={onCharKeyDown(code, variants !== undefined)}
                  onClick={() => onCharClick(code)}
                >
                  <span className="zb-kbd__glyph" lang={face.lang} dir={face.lang === 'fa' ? 'rtl' : 'ltr'}>
                    {face.text}
                  </span>
                  {variants && <span className="zb-kbd__hint" aria-hidden="true" />}
                </button>
                {isOpen && (
                  <div
                    ref={popoverRef}
                    role="group"
                    aria-label={`More letters like ${ch}`}
                    className="zb-kbd__popover"
                    onKeyDown={onPopoverKeyDown(code)}
                    onBlur={onPopoverBlur}
                  >
                    {variants.map((v, vi) => {
                      const vf = keyFace(v)
                      return (
                        <button
                          key={v}
                          type="button"
                          className="card-3d zb-kbd__key zb-kbd__variant"
                          aria-label={vf.label}
                          data-variant-index={vi}
                          onPointerDown={keepFocus}
                          onMouseDown={keepFocus}
                          onClick={() => onVariantClick(v)}
                        >
                          <span className="zb-kbd__glyph" lang={vf.lang} dir={vf.lang === 'fa' ? 'rtl' : 'ltr'}>
                            {vf.text}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
      <div className="zb-kbd__row zb-kbd__row--bottom">
        <button
          type="button"
          className="card-3d zb-kbd__key zb-kbd__key--shift"
          aria-label="shift"
          aria-pressed={shift}
          disabled={disabled}
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={() => setShift((s) => !s)}
        >
          <Icon name="shift" size={20} />
        </button>
        <button
          type="button"
          className="card-3d zb-kbd__key zb-kbd__key--half"
          aria-label="half-space"
          disabled={disabled}
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={() => type(ZWNJ)}
        >
          <span className="zb-kbd__text">half-space</span>
        </button>
        <button
          type="button"
          className="card-3d zb-kbd__key zb-kbd__key--space"
          aria-label="space"
          disabled={disabled}
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={() => type(' ')}
        >
          <span className="zb-kbd__text">space</span>
        </button>
        <button
          type="button"
          className="card-3d zb-kbd__key zb-kbd__key--backspace"
          aria-label="backspace"
          disabled={disabled}
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={() => {
            if (!disabled) onBackspace()
          }}
        >
          <Icon name="backspace" size={22} />
        </button>
        <button
          type="button"
          className="card-3d zb-kbd__key zb-kbd__key--enter"
          aria-label="enter"
          disabled={disabled}
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={() => {
            if (!disabled) onEnter()
          }}
        >
          <Icon name="enter" size={22} />
        </button>
      </div>
    </div>
  )
}
