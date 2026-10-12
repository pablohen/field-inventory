import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  handleGetWarehouses,
  listWarehouses,
  warehouseClientFor,
} from '#/server/desk/warehouses.server';
import { createTestEnv, type TestEnv } from '../support/test-env';

describe('desk warehouses', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await createTestEnv();
    await env.seedWarehouse('b-wh');
    await env.seedWarehouse('a-wh');
  });
  afterEach(() => env.cleanup());

  const deps = () => ({
    global: env.global,
    warehouseDb: (_name: string): never => {
      throw new Error('unexpected warehouseDb');
    },
  });

  it('lists warehouses ordered by name', async () => {
    expect(await listWarehouses(env.global)).toEqual([
      { id: 'a-wh', name: 'a-wh' },
      { id: 'b-wh', name: 'b-wh' },
    ]);
  });

  it('NOT_FOUND for an unknown id', async () => {
    const r = await warehouseClientFor(deps(), 'nope');
    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('NOT_READY on schema version mismatch', async () => {
    await env.global.warehouse.update({
      where: { id: 'a-wh' },
      data: { schemaVersion: 0 },
    });
    const r = await warehouseClientFor(deps(), 'a-wh');
    expect(r).toMatchObject({ ok: false, code: 'NOT_READY' });
  });

  it('returns the client when ready', async () => {
    const db = await env.warehouse('a-wh');
    const r = await warehouseClientFor(
      { global: env.global, warehouseDb: () => db },
      'a-wh',
    );
    expect(r).toEqual({ ok: true, db });
  });
});

describe('handleGetWarehouses', () => {
  it('403 for a worker, lists for a supervisor', async () => {
    const env = await createTestEnv();
    try {
      await env.seedWarehouse('a-wh');
      const claims = (role: 'worker' | 'supervisor') => ({
        userId: 'u',
        deviceId: 'desk',
        role,
        exp: 0,
      });
      await expect(
        handleGetWarehouses(claims('worker'), { global: env.global }),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await handleGetWarehouses(claims('supervisor'), { global: env.global }),
      ).toEqual([{ id: 'a-wh', name: 'a-wh' }]);
    } finally {
      await env.cleanup();
    }
  });
});
