/** The "Can't speak now" pause store: per user, expiring, never throwing. */
import { describe, expect, it } from 'vitest'
import {
  isSpeakPaused,
  pauseSpeaking,
  speakPauseKey,
  speakPausedUntil,
  type PauseStorage,
} from './pause'

function memory(): PauseStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

const T0 = Date.parse('2026-09-26T10:00:00Z')
const MIN = 60_000

describe('speak pause', () => {
  it('lasts pauseMinutes from now, stored as an ISO instant under the user key', () => {
    const s = memory()
    pauseSpeaking('u1', T0, 60, s)
    expect(s.data.get(speakPauseKey('u1'))).toBe('2026-09-26T11:00:00.000Z')
    expect(speakPauseKey('u1')).toBe('zaboon.speakPausedUntil.u1')
    expect(isSpeakPaused('u1', T0, s)).toBe(true)
    expect(isSpeakPaused('u1', T0 + 59 * MIN, s)).toBe(true)
    expect(speakPausedUntil('u1', T0 + 30 * MIN, s)).toBe(T0 + 60 * MIN)
  })

  it('expires, and an expired pause is removed', () => {
    const s = memory()
    pauseSpeaking('u1', T0, 60, s)
    expect(isSpeakPaused('u1', T0 + 60 * MIN, s)).toBe(false)
    expect(s.data.has(speakPauseKey('u1'))).toBe(false)
  })

  it('is per user: another user on the same device is not paused', () => {
    const s = memory()
    pauseSpeaking('guest-1', T0, 60, s)
    expect(isSpeakPaused('guest-1', T0, s)).toBe(true)
    expect(isSpeakPaused('account-2', T0, s)).toBe(false)
  })

  it('a new pause extends from its own now', () => {
    const s = memory()
    pauseSpeaking('u1', T0, 60, s)
    pauseSpeaking('u1', T0 + 50 * MIN, 60, s)
    expect(speakPausedUntil('u1', T0 + 70 * MIN, s)).toBe(T0 + 110 * MIN)
  })

  it('garbage or failing storage means no pause, never an error', () => {
    const s = memory()
    s.setItem(speakPauseKey('u1'), 'not a date')
    expect(isSpeakPaused('u1', T0, s)).toBe(false)
    const broken: PauseStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
    }
    expect(() => pauseSpeaking('u1', T0, 60, broken)).not.toThrow()
    expect(isSpeakPaused('u1', T0, broken)).toBe(false)
    expect(isSpeakPaused('u1', T0, null)).toBe(false)
  })
})
