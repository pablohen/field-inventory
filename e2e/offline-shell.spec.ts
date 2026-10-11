import { expect, test } from '@playwright/test';

test('the handheld shell reloads offline and stays cross-origin isolated', async ({
  page,
  context,
}) => {
  await page.goto('/h/login');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Reload so the page is controlled by the service worker.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByLabel('Username')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
});
