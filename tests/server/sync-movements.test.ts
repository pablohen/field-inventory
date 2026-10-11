import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSIONS } from '#/server/db/migrate';
import {
  type SyncDeps,
  type SyncResponse,
  syncMovementsCore,
} from '#/server/sync/sync-movements';
import { createTestEnv, type TestEnv } from '../support/test-env';

const NOW = new Date('2026-03-01T12:00:00Z');
const WH = 'wh1';
const WH2 = 'wh2';
const DEV = 'dev1';

let counter = 0;
const uuid = () =>
  `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

describe('syncMovementsCore', () => {
  let env: TestEnv;
  let deps: SyncDeps;

  beforeEach(async () => {
    counter = 0;
    env = await createTestEnv();
    await env.seedDevice({ id: DEV, warehouses: [WH, WH2] });
    await env.seedProduct({ id: 'P1', sku: 'P1', countTolerance: 5 });
    for (const wh of [WH, WH2]) {
      await env.seedLocation(wh, { id: 'L1', code: 'L1' });
      await env.seedLocation(wh, { id: 'OFF', code: 'OFF', active: false });
    }
    deps = {
      global: env.global,
      catalog: env.catalog,
      warehouseDb: (name) => {
        throw new Error(`unexpected sync warehouseDb(${name})`);
      },
      now: () => NOW,
      newId: uuid,
      clockSkewThresholdMs: 120_000,
      transferStuckHours: 24,
    };
    const dbs = new Map([
      [WH, await env.warehouse(WH)],
      [WH2, await env.warehouse(WH2)],
    ]);
    deps.warehouseDb = (name) => {
      const db = dbs.get(name);
      if (!db) throw new Error(`no db ${name}`);
      return db;
    };
  });
  afterEach(() => env.cleanup());

  const at = (time: string) => `2026-03-01T${time}:00Z`;

  function adjust(over: Record<string, unknown> = {}) {
    return {
      id: uuid(),
      type: 'ADJUST',
      warehouseId: WH,
      skuId: 'P1',
      userId: 'u1',
      deviceId: DEV,
      occurredAt: at('09:00'),
      locationId: 'L1',
      qty: 10,
      reasonCode: 'FOUND',
      ...over,
    };
  }
  function pick(over: Record<string, unknown> = {}) {
    return {
      id: uuid(),
      type: 'PICK',
      warehouseId: WH,
      skuId: 'P1',
      userId: 'u1',
      deviceId: DEV,
      occurredAt: at('09:30'),
      fromLocationId: 'L1',
      qty: 3,
      ...over,
    };
  }
  function batch(movements: unknown[], over: Record<string, unknown> = {}) {
    return {
      deviceId: DEV,
      schemaVersion: SCHEMA_VERSIONS.warehouse,
      sentAt: NOW.toISOString(),
      movements,
      ...over,
    };
  }
  async function ok(
    res: Promise<SyncResponse>,
  ): Promise<Extract<SyncResponse, { status: 'ok' }>> {
    const r = await res;
    if (r.status !== 'ok') throw new Error(`expected ok, got ${r.status}`);
    return r;
  }
  async function balance(wh = WH, location = 'L1') {
    const db = await env.warehouse(wh);
    const b = await db.stockBalance.findUnique({
      where: { skuId_locationId: { skuId: 'P1', locationId: location } },
    });
    return b?.qty ?? 0;
  }
  async function movementCount(wh = WH) {
    return (await env.warehouse(wh)).movement.count();
  }

  it('marks a row with null occurredAt invalid and does not touch the balance', async () => {
    const a = adjust();
    const bad = pick({ occurredAt: null });
    const res = await ok(syncMovementsCore(deps, batch([a, bad])));
    expect(res.results[1]).toMatchObject({ id: bad.id, status: 'invalid' });
    expect(await balance()).toBe(10);
    expect(await movementCount()).toBe(1);
  });

  it('accepts ADJUST then PICK and updates the balance', async () => {
    const a = adjust();
    const p = pick();
    const res = await ok(syncMovementsCore(deps, batch([a, p])));
    expect(res.results).toEqual([
      { id: a.id, status: 'accepted' },
      { id: p.id, status: 'accepted' },
    ]);
    expect(res.serverTime).toBe(NOW.toISOString());
    expect(await balance()).toBe(7);
  });

  it('reports a resend with the same id and a different qty as duplicate', async () => {
    const a = adjust();
    await ok(syncMovementsCore(deps, batch([a])));
    const res = await ok(syncMovementsCore(deps, batch([{ ...a, qty: 99 }])));
    expect(res.results).toEqual([{ id: a.id, status: 'duplicate' }]);
    expect(await balance()).toBe(10);
    expect(await movementCount()).toBe(1);
  });

  it('handles a mixed batch of qty 0, unassigned warehouse and a valid row, keeping input order', async () => {
    const bad = pick({ qty: 0 });
    const foreign = adjust({ warehouseId: 'elsewhere' });
    const good = adjust();
    const res = await ok(
      syncMovementsCore(deps, batch([bad, foreign, good, { qty: 1 }])),
    );
    expect(res.results[0]).toMatchObject({ id: bad.id, status: 'invalid' });
    expect((res.results[0] as { reason: string }).reason).toContain('qty');
    expect(res.results[1]).toEqual({
      id: foreign.id,
      status: 'invalid',
      reason: 'WAREHOUSE_NOT_ASSIGNED',
    });
    expect(res.results[2]).toEqual({ id: good.id, status: 'accepted' });
    expect(res.results[3]).toMatchObject({ id: null, status: 'invalid' });
    expect(await balance()).toBe(10);
  });

  it('rejects unknown SKU, unknown and inactive locations, unknown pick line', async () => {
    const res = await ok(
      syncMovementsCore(
        deps,
        batch([
          adjust({ skuId: 'NOPE' }),
          adjust({ locationId: 'MISSING' }),
          adjust({ locationId: 'OFF' }),
          pick({ ref: 'no-line' }),
        ]),
      ),
    );
    expect(res.results.map((r) => (r as { reason?: string }).reason)).toEqual([
      'UNKNOWN_SKU',
      'UNKNOWN_LOCATION',
      'INACTIVE_LOCATION',
      'UNKNOWN_PICK_LINE',
    ]);
    expect(await movementCount()).toBe(0);
  });

  it('returns UPDATE_REQUIRED for an old schema version without writing', async () => {
    const res = await syncMovementsCore(
      deps,
      batch([adjust()], { schemaVersion: 0 }),
    );
    expect(res.status).toBe('UPDATE_REQUIRED');
    expect(await movementCount()).toBe(0);
  });

  it('returns DEVICE_REVOKED and DEVICE_UNKNOWN without writing', async () => {
    await env.seedDevice({ id: 'rev', warehouses: [WH], revoked: true });
    const revoked = await syncMovementsCore(
      deps,
      batch([adjust({ deviceId: 'rev' })], { deviceId: 'rev' }),
    );
    expect(revoked.status).toBe('DEVICE_REVOKED');
    const unknown = await syncMovementsCore(
      deps,
      batch([adjust()], { deviceId: 'ghost' }),
    );
    expect(unknown.status).toBe('DEVICE_UNKNOWN');
    expect(await movementCount()).toBe(0);
  });

  it('returns WAREHOUSE_NOT_READY when a targeted warehouse has a stale schema', async () => {
    await env.global.warehouse.update({
      where: { id: WH },
      data: { schemaVersion: 0 },
    });
    const res = await syncMovementsCore(deps, batch([adjust()]));
    expect(res.status).toBe('WAREHOUSE_NOT_READY');
    expect(await movementCount()).toBe(0);
  });

  it('throws on an invalid envelope', async () => {
    await expect(syncMovementsCore(deps, { nope: true })).rejects.toThrow();
  });

  it('processes rows in occurredAt order even when sent out of order', async () => {
    const count = {
      id: uuid(),
      type: 'COUNT',
      warehouseId: WH,
      skuId: 'P1',
      userId: 'u1',
      deviceId: DEV,
      occurredAt: at('10:00'),
      locationId: 'L1',
      qty: 8,
    };
    const a = adjust({ occurredAt: at('09:00') });
    const res = await ok(syncMovementsCore(deps, batch([count, a])));
    expect(res.results.map((r) => r.status)).toEqual(['accepted', 'accepted']);
    const db = await env.warehouse(WH);
    const sys = await db.movement.findMany({ where: { source: 'system' } });
    expect(sys.map((m) => m.qty)).toEqual([-2]);
    expect(await balance()).toBe(8);
  });

  it('raises CLOCK_SKEW once for a future sentAt', async () => {
    const sentAt = new Date(NOW.getTime() + 5 * 60_000).toISOString();
    const first = await ok(
      syncMovementsCore(deps, batch([adjust()], { sentAt })),
    );
    expect(first.results[0]?.status).toBe('accepted');
    expect(first.exceptions.map((e) => e.type)).toEqual(['CLOCK_SKEW']);
    const second = await ok(
      syncMovementsCore(deps, batch([adjust()], { sentAt })),
    );
    expect(second.exceptions).toEqual([]);
    const db = await env.warehouse(WH);
    expect(await db.exception.count({ where: { type: 'CLOCK_SKEW' } })).toBe(1);
    const samples = await db.deviceClockSample.findMany();
    expect(samples).toHaveLength(2);
    expect(samples[0]?.skewMs).toBe(300_000);
  });

  it('skips clock handling for warehouses with no valid rows', async () => {
    const res = await ok(
      syncMovementsCore(
        deps,
        batch([adjust(), adjust({ warehouseId: WH2, qty: 0 })]),
      ),
    );
    expect(res.results[1]?.status).toBe('invalid');
    expect(await (await env.warehouse(WH2)).deviceClockSample.count()).toBe(0);
    expect(await (await env.warehouse(WH)).deviceClockSample.count()).toBe(1);
  });

  it('flags a stuck transfer once and not after the TRANSFER_IN arrived', async () => {
    const transferId = uuid();
    const out = {
      id: uuid(),
      type: 'TRANSFER_OUT',
      warehouseId: WH,
      skuId: 'P1',
      userId: 'u1',
      deviceId: DEV,
      occurredAt: new Date(NOW.getTime() - 25 * 3_600_000).toISOString(),
      fromLocationId: 'L1',
      qty: 2,
      transferId,
      counterpartWarehouseId: WH2,
    };
    const first = await ok(
      syncMovementsCore(
        deps,
        batch([adjust({ occurredAt: '2026-02-27T09:00:00Z', qty: 20 }), out]),
      ),
    );
    expect(first.exceptions.map((e) => e.type)).toEqual(['TRANSFER_STUCK']);
    const again = await ok(syncMovementsCore(deps, batch([adjust()])));
    expect(again.exceptions.map((e) => e.type)).toEqual([]);

    // A second transfer whose IN is already received at the counterpart.
    const transfer2 = uuid();
    const inn = {
      id: uuid(),
      type: 'TRANSFER_IN',
      warehouseId: WH2,
      skuId: 'P1',
      userId: 'u1',
      deviceId: DEV,
      occurredAt: at('11:00'),
      toLocationId: 'L1',
      qty: 2,
      transferId: transfer2,
      counterpartWarehouseId: WH,
    };
    await ok(syncMovementsCore(deps, batch([inn])));
    const out2 = { ...out, id: uuid(), transferId: transfer2 };
    const res = await ok(syncMovementsCore(deps, batch([out2])));
    expect(res.exceptions).toEqual([]);
  });
});
