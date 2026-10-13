import { expect, type Page } from '@playwright/test';
import { PRODUCTS } from '../scripts/seed-data';

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

const WH = 'wh-1';

function barcodeOf(skuId: string): string {
  const p = PRODUCTS.find((x) => x.id === skuId);
  if (!p) throw new Error(`unknown product ${skuId}`);
  return p.barcodes[0];
}

/** "wh-1-A-01" -> "A-01" (the code the desk stock table shows). */
function locationCode(locationId: string): string {
  return locationId.replace(/^wh-\d+-/, '');
}

async function scan(page: Page, label: string, value: string) {
  const input = page.getByLabel(label);
  await input.fill(value);
  await input.press('Enter');
}

async function openHandheldScreen(page: Page, screen: string) {
  await page.goto(`/h/${WH}/${screen}`);
  await waitForHandheldReady(page);
}

/** Records a MOVE on the handheld. `sku` is a product id (scanned by barcode); `from`/`to` are location codes. */
export async function recordMove(
  page: Page,
  m: { sku: string; from: string; to: string; qty: number },
): Promise<void> {
  await openHandheldScreen(page, 'move');
  await scan(page, 'Scan source location', m.from);
  await scan(page, 'Scan product', barcodeOf(m.sku));
  await page.getByLabel('Quantity').fill(String(m.qty));
  await scan(page, 'Scan destination location', m.to);
  await page.getByRole('button', { name: 'Confirm move' }).click();
  await expect(page.getByText('Recorded')).toBeVisible();
}

/** Records a COUNT on the handheld. `location` is a location code. */
export async function recordCount(
  page: Page,
  c: { sku: string; location: string; qty: number },
): Promise<void> {
  await openHandheldScreen(page, 'count');
  await scan(page, 'Scan location', c.location);
  await scan(page, 'Scan product', barcodeOf(c.sku));
  await page.getByLabel('Counted quantity').fill(String(c.qty));
  await page.getByRole('button', { name: 'Confirm count' }).click();
  await expect(page.getByText('Recorded')).toBeVisible();
}

/** Records an ADJUST (negative removes). `reason` is the reason label, e.g. "Damaged". */
export async function recordAdjust(
  page: Page,
  a: { sku: string; location: string; qty: number; reason: string },
): Promise<void> {
  await openHandheldScreen(page, 'adjust');
  await scan(page, 'Scan location', a.location);
  await scan(page, 'Scan product', barcodeOf(a.sku));
  await page.getByLabel('Adjustment (negative removes)').fill(String(a.qty));
  await page.getByLabel('Reason').selectOption({ label: a.reason });
  await page.getByRole('button', { name: 'Confirm adjustment' }).click();
  await expect(page.getByText('Recorded')).toBeVisible();
}

const PENDING = /^(\d+) pending$/;

/** Pushes the outbox now and waits for nothing to be pending. */
export async function syncNow(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText(/^0 pending$/)).toBeVisible({ timeout: 15_000 });
  // A rejected row also leaves "pending"; make that a direct failure.
  await expect(page.getByText(/need attention$/)).toHaveCount(0);
}

/** The "N pending" count in the status pill (the page must be a ready handheld page). */
export async function pendingCount(page: Page): Promise<number> {
  const badge = page.getByText(PENDING);
  await expect(badge).toBeVisible();
  const text = (await badge.innerText()).trim();
  return Number(PENDING.exec(text)?.[1]);
}

/**
 * Displayed qty on the handheld stock screen (replica balance plus pending deltas).
 * Returns 0 when there is no row for the pair.
 */
export async function handheldQty(
  page: Page,
  skuId: string,
  locationId: string,
): Promise<number> {
  await openHandheldScreen(page, 'stock');
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 30_000 });
  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: skuId, exact: true }) })
    .filter({ has: page.getByRole('cell', { name: locationId, exact: true }) });
  if ((await row.count()) === 0) return 0;
  return Number((await row.getByRole('cell').nth(2).innerText()).trim());
}

/**
 * Qty on the desk stock table. The desk lists SKU and bin by code, so the ids
 * are mapped to codes; returns 0 when the pair has no row.
 */
export async function deskQty(
  page: Page,
  skuId: string,
  locationId: string,
): Promise<number> {
  const product = PRODUCTS.find((p) => p.id === skuId);
  if (!product) throw new Error(`unknown product ${skuId}`);
  await page.goto(`/w/${WH}/stock`);
  await expect(
    page.getByRole('table').or(page.getByText('No stock matches.')),
  ).toBeVisible({ timeout: 30_000 });
  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: product.sku, exact: true }) })
    .filter({
      has: page.getByRole('cell', {
        name: locationCode(locationId),
        exact: true,
      }),
    });
  if ((await row.count()) === 0) return 0;
  return Number((await row.getByRole('cell').nth(3).innerText()).trim());
}

export interface DeskException {
  type: string;
  skuId: string;
  locationId: string;
}

/**
 * The OPEN exceptions as the desk renders them with default filters. The table
 * shows raw ids in the SKU and Bin columns ("—" when absent).
 */
export async function openExceptions(page: Page): Promise<DeskException[]> {
  await page.goto(`/w/${WH}/exceptions`);
  await expect(
    page
      .getByRole('table')
      .or(page.getByText("No open exceptions. Floor's clear.")),
  ).toBeVisible({ timeout: 30_000 });
  const rows = page.locator('tbody').getByRole('row');
  const n = await rows.count();
  const out: DeskException[] = [];
  for (let i = 0; i < n; i++) {
    const cells = rows.nth(i).getByRole('cell');
    out.push({
      type: (await cells.nth(0).innerText()).trim(),
      skuId: (await cells.nth(2).innerText()).trim(),
      locationId: (await cells.nth(3).innerText()).trim(),
    });
  }
  return out;
}
