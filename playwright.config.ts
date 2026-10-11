import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

// With E2E_TURSO=1 the server uses the real env (Turso dev DBs); otherwise file DBs.
const REAL_ENV_KEYS = [
  'SESSION_SECRET',
  'TURSO_ORG',
  'TURSO_PLATFORM_TOKEN',
  'CATALOG_TURSO_DB',
  'WAREHOUSE_DB_URL_TEMPLATE',
  'TURSO_GROUP_AUTH_TOKEN',
  'GLOBAL_DB_URL',
  'CATALOG_DB_URL',
];
const serverEnv: Record<string, string> =
  process.env.E2E_TURSO === '1'
    ? Object.fromEntries(
        REAL_ENV_KEYS.flatMap((k) => {
          const v = process.env[k];
          return v === undefined ? [] : [[k, v]];
        }),
      )
    : {
        SESSION_SECRET: 'e2e-session-secret-0123456789abcdef0123456789',
        GLOBAL_DB_URL: 'file:.data/e2e-global.db',
        CATALOG_DB_URL: 'file:.data/e2e-catalog.db',
        WAREHOUSE_DB_URL_TEMPLATE: 'file:.data/e2e-{name}.db',
      };

// Production build served by `vite preview` (SSR + static + COOP/COEP headers).
// File DBs only; no Turso is needed for the offline-shell spec.
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm build && pnpm exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/h/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { NODE_ENV: 'production', ...serverEnv },
  },
});
