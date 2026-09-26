import { TEST_TRANSCRIPT_PREFIX } from '@zaboon/contracts'
import { describe, expect, it } from 'vitest'
import {
  mixDown,
  toUploadWav,
  type DecodedAudio,
  type DecodingContext,
  type DecodingContextCtor,
} from './convert'
import { parseWav, WAV_SAMPLE_RATE } from './wav'

/** A decoded buffer with one constant value per channel. */
function decoded(channels: number[], length: number): DecodedAudio {
  return {
    numberOfChannels: channels.length,
    length,
    getChannelData: (c) => new Float32Array(length).fill(channels[c]!),
  }
}

/** An OfflineAudioContext stand-in: records how it was built and "decodes" to `result`. */
function fakeContext(
  result: DecodedAudio | Error,
  style: 'promise' | 'callbacks' = 'promise',
): { ctor: DecodingContextCtor; built: number[][]; decoded: number[] } {
  const built: number[][] = []
  const got: number[] = []
  class Fake implements DecodingContext {
    constructor(channels: number, length: number, sampleRate: number) {
      built.push([channels, length, sampleRate])
    }
    decodeAudioData(
      data: ArrayBuffer,
      success?: (b: AudioBuffer) => void,
      failure?: (e: DOMException) => void,
    ): Promise<AudioBuffer> | undefined {
      got.push(data.byteLength)
      if (style === 'callbacks') {
        setTimeout(() =>
          result instanceof Error
            ? failure?.(new DOMException(result.message, 'EncodingError'))
            : success?.(result as AudioBuffer),
        )
        return undefined
      }
      return result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(result as AudioBuffer)
    }
  }
  return { ctor: Fake, built, decoded: got }
}

const recorded = () => new Blob([new Uint8Array(4096).fill(7)], { type: 'audio/webm' })
const opts = { maxDurationMs: 15_000, timerMs: 1234 }

async function wavOf(blob: Blob) {
  return parseWav(new Uint8Array(await blob.arrayBuffer()))!
}

describe('toUploadWav', () => {
  it('decodes at 16 kHz and uploads a mono 16-bit WAV of the audio’s own length', async () => {
    const ctx = fakeContext(decoded([0.5], 24_000))
    const up = await toUploadWav(recorded(), { ...opts, ctor: ctx.ctor })
    expect(ctx.built).toEqual([[1, 1, WAV_SAMPLE_RATE]])
    expect(ctx.decoded).toEqual([4096])
    expect(up.blob.type).toBe('audio/wav')
    expect(up.durationMs).toBe(1500) // 24 000 samples, not the 1234 ms timer
    const wav = await wavOf(up.blob)
    expect(wav).toMatchObject({ sampleRate: 16_000, durationMs: 1500 })
    expect(new DataView(wav.pcm.buffer, wav.pcm.byteOffset).getInt16(0, true)).toBe(16384)
  })

  it('mixes the channels down to mono', async () => {
    const ctx = fakeContext(decoded([0.5, -0.25], 1600), 'callbacks')
    const wav = await wavOf((await toUploadWav(recorded(), { ...opts, ctor: ctx.ctor })).blob)
    expect(new DataView(wav.pcm.buffer, wav.pcm.byteOffset).getInt16(0, true)).toBe(4096) // 0.125
    expect(mixDown(decoded([1, -1], 3), 10)).toEqual(new Float32Array([0, 0, 0]))
    expect(mixDown(decoded([0.5], 5), 2)).toEqual(new Float32Array([0.5, 0.5]))
  })

  it('cuts the upload at the time limit, however late the recording stopped', async () => {
    const ctx = fakeContext(decoded([0.1], WAV_SAMPLE_RATE * 16))
    const up = await toUploadWav(recorded(), { ...opts, ctor: ctx.ctor })
    expect(up.durationMs).toBe(15_000)
    expect((await wavOf(up.blob)).durationMs).toBe(15_000)
  })

  it('a recording the browser cannot decode (or no Web Audio) is an empty upload', async () => {
    for (const ctor of [fakeContext(new Error('bad data')).ctor, null]) {
      const up = await toUploadWav(recorded(), { ...opts, ctor })
      expect(up.blob.size).toBe(0)
      expect(up.durationMs).toBe(0)
    }
    const failing = fakeContext(new Error('bad data'), 'callbacks')
    expect((await toUploadWav(recorded(), { ...opts, ctor: failing.ctor })).blob.size).toBe(0)
    const nothing = fakeContext(decoded([0.5], 0))
    expect((await toUploadWav(recorded(), { ...opts, ctor: nothing.ctor })).blob.size).toBe(0)
    const ctx = fakeContext(decoded([0.5], 100))
    expect((await toUploadWav(new Blob([]), { ...opts, ctor: ctx.ctor })).blob.size).toBe(0)
    expect(ctx.built).toEqual([])
  })

  it('sends a fake-microphone utterance (e2e) as it is, without decoding it', async () => {
    const ctx = fakeContext(new Error('must not decode'))
    const utterance = new Blob([`${TEST_TRANSCRIPT_PREFIX}سلام`], { type: 'audio/webm' })
    const up = await toUploadWav(utterance, { ...opts, timerMs: 20_000, ctor: ctx.ctor })
    expect(up.blob).toBe(utterance)
    expect(up.durationMs).toBe(15_000)
    expect(ctx.built).toEqual([])
  })
})
