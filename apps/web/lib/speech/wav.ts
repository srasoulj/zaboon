/**
 * The one audio format speak uploads (P2 speak): RIFF/WAVE, PCM, mono, 16-bit little-endian.
 *
 * - The transcription model accepts only `wav` and `mp3` input (a live probe on 2026-09-26 refused
 *   `webm` and `m4a` with a 400), so the browser converts every recording (lib/speech/convert.ts).
 * - A PCM WAV's duration is exact (data bytes ÷ byte rate), so the server enforces
 *   AppConfig.speech.maxDurationMs on what it receives, not on what the client declares, and sends
 *   the provider a canonical copy (`pcm16Wav`) holding exactly the measured samples.
 *
 * Pure functions, no DOM or Node APIs: the client and the server share them.
 */

/** What the browser records at: speech needs no more, and 15 s stay under 512 000 bytes. */
export const WAV_SAMPLE_RATE = 16_000
/** The sample rates the server accepts (the browser only ever sends WAV_SAMPLE_RATE). */
export const MIN_WAV_SAMPLE_RATE = 8_000
export const MAX_WAV_SAMPLE_RATE = 48_000
export const WAV_HEADER_BYTES = 44

/** A parsed mono 16-bit PCM WAV: the samples' bytes (a view, not a copy) and their duration. */
export interface WavInfo {
  sampleRate: number
  pcm: Uint8Array
  durationMs: number
}

/** Milliseconds of 16-bit mono audio in `dataBytes` at `sampleRate` (rounded up). */
export function wavDurationMs(dataBytes: number, sampleRate: number): number {
  return Math.ceil((dataBytes * 1000) / (sampleRate * 2))
}

function writeTag(view: DataView, offset: number, tag: string): void {
  for (let i = 0; i < 4; i++) view.setUint8(offset + i, tag.charCodeAt(i))
}

/** A canonical 44-byte-header WAV around 16-bit little-endian mono samples. */
export function pcm16Wav(pcm: Uint8Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(WAV_HEADER_BYTES + pcm.length)
  const view = new DataView(out.buffer)
  writeTag(view, 0, 'RIFF')
  view.setUint32(4, 36 + pcm.length, true)
  writeTag(view, 8, 'WAVE')
  writeTag(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeTag(view, 36, 'data')
  view.setUint32(40, pcm.length, true)
  out.set(pcm, WAV_HEADER_BYTES)
  return out
}

/** Float samples in [-1, 1] (clamped) → a mono 16-bit PCM WAV. */
export function encodeWav(
  samples: Float32Array,
  sampleRate: number = WAV_SAMPLE_RATE,
): Uint8Array<ArrayBuffer> {
  const pcm = new Uint8Array(samples.length * 2)
  const view = new DataView(pcm.buffer)
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i] || 0))
    view.setInt16(i * 2, x < 0 ? Math.round(x * 0x8000) : Math.round(x * 0x7fff), true)
  }
  return pcm16Wav(pcm, sampleRate)
}

function tagAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!,
  )
}

/**
 * The samples of a mono 16-bit PCM WAV at MIN_WAV_SAMPLE_RATE..MAX_WAV_SAMPLE_RATE, or null for
 * anything else: another container or encoding, stereo, a truncated file, or bytes after the
 * `data` chunk (so nothing unmeasured can ride along to the provider).
 */
export function parseWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < WAV_HEADER_BYTES) return null
  if (tagAt(bytes, 0) !== 'RIFF' || tagAt(bytes, 8) !== 'WAVE') return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let fmt: { sampleRate: number } | null = null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = tagAt(bytes, offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (size > bytes.length - body) return null
    if (id === 'fmt ') {
      if (size < 16) return null
      const format = view.getUint16(body, true)
      const channels = view.getUint16(body + 2, true)
      const sampleRate = view.getUint32(body + 4, true)
      const byteRate = view.getUint32(body + 8, true)
      const blockAlign = view.getUint16(body + 12, true)
      const bits = view.getUint16(body + 14, true)
      if (format !== 1 || channels !== 1 || bits !== 16 || blockAlign !== 2) return null
      if (sampleRate < MIN_WAV_SAMPLE_RATE || sampleRate > MAX_WAV_SAMPLE_RATE) return null
      if (byteRate !== sampleRate * 2) return null
      fmt = { sampleRate }
    } else if (id === 'data') {
      if (!fmt || size % 2 !== 0) return null
      // The samples end the file (one pad byte at most): nothing unmeasured follows them.
      if (bytes.length - (body + size) > 1) return null
      return {
        sampleRate: fmt.sampleRate,
        pcm: bytes.subarray(body, body + size),
        durationMs: wavDurationMs(size, fmt.sampleRate),
      }
    }
    offset = body + size + (size % 2)
  }
  return null
}
