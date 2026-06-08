import { defineConfig } from '@playwright/test';

/**
 * Playwright (Electron driver) config for the Notepads walking-skeleton E2E suite.
 *
 * The Electron app is launched via `electron.launch()` inside each test
 * (see e2e/helpers/launch.ts), so no `webServer` is configured here.
 *
 * Gate 1 requirement (docs/plan/02-phase-1-walking-skeleton.md):
 *   open → assert content → save → assert bytes round-trips one UTF-8 file.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  // Electron tests are stateful (single app instance, real fs); run serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    trace: 'retain-on-failure'
  }
});
