/**
 * Helpers for the ws-pages specs: dev-auth users made through the API, signing a page in ONCE (unlike
 * the `guestPage` fixture, which re-injects its session on every navigation and so can't switch
 * identity), playing the fixture's short lesson over HTTP, and axe.
 */
import AxeBuilder from '@axe-core/playwright'
import type { APIRequestContext, Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { answersFor } from '../../apps/web/tests/api/play'
import { expect } from '../fixtures'

/** Must match apps/web/lib/auth-client.ts LOCAL_SESSION_KEY. */
const LOCAL_SESSION_KEY = 'zaboon.session'

export interface User {
  userId: string
  accessToken: string
  expiresAt: number
  isAnonymous: boolean
  email: string | null
  headers: { authorization: string }
}

async function toUser(res: Awaited<ReturnType<APIRequestContext['post']>>): Promise<User> {
  expect(res.status(), await res.text()).toBe(200)
  const body = (await res.json()) as {
    accessToken: string
    expiresAt: string
    user: { id: string; isAnonymous: boolean; email: string | null }
  }
  return {
    userId: body.user.id,
    accessToken: body.accessToken,
    expiresAt: Date.parse(body.expiresAt),
    isAnonymous: body.user.isAnonymous,
    email: body.user.email,
    headers: { authorization: `Bearer ${body.accessToken}` },
  }
}

/** A unique marker for rows in the shared, never-reset local DB. */
export const unique = (prefix: string) => `${prefix}${randomUUID().replaceAll('-', '').slice(0, 12)}`
export const uniqueEmail = () => `${unique('e2e-')}@example.com`

export const newGuest = async (request: APIRequestContext) =>
  toUser(await request.post('/api/dev/auth/anonymous'))
export const signInEmail = async (request: APIRequestContext, email: string) =>
  toUser(await request.post('/api/dev/auth/sign-in', { data: { email } }))
export const newAdmin = async (request: APIRequestContext) =>
  toUser(await request.post('/api/dev/auth/admin'))

export async function onboard(request: APIRequestContext, user: User): Promise<void> {
  const res = await request.post('/api/onboarding', {
    headers: user.headers,
    data: { reason: 'travel', selfLevel: 'new', dailyGoalXp: 20, ageConfirmed: true, tz: 'UTC' },
  })
  expect(res.status(), await res.text()).toBe(200)
}

export async function home(request: APIRequestContext, user: User) {
  const res = await request.get('/api/home', { headers: user.headers })
  expect(res.status()).toBe(200)
  return (await res.json()) as { xpTotal: number; user: { onboarded: boolean; isAnonymous: boolean } }
}

/** Plays the fixture's short first lesson perfectly over HTTP; returns the XP it earned. */
export async function playFixtureLesson(request: APIRequestContext, user: User): Promise<number> {
  const started = await request.post('/api/sessions', {
    headers: user.headers,
    data: { courseId: 'fixture', kind: 'lesson', levelId: 'u01-s0', tz: 'UTC' },
  })
  expect(started.status(), await started.text()).toBe(200)
  const s = (await started.json()) as {
    sessionId: string
    graderVersion: number
    challenges: Parameters<typeof answersFor>[0]
  }
  const done = await request.post(`/api/sessions/${s.sessionId}/complete`, {
    headers: user.headers,
    data: {
      answers: answersFor(s.challenges),
      completedAt: new Date().toISOString(),
      graderVersion: s.graderVersion,
    },
  })
  expect(done.status(), await done.text()).toBe(200)
  return ((await done.json()) as { xp: { total: number } }).xp.total
}

/**
 * Signs the page in as `user` once (the app's auth client reads this key at start). Later identity
 * switches made by the app itself stick, because nothing re-injects the session.
 */
export async function signInPage(page: Page, user: User, path: string): Promise<void> {
  await page.goto('/sign-in')
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [
      LOCAL_SESSION_KEY,
      JSON.stringify({
        accessToken: user.accessToken,
        expiresAt: user.expiresAt,
        userId: user.userId,
        isAnonymous: user.isAnonymous,
        email: user.email,
      }),
    ],
  )
  await page.goto(path)
}

export async function storedSession(page: Page) {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), LOCAL_SESSION_KEY)
  return JSON.parse(raw ?? 'null') as { userId: string; isAnonymous: boolean; accessToken: string } | null
}

/** WCAG 2.2 A/AA violations inside `selector` (page content only, not the shell). */
export async function axeViolations(page: Page, selector = 'main'): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  )
}

export const THEMES = ['light', 'dark'] as const
