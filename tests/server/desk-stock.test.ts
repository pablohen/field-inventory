import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionClaims } from '#/server/auth/session';
import { SCHEMA_VERSIONS } from '#/server/db/migrate';
import {
  handleGetLedger,
  handleGetStock,
  ledgerCore,
  type StockDeps,
  stockCore,
  stockFiltersSchema,
} from '#/server/desk/stock.server';
import { type SyncDeps, syncMovementsCore } from '#/server/sync/sync-movements';
import { createTestEnv, type TestEnv } from '../support/test-env';

const NOW = new Date('2026-03-01T12:00:00Z');
const WH = 'wh1';
const DEV = 'dev1';

let counter = 0;
const uuid = () =>
  `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

describe('stock and ledger', () => {
  let env: TestEnv;
  let syncDeps: SyncDeps;
  let deps: StockDeps;

  beforeEach(async () => {
    counter = 0;
    env = await createTestEnv();
    await env.seedDevice({ id: DEV, warehouses: [WH] });
    await env.seedUser({ id: 'u1', username: 'u1', pin: '1234' });
    await env.seedProduct({ id: 'P1', sku: 'SKU-B', countTolerance: 2 });
    await env.seedProduct({ id: 'P2', sku: 'SKU-A', countTolerance: 0 });
    await env.seedLocation(WH, { id: 'L1', code: 'A-01' });
    await env.seedLocation(WH, { id: 'L2', code: 'A-02' });
    const db = await env.warehouse(WH);
    syncDeps = {
      global: env.global,
      catalog: env.catalog,
      warehouseDb: () => db,
      now: () => NOW,
      newId: uuid,
      clockSkewThresholdMs: 120_000,
      transferStuckHours: 100_000,
    };
    deps = {
      global: env.global,
      catalog: env.catalog,
      warehouseDb: () => db,
    };
  });
  afterEach(() => env.cleanup());

  const base = { warehouseId: WH, userId: 'u1', deviceId: DEV };
  async function send(movements: unknown[]) {
    const res = await syncMovementsCore(syncDeps, {
      deviceId: DEV,
      schemaVersion: SCHEMA_VERSIONS.warehouse,
      sentAt: NOW.toISOString(),
      movements,
    });
    expect(res.status).toBe('ok');
  }
  const adjust = (
    skuId: string,
    locationId: string,
    qty: number,
    h: string,
  ) => ({
    ...base,
    id: uuid(),
    type: 'ADJUST',
    skuId,
    locationId,
    qty,
    reasonCode: 'FOUND',
    occurredAt: `2026-03-01T${h}:00Z`,
  });

  async function seedFlow() {
    await send([
      adjust('P1', 'L1', 10, '08:00'),
      {
        ...base,
        id: uuid(),
        type: 'PICK',
        skuId: 'P1',
        fromLocationId: 'L1',
        qty: 3,
        occurredAt: '2026-03-01T09:00:00Z',
      },
      {
        ...base,
        id: uuid(),
        type: 'MOVE',
        skuId: 'P1',
        fromLocationId: 'L1',
        toLocationId: 'L2',
        qty: 2,
        occurredAt: '2026-03-01T10:00:00Z',
      },
    ]);
  }

  async function okStock(filters = {}) {
    const r = await stockCore(deps, WH, filters);
    if (!r.ok) throw new Error(r.message);
    return r.rows;
  }
  async function okLedger(skuId: string, locationId: string) {
    const r = await ledgerCore(deps, WH, { skuId, locationId });
    if (!r.ok) throw new Error(r.message);
    return r;
  }

  it('lists balances with names and codes', async () => {
    await seedFlow();
    const rows = await okStock();
    expect(rows).toEqual([
      {
        skuId: 'P1',
        sku: 'SKU-B',
        name: 'SKU-B',
        locationId: 'L1',
        locationCode: 'A-01',
        qty: 5,
      },
      {
        skuId: 'P1',
        sku: 'SKU-B',
        name: 'SKU-B',
        locationId: 'L2',
        locationCode: 'A-02',
        qty: 2,
      },
    ]);
  });

  it('orders by sku then location code', async () => {
    await send([
      adjust('P1', 'L1', 1, '08:00'),
      adjust('P2', 'L2', 1, '08:01'),
      adjust('P2', 'L1', 1, '08:02'),
    ]);
    const rows = await okStock();
    expect(rows.map((r) => `${r.sku}/${r.locationCode}`)).toEqual([
      'SKU-A/A-01',
      'SKU-A/A-02',
      'SKU-B/A-01',
    ]);
  });

  it('filters by sku and location, and by nonZero', async () => {
    await seedFlow();
    await send([
      {
        ...base,
        id: uuid(),
        type: 'PICK',
        skuId: 'P1',
        fromLocationId: 'L2',
        qty: 2,
        occurredAt: '2026-03-01T11:00:00Z',
      },
      adjust('P2', 'L1', 4, '11:30'),
    ]);
    expect(await okStock({ locationId: 'L2' })).toHaveLength(1);
    expect(await okStock({ skuId: 'P2' })).toHaveLength(1);
    expect(await okStock()).toHaveLength(3);
    const nz = await okStock({ nonZero: true });
    expect(nz.map((r) => r.qty).sort()).toEqual([4, 5]);
  });

  it('parses nonZero from URL strings without treating "false" as true', () => {
    expect(stockFiltersSchema.parse({ nonZero: 'false' }).nonZero).toBe(false);
    expect(stockFiltersSchema.parse({ nonZero: 'true' }).nonZero).toBe(true);
    expect(stockFiltersSchema.parse({ nonZero: true }).nonZero).toBe(true);
    expect(stockFiltersSchema.parse({}).nonZero).toBeUndefined();
    expect(stockFiltersSchema.safeParse({ nonZero: 'maybe' }).success).toBe(
      false,
    );
  });

  it('falls back for unknown product and location', async () => {
    const db = await env.warehouse(WH);
    await db.stockBalance.create({
      data: { skuId: 'GONE', locationId: 'NOLOC', qty: 3 },
    });
    const rows = await okStock({ skuId: 'GONE' });
    expect(rows).toEqual([
      {
        skuId: 'GONE',
        sku: 'GONE',
        name: '(unknown product)',
        locationId: 'NOLOC',
        locationCode: 'NOLOC',
        qty: 3,
      },
    ]);
  });

  it('ledger for the source bin has deltas and running balance', async () => {
    await seedFlow();
    const l = await okLedger('P1', 'L1');
    expect(l.rows.map((r) => r.delta)).toEqual([10, -3, -2]);
    expect(l.rows.map((r) => r.runningBalance)).toEqual([10, 7, 5]);
    expect(l.rows.map((r) => r.type)).toEqual(['ADJUST', 'PICK', 'MOVE']);
    expect(l.balance).toBe(5);
    expect(l.rows.at(-1)?.runningBalance).toBe(l.balance);
    const dest = await okLedger('P1', 'L2');
    expect(dest.rows.map((r) => r.delta)).toEqual([2]);
    expect(typeof l.rows[0]?.occurredAt).toBe('string');
  });

  it('shows a COUNT with delta 0 followed by the system ADJUST, ending at the balance', async () => {
    await seedFlow();
    await send([
      {
        ...base,
        id: uuid(),
        type: 'COUNT',
        skuId: 'P1',
        locationId: 'L1',
        qty: 4,
        occurredAt: '2026-03-01T11:00:00Z',
      },
    ]);
    const l = await okLedger('P1', 'L1');
    const tail = l.rows.slice(-2);
    expect(tail.map((r) => r.type)).toEqual(['COUNT', 'ADJUST']);
    expect(tail[0]?.delta).toBe(0);
    expect(tail[1]?.source).toBe('system');
    expect(tail[1]?.delta).toBe(-1);
    // Invariant: the ledger's final running balance equals StockBalance.qty.
    const db = await env.warehouse(WH);
    const stored = await db.stockBalance.findUnique({
      where: { skuId_locationId: { skuId: 'P1', locationId: 'L1' } },
    });
    expect(stored?.qty).toBe(4);
    expect(l.rows.at(-1)?.runningBalance).toBe(stored?.qty);
    expect(l.balance).toBe(4);
  });

  it('returns NOT_FOUND for an unknown warehouse', async () => {
    expect(await stockCore(deps, 'nope', {})).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(
      await ledgerCore(deps, 'nope', { skuId: 'P1', locationId: 'L1' }),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('rejects workers with 403 and no session with 401', async () => {
    const worker: SessionClaims = {
      userId: 'u1',
      deviceId: DEV,
      role: 'worker',
      exp: 0,
    };
    const stockIn = { warehouseId: WH, filters: {} };
    const ledgerIn = {
      warehouseId: WH,
      key: { skuId: 'P1', locationId: 'L1' },
    };
    const d1 = await handleGetStock(worker, stockIn, deps).catch((e) => e);
    expect((d1 as Response).status).toBe(403);
    const d2 = await handleGetLedger(worker, ledgerIn, deps).catch((e) => e);
    expect((d2 as Response).status).toBe(403);
    const a = await handleGetStock(null, stockIn, deps).catch((e) => e);
    expect((a as Response).status).toBe(401);
    const sup = { ...worker, role: 'supervisor' as const, deviceId: 'desk' };
    expect(await handleGetStock(sup, stockIn, deps)).toMatchObject({
      ok: true,
    });
    expect(await handleGetLedger(sup, ledgerIn, deps)).toMatchObject({
      ok: true,
    });
  });
});
