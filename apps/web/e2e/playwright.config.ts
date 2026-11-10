import { defineConfig, devices } from '@playwright/test';
import { E2E_WEB_ORIGIN } from './env.ts';

/** E2E-Tests im Browser (TEST_PLAN §5). Aufruf: `pnpm e2e` (braucht `TEST_DATABASE_URL`). */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  globalSetup: './global-setup.ts',
  // eine gemeinsame Welt: Tests nacheinander, jeder mit eigenem Gastkonto
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  outputDir: '../test-results',
  use: {
    baseURL: E2E_WEB_ORIGIN,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    // ohne Wiederholungen (ein Flake soll sichtbar bleiben), aber mit Trace zum Auswerten
    trace: process.env.CI ? 'retain-on-failure' : 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
