/**
 * Speech transcript tokens (P2 speak). POST /api/speech/transcribe signs the transcript it
 * returns, bound to the learner, the session, the challenge index and the SHA-256 of the
 * NFC-normalized transcript, valid until the session expires. /complete grades a speak answer only
 * when its token verifies for the same four values, so a client can't send a transcript the server
 * never produced.
 */
import { createHash } from 'node:crypto'
import { sign, SigningUnavailableError, verify } from '../signing'

export const SPEECH_TOKEN_PURPOSE = 'speech'

/** Hex SHA-256 of the NFC-normalized transcript (what the token binds). */
export function transcriptDigest(transcript: string): string {
  return createHash('sha256').update(transcript.normalize('NFC'), 'utf8').digest('hex')
}

export function speechToken(args: {
  userId: string
  sessionId: string
  index: number
  transcript: string
  expiresAt: Date
}): string {
  return sign(
    SPEECH_TOKEN_PURPOSE,
    { u: args.userId, s: args.sessionId, i: args.index, h: transcriptDigest(args.transcript) },
    { expiresAt: args.expiresAt },
  )
}

/**
 * True only for a token signed by speechToken for exactly this user, session, index and
 * transcript (up to NFC), unexpired at `now`. A missing, malformed, forged or mismatched token is
 * false; so is any token while the signing secret is unavailable (no transcript can be trusted).
 */
export function verifySpeechToken(
  token: string | undefined,
  args: { userId: string; sessionId: string; index: number; transcript: string },
  now: Date,
): boolean {
  if (typeof token !== 'string' || token.length === 0) return false
  let payload: Record<string, unknown> | null
  try {
    payload = verify(SPEECH_TOKEN_PURPOSE, token, now)
  } catch (e) {
    if (e instanceof SigningUnavailableError) return false
    throw e
  }
  if (!payload) return false
  return (
    payload.u === args.userId &&
    payload.s === args.sessionId &&
    payload.i === args.index &&
    payload.h === transcriptDigest(args.transcript)
  )
}
