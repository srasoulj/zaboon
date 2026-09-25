/** Data-URL and byte-signature helpers for image and audio payloads. */

export type ImageMime = 'image/png' | 'image/webp' | 'image/jpeg'

export interface DecodedDataUrl {
  mime: string
  bytes: Buffer
}

export function decodeDataUrl(url: string): DecodedDataUrl {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+)?(;[a-z0-9=-]+)*?(;base64)?,(.*)$/is.exec(url)
  if (!m) throw new Error('not a data: URL')
  const mime = (m[1] ?? 'text/plain').toLowerCase()
  const payload = m[4] ?? ''
  const bytes = m[3] ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload))
  return { mime, bytes }
}

export function toDataUrl(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString('base64')}`
}

/** Sniffs the real image type from its magic bytes (never trust the declared MIME alone). */
export function sniffImage(bytes: Buffer): ImageMime | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png'
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg'
  return null
}

/** gpt-audio's streamed `pcm16` output: 24 kHz, 16-bit little-endian, mono. */
export const PCM16_SAMPLE_RATE = 24_000

/** Wraps raw 16-bit little-endian PCM in a WAV (RIFF) container. */
export function pcm16ToWav(pcm: Buffer, sampleRate = PCM16_SAMPLE_RATE, channels = 1): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // fmt chunk size
  header.writeUInt16LE(1, 20) // integer PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * channels * 2, 28) // byte rate
  header.writeUInt16LE(channels * 2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/** WAV: a RIFF container of type WAVE. */
export function looksLikeWav(bytes: Buffer): boolean {
  return (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WAVE'
  )
}

/** MP3: an ID3 tag or an MPEG audio frame sync. */
export function looksLikeMp3(bytes: Buffer): boolean {
  if (bytes.length >= 3 && bytes.toString('ascii', 0, 3) === 'ID3') return true
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0
}

export function extensionFor(mime: ImageMime): 'png' | 'webp' | 'jpg' {
  return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
}
