import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

// Challenge gallery (apps/web/app/(dev)/challenges): every fixture challenge's renderer in the
// answering and feedback states. Accessibility (axe), Persian markup, keyboard use and visual
// baselines (Chromium only) in the desktop and mobile projects.
const IDS = [
  'select_image-0',
  'select_translation-0',
  'translate_bank-0',
  'translate_bank-1',
  'translate_type-0',
  'match_pairs-0',
  'listen_tap-0',
  'cloze_choice-0',
  'complete_chat-0',
  'letter_intro-0',
  'letter_sound-0',
  'letter_forms-0',
  'read_word-0',
  'build_word-0',
]
const THEMES = ['light', 'dark'] as const
const stylePath = fileURLToPath(new URL('./screenshot.css', import.meta.url))
const ZWNJ = '‌'

test.use({ contextOptions: { reducedMotion: 'reduce' } })

async function open(page: Page, query = '') {
  await page.goto(`/challenges${query}`)
  await expect(page.locator('main[data-ready]')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

const answering = (page: Page, id: string) => page.getByTestId(`answering-${id}`)
const status = (page: Page, id: string) => answering(page, id).getByTestId('gallery-status')

for (const theme of THEMES) {
  test(`every renderer has no WCAG A/AA violations (${theme})`, async ({ page }) => {
    await open(page, `?theme=${theme}`)
    await expect(page.locator('section[data-challenge]')).toHaveCount(IDS.length * 2)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(
      results.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
      ),
    ).toEqual([])
  })

  test(`renderer screenshots (${theme})`, async ({ page, browserName }) => {
    // Visual baselines are recorded for Chromium only; other engines run the behaviour checks.
    if (browserName !== 'chromium') return
    await open(page, `?theme=${theme}`)
    for (const id of IDS) {
      const section = page.getByTestId(`challenge-${id}`)
      await section.scrollIntoViewIfNeeded()
      await expect(section).toHaveScreenshot(`${id}-${theme}.png`, {
        maxDiffPixelRatio: 0.01,
        stylePath,
      })
    }
  })
}

test('Persian is marked up with lang="fa" dir="rtl" and words are never split', async ({
  page,
}) => {
  await open(page)
  const bad = await page
    .locator('[lang="fa"]')
    .evaluateAll((els) => els.filter((e) => e.getAttribute('dir') !== 'rtl').length)
  expect(bad).toBe(0)
  const split = await page
    .locator('.zb-fa__word, .zb-tile')
    .evaluateAll((els) => els.filter((e) => e.childNodes.length !== 1).length)
  expect(split).toBe(0)
})

test('select_translation: digit key + CHECK grades correct; choices are radio-like', async ({
  page,
}) => {
  await open(page, '?only=select_translation-0')
  const card = answering(page, 'select_translation-0')
  await page.keyboard.press('4')
  await expect(card.getByRole('button', { name: 'Hello, how are you?' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await card.getByRole('button', { name: 'Check' }).click()
  await expect(status(page, 'select_translation-0')).toContainText('Verdict: correct')
  await expect(card.getByRole('button', { name: /^Hello, how are you\?/ })).toHaveAttribute(
    'data-state',
    'correct',
  )
})

test('translate_bank en→fa: whole-word Persian tiles on an RTL answer line', async ({ page }) => {
  await open(page, '?only=translate_bank-1')
  const card = answering(page, 'translate_bank-1')
  const bank = card.getByRole('group', { name: 'Word bank' })
  const answer = card.getByRole('group', { name: 'Your answer' })
  await expect(answer).toHaveAttribute('dir', 'rtl')
  await bank.getByRole('button', { name: 'نون' }).click()
  await bank.getByRole('button', { name: `می${ZWNJ}خوام` }).click()
  await expect(answer.getByRole('button')).toHaveText(['نون', `می${ZWNJ}خوام`])
  await card.getByRole('button', { name: 'Check' }).click()
  await expect(status(page, 'translate_bank-1')).toContainText('Verdict: correct')
})

test('translate_type: typing and Enter checks', async ({ page }) => {
  await open(page, '?only=translate_type-0')
  const box = answering(page, 'translate_type-0').getByRole('textbox', {
    name: 'Your answer in English',
  })
  await box.fill('Mom is good')
  await box.press('Enter')
  await expect(status(page, 'translate_type-0')).toContainText('Verdict: correct')
})

test('match_pairs: keyboard-only matching submits when every pair is matched', async ({ page }) => {
  await open(page, '?only=match_pairs-0')
  const card = answering(page, 'match_pairs-0')
  const pairs: [string, string][] = [
    ['سلام', 'hello'],
    ['مرسی', 'thanks'],
    ['مامان', 'mom'],
    ['بابا', 'dad'],
    ['خوب', 'good'],
  ]
  for (const [fa, en] of pairs) {
    await card.getByRole('group', { name: 'Persian' }).getByRole('button', { name: fa }).focus()
    await page.keyboard.press('Enter')
    await card.getByRole('group', { name: 'English' }).getByRole('button', { name: en }).focus()
    await page.keyboard.press('Space')
  }
  await expect(status(page, 'match_pairs-0')).toContainText('Verdict: correct')
})

test('match_pairs: a wrong pair is a mismatch and does not shake under reduced motion', async ({
  page,
}) => {
  await open(page, '?only=match_pairs-0&reduce=1')
  const card = answering(page, 'match_pairs-0')
  await card.getByRole('group', { name: 'Persian' }).getByRole('button', { name: 'سلام' }).click()
  const thanks = card
    .getByRole('group', { name: 'English' })
    .getByRole('button', { name: 'thanks' })
  await thanks.click()
  await expect(status(page, 'match_pairs-0')).toContainText('mismatches: 1')
  await expect(thanks).toHaveAttribute('data-shake', 'false')
})

test('listen_tap: speaker and turtle buttons are named and play the clip', async ({ page }) => {
  await open(page, '?only=listen_tap-0')
  const card = answering(page, 'listen_tap-0')
  await card.getByRole('button', { name: 'Play slowly' }).click()
  await expect(status(page, 'listen_tap-0')).toContainText('played s_u01_0005.mp3 (slow)')
  await card.getByRole('button', { name: 'Play audio' }).click()
  await expect(status(page, 'listen_tap-0')).toContainText('played s_u01_0005.mp3')
})

test('build_word: placed letters render as one joined word', async ({ page }) => {
  await open(page, '?only=build_word-0')
  const card = answering(page, 'build_word-0')
  const letters = card.getByRole('group', { name: 'Letters' })
  for (const l of ['س', 'ی', 'ب'])
    await letters.getByRole('button', { name: l, exact: true }).click()
  const word = card.getByTestId('assembled-word')
  await expect(word).toHaveText('سیب')
  // Joined glyphs are narrower than the same letters kept apart with ZWNJ (no joining).
  const [joined, apart] = await word.evaluate((el) => {
    const probe = el.cloneNode() as HTMLElement
    probe.textContent = ['س', 'ی', 'ب'].join('‌')
    el.after(probe)
    const widths = [el.getBoundingClientRect().width, probe.getBoundingClientRect().width]
    probe.remove()
    return widths
  })
  expect(joined).toBeLessThan(apart!)
  await card.getByRole('button', { name: 'Check' }).click()
  await expect(status(page, 'build_word-0')).toContainText('Verdict: correct')
})

test('letter_intro: the four forms are joined with ZWJ', async ({ page }) => {
  await open(page, '?only=letter_intro-0')
  const forms = answering(page, 'letter_intro-0').locator('[data-form]')
  await expect(forms).toHaveText(['ب', 'ب‍', '‍ب‍', '‍ب'])
})

test('an unknown ?only id is a 404', async ({ page }) => {
  const res = await page.goto('/challenges?only=nope')
  expect(res?.status()).toBe(404)
})
