/**
 * POST /api/speech/transcribe (P2 speak, flags.speak; ARCHITECTURE §7, §12).
 *
 * Order of checks (nothing is spent before the last one):
 * 1. the flag (404);
 * 2. the upload against AppConfig.speech (400). Real audio must be a mono 16-bit PCM WAV
 *    (lib/speech/wav.ts, the one format the model takes that the server can measure), and its
 *    duration is measured here: the client's `durationMs` is checked too but never trusted;
 * 3. the provider's configuration and the token signing (503), so a missing key or signing secret
 *    answers before any quota is taken or any paid call is made;
 * 4. in one short locked transaction: the session (404 not the caller's, 409 completed, 410
 *    expired), the index (400 out of range or not a speak challenge, rebuilt from the stored ref
 *    like /complete does) and the daily quota (429 `quota_exceeded`).
 * The provider is called after that transaction, so no database lock is held while it works.
 *
 * Quota decision: a transcription is counted before the provider is called (so concurrent
 * requests can't overspend it). It is given back only when the provider refused the request (an
 * HTTP error status: nothing was billed). An answer (an empty transcript included), a timeout or a
 * lost connection keeps the count, because the provider may have billed it; otherwise a caller who
 * reliably gets empty answers (silence) could transcribe for free.
 *
 * The audio is decoded into memory for this request only: never stored, logged or cached. The
 * provider gets a canonical copy of exactly the measured samples (`pcm16Wav`).
 */
import type { AppConfig, TranscribeRequest, TranscribeResponse } from '@zaboon/contracts'
import { repos, withUserLock, type Db } from '@zaboon/db'
import { buildChallenge } from '@zaboon/session-engine'
import type { z } from 'zod'
import type { AuthUser } from '../auth'
import { contentView, findLevel, loadBundle, versionOf } from '../content'
import { ApiError } from '../errors'
import { assertSigningAvailable } from '../signing'
import { parseWav, pcm16Wav } from '../../speech/wav'
import { speechToken } from './token'
import {
  assertTranscriberAvailable,
  localTestTranscript,
  transcribeAudio,
  TranscriptionUnavailableError,
} from './transcriber'

export interface TranscribeCtx {
  db: Db
  user: AuthUser
  now: Date
  config: AppConfig
  flags: Readonly<Record<string, boolean>>
}

/** The UTC day a quota counts against (YYYY-MM-DD). */
export const quotaDay = (now: Date): string => now.toISOString().slice(0, 10)

export async function transcribe(
  ctx: TranscribeCtx,
  body: z.output<typeof TranscribeRequest>,
): Promise<TranscribeResponse> {
  if (ctx.flags.speak !== true) throw new ApiError('not_found', 'not found')
  const { db, now, config } = ctx
  const limits = config.speech
  const userId = ctx.user.id

  // --- the upload (AppConfig.speech; the contract already checked format and base64) -----------
  const bytes = Buffer.from(body.audio, 'base64')
  if (bytes.length === 0) throw new ApiError('validation', 'the recording is empty')
  if (bytes.length > limits.maxAudioBytes)
    throw new ApiError('validation', `the recording is larger than ${limits.maxAudioBytes} bytes`)
  const tooLong = `the recording is longer than ${limits.maxDurationMs} ms`
  if (body.durationMs > limits.maxDurationMs) throw new ApiError('validation', tooLong)
  let upload = bytes
  // Local test audio (AUTH_MODE=local only) is a scripted transcript, not audio.
  if (localTestTranscript(bytes) === null) {
    const wav = body.format === 'wav' ? parseWav(bytes) : null
    if (!wav) throw new ApiError('validation', 'the recording must be a mono 16-bit PCM WAV')
    if (wav.pcm.length === 0) throw new ApiError('validation', 'the recording is empty')
    if (wav.durationMs > limits.maxDurationMs) throw new ApiError('validation', tooLong)
    assertTranscriberAvailable()
    upload = Buffer.from(pcm16Wav(wav.pcm, wav.sampleRate))
  }
  assertSigningAvailable()

  // --- session, challenge and quota (one short transaction) -------------------------------------
  const day = quotaDay(now)
  const at = now.toISOString()
  const { expiresAt, used } = await withUserLock(db, userId, async (tx) => {
    const session = await repos.sessions.getSession(tx, userId, body.sessionId)
    if (!session) throw new ApiError('not_found', 'session not found')
    if (session.status === 'completed')
      throw new ApiError('conflict', 'session is already completed')
    if (session.status === 'expired' || now.getTime() > new Date(session.expiresAt).getTime())
      throw new ApiError('gone', 'session expired')
    const ref = session.challengeRefs[body.index]
    if (!ref) throw new ApiError('validation', `unknown challenge ${body.index}`)
    if (ref.type !== 'speak')
      throw new ApiError('validation', `challenge ${body.index} is not a speak challenge`)
    const bundle = await loadBundle(await versionOf(tx, session.courseId, session.contentVersion))
    const loc = session.levelId ? findLevel(bundle, session.levelId) : null
    const challenge = buildChallenge(ref, body.index, contentView(bundle, loc?.unitIndex ?? null))
    if (challenge.type !== 'speak')
      throw new ApiError('validation', `challenge ${body.index} is not a speak challenge`)

    const quota = await repos.speech.consumeSpeechQuota(tx, userId, {
      day,
      limit: limits.dailyQuota,
      now: at,
    })
    if (!quota.allowed)
      throw new ApiError('quota_exceeded', 'no speech recognition left today; try again tomorrow')
    return { expiresAt: new Date(session.expiresAt), used: quota.used }
  })

  // --- transcription (no transaction open) -----------------------------------------------------
  let transcript: string
  try {
    transcript = await transcribeAudio({ bytes: upload })
  } catch (e) {
    // The provider refused the request, so nothing was billed: give the quota back.
    if (e instanceof TranscriptionUnavailableError && e.refundable)
      await withUserLock(db, userId, (tx) =>
        repos.speech.refundSpeechQuota(tx, userId, { day, now: at }),
      )
    throw e
  }
  const token = speechToken({
    userId,
    sessionId: body.sessionId,
    index: body.index,
    transcript,
    expiresAt,
  })
  return { transcript, token, remaining: Math.max(0, limits.dailyQuota - used) }
}
