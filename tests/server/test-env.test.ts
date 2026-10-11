import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { warehouseDb } from '#/server/db/clients';
import { SCHEMA_VERSIONS } from '#/server/db/migrate';
import { createTestEnv, type TestEnv } from '../support/test-env';

describe('createTestEnv', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await createTestEnv();
  });
  afterEach(async () => {
    await env.cleanup();
  });

  it('seeds warehouse, device, product, location and pick line', async () => {
    await env.seedWarehouse('wh-sp');
    await env.seedDevice({ id: 'dev-1', warehouses: ['wh-sp'] });
    await env.seedDevice({ id: 'dev-2', warehouses: [], revoked: true });
    await env.seedProduct({
      id: 'p1',
      sku: 'SKU-1',
      categoryTolerance: 2,
    });
    await env.seedLocation('wh-sp', { id: 'l1', code: 'A-01' });
    await env.seedPickLine('wh-sp', {
      id: 'pl1',
      skuId: 'p1',
      locationId: 'l1',
      qtyRequested: 5,
    });

    const wh = await env.global.warehouse.findUnique({
      where: { id: 'wh-sp' },
    });
    expect(wh?.schemaVersion).toBe(SCHEMA_VERSIONS.warehouse);
    expect(
      await env.global.deviceWarehouse.count({ where: { deviceId: 'dev-1' } }),
    ).toBe(1);
    expect(
      (await env.global.device.findUnique({ where: { id: 'dev-2' } }))
        ?.revokedAt,
    ).not.toBeNull();
    const product = await env.catalog.product.findUnique({
      where: { id: 'p1' },
      include: { category: true },
    });
    expect(product?.category?.countTolerance).toBe(2);
    const db = await env.warehouse('wh-sp');
    expect(
      (await db.pickLine.findUnique({ where: { id: 'pl1' } }))?.qtyRequested,
    ).toBe(5);
  });

  it('points server-side warehouseDb at the same temp database', async () => {
    await env.seedWarehouse('wh-rj');
    await env.seedLocation('wh-rj', { id: 'l9', code: 'Z-09', active: false });
    const loc = await warehouseDb('wh-rj').location.findUnique({
      where: { id: 'l9' },
    });
    expect(loc?.active).toBe(false);
  });
});
