import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the production build, served from the same
// sub-path GitHub Pages uses. Build first: `npm run build` (or `npm run test:e2e`).
// E2E_PORT lets several checkouts run their tests side by side.
const PORT = Number(process.env.E2E_PORT ?? 4173);
const BASE_PATH = '/AlmailBooks/';
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}${BASE_PATH}`,
    locale: 'en-US',
    timezoneId: 'UTC',
    // Only the offline test opts in; elsewhere a cached app would hide changes.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: `npx vite preview --base ${BASE_PATH} --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}${BASE_PATH}`,
    reuseExistingServer: !CI,
  },
});
