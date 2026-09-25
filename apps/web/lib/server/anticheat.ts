/**
 * Plausibility checks at commit (ARCHITECTURE §9). Answer keys ship to the client, so re-grading
 * can't stop cheating; these checks decide whether a session may earn XP. A flagged session still
 * completes (progress, SRS, streak) but earns no XP, and the reasons are logged.
 */
import type { AppConfig } from '@zaboon/contracts'
import { repos, type Tx } from '@zaboon/db'

const HOUR_MS = 3_600_000

export type CheatFlag = 'impossible_answer_times' | 'sessions_per_hour' | 'xp_per_hour'

export interface PlausibilityInput {
  userId: string
  sessionId: string
  /** Client-reported answer times of rated (non-skipped) attempts, in ms. */
  answerMs: readonly number[]
  now: Date
  /** XP the session would earn. */
  xp: number
  config: AppConfig
}

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.POSITIVE_INFINITY
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/**
 * Pure part: a typical (median) answer faster than `minMsPerChallenge` is not a human answering.
 * The server's own start→commit time is deliberately not used: the outbox may deliver /complete
 * long after the fact, and scripted API clients (e2e) legitimately commit right after starting.
 */
export function timingFlags(input: Pick<PlausibilityInput, 'answerMs' | 'config'>): CheatFlag[] {
  return median(input.answerMs) < input.config.antiCheat.minMsPerChallenge
    ? ['impossible_answer_times']
    : []
}

export async function plausibilityFlags(tx: Tx, input: PlausibilityInput): Promise<CheatFlag[]> {
  const flags = timingFlags(input)
  const since = new Date(input.now.getTime() - HOUR_MS).toISOString()
  const sessions = await repos.sessions.countSessionsStartedSince(tx, input.userId, since)
  if (sessions > input.config.antiCheat.maxSessionsPerHour) flags.push('sessions_per_hour')
  const xp = await repos.progress.getXpSince(tx, input.userId, since)
  if (xp + input.xp > input.config.antiCheat.maxXpPerHour) flags.push('xp_per_hour')
  if (flags.length > 0)
    console.warn('[anticheat] session flagged; no XP awarded', {
      userId: input.userId,
      sessionId: input.sessionId,
      flags,
    })
  return flags
}
