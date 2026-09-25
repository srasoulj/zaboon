import { describe, expect, it, vi } from 'vitest'
import type { Challenge } from '@zaboon/contracts'
import { createHowlerAudio, createSilentAudio } from './audio'
import {
  EFFECT_SPRITE,
  envelopeAt,
  mediaUrls,
  parseEnvelope,
  sessionMedia,
  SPRITE_LENGTH_MS,
} from './sounds'
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

describe('Howler audio lifecycle', () => {
  /** A stand-in for Howler's Howl: records creations, plays and unloads. */
  function fakeHowler() {
    const created: FakeHowl[] = []
    class FakeHowl {
      played: unknown[] = []
      unloaded = false
      constructor(readonly opts: { src: string[] }) {
        created.push(this)
      }
      state() {
        return 'loaded'
      }
      once() {
        return this
      }
      play(name?: unknown) {
        this.played.push(name)
        return 1
      }
      stop() {
        return this
      }
      playing() {
        return false
      }
      seek() {
        return 0
      }
      unload() {
        this.unloaded = true
      }
    }
    return { created, Howl: FakeHowl }
  }

  const clipChallenge = [
    {
      ...testChallenges()[0]!,
      prompt: {
        lang: 'fa',
        text: 'سلام',
        fa: { fa: 'سلام', translit: 'salām', audio: { normal: '/a/1.mp3' } },
      },
    },
  ] as Challenge[]

  it('preloads effects and clips, and unloads them on dispose', async () => {
    const h = fakeHowler()
    const audio = createHowlerAudio({
      loadHowl: async () => h.Howl as never,
      fetch: async () => new Response('[]'),
    })
    await audio.preload(clipChallenge)
    expect(h.created.map((x) => x.opts.src[0])).toEqual(['/sounds/effects.webm', '/a/1.mp3'])
    audio.effect('correct')
    await vi.waitFor(() => expect(h.created[0]!.played).toEqual(['correct']))
    audio.dispose()
    expect(h.created.every((x) => x.unloaded)).toBe(true)
  })

  it('a preload still loading when disposed creates nothing afterwards; play/effect become no-ops', async () => {
    const h = fakeHowler()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const audio = createHowlerAudio({
      loadHowl: async () => {
        await gate
        return h.Howl as never
      },
      fetch: async () => new Response('[]'),
    })
    const preloading = audio.preload(clipChallenge)
    audio.dispose()
    release()
    await preloading
    audio.effect('wrong')
    audio.play('/a/1.mp3')
    await new Promise((r) => setTimeout(r, 0))
    expect(h.created).toEqual([])
  })

  it('respects the sound setting', async () => {
    const h = fakeHowler()
    const audio = createHowlerAudio({ loadHowl: async () => h.Howl as never })
    audio.setEnabled(false)
    audio.effect('correct')
    audio.play('/a/1.mp3')
    await new Promise((r) => setTimeout(r, 0))
    expect(h.created).toEqual([])
  })
})

describe('Howler audio: nothing outlives dispose()', () => {
  function fakeHowler() {
    const created: { unloaded: boolean; played: unknown[] }[] = []
    class FakeHowl {
      played: unknown[] = []
      unloaded = false
      constructor() {
        created.push(this)
      }
      state() {
        return 'loaded'
      }
      once() {
        return this
      }
      play(n?: unknown) {
        this.played.push(n)
        return 1
      }
      stop() {
        return this
      }
      playing() {
        return false
      }
      seek() {
        return 0
      }
      unload() {
        this.unloaded = true
      }
    }
    return { created, Howl: FakeHowl }
  }

  it('an effect and a clip requested before dispose (while Howler loads) never play or survive', async () => {
    const h = fakeHowler()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const audio = createHowlerAudio({
      loadHowl: async () => {
        await gate
        return h.Howl as never // the fake covers the Howl members the player uses
      },
    })
    audio.effect('correct')
    audio.play('/a/1.mp3')
    audio.dispose()
    release()
    await new Promise((r) => setTimeout(r, 0))
    expect(h.created).toEqual([])
    audio.effect('wrong')
    audio.play('/a/1.mp3')
    await new Promise((r) => setTimeout(r, 0))
    expect(h.created).toEqual([])
  })

  it('everything created before dispose is unloaded; nothing is re-created afterwards', async () => {
    const h = fakeHowler()
    const audio = createHowlerAudio({ loadHowl: async () => h.Howl as never })
    audio.effect('correct')
    await vi.waitFor(() => expect(h.created).toHaveLength(1))
    audio.play('/a/1.mp3')
    await vi.waitFor(() => expect(h.created).toHaveLength(2))
    audio.dispose()
    expect(h.created.every((x) => x.unloaded)).toBe(true)
    await audio.preload(testChallenges())
    expect(h.created).toHaveLength(2)
  })
})
