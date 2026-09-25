/**
 * The player's audio (Howler): effect sprite, preloading every session clip before challenge 1,
 * playback for renderers (`ChallengeAudio`), and lip-sync from the clip's amplitude envelope.
 * Howler is imported lazily, so nothing touches Web Audio during SSR or in tests.
 */
import type { Challenge } from '@zaboon/contracts'
import type { Howl as HowlType } from 'howler'
import {
  EFFECT_SPRITE,
  EFFECTS_SRC,
  envelopeAt,
  mediaUrls,
  parseEnvelope,
  sessionMedia,
  SLOW_RATE,
  type EffectName,
  type MediaClip,
} from './sounds'

export interface LessonAudio {
  /** Effects and clips play only while enabled (Settings.sound). */
  setEnabled(enabled: boolean): void
  effect(name: EffectName): void
  /** Loads every clip and envelope of the session; resolves when done, failed or timed out. */
  preload(challenges: readonly Challenge[]): Promise<void>
  play(url: string, opts?: { slow?: boolean }): void
  stop(): void
  /** 0..1 mouth openness of the clip playing now (0 when silent). */
  mouthOpen(): number
  dispose(): void
}

/** A silent implementation (tests, SSR, browsers without audio). */
export function createSilentAudio(): LessonAudio {
  return {
    setEnabled: () => {},
    effect: () => {},
    preload: async () => {},
    play: () => {},
    stop: () => {},
    mouthOpen: () => 0,
    dispose: () => {},
  }
}

type HowlCtor = typeof HowlType

const PRELOAD_TIMEOUT_MS = 8_000

export function createHowlerAudio(
  opts: { fetch?: typeof fetch; timeoutMs?: number } = {},
): LessonAudio {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  let enabled = true
  let Howl: HowlCtor | null = null
  let effects: HowlType | null = null
  const clips = new Map<string, HowlType>()
  /** clip URL → its media entry (to find the slow version and envelope). */
  const byUrl = new Map<string, MediaClip>()
  const envelopes = new Map<string, number[]>()
  let playing: { howl: HowlType; envelope: number[] | null; rate: number } | null = null

  async function load(): Promise<HowlCtor> {
    if (!Howl) Howl = (await import('howler')).Howl
    return Howl
  }

  async function ensureEffects(): Promise<void> {
    if (effects) return
    const H = await load()
    effects = new H({ src: EFFECTS_SRC, sprite: EFFECT_SPRITE, preload: true, volume: 0.8 })
  }

  function clipFor(H: HowlCtor, url: string): HowlType {
    let h = clips.get(url)
    if (!h) {
      h = new H({ src: [url], preload: true, html5: false })
      clips.set(url, h)
    }
    return h
  }

  const loaded = (h: HowlType) =>
    new Promise<void>((resolve) => {
      if (h.state() === 'loaded') return resolve()
      h.once('load', () => resolve())
      h.once('loaderror', () => resolve())
    })

  return {
    setEnabled(on) {
      enabled = on
      if (!on) this.stop()
    },

    effect(name) {
      if (!enabled) return
      void ensureEffects()
        .then(() => effects?.play(name))
        .catch(() => {})
    },

    async preload(challenges) {
      const media = sessionMedia(challenges)
      for (const m of media) {
        if (m.normal) byUrl.set(m.normal, m)
        if (m.slow) byUrl.set(m.slow, m)
      }
      const { audio, envelopes: envUrls } = mediaUrls(media)
      const work = (async () => {
        const H = await load()
        await ensureEffects()
        await Promise.all([
          ...audio.map((u) => loaded(clipFor(H, u))),
          ...envUrls.map(async (u) => {
            try {
              const res = await doFetch(u)
              const env = res.ok ? parseEnvelope(await res.json()) : null
              if (env) envelopes.set(u, env)
            } catch {
              // lip-sync is decoration: a missing envelope just keeps the mouth still
            }
          }),
        ])
      })()
      await Promise.race([
        work.catch(() => {}),
        new Promise<void>((r) => setTimeout(r, opts.timeoutMs ?? PRELOAD_TIMEOUT_MS)),
      ])
    },

    play(url, o) {
      if (!enabled) return
      const media = byUrl.get(url)
      const slow = o?.slow === true && media?.slow !== undefined
      const src = slow ? media!.slow! : url
      void load()
        .then((H) => {
          playing?.howl.stop()
          const howl = clipFor(H, src)
          const envelope = media?.envelope ? (envelopes.get(media.envelope) ?? null) : null
          playing = { howl, envelope, rate: slow ? SLOW_RATE : 1 }
          howl.once('end', () => {
            if (playing?.howl === howl) playing = null
          })
          howl.play()
        })
        .catch(() => {})
    },

    stop() {
      playing?.howl.stop()
      playing = null
    },

    mouthOpen() {
      if (!playing || !playing.envelope || !playing.howl.playing()) return 0
      const pos = playing.howl.seek()
      return typeof pos === 'number' ? envelopeAt(playing.envelope, pos, playing.rate) : 0
    },

    dispose() {
      this.stop()
      for (const h of clips.values()) h.unload()
      clips.clear()
      effects?.unload()
      effects = null
    },
  }
}
