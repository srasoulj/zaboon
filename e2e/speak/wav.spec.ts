/**
 * The speak upload in a real browser (P2 speak). Whatever MediaRecorder records, the app decodes
 * it with Web Audio and uploads a 16 kHz mono 16-bit PCM WAV of the audio's own length. That is
 * the only format the transcription model takes (it refuses webm and m4a) and one the server can
 * measure. The fake microphone records 1.5 s of a 440 Hz tone at 44.1 kHz, stereo, so decoding,
 * resampling and the mixdown all run; the transcribe request is intercepted, so no provider is
 * needed.
 */
import type { APIRequestContext } from '@playwright/test'
import { expect, fakeMicrophoneTone, setTestFlags, test, type Guest } from '../fixtures'
import { play, type User } from '../qa/support'

const V1 = '/lesson?course=fixture&kind=lesson&level=u01-v1'
const SAID = 'سلام، خوبی؟'

/** Plays every level before u01-v1 through the API (flags off), so u01-v1 is current. */
async function reachV1(request: APIRequestContext, guest: Guest): Promise<void> {
  const user: User = {
    id: guest.userId,
    token: guest.accessToken,
    authorization: guest.authorization,
  }
  await play(request, user)
  await play(request, user, { levelId: 'u01-l1' })
  await play(request, user, { levelId: 'u01-l2' })
  await play(request, user, { kind: 'practice', levelId: 'u01-p1' })
  await play(request, user, { kind: 'unit_review', levelId: 'u01-r1' })
  await play(request, user, { levelId: 'u01-t1' })
}

/** The header fields and samples of the uploaded WAV (base64). */
function readWav(b64: string) {
  const bytes = Buffer.from(b64, 'base64')
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF')
  expect(bytes.subarray(8, 16).toString('latin1')).toBe('WAVEfmt ')
  expect(bytes.subarray(36, 40).toString('latin1')).toBe('data')
  const dataBytes = bytes.readUInt32LE(40)
  expect(bytes.length).toBe(44 + dataBytes)
  const samples = dataBytes / 2
  let sum = 0
  for (let i = 0; i < samples; i++) sum += (bytes.readInt16LE(44 + i * 2) / 32768) ** 2
  return {
    format: bytes.readUInt16LE(20),
    channels: bytes.readUInt16LE(22),
    sampleRate: bytes.readUInt32LE(24),
    bits: bytes.readUInt16LE(34),
    samples,
    rms: Math.sqrt(sum / Math.max(1, samples)),
  }
}

test('a recording is uploaded as a 16 kHz mono 16-bit WAV of its own length', async ({
  guestPage: page,
  guest,
  request,
}) => {
  await reachV1(request, guest)
  await setTestFlags(page, { speak: true })
  await fakeMicrophoneTone(page)
  const sent: { body?: { format: string; audio: string; durationMs: number } } = {}
  await page.route('**/api/speech/transcribe', async (route) => {
    sent.body = route.request().postDataJSON()
    await route.fulfill({ json: { transcript: SAID, token: 'test-token', remaining: 59 } })
  })

  await page.goto(V1)
  const challenge = page.getByTestId('lesson-challenge')
  await expect(challenge).toHaveAttribute('data-type', 'speak')
  await challenge.getByRole('button', { name: 'Start recording' }).click()
  await challenge.getByRole('button', { name: 'Stop recording' }).click()
  await expect(challenge.getByTestId('speak-transcript')).toBeVisible()

  expect(sent.body?.format).toBe('wav')
  const wav = readWav(sent.body!.audio)
  expect(wav).toMatchObject({ format: 1, channels: 1, sampleRate: 16_000, bits: 16 })
  // 1.5 s of audio resampled to 16 kHz is 24 000 samples, whatever the recording timer said.
  expect(Math.abs(wav.samples - 24_000)).toBeLessThanOrEqual(240)
  expect(Math.abs(sent.body!.durationMs - 1500)).toBeLessThanOrEqual(15)
  // The tone survived decoding, resampling and the mixdown (a half-amplitude sine: RMS ≈ 0.354).
  expect(wav.rms).toBeGreaterThan(0.3)
  expect(wav.rms).toBeLessThan(0.4)
})
