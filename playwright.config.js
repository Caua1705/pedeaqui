import { defineConfig, devices } from '@playwright/test';

// E2E runs against the BUILT app served by `vite preview`, so it exercises the
// real bundle. Every API call is mocked inside the specs (page.route), so the
// suite never touches the production API and never creates a real order.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'on-first-retry'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://127.0.0.1:4174/restaurant.html?slug=junior-da-picanha',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
