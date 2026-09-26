/**
 * Speech helpers without a database: the transcript token (speech/token.ts), signing availability,
 * and the transcriber's local-only test audio, transcript cleanup, timeout/retry settings and
 * which failures give the quota back (speech/transcriber.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_TRANSCRIPT_PREFIX } from '@zaboon/contracts'
import { resetServerEnv } from '../../lib/server/env'
import { assertSigningAvailable, sign } from '../../lib/server/signing'
import { speechToken, transcriptDigest, verifySpeechToken } from '../../lib/server/speech/token'
import {
  assertTranscriberAvailable,
  cleanTranscript,
  localTestTranscript,
  MAX_TRANSCRIPT_LENGTH,
  setTranscriptionFetchForTests,
  transcribeAudio,
  TRANSCRIBE_MAX_RETRIES,
  TRANSCRIBE_TIMEOUT_MS,
} from '../../lib/server/speech/transcriber'
import { encodeWav } from '../../lib/speech/wav'

const ENV_KEYS = [
  'AUTH_MODE',
  'NEXT_PUBLIC_SUPABASE_URL',
  'DATABASE_URL_APP_SERVER',
  'APP_SIGNING_SECRET',
  'OPENROUTER_API_KEY_APP',
  'VERCEL_ENV',
] as const
let saved: Record<string, string | undefined>

function setEnv(env: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const k of ENV_KEYS) delete process.env[k]
  Object.assign(process.env, env)
  resetServerEnv()
}
const local = () => setEnv({ AUTH_MODE: 'local' })
const production = (extra: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}) =>
  setEnv({
    AUTH_MODE: 'supabase',
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    DATABASE_URL_APP_SERVER: 'postgres://app_server@db.example.test:5432/postgres',
    ...extra,
  })

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  resetServerEnv()
})

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const SESSION = '33333333-3333-4333-8333-333333333333'
const NOW = new Date('2026-09-27T10:00:00Z')
const EXPIRES = new Date('2026-09-27T12:00:00Z')
const bound = { userId: USER, sessionId: SESSION, index: 3, transcript: 'سلام، خوبی؟' }

describe('speech tokens', () => {
  beforeEach(local)

  it('verify for exactly the user, session, index and transcript they were signed for', () => {
    const token = speechToken({ ...bound, expiresAt: EXPIRES })
    expect(token.length).toBeLessThanOrEqual(400)
    expect(verifySpeechToken(token, bound, NOW)).toBe(true)
    expect(verifySpeechToken(token, { ...bound, userId: OTHER }, NOW)).toBe(false)
    expect(verifySpeechToken(token, { ...bound, sessionId: OTHER }, NOW)).toBe(false)
    expect(verifySpeechToken(token, { ...bound, index: 4 }, NOW)).toBe(false)
    expect(verifySpeechToken(token, { ...bound, transcript: 'سلام' }, NOW)).toBe(false)
    expect(verifySpeechToken(token, { ...bound, transcript: `${bound.transcript} ` }, NOW)).toBe(
      false,
    )
  })

  it('bind the NFC form of the transcript', () => {
    const composed = 'café'
    const decomposed = 'café'
    expect(transcriptDigest(composed)).toBe(transcriptDigest(decomposed))
    const token = speechToken({ ...bound, transcript: decomposed, expiresAt: EXPIRES })
    expect(verifySpeechToken(token, { ...bound, transcript: composed }, NOW)).toBe(true)
  })

  it('expire with the session', () => {
    const token = speechToken({ ...bound, expiresAt: EXPIRES })
    expect(verifySpeechToken(token, bound, new Date(EXPIRES.getTime() - 1))).toBe(true)
    expect(verifySpeechToken(token, bound, EXPIRES)).toBe(false)
  })

  it('reject missing, malformed, tampered and other-purpose tokens', () => {
    const token = speechToken({ ...bound, expiresAt: EXPIRES })
    for (const bad of [
      undefined,
      '',
      'v1.abc.def',
      `${token}x`,
      token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')),
    ])
      expect(verifySpeechToken(bad, bound, NOW)).toBe(false)
    const payload = { u: USER, s: SESSION, i: 3, h: transcriptDigest(bound.transcript) }
    expect(verifySpeechToken(sign('speak', payload, { expiresAt: EXPIRES }), bound, NOW)).toBe(
      false,
    )
    expect(verifySpeechToken(sign('speech', payload, { expiresAt: EXPIRES }), bound, NOW)).toBe(
      true,
    )
  })

  it('never verify while the signing secret is unavailable (production without APP_SIGNING_SECRET)', () => {
    const token = speechToken({ ...bound, expiresAt: EXPIRES })
    production()
    expect(verifySpeechToken(token, bound, NOW)).toBe(false)
    expect(() => speechToken({ ...bound, expiresAt: EXPIRES })).toThrow()
  })

  it('assertSigningAvailable answers 503 without a usable secret, before anything is spent', () => {
    local()
    expect(() => assertSigningAvailable()).not.toThrow()
    production()
    expect(() => assertSigningAvailable()).toThrow(expect.objectContaining({ code: 'unavailable' }))
    production({ APP_SIGNING_SECRET: 'too-short' }) // pragma: allowlist secret
    expect(() => assertSigningAvailable()).toThrow(expect.objectContaining({ code: 'unavailable' }))
    production({ APP_SIGNING_SECRET: 'x'.repeat(32) })
    expect(() => assertSigningAvailable()).not.toThrow()
  })
})

describe('transcriber', () => {
  const upload = (text: string) => Buffer.from(TEST_TRANSCRIPT_PREFIX + text, 'utf8')

  it('reads local test audio in AUTH_MODE=local only', () => {
    local()
    expect(localTestTranscript(upload('من سیب می‌خوام'))).toBe('من سیب می‌خوام')
    expect(localTestTranscript(upload(''))).toBe('')
    expect(localTestTranscript(Buffer.from('RIFF....WAVE'))).toBeNull()
    expect(localTestTranscript(Buffer.from(TEST_TRANSCRIPT_PREFIX.slice(0, 5)))).toBeNull()
    production({ OPENROUTER_API_KEY_APP: 'mock-key' }) // pragma: allowlist secret
    expect(localTestTranscript(upload('سلام'))).toBeNull()
  })

  it('needs the app key for real audio; a missing key is refundable (nothing was sent)', () => {
    local()
    expect(() => assertTranscriberAvailable()).toThrow(
      expect.objectContaining({ code: 'unavailable', refundable: true }),
    )
    production()
    expect(() => assertTranscriberAvailable()).toThrow(
      expect.objectContaining({ code: 'unavailable' }),
    )
    production({ OPENROUTER_API_KEY_APP: 'mock-key' }) // pragma: allowlist secret
    expect(() => assertTranscriberAvailable()).not.toThrow()
  })

  describe('the real transport', () => {
    const wav = Buffer.from(encodeWav(new Float32Array(1600).fill(0.25)))
    afterEach(() => setTranscriptionFetchForTests(null))

    it('gives a learner-facing request a short leash: 20 s per attempt, one retry', async () => {
      expect(TRANSCRIBE_TIMEOUT_MS).toBe(20_000)
      expect(TRANSCRIBE_MAX_RETRIES).toBe(1)
      production({ OPENROUTER_API_KEY_APP: 'mock-key' }) // pragma: allowlist secret
      let attempts = 0
      setTranscriptionFetchForTests(async () => {
        attempts += 1
        return new Response('{"error":{"message":"overloaded"}}', { status: 503 })
      })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        // An HTTP error status: the provider refused it and billed nothing.
        await expect(transcribeAudio({ bytes: wav })).rejects.toMatchObject({
          code: 'unavailable',
          refundable: true,
        })
        expect(attempts).toBe(1 + TRANSCRIBE_MAX_RETRIES)
      } finally {
        warn.mockRestore()
      }
    })

    it('an answer is never refundable: an empty one is a transcript, an error inside a 200 is not', async () => {
      production({ OPENROUTER_API_KEY_APP: 'mock-key' }) // pragma: allowlist secret
      const answer = (body: unknown) =>
        setTranscriptionFetchForTests(async () => Response.json(body))
      answer({ choices: [{ message: { role: 'assistant', content: '' } }], usage: { cost: 0 } })
      await expect(transcribeAudio({ bytes: wav })).resolves.toBe('')
      answer({ error: { code: 502, message: 'provider failed mid-answer' } })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        await expect(transcribeAudio({ bytes: wav })).rejects.toMatchObject({
          code: 'unavailable',
          refundable: false,
        })
      } finally {
        warn.mockRestore()
      }
    })
  })

  it('trims and caps transcripts without splitting a surrogate pair', () => {
    expect(cleanTranscript('  سلام \n')).toBe('سلام')
    expect(cleanTranscript('ا'.repeat(600))).toHaveLength(MAX_TRANSCRIPT_LENGTH)
    const astral = `${'a'.repeat(MAX_TRANSCRIPT_LENGTH - 1)}😀`
    expect(cleanTranscript(astral)).toBe('a'.repeat(MAX_TRANSCRIPT_LENGTH - 1))
  })
})
