import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionClaims } from '#/server/auth/session';
import { SCHEMA_VERSIONS } from '#/server/db/migrate';
import {
  exceptionSummary,
  handleListExceptions,
  type ListExceptionsDeps,
  listExceptionsCore,
} from '#/server/desk/exceptions.server';
import { type SyncDeps, syncMovementsCore } from '#/server/sync/sync-movements';
import { createTestEnv, type TestEnv } from '../support/test-env';

const SYNC_NOW = new Date('2026-03-01T12:00:00Z');
const WH = 'wh1';
const WH2 = 'wh2';
const DEV = 'dev1';

let counter = 0;
const uuid = () =>
  `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

describe('listExceptionsCore', () => {
  let env: TestEnv;
  let syncDeps: SyncDeps;
  let nowOffsetMs = 0;
  let realNow = 0;

  beforeEach(async () => {
    counter = 0;
    nowOffsetMs = 0;
    env = await createTestEnv();
    await env.seedDevice({ id: DEV, warehouses: [WH, WH2] });
    await env.seedUser({ id: 'u1', username: 'u1', pin: '1234' });
    await env.seedUser({ id: 'u2', username: 'u2', pin: '1234' });
    await env.seedProduct({ id: 'P1', sku: 'P1', countTolerance: 0 });
    await env.seedProduct({ id: 'P2', sku: 'P2', countTolerance: 0 });
    for (const wh of [WH, WH2]) {
      await env.seedLocation(wh, { id: 'L1', code: 'L1' });
    }
    const dbs = new Map([
      [WH, await env.warehouse(WH)],
      [WH2, await env.warehouse(WH2)],
    ]);
    syncDeps = {
      global: env.global,
      catalog: env.catalog,
      warehouseDb: (name) => {
        const db = dbs.get(name);
        if (!db) throw new Error(`no db ${name}`);
        return db;
      },
      now: () => SYNC_NOW,
      newId: uuid,
      clockSkewThresholdMs: 120_000,
      // High so seeding via sync does not itself flag transfers.
      transferStuckHours: 100_000,
    };
    realNow = Date.now();
  });
  afterEach(() => env.cleanup());

  const listDeps = (): ListExceptionsDeps => ({
    global: syncDeps.global,
    warehouseDb: syncDeps.warehouseDb,
    now: () => new Date(realNow + nowOffsetMs),
    transferStuckHours: 24,
  });

  async function send(movements: unknown[]) {
    const res = await syncMovementsCore(syncDeps, {
      deviceId: DEV,
      schemaVersion: SCHEMA_VERSIONS.warehouse,
      sentAt: SYNC_NOW.toISOString(),
      movements,
    });
    expect(res.status).toBe('ok');
  }
  const base = { warehouseId: WH, userId: 'u1', deviceId: DEV };

  /** u1 picks P1 below zero; u2 counts P2 with variance -3. */
  async function seedTwo() {
    await send([
      {
        ...base,
        id: uuid(),
        type: 'PICK',
        skuId: 'P1',
        occurredAt: '2026-03-01T09:30:00Z',
        fromLocationId: 'L1',
        qty: 2,
      },
      {
        ...base,
        id: uuid(),
        type: 'ADJUST',
        skuId: 'P2',
        occurredAt: '2026-03-01T09:00:00Z',
        locationId: 'L1',
        qty: 10,
        reasonCode: 'FOUND',
      },
      {
        ...base,
        userId: 'u2',
        id: uuid(),
        type: 'COUNT',
        skuId: 'P2',
        occurredAt: '2026-03-01T10:00:00Z',
        locationId: 'L1',
        qty: 7,
      },
    ]);
  }

  async function ok(filters = {}) {
    const res = await listExceptionsCore(listDeps(), WH, filters);
    if (!res.ok) throw new Error(res.message);
    return res;
  }

  it('lists open exceptions with counts and summaries', async () => {
    await seedTwo();
    const res = await ok();
    expect(res.rows.map((r) => r.type).sort()).toEqual([
      'COUNT_VARIANCE',
      'NEGATIVE_BALANCE',
    ]);
    expect(res.countsByType).toMatchObject({
      NEGATIVE_BALANCE: 1,
      COUNT_VARIANCE: 1,
      OVER_PICK: 0,
    });
    const byType = Object.fromEntries(res.rows.map((r) => [r.type, r]));
    expect(byType.COUNT_VARIANCE?.summary).toBe('observed 7, expected 10 (−3)');
    expect(byType.NEGATIVE_BALANCE?.summary).toBe('balance −2');
    expect(byType.COUNT_VARIANCE?.userIds).toEqual(['u2']);
    expect(byType.NEGATIVE_BALANCE?.userIds).toEqual(['u1']);
  });

  it('filters by type, sku and user', async () => {
    await seedTwo();
    const byType = await ok({ type: 'COUNT_VARIANCE' });
    expect(byType.rows.map((r) => r.type)).toEqual(['COUNT_VARIANCE']);
    expect(byType.countsByType.NEGATIVE_BALANCE).toBe(1);
    const byUser = await ok({ userId: 'u1' });
    expect(byUser.rows.map((r) => r.type)).toEqual(['NEGATIVE_BALANCE']);
    const bySku = await ok({ skuId: 'P2' });
    expect(bySku.rows.map((r) => r.type)).toEqual(['COUNT_VARIANCE']);
  });

  it('filters by minimum age', async () => {
    await seedTwo();
    nowOffsetMs = 2 * 3_600_000;
    expect((await ok({ minAgeHours: 1 })).rows).toHaveLength(2);
    nowOffsetMs = 30 * 60_000;
    expect((await ok({ minAgeHours: 1 })).rows).toHaveLength(0);
  });

  it('excludes resolved exceptions from rows and counts', async () => {
    await seedTwo();
    const db = await env.warehouse(WH);
    await db.exception.updateMany({
      where: { type: 'COUNT_VARIANCE' },
      data: { status: 'RESOLVED' },
    });
    const res = await ok();
    expect(res.rows.map((r) => r.type)).toEqual(['NEGATIVE_BALANCE']);
    expect(res.countsByType.COUNT_VARIANCE).toBe(0);
  });

  it('flags a stuck transfer on the first list call', async () => {
    await send([
      {
        ...base,
        id: uuid(),
        type: 'ADJUST',
        skuId: 'P1',
        occurredAt: '2026-02-27T09:00:00Z',
        locationId: 'L1',
        qty: 20,
        reasonCode: 'FOUND',
      },
      {
        ...base,
        id: uuid(),
        type: 'TRANSFER_OUT',
        skuId: 'P1',
        qty: 2,
        occurredAt: new Date(SYNC_NOW.getTime() - 25 * 3_600_000).toISOString(),
        fromLocationId: 'L1',
        transferId: uuid(),
        counterpartWarehouseId: WH2,
      },
    ]);
    const deps = { ...listDeps(), now: () => SYNC_NOW };
    const res = await listExceptionsCore(deps, WH, {});
    if (!res.ok) throw new Error(res.message);
    expect(res.rows.map((r) => r.type)).toEqual(['TRANSFER_STUCK']);
    expect(res.rows[0]?.summary).toBe('in transit 25 h');
    expect(res.countsByType.TRANSFER_STUCK).toBe(1);
  });

  it('returns the DeskError for unknown or not-ready warehouses', async () => {
    const missing = await listExceptionsCore(listDeps(), 'nope', {});
    expect(missing).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await env.global.warehouse.update({
      where: { id: WH },
      data: { schemaVersion: 0 },
    });
    const stale = await listExceptionsCore(listDeps(), WH, {});
    expect(stale).toMatchObject({ ok: false, code: 'NOT_READY' });
  });

  it('handleListExceptions rejects workers with 403 and no session with 401', async () => {
    const worker: SessionClaims = {
      userId: 'u1',
      deviceId: DEV,
      role: 'worker',
      exp: 0,
    };
    const input = { warehouseId: WH, filters: {} };
    const denied = await handleListExceptions(worker, input, listDeps()).catch(
      (e) => e,
    );
    expect(denied).toBeInstanceOf(Response);
    expect((denied as Response).status).toBe(403);
    const anon = await handleListExceptions(null, input, listDeps()).catch(
      (e) => e,
    );
    expect((anon as Response).status).toBe(401);
    const sup = await handleListExceptions(
      { ...worker, role: 'supervisor', deviceId: 'desk' },
      input,
      listDeps(),
    );
    expect(sup.ok).toBe(true);
  });
});

describe('exceptionSummary', () => {
  it('formats the remaining types', () => {
    expect(exceptionSummary('LATE_MOVEMENT', { correction: 3 })).toBe(
      'late movement, correction +3',
    );
    expect(exceptionSummary('LATE_MOVEMENT', { correction: -3 })).toBe(
      'late movement, correction −3',
    );
    expect(
      exceptionSummary('OVER_PICK', { requested: 5, pickedAfter: 6 }),
    ).toBe('picked 6 of 5');
    expect(exceptionSummary('CLOCK_SKEW', { skewMs: 180_000 })).toBe(
      'clock +180 s',
    );
    expect(exceptionSummary('CLOCK_SKEW', { skewMs: -180_000 })).toBe(
      'clock −180 s',
    );
  });
});
