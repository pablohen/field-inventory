import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSIONS } from '#/server/db/migrate';
import { checkStuckTransfers } from '#/server/sync/stuck-transfers';
import { type SyncDeps, syncMovementsCore } from '#/server/sync/sync-movements';
import { createTestEnv, type TestEnv } from '../support/test-env';

const NOW = new Date('2026-03-01T12:00:00Z');
const WH = 'wh1';
const WH2 = 'wh2';
const DEV = 'dev1';

let counter = 0;
const uuid = () =>
  `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

describe('checkStuckTransfers', () => {
  let env: TestEnv;
  let deps: SyncDeps;

  beforeEach(async () => {
    counter = 0;
    env = await createTestEnv();
    await env.seedDevice({ id: DEV, warehouses: [WH, WH2] });
    await env.seedUser({ id: 'u1', username: 'u1', pin: '1234' });
    await env.seedProduct({ id: 'P1', sku: 'P1', countTolerance: 5 });
    for (const wh of [WH, WH2]) {
      await env.seedLocation(wh, { id: 'L1', code: 'L1' });
    }
    const dbs = new Map([
      [WH, await env.warehouse(WH)],
      [WH2, await env.warehouse(WH2)],
    ]);
    deps = {
      global: env.global,
      catalog: env.catalog,
      warehouseDb: (name) => {
        const db = dbs.get(name);
        if (!db) throw new Error(`no db ${name}`);
        return db;
      },
      now: () => NOW,
      newId: uuid,
      clockSkewThresholdMs: 120_000,
      // High so seeding via sync does not itself flag the transfer.
      transferStuckHours: 100_000,
    };
  });
  afterEach(() => env.cleanup());

  async function send(movements: unknown[]) {
    const res = await syncMovementsCore(deps, {
      deviceId: DEV,
      schemaVersion: SCHEMA_VERSIONS.warehouse,
      sentAt: NOW.toISOString(),
      movements,
    });
    expect(res.status).toBe('ok');
  }
  const stuckDeps = () => ({ ...deps, transferStuckHours: 24 });

  const base = {
    skuId: 'P1',
    userId: 'u1',
    deviceId: DEV,
    qty: 2,
  };
  const seedOut = (transferId: string) =>
    send([
      {
        ...base,
        id: uuid(),
        type: 'ADJUST',
        warehouseId: WH,
        occurredAt: '2026-02-27T09:00:00Z',
        locationId: 'L1',
        qty: 20,
        reasonCode: 'FOUND',
      },
      {
        ...base,
        id: uuid(),
        type: 'TRANSFER_OUT',
        warehouseId: WH,
        occurredAt: new Date(NOW.getTime() - 25 * 3_600_000).toISOString(),
        fromLocationId: 'L1',
        transferId,
        counterpartWarehouseId: WH2,
      },
    ]);

  it('persists one draft, then none on a second call', async () => {
    await seedOut(uuid());
    const first = await checkStuckTransfers(stuckDeps(), WH);
    expect(first.map((d) => d.type)).toEqual(['TRANSFER_STUCK']);
    expect(
      await (await env.warehouse(WH)).exception.count({
        where: { type: 'TRANSFER_STUCK' },
      }),
    ).toBe(1);
    expect(await checkStuckTransfers(stuckDeps(), WH)).toEqual([]);
  });

  it('flags a transfer once under concurrent checks', async () => {
    await seedOut(uuid());
    const results = await Promise.all([
      checkStuckTransfers(stuckDeps(), WH),
      checkStuckTransfers(stuckDeps(), WH),
    ]);
    const db = await env.warehouse(WH);
    expect(
      await db.exception.count({ where: { type: 'TRANSFER_STUCK' } }),
    ).toBe(1);
    expect(results.flat()).toHaveLength(1);
  });

  it('skips a malformed details row instead of throwing', async () => {
    await seedOut(uuid());
    const db = await env.warehouse(WH);
    await db.exception.create({
      data: {
        id: 'junk',
        type: 'TRANSFER_STUCK',
        status: 'OPEN',
        movementIds: '[]',
        details: '{not json',
      },
    });
    const out = await checkStuckTransfers(stuckDeps(), WH);
    expect(out.map((d) => d.type)).toEqual(['TRANSFER_STUCK']);
  });

  it('returns none when the IN exists in the counterpart warehouse', async () => {
    const transferId = uuid();
    await seedOut(transferId);
    await send([
      {
        ...base,
        id: uuid(),
        type: 'TRANSFER_IN',
        warehouseId: WH2,
        occurredAt: '2026-03-01T11:00:00Z',
        toLocationId: 'L1',
        transferId,
        counterpartWarehouseId: WH,
      },
    ]);
    expect(await checkStuckTransfers(stuckDeps(), WH)).toEqual([]);
  });
});
