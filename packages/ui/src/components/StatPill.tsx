'use client'
import clsx from 'clsx'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from '../icons'

export type StatKind = 'streak' | 'coins' | 'hearts'

const ICON: Record<StatKind, IconName> = { streak: 'flame', coins: 'coin', hearts: 'heart' }
const NOUN: Record<StatKind, [singular: string, plural: string]> = {
  streak: ['day streak', 'day streak'],
  coins: ['coin', 'coins'],
  hearts: ['heart', 'hearts'],
}

export interface StatPillProps {
  kind: StatKind
  value: number | 'infinite'
  /** Streak: extended today (colored flame) or not yet (grey). Ignored for other kinds. */
  active?: boolean
  /** Popover content (streak calendar, heart refill, …). Without it the pill is static text. */
  popover?: ReactNode
  /** Accessible name for the popover dialog. */
  popoverLabel?: string
  className?: string
}

export function statLabel(kind: StatKind, value: number | 'infinite'): string {
  if (value === 'infinite') return `Unlimited ${NOUN[kind][1]}`
  const [one, many] = NOUN[kind]
  return `${value} ${value === 1 ? one : many}`
}

/** Streak / coins / hearts counter for the stats bar, optionally opening a popover. */
export function StatPill({ kind, value, active = true, popover, popoverLabel, className }: StatPillProps) {
  const [open, setOpen] = useState(false)
  const popId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const label = statLabel(kind, value)
  const content = (
    <>
      <Icon name={ICON[kind]} size={26} className="zb-stat__icon" />
      <span className="zb-stat__value" aria-hidden="true">
        {value === 'infinite' ? '∞' : value}
      </span>
    </>
  )
  const classes = clsx('zb-stat', `zb-stat--${kind}`, kind === 'streak' && !active && 'zb-stat--inactive')

  if (popover === undefined) {
    return (
      <div className={clsx(classes, className)} role="img" aria-label={label}>
        {content}
      </div>
    )
  }
  return (
    <div className={clsx('zb-stat-wrap', className)} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={classes}
        aria-label={label}
        aria-expanded={open}
        aria-controls={popId}
        onClick={() => setOpen((o) => !o)}
      >
        {content}
      </button>
      <div id={popId} className="zb-popover" role="dialog" aria-label={popoverLabel ?? label} hidden={!open}>
        {popover}
      </div>
    </div>
  )
}
