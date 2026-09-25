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

/** MP3: an ID3 tag or an MPEG audio frame sync. */
export function looksLikeMp3(bytes: Buffer): boolean {
  if (bytes.length >= 3 && bytes.toString('ascii', 0, 3) === 'ID3') return true
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0
}

export function extensionFor(mime: ImageMime): 'png' | 'webp' | 'jpg' {
  return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
}
