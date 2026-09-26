/**
 * P2 speak: the per-learner daily transcription quota (POST /api/speech/transcribe,
 * AppConfig.speech.dailyQuota). One counter row per learner per UTC day in `speech_usage`; the
 * audio and the transcript are never stored.
 *
 * `consumeSpeechQuota` is one atomic upsert: concurrent requests of the same learner serialize on
 * the row lock, so the counter never passes the limit. Run it inside `withUser` / `withUserLock`.
 */
import { sql } from 'drizzle-orm'
import type { Tx } from '../index'
import { assertUserId } from './shared'

const DAY = /^\d{4}-\d{2}-\d{2}$/

function assertDay(day: string): void {
  if (!DAY.test(day)) throw new Error(`invalid day ${day}`)
}

export interface SpeechQuotaResult {
  /** True when this call took one transcription from today's quota. */
  allowed: boolean
  /** Transcriptions counted today after this call (never above the limit). */
  used: number
}

/** Takes one transcription from the learner's quota for `day` (UTC), unless `limit` is used up. */
export async function consumeSpeechQuota(
  tx: Tx,
  userId: string,
  input: { day: string; limit: number; now: string },
): Promise<SpeechQuotaResult> {
  assertUserId(userId)
  assertDay(input.day)
  if (!Number.isInteger(input.limit) || input.limit <= 0) throw new Error('limit must be positive')
  const rows = await tx.execute<{ count: number }>(sql`
    INSERT INTO public.speech_usage AS s (user_id, day, count, updated_at)
    VALUES (${userId}, ${input.day}::date, 1, ${input.now}::timestamptz)
    ON CONFLICT (user_id, day) DO UPDATE
      SET count = s.count + 1, updated_at = excluded.updated_at
      WHERE s.count < ${input.limit}::int
    RETURNING count`)
  const row = rows[0]
  if (row) return { allowed: true, used: Number(row.count) }
  return { allowed: false, used: await getSpeechUsage(tx, userId, input.day) }
}

/**
 * Gives back one transcription taken for `day` (the provider failed, so nothing was transcribed).
 * Never goes below zero; a no-op without a row.
 */
export async function refundSpeechQuota(
  tx: Tx,
  userId: string,
  input: { day: string; now: string },
): Promise<void> {
  assertUserId(userId)
  assertDay(input.day)
  await tx.execute(sql`
    UPDATE public.speech_usage
    SET count = greatest(count - 1, 0), updated_at = ${input.now}::timestamptz
    WHERE user_id = ${userId} AND day = ${input.day}::date`)
}

/** Transcriptions counted for the learner on `day` (UTC); 0 without a row. */
export async function getSpeechUsage(tx: Tx, userId: string, day: string): Promise<number> {
  assertUserId(userId)
  assertDay(day)
  const rows = await tx.execute<{ count: number }>(sql`
    SELECT count FROM public.speech_usage WHERE user_id = ${userId} AND day = ${day}::date`)
  return Number(rows[0]?.count ?? 0)
}
