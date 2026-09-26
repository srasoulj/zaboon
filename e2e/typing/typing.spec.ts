/**
 * The fixture's P2 level u01-t1 in the real lesson player with the flags persianKeyboard and
 * letterTrace on: typed Persian with the on-screen keyboard (translate_type en→fa) and with
 * physical keys remapped to the standard layout (listen_type), the inline cloze blank, and a
 * letter trace declined with "Can't trace now", which keeps every heart. On /complete the server
 * re-grades the typed answers with the grader; for the trace it can only check the client-reported
 * coverage and precision against the thresholds (it never sees the strokes).
 */
import type { APIRequestContext, Page } from '@playwright/test'
import { expect, setTestFlags, test, type Guest } from '../fixtures'
import { play, type User } from '../qa/support'

const ZWNJ = '‌'
const T1 = '/lesson?course=fixture&kind=lesson&level=u01-t1'
const FLAGS = { persianKeyboard: true, letterTrace: true }

/** Plays every MVP level of the fixture unit through the API, so u01-t1 is current. */
async function reachT1(request: APIRequestContext, guest: Guest): Promise<void> {
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
}

const challenge = (page: Page) => page.getByTestId('lesson-challenge')

async function expectType(page: Page, type: string) {
  await expect(challenge(page)).toHaveAttribute('data-type', type)
}

/** CHECK is done; the verdict is `verdict`; CONTINUE. */
async function feedbackThenContinue(page: Page, verdict: string) {
  const feedback = page.getByTestId('lesson-feedback')
  await expect(feedback).toHaveAttribute('data-verdict', verdict)
  await feedback.getByRole('button', { name: 'Continue' }).click()
}

test('u01-t1 with the flags on: typed Persian, the cloze blank and a declined trace', async ({
  guestPage: page,
  guest,
  request,
}) => {
  await reachT1(request, guest)
  await setTestFlags(page, FLAGS)
  await page.goto(T1)
  await expect(page.getByTestId('lesson-player')).toBeVisible()
  await expect(page.getByTestId('lesson-hearts')).toHaveAttribute('data-count', '5')

  // 1. translate_type en→fa with the on-screen keyboard (standard layout).
  await expectType(page, 'translate_type')
  const box = challenge(page).getByRole('textbox', { name: 'Your answer in Persian' })
  await expect(box).toHaveAttribute('lang', 'fa')
  await expect(box).toHaveAttribute('dir', 'rtl')
  const keys = challenge(page).getByRole('group', { name: 'Persian keyboard' })
  for (const k of ['ن', 'و', 'ن', 'space', 'م', 'ی', 'half-space', 'خ', 'و', 'ا', 'م'])
    await keys.getByRole('button', { name: k, exact: true }).click()
  await expect(box).toHaveValue(`نون می${ZWNJ}خوام`)
  await page.getByTestId('lesson-check').click()
  await feedbackThenContinue(page, 'correct')

  // 2. listen_type with physical keys: the standard layout by KeyboardEvent.code; Enter checks.
  await expectType(page, 'listen_type')
  const heard = challenge(page).getByRole('textbox', { name: 'What you hear, in Persian' })
  await heard.focus()
  for (const k of [
    'BracketRight',
    'KeyH',
    'KeyD',
    'Space',
    'KeyL',
    'KeyD',
    'Shift+Space',
    'KeyO',
    'Comma',
    'KeyH',
    'KeyD',
  ])
    await page.keyboard.press(k)
  await expect(heard).toHaveValue(`چای می${ZWNJ}خوای`)
  await page.keyboard.press('Enter')
  await feedbackThenContinue(page, 'correct')

  // 3. cloze_type: the missing word, typed into the inline blank.
  await expectType(page, 'cloze_type')
  const blank = challenge(page).getByRole('textbox', { name: 'The missing word' })
  await expect(blank).toHaveAttribute('dir', 'rtl')
  await blank.fill('میخوام')
  await page.getByTestId('lesson-check').click()
  await feedbackThenContinue(page, 'correct')

  // 4. letter_trace: "Can't trace now" submits by itself and costs no heart.
  await expectType(page, 'letter_trace')
  await expect(challenge(page).getByTestId('trace-canvas')).toHaveCSS('touch-action', 'none')
  await challenge(page).getByRole('button', { name: "Can't trace now" }).click()
  await expect(page.getByTestId('lesson-feedback')).toHaveAttribute('data-verdict', 'correct')
  await expect(page.getByTestId('lesson-hearts')).toHaveAttribute('data-count', '5')
  await page.getByTestId('lesson-feedback').getByRole('button', { name: 'Continue' }).click()

  const summary = page.getByTestId('complete-summary')
  await expect(summary).toBeVisible()
  await expect(summary).toHaveAttribute('data-source', 'server')
  await expect(page.getByTestId('complete-accuracy')).toHaveAttribute('data-value', '100%')
})

test('a wrong typed answer costs a heart and is re-queued', async ({
  guestPage: page,
  guest,
  request,
}) => {
  await reachT1(request, guest)
  await setTestFlags(page, FLAGS)
  await page.goto(T1)
  await expectType(page, 'translate_type')
  const box = challenge(page).getByRole('textbox', { name: 'Your answer in Persian' })
  await box.fill('سلام')
  await page.getByTestId('lesson-check').click()
  await feedbackThenContinue(page, 'wrong')
  await expect(page.getByTestId('lesson-hearts')).toHaveAttribute('data-count', '4')

  // The rest of the lesson, then the wrong challenge comes back at the end.
  await expectType(page, 'listen_type')
  await challenge(page)
    .getByRole('textbox', { name: 'What you hear, in Persian' })
    .fill('چای میخوای')
  await page.getByTestId('lesson-check').click()
  await feedbackThenContinue(page, 'correct')
  await expectType(page, 'cloze_type')
  await challenge(page).getByRole('textbox', { name: 'The missing word' }).fill('میخوام')
  await page.getByTestId('lesson-check').click()
  await feedbackThenContinue(page, 'correct')
  await expectType(page, 'letter_trace')
  await challenge(page).getByRole('button', { name: "Can't trace now" }).click()
  await feedbackThenContinue(page, 'correct')

  await expectType(page, 'translate_type')
  await expect(challenge(page)).toHaveAttribute('data-index', '0')
  await challenge(page).getByRole('textbox', { name: 'Your answer in Persian' }).fill('نون میخوام')
  await page.getByTestId('lesson-check').click()
  await feedbackThenContinue(page, 'correct')
  await expect(page.getByTestId('complete-summary')).toBeVisible()
})

test('with the flags off, u01-t1 plays the MVP twins and shows no keyboard', async ({
  guestPage: page,
  guest,
  request,
}) => {
  await reachT1(request, guest)
  await page.goto(T1)
  await expectType(page, 'translate_bank')
  await expect(page.getByRole('group', { name: 'Persian keyboard' })).toHaveCount(0)
})
