/**
 * Helpers for the Wave 3 QA specs (engagement + typing with every flag on): a member whose path is
 * at the fixture's P2 level u01-t1, the lesson player's controls for typed Persian and tracing
 * (synthetic pointer strokes over the guide, as in e2e/renderers), and API reads with the flags.
 */
import type { APIRequestContext, Locator, Page } from '@playwright/test'
import postgres from 'postgres'
import { expect, flagsHeader } from '../fixtures'
import { signInEmail, uniqueEmail, type User as PageUser } from '../pages/helpers'
import { answersFor, call, play, type Body, type Session, type User } from './support'

export const ZWNJ = '‌'
export const T1 = '/lesson?course=fixture&kind=lesson&level=u01-t1'
/** Every Wave 3 flag: engagement and typing. */
export const ALL_FLAGS = {
  leagues: true,
  quests: true,
  shop: true,
  practiceHub: true,
  persianKeyboard: true,
  letterTrace: true,
}

/** The QA API user (e2e/qa/support.ts) for a pages-helper user. */
export const apiUser = (u: PageUser): User => ({
  id: u.userId,
  token: u.accessToken,
  authorization: u.headers.authorization,
})

/** GET with every Wave 3 flag on at `now`; expects 200. */
export async function readOn(
  request: APIRequestContext,
  user: User,
  path: string,
  now?: string,
  flags: Record<string, boolean> = ALL_FLAGS,
): Promise<Body> {
  const res = await call(request, user, path, {
    headers: flagsHeader(flags),
    ...(now ? { now } : {}),
  })
  expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(200)
  return res.body
}

/** Onboards with a daily goal of 10 XP in UTC. */
export async function onboard10(request: APIRequestContext, user: User, now?: string) {
  const res = await call(request, user, '/api/onboarding', {
    data: { reason: 'travel', selfLevel: 'new', dailyGoalXp: 10, ageConfirmed: true, tz: 'UTC' },
    ...(now ? { now } : {}),
  })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
}

/** Plays every MVP level of the fixture unit at `now` (no flags), so u01-t1 is current. */
export async function reachT1(request: APIRequestContext, user: User, now: string) {
  await play(request, user, { now })
  await play(request, user, { levelId: 'u01-l1', now })
  await play(request, user, { levelId: 'u01-l2', now })
  await play(request, user, { kind: 'practice', levelId: 'u01-p1', now })
  await play(request, user, { kind: 'unit_review', levelId: 'u01-r1', now })
}

/**
 * A new member whose quests on `now`'s date include "Complete a lesson" (quests are drawn per
 * learner and date, so any lesson that day completes one quest and pays its coins).
 */
export async function memberWithLessonQuest(request: APIRequestContext, now: string) {
  for (let i = 0; i < 40; i++) {
    const member = await signInEmail(request, uniqueEmail())
    const user = apiUser(member)
    await onboard10(request, user, now)
    const q = await readOn(request, user, '/api/quests', now, { quests: true })
    if ((q.quests as { id: string }[]).some((x) => x.id === 'lessons_1')) return { member, user }
  }
  throw new Error('no learner drew the lessons_1 quest in 40 tries')
}

export const challenge = (page: Page) => page.getByTestId('lesson-challenge')

export async function expectType(page: Page, type: string) {
  await expect(challenge(page)).toHaveAttribute('data-type', type)
}

/** The feedback bar shows `verdict`; CONTINUE. */
export async function feedbackThenContinue(page: Page, verdict: string) {
  const feedback = page.getByTestId('lesson-feedback')
  await expect(feedback).toHaveAttribute('data-verdict', verdict)
  await feedback.getByRole('button', { name: 'Continue' }).click()
}

/** Horizontal strokes over every run of guide pixels, one every `step` rows (canvas coordinates). */
export async function guideStrokes(canvas: Locator, step = 6): Promise<[number, number][][]> {
  return canvas.evaluate((el, step) => {
    const c = el as HTMLCanvasElement
    const { data, width, height } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
    const out: [number, number][][] = []
    for (let y = 0; y < height; y += step) {
      let run: number | null = null
      for (let x = 0; x <= width; x++) {
        const ink = x < width && data[(y * width + x) * 4 + 3]! > 128
        if (ink && run === null) run = x
        if (!ink && run !== null) {
          out.push([
            [run, y],
            [x - 1, y],
          ])
          run = null
        }
      }
    }
    return out
  }, step)
}

/** A zigzag across the whole canvas: a scribble that ignores the guide. */
export async function scribble(canvas: Locator): Promise<[number, number][][]> {
  const size = await canvas.evaluate((el) => (el as HTMLCanvasElement).width)
  return [Array.from({ length: 16 }, (_, i) => [i % 2 ? 4 : size - 4, 4 + i * ((size - 8) / 15)])]
}

/** Draws strokes (canvas coordinates) with the mouse, as Pointer Events. */
export async function drawStrokes(page: Page, canvas: Locator, strokes: [number, number][][]) {
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  const size = await canvas.evaluate((el) => (el as HTMLCanvasElement).width)
  const at = ([x, y]: [number, number]) =>
    [box.x + (x * box.width) / size, box.y + (y * box.height) / size] as const
  for (const stroke of strokes) {
    const [first, ...rest] = stroke
    await page.mouse.move(...at(first!))
    await page.mouse.down()
    for (const p of rest) await page.mouse.move(...at(p), { steps: 4 })
    await page.mouse.up()
  }
}

/** Waits until the trace guide is drawn (it needs the Persian font). */
export async function guideReady(canvas: Locator) {
  await expect.poll(async () => (await guideStrokes(canvas)).length).toBeGreaterThan(3)
}

/** Persian text rules on the current page: `[lang=fa]` has dir=rtl, no word split over elements. */
export async function persianMarkupProblems(page: Page, selector = 'body'): Promise<string[]> {
  return page.locator(selector).evaluate((root) => {
    const problems: string[] = []
    const persian = /[؀-ۿ]/
    /** Both text nodes flow in one line box: every element between them and their common
     * ancestor is display: inline (block siblings, list items and table cells are separate). */
    const inline = (x: Text, y: Text) => {
      const common = (() => {
        for (let e: Element | null = x.parentElement; e; e = e.parentElement)
          if (e.contains(y)) return e
        return null
      })()
      const flows = (t: Text) => {
        for (let e = t.parentElement; e && e !== common; e = e.parentElement)
          if (getComputedStyle(e).display !== 'inline') return false
        return true
      }
      return common !== null && flows(x) && flows(y)
    }
    for (const el of root.querySelectorAll('[lang="fa"]'))
      if (el.getAttribute('dir') !== 'rtl')
        problems.push(`lang=fa without dir=rtl: <${el.tagName.toLowerCase()}> ${el.textContent}`)
    // A Persian letter at the end of one text node and at the start of the next text node in
    // document order, with no space between them, means one word split across elements.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let prev: Text | null = null
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      const text = n.data
      if (!text.trim()) {
        if (text.length > 0) prev = null // whitespace separates words
        continue
      }
      if (prev && prev.parentElement !== n.parentElement) {
        const a = prev.data.at(-1) ?? ''
        const b = text[0] ?? ''
        const hidden = (t: Text) => t.parentElement?.closest('[aria-hidden="true"], .sr-only')
        if (persian.test(a) && persian.test(b) && !hidden(prev) && !hidden(n) && inline(prev, n))
          problems.push(`word split across elements: «${prev.data}|${text}»`)
      }
      prev = n
    }
    return problems
  })
}

/** Starts and completes a fixture session with `flags` on (perfect unless `wrong`); expects 200. */
export async function playOn(
  request: APIRequestContext,
  user: User,
  flags: Record<string, boolean>,
  o: { now: string; wrong?: number[]; levelId?: string; kind?: 'lesson' | 'practice' },
): Promise<Body> {
  const headers = flagsHeader(flags)
  const kind = o.kind ?? 'lesson'
  const started = await call(request, user, '/api/sessions', {
    now: o.now,
    headers,
    data: {
      courseId: 'fixture',
      kind,
      ...(kind === 'lesson' ? { levelId: o.levelId ?? 'u01-s0' } : {}),
      tz: 'UTC',
    },
  })
  expect(started.status, JSON.stringify(started.body)).toBe(200)
  const s = started.body as unknown as Session
  const done = await call(request, user, `/api/sessions/${s.sessionId}/complete`, {
    now: o.now,
    headers,
    data: {
      answers: answersFor(s.challenges, o.wrong ? { wrong: o.wrong } : {}),
      completedAt: o.now,
      graderVersion: s.graderVersion,
    },
  })
  expect(done.status, JSON.stringify(done.body)).toBe(200)
  return done.body
}

const DB_URL = `postgres://supabase_admin@127.0.0.1:${process.env.ZABOON_DB_PORT ?? 54322}/${
  process.env.ZABOON_DB_NAME ?? 'zaboon'
}`

/** Puts a learner in a league tier (user_league), as a past rollover would have. */
export async function setTier(userId: string, tier: string): Promise<void> {
  const sql = postgres(DB_URL, { max: 1, onnotice: () => {} })
  try {
    await sql`INSERT INTO public.user_league (user_id, tier) VALUES (${userId}, ${tier})
              ON CONFLICT (user_id) DO UPDATE SET tier = ${tier}`
  } finally {
    await sql.end()
  }
}
