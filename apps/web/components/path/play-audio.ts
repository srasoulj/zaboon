/**
 * Plays a short clip (a letter sound, a guidebook phrase, a word). One clip at a time: starting a
 * new one stops the previous. Failures (autoplay rules, a missing file) are ignored on purpose:
 * the audio is a help, never required to use the page.
 */
let playing: HTMLAudioElement | null = null

export function playAudio(url: string): void {
  if (!url || typeof Audio === 'undefined') return
  try {
    playing?.pause()
    const audio = new Audio(url)
    playing = audio
    void audio.play()?.catch(() => {})
  } catch {
    // Some environments (tests, locked-down browsers) have no playable Audio.
  }
}
