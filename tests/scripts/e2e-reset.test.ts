import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { globalDb } from '#/server/db/clients';
import { main, resetWarehouseData } from '../../scripts/e2e-reset';
import { seedDev } from '../../scripts/seed-dev';
import { createTestEnv, type TestEnv } from '../support/test-env';

describe('e2e reset', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await createTestEnv();
  });
  afterEach(async () => {
    await env.cleanup();
  });

  it('clears transactional rows and keeps locations and definitions', async () => {
    const db = await env.warehouse('wh-t');
    await env.seedLocation('wh-t', { id: 'l1', code: 'A-01' });
    await env.seedLocation('wh-t', { id: 'l2', code: 'A-02' });
    await env.seedPickLine('wh-t', {
      id: 'pk1',
      skuId: 'p1',
      locationId: 'l1',
      qtyRequested: 1,
    });
    await db.pickList.update({
      where: { id: 'pl-pk1' },
      data: { status: 'DONE' },
    });
    await db.countTask.create({
      data: { id: 'ct', scope: '{}', status: 'DONE' },
    });
    for (const n of [1, 2]) {
      await db.movement.create({
        data: {
          id: `m${n}`,
          type: 'ADJUST',
          skuId: 'p1',
          toLocationId: 'l1',
          qty: 5,
          userId: 'u',
          deviceId: 'd',
          occurredAt: new Date(),
          source: 'device',
        },
      });
    }
    await db.stockBalance.create({
      data: { skuId: 'p1', locationId: 'l1', qty: 10 },
    });
    await db.exception.create({
      data: {
        id: 'e1',
        type: 'COUNT_VARIANCE',
        movementIds: '[]',
        details: '{}',
      },
    });
    await db.deviceClockSample.create({
      data: {
        deviceId: 'd',
        deviceTime: new Date(),
        serverTime: new Date(),
        skewMs: 0,
      },
    });

    await resetWarehouseData(db);

    expect(await db.movement.count()).toBe(0);
    expect(await db.stockBalance.count()).toBe(0);
    expect(await db.exception.count()).toBe(0);
    expect(await db.deviceClockSample.count()).toBe(0);
    expect(await db.location.count()).toBe(2);
    expect(await db.pickLine.count()).toBe(1);
    const list = await db.pickList.findUniqueOrThrow({
      where: { id: 'pl-pk1' },
    });
    expect(list.status).toBe('OPEN');
    const task = await db.countTask.findUniqueOrThrow({ where: { id: 'ct' } });
    expect(task.status).toBe('OPEN');
  });

  it('main() refuses without both env vars', async () => {
    const prev = { t: process.env.E2E_TURSO, a: process.env.E2E_ALLOW_RESET };
    delete process.env.E2E_TURSO;
    delete process.env.E2E_ALLOW_RESET;
    try {
      await expect(main()).rejects.toThrow(
        'Refusing to reset: set E2E_TURSO=1 and E2E_ALLOW_RESET=1',
      );
      process.env.E2E_TURSO = '1';
      await expect(main()).rejects.toThrow('Refusing to reset');
    } finally {
      if (prev.t === undefined) delete process.env.E2E_TURSO;
      else process.env.E2E_TURSO = prev.t;
      if (prev.a === undefined) delete process.env.E2E_ALLOW_RESET;
      else process.env.E2E_ALLOW_RESET = prev.a;
    }
  });

  it('restores seeded devices, users and login attempts after a reset', async () => {
    const prev = { t: process.env.E2E_TURSO, a: process.env.E2E_ALLOW_RESET };
    process.env.E2E_TURSO = '1';
    process.env.E2E_ALLOW_RESET = '1';
    try {
      await seedDev();
      const g = globalDb();
      await g.device.update({
        where: { id: 'dev-handheld-1' },
        data: { revokedAt: new Date() },
      });
      await g.deviceWarehouse.delete({
        where: {
          deviceId_warehouseId: {
            deviceId: 'dev-handheld-1',
            warehouseId: 'wh-2',
          },
        },
      });
      await g.user.update({
        where: { username: 'ana' },
        data: { disabledAt: new Date() },
      });
      await g.loginAttempt.create({
        data: { deviceId: 'dev-handheld-1', username: 'ana', failures: 5 },
      });
      await (await env.warehouse('fi-wh-1')).countTask.update({
        where: { id: 'ct-1' },
        data: { assignedUserId: null },
      });

      await main();

      const dev = await g.device.findUniqueOrThrow({
        where: { id: 'dev-handheld-1' },
        include: { warehouses: true },
      });
      expect(dev.revokedAt).toBeNull();
      expect(dev.warehouses.map((w) => w.warehouseId).sort()).toEqual([
        'wh-1',
        'wh-2',
      ]);
      const ana = await g.user.findUniqueOrThrow({
        where: { username: 'ana' },
      });
      expect(ana.disabledAt).toBeNull();
      expect(await g.loginAttempt.count()).toBe(0);
      const ct = await (
        await env.warehouse('fi-wh-1')
      ).countTask.findUniqueOrThrow({
        where: { id: 'ct-1' },
      });
      expect(ct.assignedUserId).toBe('user-ana');
    } finally {
      if (prev.t === undefined) delete process.env.E2E_TURSO;
      else process.env.E2E_TURSO = prev.t;
      if (prev.a === undefined) delete process.env.E2E_ALLOW_RESET;
      else process.env.E2E_ALLOW_RESET = prev.a;
    }
  }, 30_000);
});
