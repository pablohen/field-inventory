import { execSync } from 'node:child_process';
import {
  type Browser,
  type BrowserContext,
  test as base,
  expect,
  type Page,
} from '@playwright/test';
import { DEV_PIN } from '../scripts/seed-data';
import { TOUR_KEYS } from '../src/ui/onboarding';
import { waitForHandheldReady, waitForServiceWorkerControl } from './helpers';

export interface Handheld {
  page: Page;
  context: BrowserContext;
}

/** A fresh context with the onboarding tours already seen, so they never cover a spec. */
async function newTestContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addInitScript((keys: string[]) => {
    for (const key of keys) window.localStorage.setItem(key, 'done');
  }, Object.values(TOUR_KEYS));
  return context;
}

async function typePin(page: Page) {
  await page
    .getByRole('group', { name: 'PIN' })
    .locator('input')
    .first()
    .click();
  await page.keyboard.type(DEV_PIN);
}

/** Own context, signed in on a device, service worker in control and first replica pull done. */
async function signedInHandheld(
  browser: Browser,
  deviceId: string,
  username: string,
): Promise<Handheld> {
  const context = await newTestContext(browser);
  const page = await context.newPage();
  await page.goto('/h/login');
  await page.getByLabel('Device id').fill(deviceId);
  await page.getByLabel('Username').fill(username);
  await typePin(page);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/h$/);
  await waitForServiceWorkerControl(page);

  // The first replica pull must finish before any scan (lookups read local replicas).
  await page.goto('/h');
  await waitForHandheldReady(page);
  await expect(page.getByText(/^Synced /)).toBeVisible({ timeout: 30_000 });
  return { page, context };
}

const SETUP_TIMEOUT = 180_000;

export const test = base.extend<{
  resetData: undefined;
  handheldA: Handheld;
  handheldB: Handheld;
  desk: Page;
  admin: Page;
}>({
  // Runs `pnpm e2e:reset` before each test that uses a signed-in context.
  resetData: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured first argument
    async ({}, use) => {
      if (process.env.E2E_TURSO === '1') {
        execSync('pnpm e2e:reset', { stdio: 'inherit', timeout: 120_000 });
      }
      await use(undefined);
    },
    { timeout: SETUP_TIMEOUT },
  ],

  handheldA: [
    async ({ browser, resetData: _reset }, use) => {
      const h = await signedInHandheld(browser, 'dev-handheld-1', 'ana');
      await use(h);
      await h.context.close();
    },
    { timeout: SETUP_TIMEOUT },
  ],

  handheldB: [
    async ({ browser, resetData: _reset }, use) => {
      const h = await signedInHandheld(browser, 'dev-handheld-2', 'bruno');
      await use(h);
      await h.context.close();
    },
    { timeout: SETUP_TIMEOUT },
  ],

  desk: [
    async ({ browser, resetData: _reset }, use) => {
      const context = await newTestContext(browser);
      const page = await context.newPage();
      await page.goto('/desk/login');
      await page.getByLabel('Username').fill('sup');
      await typePin(page);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.waitForURL((url) => !url.pathname.startsWith('/desk/login'));
      await page.goto('/w/wh-1/exceptions');
      await expect(
        page.getByRole('heading', { name: 'Exceptions' }),
      ).toBeVisible();
      await use(page);
      await context.close();
    },
    { timeout: SETUP_TIMEOUT },
  ],

  admin: [
    async ({ browser, resetData: _reset }, use) => {
      const context = await newTestContext(browser);
      const page = await context.newPage();
      await page.goto('/desk/login');
      await page.getByLabel('Username').fill('admin');
      await typePin(page);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.waitForURL((url) => !url.pathname.startsWith('/desk/login'));
      await page.goto('/admin/devices');
      await expect(page.getByRole('table')).toBeVisible({ timeout: 30_000 });
      await use(page);
      await context.close();
    },
    { timeout: SETUP_TIMEOUT },
  ],
});

export { expect };
