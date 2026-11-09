import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
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
      command: 'npm run db:migrate && npm run db:seed && npm run preview',
      // Even with the flag present, production preview must require authentication.
      env: { MOCK_PARENT: '1' },
      url: 'http://127.0.0.1:4173/',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run dev -- --port 4174 --strictPort',
      url: 'http://127.0.0.1:4174/',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
