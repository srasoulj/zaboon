/**
 * Setup for the path, letters and practice specs: onboard a guest and finish the fixture's first
 * lesson through the API (the answer-helper pattern from e2e/skeleton.api.spec.ts). Finishing
 * u01-s0 also makes `fixture` the active course (the most recently used enrollment).
 */
import AxeBuilder from '@axe-core/playwright'
import type { APIRequestContext, Page } from '@playwright/test'
import { expect, type Guest } from '../fixtures'

interface Graph {
  start: number
  accept: number[]
  edges: { from: number; to: number; t: string }[]
}
interface Challenge {
  type: string
  answer?: number
  graph?: Graph
  pairs?: unknown[]
}

/** The first accepted path through an answer graph (the canonical solution). */
function canonical(graph: Graph): string[] {
  const words: string[] = []
  let node = graph.start
  const accept = new Set(graph.accept)
  for (let guard = 0; !accept.has(node) && guard < 100; guard++) {
    const edge = graph.edges.find((e) => e.from === node)
    if (!edge) throw new Error('dead end in answer graph')
    if (edge.t) words.push(edge.t)
    node = edge.to
  }
  return words
}

function correctResponse(c: Challenge): unknown {
  switch (c.type) {
    case 'select_translation':
      return { kind: 'choice', value: c.answer }
    case 'translate_bank':
      return { kind: 'tiles', value: canonical(c.graph!) }
    case 'translate_type':
      return { kind: 'text', value: canonical(c.graph!).join(' ') }
    case 'match_pairs':
      return { kind: 'pairs', value: c.pairs!.map((_, i) => [i, i]) }
    default:
      throw new Error(`no scripted answer for ${c.type}`)
  }
}

export async function onboard(request: APIRequestContext, guest: Guest): Promise<void> {
  const res = await request.post('/api/onboarding', {
    headers: { authorization: guest.authorization },
    data: {
      reason: 'culture',
      selfLevel: 'new',
      dailyGoalXp: 20,
      ageConfirmed: true,
      tz: 'UTC',
    },
  })
  expect(res.status(), await res.text()).toBe(200)
}

/** Plays u01-s0 of the fixture course perfectly through the API. */
export async function finishFirstLesson(request: APIRequestContext, guest: Guest): Promise<void> {
  const started = await request.post('/api/sessions', {
    headers: { authorization: guest.authorization },
    data: { courseId: 'fixture', kind: 'lesson', levelId: 'u01-s0', tz: 'UTC' },
  })
  expect(started.status(), await started.text()).toBe(200)
  const session = (await started.json()) as {
    sessionId: string
    graderVersion: number
    challenges: Challenge[]
  }
  const done = await request.post(`/api/sessions/${session.sessionId}/complete`, {
    headers: { authorization: guest.authorization },
    data: {
      answers: session.challenges.map((c, i) => ({
        index: i,
        attemptSeq: i,
        response: correctResponse(c),
        verdict: 'correct',
        ms: 1500,
        hinted: false,
      })),
      completedAt: new Date().toISOString(),
      graderVersion: session.graderVersion,
    },
  })
  expect(done.status(), await done.text()).toBe(200)
}

/** An onboarded guest who finished u01-s0, with `fixture` as the active course. */
export async function learnerAfterFirstLesson(
  request: APIRequestContext,
  guest: Guest,
): Promise<void> {
  await onboard(request, guest)
  await finishFirstLesson(request, guest)
}

/** axe (WCAG 2.0/2.1/2.2 A + AA) on the page content only (the shell has its own specs). */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('#main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([])
}

/** Every Persian element carries dir="rtl" (CLAUDE.md rule 5) and words are never split. */
export async function expectPersianMarkup(
  page: Page,
  { requirePersian = true }: { requirePersian?: boolean } = {},
): Promise<void> {
  const fa = page.locator('#main [lang="fa"]')
  if (requirePersian) expect(await fa.count()).toBeGreaterThan(0)
  const bad = await fa.evaluateAll(
    (els) => els.filter((e) => e.getAttribute('dir') !== 'rtl').length,
  )
  expect(bad).toBe(0)
  const split = await page
    .locator('#main .zb-fa__word')
    .evaluateAll((els) => els.filter((e) => e.childNodes.length !== 1).length)
  expect(split).toBe(0)
}

/** Waits until web fonts are in, so screenshots are stable. */
export async function fontsReady(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready)
}
