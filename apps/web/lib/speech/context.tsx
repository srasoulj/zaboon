'use client'
/**
 * Hands the lesson player's SpeechService to the speak renderer. `ChallengeRendererProps` has no
 * field for it yet (lib/challenge-registry.ts is orchestrator-owned; a `speech?: SpeechService`
 * prop is requested), so it travels by context. Outside a player (dev gallery, tests) there is
 * none: the renderer then offers only "Can't speak now".
 */
import { createContext, useContext, type ReactNode } from 'react'
import type { SpeechService } from './service'

const Ctx = createContext<SpeechService | null>(null)

export function SpeechServiceProvider({
  value,
  children,
}: {
  value: SpeechService | null
  children: ReactNode
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSpeechService(): SpeechService | null {
  return useContext(Ctx)
}
