import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

// Production build served by `vite preview` (SSR + static + COOP/COEP headers).
// File DBs only; no Turso is needed for the offline-shell spec.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm build && pnpm exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/h/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NODE_ENV: 'production',
      SESSION_SECRET: 'e2e-session-secret-0123456789abcdef0123456789',
      GLOBAL_DB_URL: 'file:.data/e2e-global.db',
      CATALOG_DB_URL: 'file:.data/e2e-catalog.db',
      WAREHOUSE_DB_URL_TEMPLATE: 'file:.data/e2e-{name}.db',
    },
  },
});
