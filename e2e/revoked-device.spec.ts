import { readFile } from 'node:fs/promises';
import { initialQty, LOCATION_CODES, PRODUCTS } from '../scripts/seed-data';
import { expect, test } from './fixtures';
import { deskQty, pendingCount, recordAdjust, syncNow } from './helpers';

test.skip(
  process.env.E2E_TURSO !== '1',
  'requires E2E_TURSO=1 and Turso dev DBs',
);

const WH = 'wh-1';
const DEVICE_LABEL = 'Dev handheld 1';

// prod-2 is stocked at A-02 (product i is stocked at location i in the seed).
const productIndex = PRODUCTS.findIndex((p) => p.id === 'prod-2');
const locationCode = LOCATION_CODES[productIndex];
const locationId = `${WH}-${locationCode}`;
const initial = initialQty(productIndex, productIndex);
if (locationCode !== 'A-02' || initial === null) {
  throw new Error('prod-2 must be seeded at A-02');
}

const POLL = { timeout: 30_000 };

test('a revoked device keeps its offline work and syncs it after restore', async ({
  handheldA,
  admin,
}) => {
  test.setTimeout(240_000);
  const a = handheldA.page;

  // Offline BEFORE recording, so nothing is pushed early.
  await handheldA.context.setOffline(true);
  await recordAdjust(a, {
    sku: 'prod-2',
    location: locationCode,
    qty: 1,
    reason: 'Found',
  });
  await expect.poll(() => pendingCount(a)).toBe(1);

  // The admin revokes the device and confirms the dialog.
  await admin.goto('/admin/devices');
  await admin.getByRole('button', { name: `Revoke ${DEVICE_LABEL}` }).click();
  const dialog = admin.getByRole('dialog');
  await expect(
    dialog.getByText(
      `Revoke ${DEVICE_LABEL}? It will stop syncing; recorded work stays in its outbox.`,
    ),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(
    admin.getByRole('button', { name: `Restore ${DEVICE_LABEL}` }),
  ).toBeVisible({ timeout: 15_000 });

  // A reconnects and syncs: it is blocked, and the work stays in the outbox.
  await handheldA.context.setOffline(false);
  await a.getByRole('button', { name: 'Sync now' }).click();
  await expect(a.getByText('Device revoked')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => pendingCount(a), { timeout: 5_000 }).toBe(1);

  // The attention screen offers the export; the download holds the recorded work.
  await a.getByText('Device revoked').click();
  await a.waitForURL(/\/h\/attention$/);
  await expect(a.getByText('This device was revoked')).toBeVisible();
  const [download] = await Promise.all([
    a.waitForEvent('download'),
    a.getByRole('button', { name: 'Export outbox' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^outbox-dev-handheld-1-\d{4}-\d{2}-\d{2}\.json$/,
  );
  const path = await download.path();
  const rows = JSON.parse(await readFile(path, 'utf8')) as Array<{
    id: string;
    warehouseId: string;
    status: string;
    input: Record<string, unknown>;
  }>;
  // The movement id is not shown anywhere in the UI, so assert on the stable
  // fields of the one exported row (its outbox id equals the movement id).
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    warehouseId: WH,
    status: 'pending',
    input: {
      type: 'ADJUST',
      skuId: 'prod-2',
      locationId,
      qty: 1,
      warehouseId: WH,
      deviceId: 'dev-handheld-1',
    },
  });
  expect(rows[0].input.id).toBe(rows[0].id);

  // Still blocked and still pending; the server balance is unchanged.
  await expect.poll(() => pendingCount(a), { timeout: 5_000 }).toBe(1);
  expect(await deskQty(admin, 'prod-2', locationId)).toBe(initial);

  // The admin restores the device; A syncs the work.
  await admin.goto('/admin/devices');
  await admin.getByRole('button', { name: `Restore ${DEVICE_LABEL}` }).click();
  await expect(
    admin.getByRole('button', { name: `Revoke ${DEVICE_LABEL}` }),
  ).toBeVisible({ timeout: 15_000 });

  // Each Sync now re-checks the config, which clears the block once restored.
  await expect(async () => {
    await syncNow(a);
  }).toPass({ timeout: 60_000 });
  await expect(a.getByText('Device revoked')).toHaveCount(0);
  await expect
    .poll(() => deskQty(admin, 'prod-2', locationId), POLL)
    .toBe(initial + 1);
});
