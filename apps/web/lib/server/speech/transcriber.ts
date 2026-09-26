/**
 * Speech → text for POST /api/speech/transcribe (P2 speak; ARCHITECTURE §11, §12, ADR 0008).
 *
 * - AUTH_MODE=local only: audio whose bytes start with TEST_TRANSCRIPT_PREFIX (UTF-8) "says" the
 *   rest of the bytes, with no network (e2e `fakeMicrophone`, route tests).
 * - Otherwise @zaboon/ai with the app key (OPENROUTER_API_KEY_APP, model `app_transcribe`),
 *   provider data collection denied, no response cache (no promptVersion), no budget ledger, and a
 *   short leash for a request a learner is waiting on: 20 s per attempt, one retry.
 * - The audio sent is a mono 16-bit PCM WAV the route has already measured (lib/speech/wav.ts): the
 *   model accepts only `wav` and `mp3` (a live probe on 2026-09-26 refused `webm` and `m4a`).
 * - An answer with no text is an empty transcript (the model heard nothing), not a failure.
 * - A missing key or any provider failure is `TranscriptionUnavailableError` (503 `unavailable`).
 *   Its `refundable` says whether the provider refused the request (an HTTP error status: nothing
 *   was billed) rather than answered (even with an error body), timed out or lost the connection
 *   (any of which may have been billed).
 * - The audio is never stored or logged: it lives in this request's memory only, and failures log
 *   the error class and HTTP status, never the request or response body.
 *
 * Tests swap the HTTP transport with `setTranscriptionTransportForTests(new MockTransport(…))`, or
 * only its `fetch` with `setTranscriptionFetchForTests` (the real transport's timeout and retries).
 */
import { AiClient, AiHttpError, type AiTransport, type FetchLike } from '@zaboon/ai'
import { TEST_TRANSCRIPT_PREFIX } from '@zaboon/contracts'
import { serverEnv } from '../env'
import { ApiError } from '../errors'

/** Longest transcript returned (TranscribeResponse.transcript). */
export const MAX_TRANSCRIPT_LENGTH = 500
export const TRANSCRIBE_LANGUAGE = 'Persian (Farsi)'
/** Per attempt: a 15 s recording transcribes in about a second. */
export const TRANSCRIBE_TIMEOUT_MS = 20_000
/** Retries after the first attempt (429, 5xx, timeouts and network errors). */
export const TRANSCRIBE_MAX_RETRIES = 1

const PREFIX_BYTES = Buffer.from(TEST_TRANSCRIPT_PREFIX, 'utf8')

/** The transcription provider is not configured or failed: 503 `unavailable`. */
export class TranscriptionUnavailableError extends ApiError {
  constructor(
    readonly reason: string,
    /** True when the provider was never reached or refused the request (nothing was billed). */
    readonly refundable: boolean,
  ) {
    super('unavailable', 'speech recognition is temporarily unavailable')
    this.name = 'TranscriptionUnavailableError'
  }
}

let testTransport: AiTransport | null = null
let testFetch: FetchLike | null = null

/** Tests only: route provider calls through `transport` (null restores the real HTTP transport). */
export function setTranscriptionTransportForTests(transport: AiTransport | null): void {
  testTransport = transport
}

/** Tests only: the real HTTP transport with this `fetch` (null restores the global one). */
export function setTranscriptionFetchForTests(fetch: FetchLike | null): void {
  testFetch = fetch
}

/** The transcript a local-mode test upload carries, or null for real audio (or outside local mode). */
export function localTestTranscript(bytes: Buffer): string | null {
  if (serverEnv().authMode !== 'local') return null
  if (bytes.length < PREFIX_BYTES.length) return null
  if (!bytes.subarray(0, PREFIX_BYTES.length).equals(PREFIX_BYTES)) return null
  return bytes.subarray(PREFIX_BYTES.length).toString('utf8')
}

/** Trimmed and capped at MAX_TRANSCRIPT_LENGTH UTF-16 units, never splitting a surrogate pair. */
export function cleanTranscript(text: string): string {
  let t = text.trim()
  if (t.length > MAX_TRANSCRIPT_LENGTH) {
    t = t.slice(0, MAX_TRANSCRIPT_LENGTH)
    if (/[\uD800-\uDBFF]$/.test(t)) t = t.slice(0, -1)
    t = t.trimEnd()
  }
  return t
}

function failureReason(e: unknown): string {
  if (e instanceof AiHttpError) return `AiHttpError ${e.status}`
  return e instanceof Error ? e.name : typeof e
}

/**
 * Throws 503 when real audio can't be transcribed (no app key). The route checks this before
 * taking quota, so a missing key answers 503 without consuming anything.
 */
export function assertTranscriberAvailable(): void {
  if (!serverEnv().openrouterAppKey)
    throw new TranscriptionUnavailableError('OPENROUTER_API_KEY_APP is not set', true)
}

/**
 * The cleaned transcript of one recording ('' when the model heard nothing): local test audio, or
 * a mono 16-bit PCM WAV the route has measured.
 */
export async function transcribeAudio(audio: { bytes: Buffer }): Promise<string> {
  const local = localTestTranscript(audio.bytes)
  if (local !== null) return cleanTranscript(local)

  const apiKey = serverEnv().openrouterAppKey
  if (!apiKey) throw new TranscriptionUnavailableError('OPENROUTER_API_KEY_APP is not set', true)
  const client = new AiClient({
    apiKey,
    dataCollection: 'deny',
    timeoutMs: TRANSCRIBE_TIMEOUT_MS,
    maxRetries: TRANSCRIBE_MAX_RETRIES,
    ...(testTransport ? { transport: testTransport } : {}),
    ...(testFetch ? { fetch: testFetch } : {}),
  })
  try {
    const { text } = await client.transcribe(
      { bytes: audio.bytes, format: 'wav' },
      { language: TRANSCRIBE_LANGUAGE, label: 'speech-transcribe' },
    )
    return cleanTranscript(text)
  } catch (e) {
    const reason = failureReason(e)
    // Never the error object itself: provider errors may echo the request.
    console.warn('[speech] transcription failed', { reason })
    throw new TranscriptionUnavailableError(reason, e instanceof AiHttpError && !e.inOkResponse)
  }
}
