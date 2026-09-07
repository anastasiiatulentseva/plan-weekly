import { defineConfig } from '@playwright/test';
import { testDatabaseUrl } from './tests/database.mjs';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  globalSetup: './tests/e2e/setup.mjs',
  use: { baseURL: 'http://localhost:4329', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', launchOptions: {
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
  } } }],
  webServer: {
    command: 'node dist/server/entry.mjs',
    url: 'http://localhost:4329/healthz',
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    env: { DATABASE_URL: testDatabaseUrl(), PUBLIC_ORIGIN: 'http://localhost:4329',
      INVITE_TOKEN: 'browser-test-invite-'.repeat(4), SESSION_SECRET: 'browser-test-session-'.repeat(4),
      HOST: '127.0.0.1', PORT: '4329', ASTRO_TELEMETRY_DISABLED: '1' },
  },
});
