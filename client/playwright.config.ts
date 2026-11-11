import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  globalTimeout: 15 * 60_000,
  reporter: [['list']],
  outputDir: '../output/playwright/novo-frontend',
  use: {
    baseURL: process.env.HANDEBOL_QA_URL ?? 'http://localhost:3000',
    browserName: 'chromium',
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    viewport: { width: 1440, height: 900 },
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: process.env.CI ? 'npm start' : 'npm run dev',
    url: process.env.HANDEBOL_QA_URL ?? 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
