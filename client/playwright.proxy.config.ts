import { defineConfig } from '@playwright/test';

/** Reproduz o mesmo domínio e rewrite de produção com a API local, sem segredos hospedados. */
export default defineConfig({
  testDir: './proxy-tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 30_000,
  reporter: [['list']],
  outputDir: '../output/playwright/proxy-polling',
  use: {
    baseURL: 'http://localhost:3000',
    browserName: 'chromium',
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    trace: 'off', video: 'off', screenshot: 'off',
  },
  webServer: {
    command: 'npm start',
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { API_ORIGEM: 'http://localhost:3001', PROXY_SEGREDO: 'proxy-local-sem-valor-hospedado' },
  },
});
