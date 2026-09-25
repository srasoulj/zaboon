'use client'
/**
 * Reduced-motion preference (DESIGN-SYSTEM §8): the OS `prefers-reduced-motion` setting OR the
 * in-app animation toggle. Wrap the app in <MotionPreferenceProvider reduce={…}> to apply the
 * toggle; the provider also sets motion's global `reducedMotion` so layout/spring animations
 * snap instantly. CSS animations honor `[data-motion="reduce"]` on any ancestor.
 */
import { MotionConfig, useReducedMotion } from 'motion/react'
import { createContext, useContext, type ReactNode } from 'react'

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

/** True when animations should be skipped or replaced by a static state. */
export function usePrefersReducedMotion(): boolean {
  const os = useReducedMotion()
  const inApp = useContext(InAppReduce)
  return inApp === true || os === true
}
