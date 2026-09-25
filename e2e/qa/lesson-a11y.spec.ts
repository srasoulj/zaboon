/**
 * /lesson with the REAL renderers, through the fixture's short first lesson (u01-s0: select
 * translation, word bank, typed translation, match pairs): axe (WCAG 2.0/2.1 A+AA, 2.2 AA) on every
 * answering and feedback state and on the complete screens, and the Persian markup rules on every
 * state (CLAUDE.md rule 5): each `[lang="fa"]` has `dir="rtl"`, and no Persian word is split across
 * elements (every Persian run of text is made of whole words of the lesson; ZWNJ kept).
 */
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { correctResponse, type Challenge } from './support'

const FIRST_LESSON = '/lesson?course=fixture&kind=lesson&level=u01-s0'
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
/** Arabic-script letters (U+0600–U+06FF). */
const PERSIAN = new RegExp(`[${String.fromCodePoint(0x600)}-${String.fromCodePoint(0x6ff)}]`)
const ZWNJ = String.fromCodePoint(0x200c)

test.use({ contextOptions: { reducedMotion: 'reduce' } })

/**
 * Known violations with an open issue, per color scheme and screen. They are excluded from the
 * sweep so the rest of the screen stays covered; each has its own `test.fail()` regression test
 * below. Remove an entry when its regression test starts passing.
 */
type Scheme = 'light' | 'dark'
const SUMMARY_HEADING = '[data-testid="complete-summary"] h1'
const SUMMARY_XP_LABEL = '[data-testid="complete-xp"] .bg-zaferan-500'
const KNOWN: Record<Scheme, Record<string, string[]>> = {
  // #29 (saffron summary text contrast) is fixed; its regression tests below guard it.
  light: {},
  dark: {},
}

function violations(results: {
  violations: { id: string; impact?: string | null; nodes: { target: unknown[] }[] }[]
}) {
  return results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  )
}

async function axe(page: Page, scheme: Scheme, state: string) {
  let builder = new AxeBuilder({ page }).withTags(WCAG)
  for (const selector of KNOWN[scheme][state] ?? []) builder = builder.exclude(selector)
  expect
    .soft(violations(await builder.analyze()), `axe violations on the ${state} screen`)
    .toEqual([])
}

/** Every whole Persian word the session's content contains (split on spaces and punctuation). */
function persianWords(session: unknown): Set<string> {
  const words = new Set<string>()
  const visit = (v: unknown) => {
    if (typeof v === 'string') {
      if (PERSIAN.test(v))
        for (const w of v.split(/[\s.,!?؟،؛«»:()"]+/)) if (w && PERSIAN.test(w)) words.add(w)
    } else if (Array.isArray(v)) v.forEach(visit)
    else if (v && typeof v === 'object') Object.values(v).forEach(visit)
  }
  visit(session)
  return words
}

/**
 * RTL markup rules on the current screen. Returns the offending snippets (empty when fine) so a
 * failure names them.
 */
async function persianMarkup(page: Page, words: Set<string>) {
  return page.evaluate(
    ({ known, persian }) => {
      const re = new RegExp(persian)
      const problems: string[] = []
      for (const el of Array.from(document.querySelectorAll('[lang="fa"]')))
        if (el.getAttribute('dir') !== 'rtl')
          problems.push(`lang=fa without dir=rtl: <${el.tagName.toLowerCase()}> ${el.textContent}`)
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      const knownSet = new Set(known)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent ?? ''
        if (!re.test(text)) continue
        const parent = n.parentElement
        if (!parent || parent.closest('script, style, [hidden], [aria-hidden="true"] svg')) continue
        for (const w of text.split(/[\s.,!?؟،؛«»:()"]+/))
          if (w && re.test(w) && !knownSet.has(w))
            problems.push(
              `not a whole word of the lesson: "${w}" in <${parent.tagName.toLowerCase()}> "${text}"`,
            )
      }
      return problems
    },
    { known: [...words], persian: PERSIAN.source },
  )
}

/** Operates the real renderer of `c` to give the correct answer. */
async function answerCorrectly(page: Page, c: Challenge) {
  const area = page.getByTestId('lesson-challenge')
  const response = correctResponse(c)
  switch (c.type) {
    case 'select_translation': {
      const choice = (c.choices as { text: string }[])[c.answer as number]!
      await area.getByRole('button', { name: choice.text }).click()
      break
    }
    case 'translate_bank': {
      const bank = area.getByRole('group', { name: 'Word bank' })
      for (const word of response.value as string[])
        await bank.getByRole('button', { name: word, exact: true }).first().click()
      break
    }
    case 'translate_type':
      await area.getByRole('textbox').fill(response.value as string)
      break
    case 'match_pairs':
      for (const pair of c.pairs as { fa: { fa: string; faVocalized?: string }; en: string }[]) {
        // Tiles show the vocalized spelling when there is one.
        const fa = pair.fa.faVocalized ?? pair.fa.fa
        await area.getByRole('group', { name: 'Persian' }).getByRole('button', { name: fa }).click()
        await area
          .getByRole('group', { name: 'English' })
          .getByRole('button', { name: pair.en, exact: true })
          .click()
      }
      break
    default:
      throw new Error(`the first lesson has no ${c.type}`)
  }
}

/** Opens the first lesson and returns the session the player created. */
async function openLesson(page: Page) {
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/sessions') && r.request().method() === 'POST',
  )
  await page.goto(FIRST_LESSON)
  return (await (await created).json()) as { challenges: Challenge[] }
}

/** Plays the lesson perfectly, calling `check(state)` on every screen. Ends on the summary screen. */
async function playLesson(
  page: Page,
  session: { challenges: Challenge[] },
  check: (state: string) => Promise<void>,
) {
  for (const c of session.challenges) {
    const area = page.getByTestId('lesson-challenge')
    await expect(area).toHaveAttribute('data-index', String(c.index))
    await expect(area).toHaveAttribute('data-type', c.type)
    await check(`${c.type} answering`)

    await answerCorrectly(page, c)
    const feedback = page.getByTestId('lesson-feedback')
    // Matching finishes by itself when the last pair is matched; everything else needs CHECK.
    if (!(await feedback.isVisible())) await page.getByTestId('lesson-check').click()
    await expect(feedback).toHaveAttribute('data-verdict', 'correct')
    await check(`${c.type} feedback`)
    await feedback.getByRole('button', { name: 'Continue' }).click()
  }
  await expect(page.getByTestId('complete-summary')).toBeVisible()
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme })

    test('the lesson player passes axe and the Persian markup rules on every screen', async ({
      guestPage: page,
    }) => {
      test.slow() // a whole lesson with an axe run per state
      const session = await openLesson(page)
      const words = persianWords(session)
      expect(words.has(`می${ZWNJ}خوام`), 'ZWNJ words are kept whole in the content').toBe(true)

      await playLesson(page, session, async (state) => {
        await axe(page, colorScheme, state)
        expect.soft(await persianMarkup(page, words), state).toEqual([])
      })
      await axe(page, colorScheme, 'complete summary')
      await page.getByTestId('complete-continue').click()
      await expect(page.getByTestId('complete-streak')).toBeVisible()
      await axe(page, colorScheme, 'complete streak')
    })

    test('a wrong answer: the feedback with the correct solution passes axe and the RTL rules', async ({
      guestPage: page,
    }) => {
      const session = await openLesson(page)
      const first = session.challenges[0]!
      const wrong = (first.choices as { text: string }[]).find((_, i) => i !== first.answer)!
      await page.getByTestId('lesson-challenge').getByRole('button', { name: wrong.text }).click()
      await page.getByTestId('lesson-check').click()
      const feedback = page.getByTestId('lesson-feedback')
      await expect(feedback).toHaveAttribute('data-verdict', 'wrong')
      await axe(page, colorScheme, 'wrong feedback')
      expect(await persianMarkup(page, persianWords(session))).toEqual([])

      // The report sheet opened from the feedback is accessible too.
      await page.getByRole('button', { name: 'Report a problem' }).click()
      await expect(page.getByTestId('report-sheet')).toBeVisible()
      await axe(page, colorScheme, 'report sheet')
    })
  })
}

// Regression tests for #29 (https://github.com/srasoulj/zaboon/issues/29, fixed).
for (const [scheme, selector] of [
  ['light', SUMMARY_HEADING],
  ['dark', SUMMARY_XP_LABEL],
] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme })

    test(`regression: the lesson-complete summary text has enough contrast (${selector})`, async ({
      guestPage: page,
    }) => {
      test.slow()
      const session = await openLesson(page)
      await playLesson(page, session, async () => {})
      await expect(page.locator(selector)).toBeVisible()
      const results = await new AxeBuilder({ page }).withTags(WCAG).include(selector).analyze()
      expect(violations(results)).toEqual([])
    })
  })
}
