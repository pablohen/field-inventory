import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateAllWarehouses } from '#/server/db/migrate-all-warehouses';
import { createTestEnv, type TestEnv } from '../support/test-env';

describe('migrateAllWarehouses', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await createTestEnv();
    for (const [id, schemaVersion] of [
      ['a', 1],
      ['b', 0],
      ['c', 1],
      ['d', 1],
    ] as const) {
      await env.global.warehouse.create({
        data: { id, name: id, tursoDbName: `fi-${id}`, schemaVersion },
      });
    }
  });
  afterEach(() => env.cleanup());

  it('skips unprovisioned warehouses, continues past failures and counts them', async () => {
    const migrate = vi.fn(async (db: string) => {
      if (db === 'fi-a') throw new Error('boom');
      return 5;
    });
    const log = vi.fn();
    const logError = vi.fn();
    const failed = await migrateAllWarehouses(
      env.global,
      migrate,
      log,
      logError,
    );
    expect(failed).toBe(1);
    expect(migrate.mock.calls.map((c) => c[0])).toEqual([
      'fi-a',
      'fi-c',
      'fi-d',
    ]);
    expect(log).toHaveBeenCalledWith(
      'fi-b: setup incomplete, finish it in /admin',
    );
    expect(logError).toHaveBeenCalledTimes(1);
    const versions = await env.global.warehouse.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, schemaVersion: true },
    });
    expect(versions).toEqual([
      { id: 'a', schemaVersion: 1 },
      { id: 'b', schemaVersion: 0 },
      { id: 'c', schemaVersion: 5 },
      { id: 'd', schemaVersion: 5 },
    ]);
  });
});
