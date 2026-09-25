/**
 * Orchestrator-owned Playwright config (CLAUDE.md). Local runs use the preinstalled Chromium
 * (Playwright 1.56.1 ↔ Chromium build 1194); never run `playwright install` locally.
 * Set ZABOON_E2E_BROWSERS=chromium,webkit where WebKit is installed (CI).
 */
import { defineConfig, devices } from '@playwright/test'

const browsers = (process.env.ZABOON_E2E_BROWSERS ?? 'chromium').split(',').map((b) => b.trim())
const PORT = Number(process.env.ZABOON_E2E_PORT ?? 3100)

// `*.api.spec.ts` exercise the HTTP API only, so they run once, in the browserless `api` project.
const API_SPECS = /\.api\.spec\.ts$/

const projects = [
  { name: 'api', testMatch: API_SPECS },
  {
    name: 'chromium-desktop',
    testIgnore: API_SPECS,
    use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
  },
  { name: 'chromium-mobile', testIgnore: API_SPECS, use: { ...devices['Pixel 7'] } },
  ...(browsers.includes('webkit')
    ? [
        {
          name: 'webkit-desktop',
          testIgnore: API_SPECS,
          use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
        },
        { name: 'webkit-mobile', testIgnore: API_SPECS, use: { ...devices['iPhone 14'] } },
      ]
    : []),
]

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects,
  webServer: {
    command: `pnpm --filter @zaboon/web exec next dev --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      AUTH_MODE: 'local',
      ZABOON_DEV_AUTH: '1',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
})
