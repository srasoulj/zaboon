/**
 * Plays a short clip (a letter sound, a guidebook phrase, a word). One clip at a time: starting a
 * new one stops the previous. Only content media plays: same-origin `/content/…` files, or files
 * under `NEXT_PUBLIC_CONTENT_BASE_URL` when content is served from elsewhere. Failures (autoplay
 * rules, a missing file) are ignored on purpose: the audio is a help, never required.
 */
let playing: HTMLAudioElement | null = null

/** True for URLs of course media (see above); anything else is never handed to `Audio`. */
export function isContentAudioUrl(
  url: string,
  contentBase = process.env.NEXT_PUBLIC_CONTENT_BASE_URL,
): boolean {
  if (!url || typeof location === 'undefined') return false
  let u: URL
  try {
    u = new URL(url, location.origin)
  } catch {
    return false
  }
  if (u.origin === location.origin && u.pathname.startsWith('/content/')) return true
  if (!contentBase) return false
  try {
    const base = new URL(contentBase.replace(/\/*$/, '/'))
    return (
      base.protocol === 'https:' && u.origin === base.origin && u.pathname.startsWith(base.pathname)
    )
  } catch {
    return false
  }
}

export function playAudio(url: string): void {
  if (!isContentAudioUrl(url) || typeof Audio === 'undefined') return
  try {
    playing?.pause()
    const audio = new Audio(url)
    playing = audio
    void audio.play()?.catch(() => {})
  } catch {
    // Some environments (tests, locked-down browsers) have no playable Audio.
  }
}
