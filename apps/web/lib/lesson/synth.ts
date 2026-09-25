/**
 * Synthesizes Zaboon's original lesson sound effects (DESIGN-SYSTEM §8) as one PCM sprite:
 * a bright santur-like pluck (correct), a soft low tar-like note (wrong), a daf-and-santur flourish
 * (lesson complete), a rising santur arpeggio (streak) and a wooden click (tap). Pure and
 * deterministic, so the generated files are reproducible (see generate-sounds.ts).
 */
import { EFFECT_SPRITE, SPRITE_LENGTH_MS, type EffectName } from './sounds'

export const SAMPLE_RATE = 44_100

/** Note frequency from semitones relative to A4 (440 Hz); quarter tones allowed (0.5 steps). */
export const note = (semitonesFromA4: number): number => 440 * 2 ** (semitonesFromA4 / 12)

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Adds a plucked string (double-strung like a santur course) starting at `at` seconds. */
function pluck(
  out: Float32Array,
  at: number,
  freq: number,
  opts: { gain?: number; decay?: number; partials?: number[]; detune?: number; attack?: number } = {},
) {
  const gain = opts.gain ?? 0.3
  const decay = opts.decay ?? 0.35
  const partials = opts.partials ?? [1, 0.45, 0.22, 0.1]
  const detune = opts.detune ?? 1.003
  const attack = opts.attack ?? 0.003
  const start = Math.floor(at * SAMPLE_RATE)
  const len = Math.min(out.length - start, Math.floor(decay * 6 * SAMPLE_RATE))
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE
    const env = Math.min(1, t / attack) * Math.exp(-t / decay)
    let s = 0
    for (let p = 0; p < partials.length; p++) {
      const f = freq * (p + 1)
      // Higher partials fade faster, like a struck string.
      const pe = partials[p]! * Math.exp((-t * p) / (decay * 1.5))
      s += pe * (Math.sin(2 * Math.PI * f * t) + Math.sin(2 * Math.PI * f * detune * t)) * 0.5
    }
    out[start + i]! += gain * env * s
  }
}

/** A frame-drum hit: a low thump plus a short burst of filtered noise. */
function daf(out: Float32Array, at: number, gain = 0.35, seed = 7) {
  const rand = mulberry32(seed)
  const start = Math.floor(at * SAMPLE_RATE)
  const len = Math.min(out.length - start, Math.floor(0.25 * SAMPLE_RATE))
  let lp = 0
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE
    const thump = Math.sin(2 * Math.PI * (70 + 40 * Math.exp(-t / 0.03)) * t) * Math.exp(-t / 0.09)
    lp += 0.25 * (rand() * 2 - 1 - lp) // one-pole low-pass on the noise
    const jingle = lp * Math.exp(-t / 0.04)
    out[start + i]! += gain * (0.8 * thump + 0.6 * jingle)
  }
}

function click(out: Float32Array, at: number, gain = 0.25) {
  const rand = mulberry32(3)
  const start = Math.floor(at * SAMPLE_RATE)
  const len = Math.min(out.length - start, Math.floor(0.05 * SAMPLE_RATE))
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE
    const env = Math.exp(-t / 0.008)
    out[start + i]! += gain * env * (0.7 * Math.sin(2 * Math.PI * 1250 * t) + 0.3 * (rand() * 2 - 1))
  }
}

// Notes from dastgāh-e Shur on D (E half-flat approximated with a quarter tone).
const D5 = note(5)
const Ek5 = note(6.5)
const F5 = note(8)
const G5 = note(10)
const A5 = note(12)
const D6 = note(17)
const A2 = note(-24)
const D3 = note(-19)

const RENDER: Record<EffectName, (out: Float32Array, at: number) => void> = {
  correct: (o, at) => {
    pluck(o, at, A5, { gain: 0.28, decay: 0.18 })
    pluck(o, at + 0.09, D6, { gain: 0.3, decay: 0.25 })
  },
  wrong: (o, at) => {
    // Soft attack, few partials: gentle, never harsh.
    pluck(o, at, D3, { gain: 0.32, decay: 0.28, partials: [1, 0.3, 0.08], attack: 0.02, detune: 1.001 })
    pluck(o, at + 0.16, A2, { gain: 0.3, decay: 0.3, partials: [1, 0.3, 0.08], attack: 0.02, detune: 1.001 })
  },
  complete: (o, at) => {
    daf(o, at, 0.35, 11)
    daf(o, at + 0.22, 0.25, 12)
    daf(o, at + 0.44, 0.35, 13)
    ;[D5, F5, A5, D6].forEach((f, i) => pluck(o, at + 0.1 + i * 0.11, f, { gain: 0.22, decay: 0.3 }))
    pluck(o, at + 0.6, D6, { gain: 0.25, decay: 0.45 })
    pluck(o, at + 0.6, A5, { gain: 0.18, decay: 0.45 })
  },
  streak: (o, at) => {
    ;[D5, Ek5, F5, G5, A5, D6].forEach((f, i) =>
      pluck(o, at + i * 0.1, f, { gain: 0.2 + i * 0.015, decay: 0.22 }),
    )
  },
  tap: (o, at) => click(o, at),
}

/** The whole sprite as mono float PCM in [-1, 1]. */
export function renderSprite(): Float32Array {
  const out = new Float32Array(Math.ceil((SPRITE_LENGTH_MS / 1000) * SAMPLE_RATE))
  for (const [name, [offset, duration]] of Object.entries(EFFECT_SPRITE) as [EffectName, [number, number]][]) {
    const region = new Float32Array(Math.ceil((duration / 1000) * SAMPLE_RATE))
    RENDER[name](region, 0)
    // Fade the last 20 ms so nothing clicks at the region's end.
    const fade = Math.floor(0.02 * SAMPLE_RATE)
    for (let i = 0; i < fade; i++) region[region.length - 1 - i]! *= i / fade
    out.set(region, Math.floor((offset / 1000) * SAMPLE_RATE))
  }
  // Normalize to −1 dBFS peak.
  let peak = 0
  for (const s of out) peak = Math.max(peak, Math.abs(s))
  const k = peak > 0 ? 0.89 / peak : 1
  for (let i = 0; i < out.length; i++) out[i]! *= k
  return out
}

/** 16-bit mono PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const data = samples.length * 2
  const buf = new ArrayBuffer(44 + data)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + data, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, data, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!))
    v.setInt16(44 + i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true)
  }
  return new Uint8Array(buf)
}
