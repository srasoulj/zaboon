/**
 * The fixture's P2 level u01-v1 (speak s_u01_0001, speak s_u01_0007, listen_tap s_u01_0005) in the
 * real lesson player with flags.speak on and a fake microphone (e2e/fixtures/browser-fakes.ts):
 * every recording "says" a scripted transcript, which the local-mode transcribe route returns
 * with a signed token, so /complete re-grades it like a real one.
 *
 * - a correct utterance grades correct and the lesson earns XP;
 * - a wrong utterance costs a heart;
 * - "Can't speak now" keeps every heart, and the next session is created with speakPaused (no
 *   speak challenges: the pins play their listen_tap twins);
 * - a denied microphone shows a clear message and the same way on;
 * - with the flag off, u01-v1 plays listen_tap twins;
 * - axe (WCAG 2.0/2.1 A+AA, 2.2 AA) on the speak screen, and every [lang=fa] has dir=rtl.
 */
import AxeBuilder from '@axe-core/playwright'
import type { APIRequestContext, Page } from '@playwright/test'
import { denyMicrophone, expect, fakeMicrophone, setTestFlags, test, type Guest } from '../fixtures'
import { play, type Session, type User } from '../qa/support'
import { solveGraph } from '../qa/golden-answers'

const V1 = '/lesson?course=fixture&kind=lesson&level=u01-v1'
const FLAGS = { speak: true }
/** The Persian of the two speak pins (s_u01_0001, s_u01_0007). */
const FIRST = 'سلام، خوبی؟'
const SECOND = 'من سیب می‌خوام'
const WRONG = 'خداحافظ'

/** Plays every level before u01-v1 through the API (flags off), so u01-v1 is current. */
async function reachV1(request: APIRequestContext, guest: Guest): Promise<void> {
  const user: User = {
    id: guest.userId,
    token: guest.accessToken,
    authorization: guest.authorization,
  }
  await play(request, user)
  await play(request, user, { levelId: 'u01-l1' })
  await play(request, user, { levelId: 'u01-l2' })
  await play(request, user, { kind: 'practice', levelId: 'u01-p1' })
  await play(request, user, { kind: 'unit_review', levelId: 'u01-r1' })
  await play(request, user, { levelId: 'u01-t1' })
}

const challenge = (page: Page) => page.getByTestId('lesson-challenge')

async function expectType(page: Page, type: string) {
  await expect(challenge(page)).toHaveAttribute('data-type', type)
}

interface Opened {
  session: Session
  body: Record<string, unknown>
}

/** Opens u01-v1 and returns the createSession request body and the session it created. */
async function openV1(page: Page): Promise<Opened> {
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/sessions') && r.request().method() === 'POST',
  )
  await page.goto(V1)
  const res = await created
  expect(res.status()).toBe(200)
  const body = res.request().postDataJSON() as Record<string, unknown>
  const session = (await res.json()) as Session
  await expect(page.getByTestId('lesson-player')).toBeVisible()
  return { session, body }
}

/** Records one utterance (the fake microphone says the next scripted transcript). */
async function speak(page: Page) {
  await challenge(page).getByRole('button', { name: 'Start recording' }).click()
  await challenge(page).getByRole('button', { name: 'Stop recording' }).click()
  await expect(challenge(page).getByTestId('speak-transcript')).toBeVisible()
}

/** Faster answers earn no XP (AppConfig.antiCheat.minMsPerChallenge = 800 ms median). */
const HUMAN_MS = 900

async function check(page: Page, verdict: string, o: { human?: boolean } = {}) {
  if (o.human) await page.waitForTimeout(HUMAN_MS)
  await page.getByTestId('lesson-check').click()
  await expect(page.getByTestId('lesson-feedback')).toHaveAttribute('data-verdict', verdict)
}

async function next(page: Page) {
  await page.getByTestId('lesson-feedback').getByRole('button', { name: 'Continue' }).click()
}

/** Taps the listen_tap answer from the word bank. */
async function tapListen(page: Page, session: Session) {
  await expectType(page, 'listen_tap')
  const index = Number(await challenge(page).getAttribute('data-index'))
  const c = session.challenges.find((x) => x.index === index) as unknown as {
    bank: string[]
    graph: Parameters<typeof solveGraph>[0]
  }
  const words = solveGraph(c.graph, c.bank)!
  const bank = challenge(page).getByRole('group', { name: 'Word bank', exact: true })
  for (const w of words) await bank.getByRole('button', { name: w, exact: true }).first().click()
}

async function expectA11y(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations, `${label}: ${JSON.stringify(results.violations, null, 2)}`).toEqual([])
  const bad = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[lang="fa"]'))
      .filter((el) => el.getAttribute('dir') !== 'rtl')
      .map((el) => el.outerHTML.slice(0, 120)),
  )
  expect(bad, `${label}: lang=fa without dir=rtl`).toEqual([])
}

test('u01-v1 with speak on: saying both sentences grades correct and earns XP', async ({
  guestPage: page,
  guest,
  request,
}) => {
  await reachV1(request, guest)
  await setTestFlags(page, FLAGS)
  await fakeMicrophone(page, [FIRST, SECOND])
  const { session, body } = await openV1(page)
  expect(body).not.toHaveProperty('speakPaused')
  expect(session.challenges.map((c) => c.type)).toEqual(['speak', 'speak', 'listen_tap'])
  await expect(page.getByTestId('lesson-hearts')).toHaveAttribute('data-count', '5')

  await expectType(page, 'speak')
  await expect(challenge(page).getByRole('heading', { name: 'Speak this sentence' })).toBeVisible()
  await expectA11y(page, 'speak (idle)')
  await speak(page)
  await expect(
    challenge(page).getByTestId('speak-transcript').locator('[lang="fa"]'),
  ).toHaveAttribute('dir', 'rtl')
  await expectA11y(page, 'speak (transcribed)')
  await check(page, 'correct', { human: true })
  await next(page)

  await expectType(page, 'speak')
  await speak(page)
  await check(page, 'correct', { human: true })
  await next(page)

  await tapListen(page, session)
  const completed = page.waitForResponse((r) => /\/api\/sessions\/[^/]+\/complete$/.test(r.url()))
  await check(page, 'correct', { human: true })
  await next(page)

  // The server re-graded both transcripts with their tokens: a perfect lesson with XP.
  const result = (await (await completed).json()) as { xp: { total: number }; accuracy: number }
  expect(result.xp.total).toBeGreaterThan(0)
  expect(result.accuracy).toBe(1)
  const summary = page.getByTestId('complete-summary')
  await expect(summary).toBeVisible()
  await expect(summary).toHaveAttribute('data-source', 'server')
  await expect(page.getByTestId('complete-xp')).toHaveAttribute(
    'data-value',
    String(result.xp.total),
  )
})

test('a wrong utterance costs a heart', async ({ guestPage: page, guest, request }) => {
  await reachV1(request, guest)
  await setTestFlags(page, FLAGS)
  await fakeMicrophone(page, [WRONG, FIRST])
  await openV1(page)
  await expectType(page, 'speak')
  await speak(page)
  await check(page, 'wrong')
  await expect(page.getByTestId('lesson-hearts')).toHaveAttribute('data-count', '4')
  await next(page)
  await expectType(page, 'speak')
})

test('"Can\'t speak now" keeps every heart and the next session has no speak challenge', async ({
  guestPage: page,
  guest,
  request,
}) => {
  await reachV1(request, guest)
  await setTestFlags(page, FLAGS)
  await fakeMicrophone(page, FIRST)
  const { session } = await openV1(page)

  // Both speak pins are declined: each submits itself, grades correct and costs no heart.
  for (let i = 0; i < 2; i++) {
    await expectType(page, 'speak')
    await challenge(page).getByRole('button', { name: "Can't speak now" }).click()
    await expect(page.getByTestId('lesson-feedback')).toHaveAttribute('data-verdict', 'correct')
    await expect(page.getByTestId('lesson-hearts')).toHaveAttribute('data-count', '5')
    await next(page)
  }
  await tapListen(page, session)
  await check(page, 'correct')
  await next(page)
  await expect(page.getByTestId('complete-summary')).toBeVisible()

  // The pause is running: the next u01-v1 is created with speakPaused and plays the twins.
  const again = await openV1(page)
  expect(again.body).toMatchObject({ speakPaused: true })
  expect(again.session.challenges.map((c) => c.type)).not.toContain('speak')
  await expectType(page, 'listen_tap')
})

test('a denied microphone explains itself and "Can\'t speak now" goes on', async ({
  guestPage: page,
  guest,
  request,
}) => {
  await reachV1(request, guest)
  await setTestFlags(page, FLAGS)
  await denyMicrophone(page)
  await openV1(page)
  await expectType(page, 'speak')
  await challenge(page).getByRole('button', { name: 'Start recording' }).click()
  await expect(challenge(page).getByTestId('speak-status')).toContainText('Microphone unavailable')
  const decline = challenge(page).getByRole('button', { name: "Can't speak now" })
  await expect(decline).toBeFocused()
  await expectA11y(page, 'speak (microphone denied)')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('lesson-feedback')).toHaveAttribute('data-verdict', 'correct')
  await expect(page.getByTestId('lesson-hearts')).toHaveAttribute('data-count', '5')
})

test('with speak off, u01-v1 plays the listen_tap twins', async ({
  guestPage: page,
  guest,
  request,
}) => {
  await reachV1(request, guest)
  const { session } = await openV1(page)
  expect(session.challenges.map((c) => c.type)).toEqual(['listen_tap', 'listen_tap', 'listen_tap'])
  await expectType(page, 'listen_tap')
  await expect(page.getByRole('button', { name: 'Start recording' })).toHaveCount(0)
})
