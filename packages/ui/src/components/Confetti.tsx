'use client'
import clsx from 'clsx'
import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { usePrefersReducedMotion } from '../motion-preference'
import { BRAND_NAMES } from '../tokens'

export interface ConfettiBurstProps {
  /** Change this value (e.g. increment) to fire a new burst; `null`/`0` renders nothing. */
  fireKey: number | null
  count?: number
  /** Burst duration in ms. */
  duration?: number
  /** Called when the burst ends (immediately under reduced motion). */
  onDone?: () => void
  className?: string
}

export interface ConfettiPiece {
  angle: number
  distance: number
  size: number
  rotate: number
  delay: number
  color: string
  round: boolean
}

/** Deterministic pseudo-random pieces (mulberry32), so a burst looks the same every time. */
export function confettiPieces(count: number, seed = 1): ConfettiPiece[] {
  let a = seed >>> 0
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return Array.from({ length: count }, (_, i) => ({
    angle: (360 / count) * i + rand() * 20,
    distance: 90 + rand() * 140,
    size: 7 + rand() * 7,
    rotate: rand() * 720 - 360,
    delay: rand() * 120,
    color: `var(--color-${BRAND_NAMES[i % BRAND_NAMES.length]}-500)`,
    round: rand() > 0.6,
  }))
}

/**
 * Celebration confetti (lesson complete, streak). Decorative (`aria-hidden`), pointer-transparent,
 * and skipped entirely under reduced motion (§8).
 */
export function ConfettiBurst({ fireKey, count = 36, duration = 1200, onDone, className }: ConfettiBurstProps) {
  const reduce = usePrefersReducedMotion()
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })
  const pieces = useMemo(() => confettiPieces(count, fireKey ?? 1), [count, fireKey])
  const active = fireKey !== null && fireKey !== 0

  useEffect(() => {
    if (!active) return
    if (reduce) {
      done.current?.()
      return
    }
    const t = window.setTimeout(() => done.current?.(), duration)
    return () => window.clearTimeout(t)
  }, [active, reduce, duration, fireKey])

  if (!active || reduce) return null
  return (
    <div className={clsx('zb-confetti', className)} aria-hidden="true" key={fireKey}>
      {pieces.map((p, i) => {
        const rad = (p.angle * Math.PI) / 180
        const style = {
          '--dx': `${Math.cos(rad) * p.distance}px`,
          '--dy': `${Math.sin(rad) * p.distance - 60}px`,
          '--rot': `${p.rotate}deg`,
          '--size': `${p.size}px`,
          animationDuration: `${duration}ms`,
          animationDelay: `${p.delay}ms`,
          background: p.color,
          borderRadius: p.round ? '50%' : '2px',
        } as CSSProperties
        return <span key={i} className="zb-confetti__piece" style={style} />
      })}
    </div>
  )
}
