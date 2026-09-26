/**
 * Helpers for the speak route tests: a guest at the fixture's u01-v1 (two speak pins and a
 * listen_tap), transcribe calls with local test audio (TEST_TRANSCRIPT_PREFIX + text), and
 * scripted answers for a speak session.
 */
import { expect } from 'vitest'
import {
  DEFAULT_APP_CONFIG,
  TEST_TRANSCRIPT_PREFIX,
  type AppConfig,
  type Challenge,
  type ChallengeResponse,
} from '@zaboon/contracts'
import { repos, withSystem } from '@zaboon/db'
import * as transcribeRoute from '../../app/api/speech/transcribe/route'
import { resetRuntimeConfig } from '../../lib/server/config'
import { api, play, type StartedSession } from '../api/flows'
import type { Harness, TestUser } from '../api/harness'
import { canonicalTokens, correctResponse } from '../api/play'

export const SPEAK = { speak: true } as const
export const transcribeHandler = transcribeRoute.POST

/** Standard base64 of local test audio that "says" `text`. */
export const testAudio = (text: string): string =>
  Buffer.from(TEST_TRANSCRIPT_PREFIX + text, 'utf8').toString('base64')

/** A guest who has played every level before u01-v1 (flags off), so u01-v1 is current. */
export async function reachV1(h: Harness): Promise<TestUser> {
  const u = await h.guest()
  await play(h, u) // u01-s0
  await play(h, u, { levelId: 'u01-l1' })
  await play(h, u, { levelId: 'u01-l2' })
  await play(h, u, { kind: 'practice', levelId: 'u01-p1' })
  await play(h, u, { kind: 'unit_review', levelId: 'u01-r1' })
  await play(h, u, { levelId: 'u01-t1' }) // flags off: its MVP twins
  return u
}

export function startV1Raw(
  h: Harness,
  u: TestUser,
  o: { flags?: Record<string, boolean>; speakPaused?: boolean; now?: string } = {},
) {
  return h.call(api.createSession, {
    path: '/api/sessions',
    user: u,
    flags: o.flags ?? SPEAK,
    ...(o.now === undefined ? {} : { now: o.now }),
    body: {
      courseId: 'fixture',
      kind: 'lesson',
      levelId: 'u01-v1',
      tz: 'UTC',
      ...(o.speakPaused === undefined ? {} : { speakPaused: o.speakPaused }),
    },
  })
}

export type V1Session = StartedSession & { expiresAt: string }

export async function startV1(
  h: Harness,
  u: TestUser,
  o: { flags?: Record<string, boolean>; speakPaused?: boolean; now?: string } = {},
): Promise<V1Session> {
  const res = await startV1Raw(h, u, o)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as V1Session
}

/** Indexes of the session's speak challenges. */
export const speakIndexes = (s: StartedSession): number[] =>
  s.challenges.filter((c) => c.type === 'speak').map((c) => c.index)

/** What a learner who says the prompt correctly is heard as (the graph's canonical path). */
export const spoken = (c: Challenge): string =>
  canonicalTokens((c as { graph: Parameters<typeof canonicalTokens>[0] }).graph).join(' ')

export interface TranscribeInput {
  sessionId: string
  index: number
  audio?: string
  text?: string
  format?: string
  durationMs?: number
}

export function transcribeCall(
  h: Harness,
  u: TestUser,
  input: TranscribeInput,
  o: { flags?: Record<string, boolean>; now?: string } = {},
) {
  return h.call(transcribeHandler, {
    path: '/api/speech/transcribe',
    user: u,
    flags: o.flags ?? SPEAK,
    ...(o.now === undefined ? {} : { now: o.now }),
    body: {
      sessionId: input.sessionId,
      index: input.index,
      format: input.format ?? 'webm',
      audio: input.audio ?? testAudio(input.text ?? ''),
      durationMs: input.durationMs ?? 1500,
    },
  })
}

/** Transcribes `text` for the speak challenge at `index`; expects 200 and returns the body. */
export async function transcribeOk(
  h: Harness,
  u: TestUser,
  s: StartedSession,
  index: number,
  text: string,
): Promise<{ transcript: string; token: string; remaining: number }> {
  const res = await transcribeCall(h, u, { sessionId: s.sessionId, index, text })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body
}

/**
 * One first-try answer per challenge claimed `correct`: a speak challenge gets `speakResponse(c)`
 * (by default the canonical transcript without a token), anything else its correct response.
 */
export function v1Answers(
  s: StartedSession,
  speakResponse: (c: Challenge) => ChallengeResponse = (c) => ({
    kind: 'audio',
    transcript: spoken(c),
  }),
) {
  return s.challenges.map((c, i) => ({
    index: c.index,
    attemptSeq: i,
    response: c.type === 'speak' ? speakResponse(c) : correctResponse(c),
    verdict: 'correct' as const,
    ms: 2500,
    hinted: false,
  }))
}

/** Replaces AppConfig.speech for every later request (restore with `setSpeechConfig(h)`). */
export async function setSpeechConfig(
  h: Harness,
  speech: Partial<AppConfig['speech']> = {},
): Promise<void> {
  await withSystem(h.db.db, (tx) =>
    repos.content.setAppConfig(tx, 'speech', { ...DEFAULT_APP_CONFIG.speech, ...speech }),
  )
  resetRuntimeConfig()
}

export async function usageOf(h: Harness, userId: string): Promise<number> {
  const [row] = await h.sql`
    SELECT coalesce(sum(count), 0)::int AS n FROM speech_usage WHERE user_id = ${userId}`
  return Number(row?.n ?? 0)
}

/** Public tables with any row whose text form contains `needle` (superuser: every row). */
export async function tablesContaining(h: Harness, needle: string): Promise<string[]> {
  const tables = await h.sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
  const hits: string[] = []
  for (const { table_name } of tables) {
    const [row] = await h.sql`
      SELECT count(*)::int AS n FROM ${h.sql('public')}.${h.sql(table_name)} x
      WHERE x::text LIKE ${'%' + needle + '%'}`
    if (Number(row?.n ?? 0) > 0) hits.push(table_name)
  }
  return hits
}
