import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionClaims } from '#/server/auth/session';
import { SCHEMA_VERSIONS } from '#/server/db/migrate';
import {
  exceptionDetailCore,
  handleGetExceptionDetail,
  type ListExceptionsDeps,
} from '#/server/desk/exceptions.server';
import { type SyncDeps, syncMovementsCore } from '#/server/sync/sync-movements';
import { createTestEnv, type TestEnv } from '../support/test-env';

const SYNC_NOW = new Date('2026-03-01T12:00:00Z');
const WH = 'wh1';
const DEV = 'dev1';

let counter = 0;
const uuid = () =>
  `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

describe('exceptionDetailCore', () => {
  let env: TestEnv;
  let syncDeps: SyncDeps;

  beforeEach(async () => {
    counter = 0;
    env = await createTestEnv();
    await env.seedDevice({ id: DEV, warehouses: [WH] });
    await env.seedUser({ id: 'u1', username: 'u1', pin: '1234' });
    await env.seedProduct({ id: 'P1', sku: 'P1', countTolerance: 0 });
    await env.seedLocation(WH, { id: 'L1', code: 'L1' });
    const db = await env.warehouse(WH);
    syncDeps = {
      global: env.global,
      catalog: env.catalog,
      warehouseDb: () => db,
      now: () => SYNC_NOW,
      newId: uuid,
      clockSkewThresholdMs: 120_000,
      transferStuckHours: 100_000,
    };
  });
  afterEach(() => env.cleanup());

  const deps = (): ListExceptionsDeps => ({
    global: syncDeps.global,
    warehouseDb: syncDeps.warehouseDb,
    now: () => new Date(SYNC_NOW.getTime() + 3_600_000),
    transferStuckHours: 24,
  });

  const base = { warehouseId: WH, userId: 'u1', deviceId: DEV };

  async function send(movements: unknown[]) {
    const res = await syncMovementsCore(syncDeps, {
      deviceId: DEV,
      schemaVersion: SCHEMA_VERSIONS.warehouse,
      sentAt: SYNC_NOW.toISOString(),
      movements,
    });
    expect(res.status).toBe('ok');
  }

  async function detail(id: string) {
    const res = await exceptionDetailCore(deps(), WH, id);
    if (!res.ok) throw new Error(res.message);
    return res;
  }

  const adjustOf = (id: string, at: string, qty: number) => ({
    ...base,
    id,
    type: 'ADJUST',
    skuId: 'P1',
    occurredAt: at,
    locationId: 'L1',
    qty,
    reasonCode: 'FOUND',
  });

  it('shows the same movements in physical and arrival order', async () => {
    const adjust = uuid();
    const count = uuid();
    const pick = uuid();
    await send([
      adjustOf(adjust, '2026-03-01T09:00:00Z', 10),
      {
        ...base,
        id: count,
        type: 'COUNT',
        skuId: 'P1',
        occurredAt: '2026-03-01T10:30:00Z',
        locationId: 'L1',
        qty: 10,
      },
    ]);
    await send([
      {
        ...base,
        id: pick,
        type: 'PICK',
        skuId: 'P1',
        occurredAt: '2026-03-01T10:00:00Z',
        fromLocationId: 'L1',
        qty: 3,
      },
    ]);
    const db = await env.warehouse(WH);
    const ex = await db.exception.findFirstOrThrow({
      where: { type: 'LATE_MOVEMENT' },
    });
    const res = await detail(ex.id);
    expect(res.exception.type).toBe('LATE_MOVEMENT');
    expect(res.exception.status).toBe('OPEN');
    expect(res.missingMovementIds).toEqual([]);
    expect(res.bySeq.map((m) => m.id)).toEqual([adjust, count, pick]);
    expect(res.byOccurredAt.map((m) => m.id)).toEqual([adjust, pick, count]);
    const involved = Object.fromEntries(
      res.bySeq.map((m) => [m.id, m.involved]),
    );
    expect(involved[pick]).toBe(true);
    expect(involved[count]).toBe(true);
    expect(res.bySeq[0]?.occurredAt).toBe('2026-03-01T09:00:00.000Z');
    expect(typeof res.bySeq[0]?.receivedAt).toBe('string');
  });

  it('returns empty timelines for a keyless CLOCK_SKEW exception', async () => {
    const db = await env.warehouse(WH);
    await db.exception.create({
      data: {
        id: 'skew1',
        type: 'CLOCK_SKEW',
        movementIds: '[]',
        deviceId: DEV,
        details: JSON.stringify({ skewMs: 600_000 }),
      },
    });
    const res = await detail('skew1');
    expect(res.byOccurredAt).toEqual([]);
    expect(res.bySeq).toEqual([]);
    expect(res.missingMovementIds).toEqual([]);
    expect(res.exception.summary).toBe('clock +600 s');
  });

  it('lists unknown referenced movements and still returns the others', async () => {
    const adjust = uuid();
    await send([adjustOf(adjust, '2026-03-01T09:00:00Z', 5)]);
    const ghost = uuid();
    const db = await env.warehouse(WH);
    await db.exception.create({
      data: {
        id: 'ex-ghost',
        type: 'COUNT_VARIANCE',
        movementIds: JSON.stringify([adjust, ghost]),
        skuId: 'P1',
        locationId: 'L1',
        details: JSON.stringify({ observed: 4, expected: 5, variance: -1 }),
      },
    });
    const res = await detail('ex-ghost');
    expect(res.missingMovementIds).toEqual([ghost]);
    expect(res.bySeq.map((m) => m.id)).toEqual([adjust]);
    expect(res.bySeq[0]?.involved).toBe(true);
  });

  it('without a key the timeline is just the referenced movements', async () => {
    const a = uuid();
    const b = uuid();
    await send([
      adjustOf(a, '2026-03-01T09:00:00Z', 5),
      adjustOf(b, '2026-03-01T09:10:00Z', 1),
    ]);
    const db = await env.warehouse(WH);
    await db.exception.create({
      data: {
        id: 'nokey',
        type: 'CLOCK_SKEW',
        movementIds: JSON.stringify([b]),
        details: '{}',
      },
    });
    const res = await detail('nokey');
    expect(res.bySeq.map((m) => m.id)).toEqual([b]);
  });

  it('returns NOT_FOUND for an unknown exception id', async () => {
    const res = await exceptionDetailCore(deps(), WH, 'nope');
    expect(res).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('handleGetExceptionDetail rejects workers with 403 and anonymous with 401', async () => {
    const worker: SessionClaims = {
      userId: 'u1',
      deviceId: DEV,
      role: 'worker',
      exp: 0,
    };
    const input = { warehouseId: WH, exceptionId: 'x' };
    const denied = await handleGetExceptionDetail(worker, input, deps()).catch(
      (e) => e,
    );
    expect((denied as Response).status).toBe(403);
    const anon = await handleGetExceptionDetail(null, input, deps()).catch(
      (e) => e,
    );
    expect((anon as Response).status).toBe(401);
    const sup = await handleGetExceptionDetail(
      { ...worker, role: 'supervisor', deviceId: 'desk' },
      input,
      deps(),
    );
    expect(sup).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});
