import { defineConfig, devices } from '@playwright/test';

import { browserDatabasePath as testDatabasePath } from './tests/browser/database';
const testServerEnv = { DAILY_STARS_D1_PATH: testDatabasePath };

export default defineConfig({
  testDir: './tests/browser',
  // The suite shares one local SQLite file across all tests (see
  // tests/browser/database.ts), so parallel workers contend on it and seeding
  // intermittently throws. Run serially — this is what the DB design requires.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Pixel 7'] } },
    { name: 'webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: [
    {
      command: `npm run db:migrate -- --persist-to ${testDatabasePath} && npm run db:seed -- --persist-to ${testDatabasePath} && npm run preview`,
      // Even with the flag present, production preview must require authentication.
      env: { ...testServerEnv, MOCK_PARENT: '1' },
      url: 'http://127.0.0.1:4173/',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run dev -- --port 4174 --strictPort',
      env: { ...testServerEnv, DAILY_STARS_BROWSER_TEST_NOW: '2026-11-08T17:00:00Z' },
      url: 'http://127.0.0.1:4174/',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
