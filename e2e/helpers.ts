import { expect, type Page } from '@playwright/test';

/** Installs the service worker and reloads until it controls the page. */
export async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
}

/** Waits until the handheld backend is up: the StatusPill has rendered and no longer says "Starting…". */
export async function waitForHandheldReady(page: Page): Promise<void> {
  // The pill must exist first, otherwise an unhydrated page would pass vacuously.
  await expect(page.locator('.mantine-Badge-root').first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Starting…')).toHaveCount(0, {
    timeout: 30_000,
  });
}
