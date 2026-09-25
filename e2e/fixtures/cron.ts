/**
 * The cron secret the local e2e web server runs with (playwright.config.ts `webServer.env`). It is
 * a fixed, clearly fake test value for AUTH_MODE=local, never a real credential. API specs call
 * cron routes the way Vercel Cron does: `GET` with `Authorization: Bearer <secret>`.
 */
export const E2E_CRON_SECRET = 'zaboon-e2e-cron-secret-not-a-real-credential' // pragma: allowlist secret

/** Headers for calling a cron route from an API spec. */
export function cronHeaders(): Record<string, string> {
  return { authorization: `Bearer ${E2E_CRON_SECRET}` }
}
