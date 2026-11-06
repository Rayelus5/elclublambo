import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// End-to-end against the REAL server (built) and the local Postgres as galaxy_api. It writes e2e_* accounts in the
// local `galaxy` schema (the user's DB): never reset anything. Port 8090 so it never fights a dev server on 8080.
const PORT = 8090;
const ORIGIN = `http://localhost:${PORT}`;
export const E2E_ENV = {
  DATABASE_URL: process.env.GALAXY_TEST_DATABASE_URL ?? 'postgresql://galaxy_api:galaxy_dev@127.0.0.1:54322/postgres',
  GALAXY_PUBLIC_ORIGINS: ORIGIN,
  GALAXY_TOTP_KEY: Buffer.alloc(32, 9).toString('base64'),
  PORT: String(PORT),
  WEB_DIST: fileURLToPath(new URL('./dist', import.meta.url)),
  NODE_ENV: 'production',
};

// Rate limits live in the DB per IP: give this run its own address so repeated runs never trip each other.
const runIp = `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: ORIGIN, extraHTTPHeaders: { 'cf-connecting-ip': runIp }, trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm -C ../.. build && node ../server/dist/main.js',
    url: `${ORIGIN}/galaxy/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: E2E_ENV,
  },
  projects: [
    { name: 'setup', testMatch: /admin\.setup\.ts/ },
    {
      name: 'chromium',
      testMatch: /\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } },
    },
  ],
});
