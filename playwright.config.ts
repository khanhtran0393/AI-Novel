import { defineConfig } from '@playwright/test';

/**
 * Playwright:
 * - api-and-contracts: pure logic (no browser server required)
 * - ui: live Next workspace (starts webServer)
 */
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? 'github' : 'list',
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'api-and-contracts',
      testMatch: /^(?!.*ui-).*\.spec\.ts$/,
    },
    {
      name: 'ui',
      testMatch: /ui-.*\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000',
    // Local often has `npm run dev` already; CI has free port so still starts fresh.
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
