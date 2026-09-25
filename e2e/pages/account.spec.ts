/**
 * Account flows (/settings/account, /profile): link an email, usernames, merge, export, delete.
 * Pages are signed in once through the dev auth routes (helpers.signInPage), so the identity
 * switches the app makes stick across navigations.
 */
import { readFile } from 'node:fs/promises'
import { expect, test } from '../fixtures'
import {
  home,
  newGuest,
  onboard,
  playFixtureLesson,
  signInEmail,
  signInPage,
  storedSession,
  unique,
  uniqueEmail,
} from './helpers'

test('a guest links an email, picks a username and sees "taken" for a duplicate', async ({
  page,
  request,
}) => {
  const guest = await newGuest(request)
  await onboard(request, guest)
  await signInPage(page, guest, '/profile')
  await expect(page.getByRole('link', { name: 'Create a profile' })).toBeVisible()
  await expect(page.getByLabel('Username')).toHaveCount(0)

  await page.getByRole('link', { name: 'Create a profile' }).click()
  await expect(page).toHaveURL(/\/settings\/account$/)
  const email = uniqueEmail()
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Create a profile' }).click()
  await expect(page.getByRole('main').getByRole('status')).toContainText(`Profile created. You're signed in as ${email}.`)
  const linked = await storedSession(page)
  expect(linked).toMatchObject({ userId: guest.userId, isAnonymous: false })

  // Another learner already owns this username.
  const taken = unique('taken_')
  const other = await signInEmail(request, uniqueEmail())
  const claim = await request.patch('/api/profile', { headers: other.headers, data: { username: taken } })
  expect(claim.status(), await claim.text()).toBe(200)

  await page.goto('/profile')
  const username = page.getByLabel('Username')
  await username.fill(taken)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('That username is taken')

  const mine = unique('mine_')
  await username.fill(mine)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('main').getByRole('status')).toHaveText('Saved.')
  await expect(page.getByText(`@${mine}`)).toBeVisible()
  await page.reload()
  await expect(page.getByText(`@${mine}`)).toBeVisible()
})

test('signing in merges the guest into the account and sums their XP', async ({ page, request }) => {
  const email = uniqueEmail()
  const member = await signInEmail(request, email)
  await onboard(request, member)
  const memberXp = await playFixtureLesson(request, member)
  const guest = await newGuest(request)
  await onboard(request, guest)
  const guestXp = await playFixtureLesson(request, guest)
  expect(memberXp).toBeGreaterThan(0)
  expect(guestXp).toBeGreaterThan(0)

  await signInPage(page, guest, '/settings/account')
  await page.getByRole('button', { name: 'I already have an account' }).click()
  await page.getByLabel('Email').fill(email)
  const merged = page.waitForResponse((r) => r.url().endsWith('/api/account/merge'))
  await page.getByRole('button', { name: 'Sign in' }).click()
  expect((await merged).status()).toBe(200)
  await expect(page.getByRole('main').getByRole('status')).toContainText('Your guest progress was added')
  await expect(page.getByText(email)).toBeVisible()
  expect(await storedSession(page)).toMatchObject({ userId: member.userId, isAnonymous: false })

  const after = await home(request, await signInEmail(request, email))
  expect(after.xpTotal).toBe(memberXp + guestXp)
})

test('the GDPR export downloads a JSON file', async ({ page, request }) => {
  const guest = await newGuest(request)
  await onboard(request, guest)
  await signInPage(page, guest, '/settings/account')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download my data' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^zaboon-export-\d{4}-\d{2}-\d{2}\.json$/)
  const data = JSON.parse(await readFile((await file.path())!, 'utf8')) as Record<string, unknown>
  expect(JSON.stringify(data)).toContain(guest.userId)
})

test('deleting the account signs out and returns to /', async ({ page, request }) => {
  const guest = await newGuest(request)
  await onboard(request, guest)
  await signInPage(page, guest, '/settings/account')
  const del = page.getByRole('button', { name: 'Delete my account' })
  await expect(del).toHaveAttribute('aria-disabled', 'true')
  await page.getByLabel('Type DELETE to confirm').fill('DELETE')
  await del.click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Zaboon')
  expect(await storedSession(page)).toBeNull()
  const gone = await request.get('/api/home', { headers: guest.headers })
  expect(gone.status()).not.toBe(200)
})

test('a member signs out from the account page', async ({ page, request }) => {
  const member = await signInEmail(request, uniqueEmail())
  await onboard(request, member)
  await signInPage(page, member, '/settings/account')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/$/)
  expect(await storedSession(page)).toBeNull()
})
