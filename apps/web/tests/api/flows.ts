/** Route handlers under test plus the common start → complete flow. */
import { expect } from 'vitest'
import type { Challenge } from '@zaboon/contracts'
import * as accountRoute from '../../app/api/account/route'
import * as exportRoute from '../../app/api/account/export/route'
import * as mergeRoute from '../../app/api/account/merge/route'
import * as adminReportRoute from '../../app/api/admin/reports/[id]/route'
import * as adminReportsRoute from '../../app/api/admin/reports/route'
import * as homeRoute from '../../app/api/home/route'
import * as lettersRoute from '../../app/api/letters/route'
import * as onboardingRoute from '../../app/api/onboarding/route'
import * as pathRoute from '../../app/api/path/route'
import * as profileRoute from '../../app/api/profile/route'
import * as reportsRoute from '../../app/api/reports/route'
import * as completeRoute from '../../app/api/sessions/[id]/complete/route'
import * as eventsRoute from '../../app/api/sessions/[id]/events/route'
import * as sessionsRoute from '../../app/api/sessions/route'
import * as settingsRoute from '../../app/api/settings/route'
import * as wordsRoute from '../../app/api/words/route'
import type { Harness, Json, TestUser } from './harness'
import { answersFor } from './play'

export const api = {
  onboarding: onboardingRoute.POST,
  home: homeRoute.GET,
  path: pathRoute.GET,
  letters: lettersRoute.GET,
  words: wordsRoute.GET,
  profile: profileRoute.GET,
  updateProfile: profileRoute.PATCH,
  settings: settingsRoute.GET,
  updateSettings: settingsRoute.PATCH,
  createSession: sessionsRoute.POST,
  event: eventsRoute.POST,
  complete: completeRoute.POST,
  merge: mergeRoute.POST,
  exportAccount: exportRoute.GET,
  deleteAccount: accountRoute.DELETE,
  createReport: reportsRoute.POST,
  adminReports: adminReportsRoute.GET,
  adminUpdateReport: adminReportRoute.PATCH,
}

export interface StartedSession {
  sessionId: string
  kind: string
  levelId: string | null
  graderVersion: number
  challenges: Challenge[]
  lives: { count: number; max: number; nextRegenAt: string | null }
}

export interface StartOptions {
  kind?: 'lesson' | 'practice' | 'letters' | 'unit_review' | 'legendary' | 'jump_test'
  levelId?: string
  courseId?: string
  tz?: string
  now?: Date | string
}

/** POST /api/sessions; a lesson defaults to the fixture's first level. */
export function startRaw(h: Harness, user: TestUser, o: StartOptions = {}) {
  const kind = o.kind ?? 'lesson'
  const levelId = o.levelId ?? (kind === 'lesson' ? 'u01-s0' : undefined)
  return h.call(api.createSession, {
    path: '/api/sessions',
    user,
    ...(o.now === undefined ? {} : { now: o.now }),
    body: {
      courseId: o.courseId ?? 'fixture',
      kind,
      ...(levelId === undefined ? {} : { levelId }),
      tz: o.tz ?? 'UTC',
    },
  })
}

export async function start(
  h: Harness,
  user: TestUser,
  o: StartOptions = {},
): Promise<StartedSession> {
  const res = await startRaw(h, user, o)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as StartedSession
}

export interface FinishOptions {
  wrong?: number[]
  ms?: number
  now?: Date | string
  completedAt?: string
  answers?: unknown[]
}

export function finishRaw(h: Harness, user: TestUser, s: StartedSession, o: FinishOptions = {}) {
  const now =
    o.now === undefined ? undefined : typeof o.now === 'string' ? o.now : o.now.toISOString()
  return h.call(api.complete, {
    path: `/api/sessions/${s.sessionId}/complete`,
    params: { id: s.sessionId },
    user,
    ...(now === undefined ? {} : { now }),
    body: {
      answers:
        o.answers ??
        answersFor(s.challenges, {
          ...(o.wrong ? { wrong: o.wrong } : {}),
          ...(o.ms ? { ms: o.ms } : {}),
        }),
      completedAt: o.completedAt ?? now ?? new Date().toISOString(),
      graderVersion: s.graderVersion,
    },
  })
}

export async function finish(
  h: Harness,
  user: TestUser,
  s: StartedSession,
  o: FinishOptions = {},
): Promise<Json> {
  const res = await finishRaw(h, user, s, o)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body
}

/** Starts and completes a session perfectly. */
export async function play(
  h: Harness,
  user: TestUser,
  o: StartOptions & FinishOptions = {},
): Promise<Json> {
  const s = await start(h, user, o)
  return finish(h, user, s, o)
}

export function wrongEvent(
  h: Harness,
  user: TestUser,
  sessionId: string,
  attemptSeq: number,
  o: { index?: number; now?: Date | string } = {},
) {
  return h.call(api.event, {
    path: `/api/sessions/${sessionId}/events`,
    params: { id: sessionId },
    user,
    ...(o.now === undefined ? {} : { now: o.now }),
    body: { attemptSeq, index: o.index ?? 0, kind: 'wrong' },
  })
}

export const get = (
  h: Harness,
  handler: (typeof api)[keyof typeof api],
  path: string,
  user: TestUser,
  now?: Date | string,
) => h.call(handler, { path, user, ...(now === undefined ? {} : { now }) })
