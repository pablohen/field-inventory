import { expect, type Page, test } from '@playwright/test';
import { DEV_PIN, LOCATION_CODES, PRODUCTS } from '../scripts/seed-data';
import { waitForServiceWorkerControl } from './helpers';

test.skip(
  process.env.E2E_TURSO !== '1',
  'requires E2E_TURSO=1 and Turso dev DBs',
);

const PRODUCT = PRODUCTS[0];
const LOCATION = LOCATION_CODES[0];
const LOCATION_ID = `wh-1-${LOCATION}`;

async function scan(page: Page, label: string, value: string) {
  const input = page.getByLabel(label);
  await input.fill(value);
  await input.press('Enter');
}

async function displayedQty(page: Page): Promise<string> {
  await page.goto('/h/wh-1/stock');
  const row = page
    .getByRole('row')
    .filter({ hasText: PRODUCT.id })
    .filter({ hasText: LOCATION_ID });
  await expect(row).toBeVisible();
  const qty = await row.getByRole('cell').nth(2).innerText();
  return qty.trim();
}

test('count and adjust offline, then sync back to zero pending', async ({
  page,
  context,
}) => {
  // 1. Sign in as ana on dev-handheld-1.
  await page.goto('/h/login');
  await page.getByLabel('Device id').fill('dev-handheld-1');
  await page.getByLabel('Username').fill('ana');
  await page.getByLabel('PIN').first().click();
  await page.keyboard.type(DEV_PIN);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/h$/);
  await waitForServiceWorkerControl(page);

  // 2. Count A-01 + first product = 7.
  await page.goto('/h/wh-1/count');
  await scan(page, 'Scan location', LOCATION);
  await scan(page, 'Scan product', PRODUCT.barcodes[0]);
  await page.getByLabel('Counted quantity').fill('7');
  await page.getByRole('button', { name: 'Confirm count' }).click();
  await expect(page.getByText('Recorded')).toBeVisible();
  await expect(page.getByText('1 pending')).toBeVisible();

  const before = await displayedQty(page);

  // 3. Offline: the app loads from the SW and keeps its state.
  await page.goto('/h/wh-1/count');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('1 pending')).toBeVisible();
  expect(await displayedQty(page)).toBe(before);

  // 4. Record an ADJUST offline.
  await page.goto('/h/wh-1/adjust');
  await scan(page, 'Scan location', LOCATION);
  await scan(page, 'Scan product', PRODUCT.barcodes[0]);
  await page.getByLabel('Adjustment (negative removes)').fill('1');
  await page.getByLabel('Reason').selectOption({ label: 'Found' });
  await page.getByRole('button', { name: 'Confirm adjustment' }).click();
  await expect(page.getByText('Recorded')).toBeVisible();
  await expect(page.getByText('2 pending')).toBeVisible();

  const offlineQty = await displayedQty(page);

  // 5. Back online: sync, then nothing pending and stock unchanged.
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('0 pending')).toBeVisible({ timeout: 15_000 });
  expect(await displayedQty(page)).toBe(offlineQty);
});
