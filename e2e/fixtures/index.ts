/**
 * Shared Playwright fixtures (orchestrator-owned). Import `test`/`expect` from here in UI specs:
 *
 *   import { expect, test } from './fixtures'
 *   test('…', async ({ guestPage }) => { await guestPage.goto('/learn') })
 *
 * - `guest`: a fresh anonymous user (dev auth) with its bearer header, for API setup calls.
 * - `guestPage`: a page already signed in as `guest` (session stored like the app's auth client).
 * - `setTestNow(page, iso)`: time travel for the app's API calls (local mode `x-test-now`).
 * - `setTestFlags(page, flags)`: feature-flag overrides for the app's API calls (local mode
 *   `x-test-flags`), e.g. `setTestFlags(page, { shop: true })`; `flagsHeader(flags)` gives the
 *   same header for `request` calls in API specs.
 */
import { test as base, expect, type Page } from '@playwright/test'

/**
 * Must match apps/web/lib/auth-client.ts LOCAL_SESSION_KEY and apps/web/lib/api-client.ts
 * TEST_NOW_KEY / TEST_FLAGS_KEY.
 */
const LOCAL_SESSION_KEY = 'zaboon.session'
const TEST_NOW_KEY = 'zaboon.testNow'
const TEST_FLAGS_KEY = 'zaboon.testFlags'
/** Must match TEST_FLAGS_HEADER in @zaboon/contracts. */
const TEST_FLAGS_HEADER = 'x-test-flags'

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

/**
 * Turns feature flags on (or off) for the app's API calls in this page (AUTH_MODE=local only), e.g.
 * `await setTestFlags(page, { leagues: true })`. Call before navigating; the server rejects
 * unknown flag names with a 400.
 */
export async function setTestFlags(page: Page, flags: Record<string, boolean>): Promise<void> {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [TEST_FLAGS_KEY, JSON.stringify(flags)],
  )
}

/**
 * The `x-test-flags` header for direct API calls in API specs, e.g.
 * `request.get('/api/shop', { headers: { authorization, ...flagsHeader({ shop: true }) } })`.
 */
export function flagsHeader(flags: Record<string, boolean>): Record<string, string> {
  return { [TEST_FLAGS_HEADER]: JSON.stringify(flags) }
}

export { expect }
