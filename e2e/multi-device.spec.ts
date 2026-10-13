import { expect, test } from './fixtures';
import {
  deskQty,
  handheldQty,
  openExceptions,
  pendingCount,
  recordAdjust,
  recordCount,
  recordMove,
  syncNow,
} from './helpers';
import { CONTESTS } from './scenario-data';

test.skip(
  process.env.E2E_TURSO !== '1',
  'requires E2E_TURSO=1 and Turso dev DBs',
);

const RECONNECT_ORDERS = ['A then B', 'B then A', 'together'] as const;

const { countVsMove: cm, lastUnits: lu } = CONTESTS;

if (cm.countQty !== cm.initialQty - cm.moveQty) {
  throw new Error('countVsMove.countQty must equal initialQty - moveQty');
}

/** Expected final quantities, derived from the contest data. */
const EXPECTED = [
  { skuId: cm.skuId, locationId: cm.from.id, qty: cm.initialQty - cm.moveQty },
  { skuId: cm.skuId, locationId: cm.to.id, qty: cm.moveQty },
  { skuId: lu.skuId, locationId: lu.from.id, qty: -lu.initialQty },
  { skuId: lu.skuId, locationId: lu.to.id, qty: lu.initialQty },
];

const POLL = { timeout: 30_000 };

for (const order of RECONNECT_ORDERS) {
  test(`two handhelds and a supervisor, reconnect ${order}`, async ({
    handheldA,
    handheldB,
    desk,
  }) => {
    test.setTimeout(240_000);
    const a = handheldA;
    const b = handheldB;

    // Offline BEFORE recording, so nothing is pushed early.
    await a.context.setOffline(true);
    await b.context.setOffline(true);

    // A records both of its actions, then B records its two.
    await recordMove(a.page, {
      sku: cm.skuId,
      from: cm.from.code,
      to: cm.to.code,
      qty: cm.moveQty,
    });
    await recordAdjust(a.page, {
      sku: lu.skuId,
      location: lu.from.code,
      qty: -lu.initialQty,
      reason: lu.adjustReason,
    });
    await recordCount(b.page, {
      sku: cm.skuId,
      location: cm.from.code,
      qty: cm.countQty,
    });
    await recordMove(b.page, {
      sku: lu.skuId,
      from: lu.from.code,
      to: lu.to.code,
      qty: lu.initialQty,
    });

    await expect.poll(() => pendingCount(a.page)).toBe(2);
    await expect.poll(() => pendingCount(b.page)).toBe(2);

    // Reconnect in the given order.
    if (order === 'A then B') {
      await a.context.setOffline(false);
      await syncNow(a.page);
      await b.context.setOffline(false);
      await syncNow(b.page);
    } else if (order === 'B then A') {
      await b.context.setOffline(false);
      await syncNow(b.page);
      await a.context.setOffline(false);
      await syncNow(a.page);
    } else {
      await a.context.setOffline(false);
      await b.context.setOffline(false);
      await Promise.all([syncNow(a.page), syncNow(b.page)]);
    }

    // Supervisor desk: same balances and exactly one NEGATIVE_BALANCE, in every order.
    await expect
      .poll(async () => {
        const qtys: number[] = [];
        for (const e of EXPECTED) {
          qtys.push(await deskQty(desk, e.skuId, e.locationId));
        }
        return qtys;
      }, POLL)
      .toEqual(EXPECTED.map((e) => e.qty));
    await expect
      .poll(() => openExceptions(desk), POLL)
      .toEqual([
        {
          type: 'NEGATIVE_BALANCE',
          skuId: lu.skuId,
          locationId: lu.from.id,
        },
      ]);

    // Both handhelds pull and show the same balances.
    await syncNow(a.page);
    await syncNow(b.page);
    for (const h of [a, b]) {
      for (const e of EXPECTED) {
        await expect
          .poll(() => handheldQty(h.page, e.skuId, e.locationId), POLL)
          .toBe(e.qty);
      }
    }

    // Supervisor resolves the negative balance with a correcting adjustment.
    await desk.goto('/w/wh-1/exceptions');
    await desk.locator('tbody').getByRole('link').first().click();
    await desk.getByText('Correcting adjustment').click();
    // SKU and Bin are prefilled from the exception (prod-4, wh-1-A-04).
    await desk.getByLabel('Quantity').fill(String(lu.initialQty));
    await desk.getByLabel('Reason').click();
    await desk.getByRole('option', { name: 'Found' }).click();
    await desk.getByRole('button', { name: 'Resolve', exact: true }).click();
    await expect(desk.getByTestId('resolution')).toContainText(
      'Resolved: ADJUSTED',
      { timeout: 15_000 },
    );

    await expect.poll(() => openExceptions(desk), POLL).toEqual([]);
    await expect.poll(() => deskQty(desk, lu.skuId, lu.from.id), POLL).toBe(0);
  });
}
