/**
 * Lesson sounds (DESIGN-SYSTEM §8): one Howler audio sprite of original effects (synth.ts renders it
 * into public/sounds/), the session media to preload before challenge 1, and the amplitude
 * envelopes that drive the character's mouth while a clip plays (§7.3).
 */
import type { Challenge } from '@zaboon/contracts'

export type EffectName = 'correct' | 'wrong' | 'complete' | 'streak' | 'tap'

export const EFFECTS_SRC = ['/sounds/effects.webm', '/sounds/effects.mp3']

/** [offset ms, duration ms] of each effect in the sprite (synth.ts lays the file out from this). */
export const EFFECT_SPRITE: Record<EffectName, [number, number]> = {
  correct: [0, 600],
  wrong: [700, 700],
  complete: [1500, 1500],
  streak: [3100, 1100],
  tap: [4300, 80],
}
export const SPRITE_LENGTH_MS = 4500

/** Frames per second of the content pipeline's envelopes (tools/content-cli/src/audio.ts). */
export const ENVELOPE_FPS = 20
/** Speed of the "turtle" clips. */
export const SLOW_RATE = 0.7

export interface MediaClip {
  normal?: string | undefined
  slow?: string | undefined
  envelope?: string | undefined
}

/** Every audio clip a session can play (prompt audio, transcripts, letter sounds…). */
export function sessionMedia(challenges: readonly Challenge[]): MediaClip[] {
  const clips = new Map<string, MediaClip>()
  const visit = (node: unknown, key: string | null) => {
    if (Array.isArray(node)) {
      for (const n of node) visit(n, null)
      return
    }
    if (typeof node === 'string') {
      if (key === 'audio' && !clips.has(node)) clips.set(node, { normal: node })
      return
    }
    if (!node || typeof node !== 'object') return
    const rec = node as Record<string, unknown>
    if (key === 'audio' && (typeof rec.normal === 'string' || typeof rec.slow === 'string')) {
      const clip: MediaClip = {
        normal: typeof rec.normal === 'string' ? rec.normal : undefined,
        slow: typeof rec.slow === 'string' ? rec.slow : undefined,
        envelope: typeof rec.envelope === 'string' ? rec.envelope : undefined,
      }
      const id = clip.normal ?? clip.slow!
      const seen = clips.get(id)
      clips.set(id, {
        normal: clip.normal ?? seen?.normal,
        slow: clip.slow ?? seen?.slow,
        envelope: clip.envelope ?? seen?.envelope,
      })
      return
    }
    for (const [k, v] of Object.entries(rec)) visit(v, k)
  }
  visit(challenges, null)
  return [...clips.values()]
}

/** All URLs to fetch before challenge 1 (clips and their envelopes). */
export function mediaUrls(clips: readonly MediaClip[]): { audio: string[]; envelopes: string[] } {
  const audio = new Set<string>()
  const envelopes = new Set<string>()
  for (const c of clips) {
    if (c.normal) audio.add(c.normal)
    if (c.slow) audio.add(c.slow)
    if (c.envelope) envelopes.add(c.envelope)
  }
  return { audio: [...audio], envelopes: [...envelopes] }
}

/** Parses an envelope file: an array of 0..1 values, one per 1/ENVELOPE_FPS s. */
export function parseEnvelope(json: unknown): number[] | null {
  if (!Array.isArray(json)) return null
  const out: number[] = []
  for (const v of json) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null
    out.push(Math.min(1, Math.max(0, v)))
  }
  return out
}

/** Mouth openness at `seconds` into a clip, linearly interpolated; 0 outside the clip. */
export function envelopeAt(env: readonly number[], seconds: number, rate = 1, fps = ENVELOPE_FPS): number {
  if (env.length === 0 || !Number.isFinite(seconds) || seconds < 0) return 0
  const pos = seconds * rate * fps
  const i = Math.floor(pos)
  if (i >= env.length) return 0
  const a = env[i]!
  const b = env[i + 1] ?? 0
  return a + (b - a) * (pos - i)
}
