/**
 * Shared Playwright fixtures (orchestrator-owned). Import `test`/`expect` from here in UI specs:
 *
 *   import { expect, test } from './fixtures'
 *   test('…', async ({ guestPage }) => { await guestPage.goto('/learn') })
 *
 * - `guest`: a fresh anonymous user (dev auth) with its bearer header, for API setup calls.
 * - `guestPage`: a page already signed in as `guest` (session stored like the app's auth client).
 * - `setTestNow(page, iso)`: time travel for the app's API calls (local mode `x-test-now`).
 */
import { test as base, expect, type Page } from '@playwright/test'

/** Must match apps/web/lib/auth-client.ts LOCAL_SESSION_KEY and apps/web/lib/api-client.ts TEST_NOW_KEY. */
const LOCAL_SESSION_KEY = 'zaboon.session'
const TEST_NOW_KEY = 'zaboon.testNow'

export interface Guest {
  userId: string
  accessToken: string
  expiresAt: number
  authorization: string
}

export const test = base.extend<{ guest: Guest; guestPage: Page }>({
  guest: async ({ request }, use) => {
    const res = await request.post('/api/dev/auth/anonymous')
    expect(res.status(), 'dev auth must be enabled (ZABOON_DEV_AUTH=1)').toBe(200)
    const body = (await res.json()) as {
      accessToken: string
      expiresAt: string
      user: { id: string }
    }
    await use({
      userId: body.user.id,
      accessToken: body.accessToken,
      expiresAt: Date.parse(body.expiresAt),
      authorization: `Bearer ${body.accessToken}`,
    })
  },
  guestPage: async ({ page, guest }, use) => {
    const session = {
      accessToken: guest.accessToken,
      expiresAt: guest.expiresAt,
      userId: guest.userId,
      isAnonymous: true,
      email: null,
    }
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key!, value!),
      [LOCAL_SESSION_KEY, JSON.stringify(session)],
    )
    await use(page)
  },
})

/** Makes the app's API calls run at `iso` (AUTH_MODE=local only). Call before navigating. */
export async function setTestNow(page: Page, iso: string): Promise<void> {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [TEST_NOW_KEY, iso],
  )
}

export { expect }
