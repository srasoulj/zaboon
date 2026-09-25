import { describe, expect, it } from 'vitest'
import type { Challenge } from '@zaboon/contracts'
import { createSilentAudio } from './audio'
import { EFFECT_SPRITE, envelopeAt, mediaUrls, parseEnvelope, sessionMedia, SPRITE_LENGTH_MS } from './sounds'
import { encodeWav, renderSprite, SAMPLE_RATE } from './synth'
import { testChallenges } from './test-support'

describe('session media', () => {
  it('finds every clip (with slow versions and envelopes) and letter sounds', () => {
    const challenges = [
      ...testChallenges(),
      {
        index: 3,
        type: 'listen_tap',
        ref: { type: 'listen_tap', items: ['s_x'] },
        isNew: false,
        audio: { normal: '/a/s.mp3', slow: '/a/s.slow.mp3', envelope: '/a/s.envelope.json' },
        transcript: { fa: 'سلام', translit: 'salām', audio: { normal: '/a/s.mp3' } },
        bank: ['سلام', 'آب'],
        graph: { v: 1, start: 0, accept: [1], edges: [{ from: 0, to: 1, t: 'سلام' }] },
      },
      {
        index: 4,
        type: 'letter_sound',
        ref: { type: 'letter_sound', items: ['l_be'] },
        isNew: false,
        mode: 'letter_to_sound',
        letter: {
          id: 'l_be',
          letter: 'ب',
          name: 'be',
          translit: 'b',
          ipa: 'b',
          connects: true,
          forms: { isolated: 'ب', initial: 'بـ', medial: 'ـبـ', final: 'ـب' },
          audio: '/a/l_be.mp3',
        },
        choices: ['b', 'p'],
        answer: 0,
      },
    ] as Challenge[]
    const media = sessionMedia(challenges)
    expect(media).toEqual([
      { normal: '/a/s.mp3', slow: '/a/s.slow.mp3', envelope: '/a/s.envelope.json' },
      { normal: '/a/l_be.mp3' },
    ])
    expect(mediaUrls(media)).toEqual({
      audio: ['/a/s.mp3', '/a/s.slow.mp3', '/a/l_be.mp3'],
      envelopes: ['/a/s.envelope.json'],
    })
  })
})

describe('envelopes', () => {
  it('parses and clamps envelope files; rejects anything else', () => {
    expect(parseEnvelope([0, 0.5, 2, -1])).toEqual([0, 0.5, 1, 0])
    expect(parseEnvelope({})).toBeNull()
    expect(parseEnvelope([0, 'x'])).toBeNull()
  })

  it('interpolates at 20 fps, scaled for slow clips, and is 0 outside the clip', () => {
    const env = [0, 1, 0.5]
    expect(envelopeAt(env, 0)).toBe(0)
    expect(envelopeAt(env, 0.025)).toBeCloseTo(0.5)
    expect(envelopeAt(env, 0.05)).toBe(1)
    expect(envelopeAt(env, 0.05 / 0.7, 0.7)).toBeCloseTo(1)
    expect(envelopeAt(env, 5)).toBe(0)
    expect(envelopeAt(env, -1)).toBe(0)
    expect(envelopeAt([], 0)).toBe(0)
  })

  it('the silent audio never opens the mouth', async () => {
    const a = createSilentAudio()
    await a.preload(testChallenges())
    a.play('/x.mp3')
    expect(a.mouthOpen()).toBe(0)
  })
})

describe('synthesized effects', () => {
  const pcm = renderSprite()
  it('lays out every effect inside the sprite, peak-normalized', () => {
    expect(pcm.length).toBe(Math.ceil((SPRITE_LENGTH_MS / 1000) * SAMPLE_RATE))
    let peak = 0
    for (const s of pcm) peak = Math.max(peak, Math.abs(s))
    expect(peak).toBeCloseTo(0.89, 2)
    const regions = Object.values(EFFECT_SPRITE).sort((a, b) => a[0] - b[0])
    for (const [offset, duration] of regions) {
      expect(offset + duration).toBeLessThanOrEqual(SPRITE_LENGTH_MS)
      const from = Math.floor((offset / 1000) * SAMPLE_RATE)
      const to = Math.floor(((offset + duration) / 1000) * SAMPLE_RATE)
      let energy = 0
      for (let i = from; i < to; i++) energy += pcm[i]! ** 2
      expect(energy).toBeGreaterThan(0)
    }
    for (let i = 1; i < regions.length; i++)
      expect(regions[i]![0]).toBeGreaterThanOrEqual(regions[i - 1]![0] + regions[i - 1]![1])
  })

  it('is deterministic', () => {
    expect(renderSprite()).toEqual(pcm)
  })

  it('encodes a valid 16-bit mono WAV', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1]), 8000)
    const v = new DataView(wav.buffer)
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF')
    expect(v.getUint32(24, true)).toBe(8000)
    expect(v.getUint32(40, true)).toBe(6)
    expect(v.getInt16(46, true)).toBe(32767)
    expect(v.getInt16(48, true)).toBe(-32768)
  })
})
