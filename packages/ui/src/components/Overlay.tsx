'use client'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../icons'
import { usePrefersReducedMotion } from '../motion-preference'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('hidden'))
}

/**
 * Modal-dialog behavior shared by Modal and BottomSheet: focus moves in on open (initialFocus or
 * the first focusable), Tab is trapped, Escape closes, focus returns to the opener on close,
 * and the page behind does not scroll.
 */
function useModalDialog(active: boolean, onClose: () => void, panel: RefObject<HTMLElement | null>, initialFocus?: RefObject<HTMLElement | null>) {
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  useEffect(() => {
    if (!active) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = panel.current
    const target = initialFocus?.current ?? (node ? focusables(node)[0] : undefined) ?? node
    target?.focus({ preventScroll: true })
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close.current()
        return
      }
      if (e.key !== 'Tab' || !panel.current) return
      const items = focusables(panel.current)
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]!
      const last = items[items.length - 1]!
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      opener?.focus({ preventScroll: true })
    }
  }, [active, panel, initialFocus])
}

const noopSubscribe = () => () => {}

/** False during SSR and hydration, true on the client: portals need `document.body`. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  )
}

interface DialogBaseProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** Supporting text, linked with aria-describedby. */
  description?: ReactNode
  children?: ReactNode
  /** Footer actions (Button3D…). */
  actions?: ReactNode
  /** Close on backdrop click. Default true. */
  dismissible?: boolean
  /** Element to focus when opening (defaults to the first focusable). */
  initialFocus?: RefObject<HTMLElement | null>
  closeLabel?: string
  /** Hero art above the title, e.g. a Character. */
  illustration?: ReactNode
  className?: string
}

function DialogShell({ kind, ...p }: DialogBaseProps & { kind: 'modal' | 'sheet' }) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()
  const reduce = usePrefersReducedMotion()
  const mounted = useIsClient()
  useModalDialog(mounted && p.open, p.onClose, panel, p.initialFocus)
  if (!mounted) return null

  const panelMotion =
    kind === 'sheet'
      ? { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' } }
      : { initial: { opacity: 0, scale: 0.94 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.94 } }
  const transition = reduce ? { duration: 0 } : { type: 'spring' as const, duration: 0.3, bounce: 0.2 }

  return createPortal(
    <AnimatePresence>
      {p.open && (
        <div className={clsx('zb-overlay', `zb-overlay--${kind}`)} key="overlay">
          <motion.div
            className="zb-overlay__backdrop"
            data-testid="overlay-backdrop"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.2 }}
            onClick={() => (p.dismissible ?? true) && p.onClose()}
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={p.description !== undefined ? descId : undefined}
            tabIndex={-1}
            className={clsx(kind === 'sheet' ? 'zb-sheet' : 'zb-modal', p.className)}
            initial={reduce ? false : panelMotion.initial}
            animate={panelMotion.animate}
            exit={panelMotion.exit}
            transition={transition}
          >
            {kind === 'sheet' && <span className="zb-sheet__handle" aria-hidden="true" />}
            <button type="button" className="zb-dialog__close" aria-label={p.closeLabel ?? 'Close'} onClick={p.onClose}>
              <Icon name="close" size={22} />
            </button>
            {p.illustration !== undefined && <div className="zb-dialog__art">{p.illustration}</div>}
            <h2 id={titleId} className="zb-dialog__title">
              {p.title}
            </h2>
            {p.description !== undefined && (
              <p id={descId} className="zb-dialog__desc">
                {p.description}
              </p>
            )}
            {p.children}
            {p.actions !== undefined && <div className="zb-dialog__actions">{p.actions}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

export type ModalProps = DialogBaseProps
export type BottomSheetProps = DialogBaseProps

/** Centered modal dialog ("Wait, don't go!", out of hearts…). */
export function Modal(props: ModalProps) {
  return <DialogShell kind="modal" {...props} />
}

/** Bottom sheet (mobile menus, word hints, settings). Same dialog semantics as Modal. */
export function BottomSheet(props: BottomSheetProps) {
  return <DialogShell kind="sheet" {...props} />
}

export type ToastTone = 'info' | 'success' | 'error'

export interface ToastProps {
  message: ReactNode
  tone?: ToastTone
  /** Called after `duration` ms, or when the close button is pressed. */
  onDismiss?: () => void
  /** Auto-dismiss delay; `null` keeps it until dismissed. Paused while hovered or focused. */
  duration?: number | null
  closeLabel?: string
  className?: string
}

/** A short, non-blocking message. Errors use role="alert", everything else role="status". */
export function Toast({ message, tone = 'info', onDismiss, duration = 4000, closeLabel = 'Dismiss', className }: ToastProps) {
  const [paused, setPaused] = useState(false)
  const dismiss = useRef(onDismiss)
  useEffect(() => {
    dismiss.current = onDismiss
  })
  useEffect(() => {
    if (duration === null || paused) return
    const t = window.setTimeout(() => dismiss.current?.(), duration)
    return () => window.clearTimeout(t)
  }, [duration, paused])

  const icon = tone === 'success' ? 'check' : tone === 'error' ? 'cross' : null
  return (
    <div
      className={clsx('zb-toast', `zb-toast--${tone}`, className)}
      role={tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {icon && <Icon name={icon} size={20} className="zb-toast__icon" />}
      <div className="zb-toast__message">{message}</div>
      {onDismiss && (
        <button type="button" className="zb-toast__close" aria-label={closeLabel} onClick={onDismiss}>
          <Icon name="close" size={18} />
        </button>
      )}
    </div>
  )
}
