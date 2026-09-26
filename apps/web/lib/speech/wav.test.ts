import { describe, expect, it } from 'vitest'
import {
  encodeWav,
  parseWav,
  pcm16Wav,
  WAV_HEADER_BYTES,
  WAV_SAMPLE_RATE,
  wavDurationMs,
} from './wav'

/** A header with the given fmt fields around `dataBytes` zero bytes (for malformed cases). */
function wavWith(
  fields: Partial<{
    format: number
    channels: number
    sampleRate: number
    byteRate: number
    blockAlign: number
    bits: number
  }>,
  dataBytes = 320,
): Uint8Array {
  const f = { format: 1, channels: 1, sampleRate: 16_000, blockAlign: 2, bits: 16, ...fields }
  const bytes = pcm16Wav(new Uint8Array(dataBytes), f.sampleRate)
  const view = new DataView(bytes.buffer)
  view.setUint16(20, f.format, true)
  view.setUint16(22, f.channels, true)
  view.setUint32(28, fields.byteRate ?? f.sampleRate * 2, true)
  view.setUint16(32, f.blockAlign, true)
  view.setUint16(34, f.bits, true)
  return bytes
}

describe('WAV (the speak upload)', () => {
  it('encodes float samples as a canonical 16 kHz mono 16-bit PCM WAV and reads them back', () => {
    const samples = Float32Array.from([0, 0.5, -0.5, 1, -1, 2, -2, Number.NaN])
    const wav = encodeWav(samples)
    expect(wav.length).toBe(WAV_HEADER_BYTES + samples.length * 2)
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(wav.subarray(8, 16))).toBe('WAVEfmt ')
    const parsed = parseWav(wav)!
    expect(parsed.sampleRate).toBe(WAV_SAMPLE_RATE)
    expect(parsed.pcm.length).toBe(samples.length * 2)
    const view = new DataView(parsed.pcm.buffer, parsed.pcm.byteOffset, parsed.pcm.byteLength)
    const ints = Array.from({ length: samples.length }, (_, i) => view.getInt16(i * 2, true))
    // Clamped to [-1, 1]; NaN is silence.
    expect(ints).toEqual([0, 16384, -16384, 32767, -32768, 32767, -32768, 0])
    // A canonical copy of the samples is byte-identical.
    expect(pcm16Wav(parsed.pcm, parsed.sampleRate)).toEqual(wav)
  })

  it('measures the duration from the samples, not from anything the client says', () => {
    expect(wavDurationMs(32_000, 16_000)).toBe(1000)
    expect(wavDurationMs(2, 16_000)).toBe(1) // rounded up
    expect(parseWav(encodeWav(new Float32Array(16_000 * 15)))!.durationMs).toBe(15_000)
    expect(parseWav(encodeWav(new Float32Array(16_000 * 15 + 1)))!.durationMs).toBe(15_001)
    expect(parseWav(pcm16Wav(new Uint8Array(48_000 * 2), 48_000))!.durationMs).toBe(1000)
    // 15 s at 16 kHz fits AppConfig.speech.maxAudioBytes (512 000).
    expect(encodeWav(new Float32Array(16_000 * 15)).length).toBeLessThan(512_000)
  })

  it('refuses anything but mono 16-bit PCM at 8–48 kHz', () => {
    expect(parseWav(wavWith({}))).not.toBeNull()
    expect(parseWav(wavWith({ format: 3 }))).toBeNull() // float
    expect(parseWav(wavWith({ channels: 2, blockAlign: 4, byteRate: 64_000 }))).toBeNull()
    expect(parseWav(wavWith({ bits: 8, blockAlign: 1, byteRate: 16_000 }))).toBeNull()
    expect(parseWav(wavWith({ sampleRate: 4_000 }))).toBeNull()
    expect(parseWav(wavWith({ sampleRate: 96_000 }))).toBeNull()
    expect(parseWav(wavWith({ byteRate: 1 }))).toBeNull() // a byte rate that would fake the duration
  })

  it('refuses other containers, truncated files and anything after the samples', () => {
    const good = encodeWav(new Float32Array(160))
    expect(parseWav(new TextEncoder().encode('zaboon-test-transcript:سلام'))).toBeNull()
    expect(parseWav(new Uint8Array(100))).toBeNull()
    expect(parseWav(good.subarray(0, 40))).toBeNull()
    expect(parseWav(good.subarray(0, good.length - 2))).toBeNull() // data size beyond the file
    const trailing = new Uint8Array(good.length + 64)
    trailing.set(good)
    expect(parseWav(trailing)).toBeNull() // unmeasured bytes after the data chunk
    const padded = new Uint8Array(good.length + 1)
    padded.set(good)
    expect(parseWav(padded)).not.toBeNull() // one pad byte is allowed
    const odd = pcm16Wav(new Uint8Array(3), 16_000)
    expect(parseWav(odd)).toBeNull() // half a sample
  })

  it('skips chunks before the samples, and needs fmt before data', () => {
    const good = encodeWav(new Float32Array(160))
    // RIFF header, a LIST chunk, then the original fmt and data chunks.
    const list = new Uint8Array([...new TextEncoder().encode('LIST'), 4, 0, 0, 0, 1, 2, 3, 4])
    const withList = new Uint8Array(good.length + list.length)
    withList.set(good.subarray(0, 12))
    withList.set(list, 12)
    withList.set(good.subarray(12), 12 + list.length)
    expect(parseWav(withList)!.pcm).toEqual(parseWav(good)!.pcm)
    // data before fmt
    const swapped = new Uint8Array(good.length)
    swapped.set(good.subarray(0, 12))
    swapped.set(good.subarray(36), 12)
    swapped.set(good.subarray(12, 36), 12 + good.length - 36)
    expect(parseWav(swapped)).toBeNull()
  })
})
