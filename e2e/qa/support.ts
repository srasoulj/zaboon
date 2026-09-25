/**
 * QA helpers for specs that drive the running app's HTTP API (CLAUDE.md rule 9): dev-auth users,
 * sessions of the frozen fixture course and scripted answers for every MVP challenge type.
 *
 * Every helper takes the test's `request` context and a fresh user, so specs never share state and
 * can run in any order and in parallel.
 */
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test'

/** Must match TEST_NOW_HEADER and APP_VERSION_HEADER in @zaboon/contracts. */
export const TEST_NOW = 'x-test-now'
export const APP_VERSION = 'x-zaboon-app-version'

export interface User {
  id: string
  token: string
  authorization: string
}

export interface Graph {
  start: number
  accept: number[]
  edges: { from: number; to: number; t: string }[]
}

/** The parts of a challenge the scripted answers need (the full shape is in @zaboon/contracts). */
export interface Challenge {
  index: number
  type: string
  answer?: number | string
  choices?: unknown[]
  graph?: Graph
  pairs?: unknown[]
}

export interface Session {
  sessionId: string
  kind: string
  levelId: string | null
  expiresAt: string
  graderVersion: number
  challenges: Challenge[]
  lives: Lives
}

export interface Lives {
  count: number
  max: number
  nextRegenAt: string | null
}

export interface Answer {
  index: number
  attemptSeq: number
  response: { kind: string; value?: unknown }
  verdict: 'correct' | 'wrong' | 'skipped'
  ms: number
  hinted: boolean
}

/** A JSON body read from a response (tests assert on arbitrary shapes). */
export type Body = Record<string, unknown>

export interface Result {
  status: number
  body: Body
  headers: Record<string, string>
}

async function read(res: APIResponse): Promise<Result> {
  const text = await res.text()
  let body: Body
  try {
    body = JSON.parse(text) as Body
  } catch {
    body = { raw: text }
  }
  return { status: res.status(), body, headers: res.headers() }
}

async function devUser(request: APIRequestContext, path: string, token?: string): Promise<User> {
  const res = await request.post(path, {
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    ...(path.endsWith('/link') || path.endsWith('/sign-in')
      ? { data: { email: `qa-${crypto.randomUUID()}@zaboon.test` } }
      : {}),
  })
  expect(res.status(), await res.text()).toBe(200)
  const body = (await res.json()) as { accessToken: string; user: { id: string } }
  return {
    id: body.user.id,
    token: body.accessToken,
    authorization: `Bearer ${body.accessToken}`,
  }
}

/** A fresh anonymous guest. */
export const guest = (request: APIRequestContext) => devUser(request, '/api/dev/auth/anonymous')
/** A fresh admin (has the admin role claim). */
export const admin = (request: APIRequestContext) => devUser(request, '/api/dev/auth/admin')
/** Links a fresh email to a guest: the same user id, now a member. */
export const link = (request: APIRequestContext, user: User) =>
  devUser(request, '/api/dev/auth/link', user.token)

export interface CallOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  data?: unknown
  /** Server clock for this request (x-test-now, local auth mode only). */
  now?: string
  headers?: Record<string, string>
}

/** Calls the API as `user` (or anonymously with `null`) and returns status, JSON body and headers. */
export async function call(
  request: APIRequestContext,
  user: User | null,
  path: string,
  o: CallOptions = {},
): Promise<Result> {
  const headers: Record<string, string> = { ...o.headers }
  if (user) headers.authorization = user.authorization
  if (o.now) headers[TEST_NOW] = o.now
  const method = o.method ?? (o.data === undefined ? 'GET' : 'POST')
  const res = await request.fetch(path, {
    method,
    headers,
    ...(o.data === undefined ? {} : { data: o.data }),
  })
  return read(res)
}

export interface StartOptions {
  kind?: 'lesson' | 'practice' | 'letters' | 'unit_review'
  levelId?: string
  tz?: string
  now?: string
}

export function startRaw(request: APIRequestContext, user: User, o: StartOptions = {}) {
  const kind = o.kind ?? 'lesson'
  const levelId = o.levelId ?? (kind === 'lesson' ? 'u01-s0' : undefined)
  return call(request, user, '/api/sessions', {
    ...(o.now ? { now: o.now } : {}),
    data: {
      courseId: 'fixture',
      kind,
      ...(levelId === undefined ? {} : { levelId }),
      tz: o.tz ?? 'UTC',
    },
  })
}

/** Starts a session of the fixture course (by default its short first lesson, u01-s0). */
export async function start(
  request: APIRequestContext,
  user: User,
  o: StartOptions = {},
): Promise<Session> {
  const res = await startRaw(request, user, o)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as unknown as Session
}

/** The first accepted path through an answer graph (the canonical solution), as tokens. */
export function canonical(graph: Graph): string[] {
  const words: string[] = []
  const accept = new Set(graph.accept)
  let node = graph.start
  for (let guard = 0; !accept.has(node) && guard < 200; guard++) {
    const edge = graph.edges.find((e) => e.from === node)
    if (!edge) throw new Error('dead end in answer graph')
    if (edge.t) words.push(edge.t)
    node = edge.to
  }
  return words
}

/** The response a learner who knows the answer sends, for each of the 13 MVP challenge types. */
export function correctResponse(c: Challenge): Answer['response'] {
  switch (c.type) {
    case 'select_image':
    case 'select_translation':
    case 'cloze_choice':
    case 'complete_chat':
    case 'letter_sound':
    case 'read_word':
      return { kind: 'choice', value: c.answer }
    case 'translate_bank':
    case 'listen_tap':
      return { kind: 'tiles', value: canonical(c.graph!) }
    case 'translate_type':
      return { kind: 'text', value: canonical(c.graph!).join(' ') }
    case 'match_pairs':
    case 'letter_forms':
      return { kind: 'pairs', value: c.pairs!.map((_, i) => [i, i]) }
    case 'letter_intro':
      return { kind: 'none' }
    case 'build_word':
      return { kind: 'tiles', value: [...String(c.answer)] }
    default:
      throw new Error(`no scripted answer for ${c.type}`)
  }
}

/** A response the grader marks wrong (choice challenges only; others get a mismatched kind). */
export function wrongResponse(c: Challenge): Answer['response'] {
  if (typeof c.answer === 'number' && c.choices)
    return { kind: 'choice', value: (c.answer + 1) % c.choices.length }
  return { kind: 'choice', value: 99 }
}

/**
 * Answers every challenge correctly on the first try, except `wrong` indexes: those are answered
 * wrong first and correctly at the end (a re-queued retry with its own attemptSeq), like the player.
 * `ms` stays above the anti-cheat minimum (800 ms) so the session earns XP.
 */
export function answersFor(
  challenges: readonly Challenge[],
  o: { wrong?: readonly number[]; ms?: number } = {},
): Answer[] {
  const ms = o.ms ?? 1500
  const out: Answer[] = []
  let seq = 0
  for (const c of challenges) {
    const wrong = o.wrong?.includes(c.index) ?? false
    out.push({
      index: c.index,
      attemptSeq: seq++,
      response: wrong ? wrongResponse(c) : correctResponse(c),
      verdict: wrong ? 'wrong' : 'correct',
      ms,
      hinted: false,
    })
  }
  for (const i of o.wrong ?? [])
    out.push({
      index: i,
      attemptSeq: seq++,
      response: correctResponse(challenges[i]!),
      verdict: 'correct',
      ms,
      hinted: false,
    })
  return out
}

export interface FinishOptions {
  now?: string
  completedAt?: string
  answers?: Answer[]
  wrong?: number[]
}

export function finishRaw(
  request: APIRequestContext,
  user: User,
  s: Session,
  o: FinishOptions = {},
): Promise<Result> {
  return call(request, user, `/api/sessions/${s.sessionId}/complete`, {
    ...(o.now ? { now: o.now } : {}),
    data: {
      answers: o.answers ?? answersFor(s.challenges, o.wrong ? { wrong: o.wrong } : {}),
      completedAt: o.completedAt ?? o.now ?? new Date().toISOString(),
      graderVersion: s.graderVersion,
    },
  })
}

/** Completes a session (perfectly unless `wrong`/`answers` say otherwise); expects 200. */
export async function finish(
  request: APIRequestContext,
  user: User,
  s: Session,
  o: FinishOptions = {},
): Promise<Body> {
  const res = await finishRaw(request, user, s, o)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body
}

/** Starts and perfectly completes a session. */
export async function play(
  request: APIRequestContext,
  user: User,
  o: StartOptions & FinishOptions = {},
): Promise<Body> {
  const s = await start(request, user, o)
  return finish(request, user, s, o)
}

/** POST /api/sessions/:id/events: one wrong attempt. */
export function wrongEvent(
  request: APIRequestContext,
  user: User,
  sessionId: string,
  attemptSeq: number,
  o: { index?: number; now?: string } = {},
): Promise<Result> {
  return call(request, user, `/api/sessions/${sessionId}/events`, {
    ...(o.now ? { now: o.now } : {}),
    data: { attemptSeq, index: o.index ?? 0, kind: 'wrong' },
  })
}

/** GET a user-scoped read model; expects 200. */
export async function read200(
  request: APIRequestContext,
  user: User,
  path: string,
  now?: string,
): Promise<Body> {
  const res = await call(request, user, path, now ? { now } : {})
  expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(200)
  return res.body
}

/** The error envelope every failure uses (withRoute + errors.ts). */
export function expectEnvelope(res: Result, status: number, code: string): void {
  expect(res.status, JSON.stringify(res.body)).toBe(status)
  expect(res.body).toMatchObject({ error: { code, message: expect.any(String) } })
  expect(res.headers['cache-control']).toBe('no-store')
}

/** An ISO instant `hours` after `iso`. */
export const plusHours = (iso: string, hours: number) =>
  new Date(Date.parse(iso) + hours * 3_600_000).toISOString()
