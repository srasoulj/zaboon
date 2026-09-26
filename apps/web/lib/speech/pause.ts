/**
 * The "Can't speak now" pause (P2 speak), kept on this device per user: localStorage key
 * `zaboon.speakPausedUntil.<userId>` holds the ISO instant it ends. While it runs, the player
 * creates sessions with `speakPaused: true` (no speak challenges). Storage failures (private
 * mode, blocked site data) only mean no pause is remembered.
 */
import { TEST_NOW_KEY } from '../api-client'

export const SPEAK_PAUSE_KEY_PREFIX = 'zaboon.speakPausedUntil.'

export type PauseStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const speakPauseKey = (userId: string): string => `${SPEAK_PAUSE_KEY_PREFIX}${userId}`

function defaultStorage(): PauseStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * The pause clock: the local-mode test instant (`x-test-now`, localStorage TEST_NOW_KEY) when one
 * is set, so the pause follows the same time as the server in UI tests; else the device clock.
 */
export function speechNow(): number {
  if (process.env.NEXT_PUBLIC_AUTH_MODE === 'local') {
    try {
      const iso = globalThis.localStorage?.getItem(TEST_NOW_KEY)
      const t = iso ? Date.parse(iso) : NaN
      if (Number.isFinite(t)) return t
    } catch {
      // fall through to the device clock
    }
  }
  return Date.now()
}

/** Starts (or extends) the pause for `userId`: it ends `minutes` after `now`. */
export function pauseSpeaking(
  userId: string,
  now: number,
  minutes: number,
  storage: PauseStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(speakPauseKey(userId), new Date(now + minutes * 60_000).toISOString())
  } catch {
    // Nothing remembered: the next session may contain speak challenges again.
  }
}

/** When the pause of `userId` ends (epoch ms), or null when none is running at `now`. */
export function speakPausedUntil(
  userId: string,
  now: number,
  storage: PauseStorage | null = defaultStorage(),
): number | null {
  try {
    const raw = storage?.getItem(speakPauseKey(userId))
    if (!raw) return null
    const until = Date.parse(raw)
    if (!Number.isFinite(until) || until <= now) {
      storage?.removeItem(speakPauseKey(userId))
      return null
    }
    return until
  } catch {
    return null
  }
}

export function isSpeakPaused(
  userId: string,
  now: number,
  storage: PauseStorage | null = defaultStorage(),
): boolean {
  return speakPausedUntil(userId, now, storage) !== null
}
