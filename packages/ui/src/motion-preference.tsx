'use client'
/**
 * Reduced-motion preference (DESIGN-SYSTEM §8): the OS `prefers-reduced-motion` setting OR the
 * in-app animation toggle. Wrap the app in <MotionPreferenceProvider reduce={…}> to apply the
 * toggle; the provider also sets motion's global `reducedMotion` so layout/spring animations
 * snap instantly. CSS animations honor `[data-motion="reduce"]` on any ancestor.
 */
import { MotionConfig } from 'motion/react'
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'

const InAppReduce = createContext<boolean | undefined>(undefined)

export interface MotionPreferenceProviderProps {
  /** The in-app "reduce animations" toggle. `undefined` follows the OS setting only. */
  reduce?: boolean | undefined
  children: ReactNode
}

export function MotionPreferenceProvider({ reduce, children }: MotionPreferenceProviderProps) {
  return (
    <InAppReduce.Provider value={reduce}>
      <MotionConfig reducedMotion={reduce ? 'always' : 'user'}>{children}</MotionConfig>
    </InAppReduce.Provider>
  )
}

const QUERY = '(prefers-reduced-motion: reduce)'

function mediaQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null
}

function subscribe(onChange: () => void): () => void {
  const mq = mediaQuery()
  mq?.addEventListener('change', onChange)
  return () => mq?.removeEventListener('change', onChange)
}

/**
 * The OS setting, hydration-safe: the server and the hydrating client both report `false`, then
 * the client re-renders with the real value (no SSR/CSR attribute mismatch).
 */
export function useOsReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => mediaQuery()?.matches ?? false,
    () => false,
  )
}

/** True when animations should be skipped or replaced by a static state. */
export function usePrefersReducedMotion(): boolean {
  const os = useOsReducedMotion()
  const inApp = useContext(InAppReduce)
  return inApp === true || os
}
