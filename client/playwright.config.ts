import { defineConfig, devices } from '@playwright/test'

// E2E runs against an already-running `docker compose` stack (client + server + mongo + redis),
// both locally and in CI — Playwright does not boot anything itself. The app needs Mongo and
// Redis, so a `webServer` that only starts Vite would give a false sense of a full stack.
//
//   docker compose up -d --build
//   cd client && npx playwright test
//
// Env overrides:
//   E2E_BASE_URL          client URL (default http://localhost:5173)
//   E2E_BROWSER_CHANNEL   use an installed browser instead of Playwright's Chromium, e.g. "chrome"
export default defineConfig({
  testDir: './e2e',
  // One long user journey with two browsers — generous, but bounded
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.E2E_BROWSER_CHANNEL ? { channel: process.env.E2E_BROWSER_CHANNEL } : {}),
      },
    },
  ],
})
