import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSIONS } from '#/server/db/migrate';
import {
  type ResolveDeps,
  resolveExceptionCore,
} from '#/server/desk/exceptions.server';
import type { DeskSession } from '#/server/desk/session';
import { type SyncDeps, syncMovementsCore } from '#/server/sync/sync-movements';
import { createTestEnv, type TestEnv } from '../support/test-env';

const NOW = new Date('2026-03-01T12:00:00Z');
const WH = 'wh1';
const DEV = 'dev1';

let counter = 0;
const uuid = () =>
  `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

const session: DeskSession = {
  userId: 'sup1',
  role: 'supervisor',
  deviceId: 'desk',
} as DeskSession;

describe('late movement supersedes a stale count exception', () => {
  let env: TestEnv;
  let syncDeps: SyncDeps;
  let resolveDeps: ResolveDeps;

  beforeEach(async () => {
    counter = 0;
    env = await createTestEnv();
    await env.seedDevice({ id: DEV, warehouses: [WH] });
    await env.seedUser({ id: 'u1', username: 'u1', pin: '1234' });
    await env.seedProduct({ id: 'P1', sku: 'P1', countTolerance: 2 });
    await env.seedLocation(WH, { id: 'L1', code: 'L1' });
    await env.seedLocation(WH, { id: 'L2', code: 'L2' });
    await env.seedLocation(WH, { id: 'L3', code: 'L3' });
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
    resolveDeps = {
      global: env.global,
      catalog: env.catalog,
      warehouseDb: () => db,
      now: () => NOW,
      newId: uuid,
    };
  });
  afterEach(() => env.cleanup());

  const base = { warehouseId: WH, userId: 'u1', deviceId: DEV, skuId: 'P1' };

  async function send(movements: unknown[]) {
    const res = await syncMovementsCore(syncDeps, {
      deviceId: DEV,
      schemaVersion: SCHEMA_VERSIONS.warehouse,
      sentAt: NOW.toISOString(),
      movements,
    });
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      for (const r of res.results) expect(r.status).toBe('accepted');
    }
  }

  async function setup() {
    await send([
      {
        ...base,
        id: uuid(),
        type: 'ADJUST',
        occurredAt: '2026-03-01T00:00:00Z',
        locationId: 'L1',
        qty: 10,
        reasonCode: 'INITIAL',
      },
    ]);
    const count = {
      ...base,
      id: uuid(),
      type: 'COUNT',
      occurredAt: '2026-03-01T10:30:00Z',
      locationId: 'L1',
      qty: 4,
    };
    await send([count]);
    const db = await env.warehouse(WH);
    const open = await db.exception.findFirstOrThrow({
      where: { type: 'COUNT_VARIANCE' },
    });
    expect(open).toMatchObject({ status: 'OPEN', version: 1 });
    return { db, open, count };
  }

  const lateMove = (qty: number) => ({
    ...base,
    id: uuid(),
    type: 'MOVE',
    occurredAt: '2026-03-01T10:00:00Z',
    fromLocationId: 'L1',
    toLocationId: 'L2',
    qty,
  });

  it('resolves the open COUNT_VARIANCE in the same sync and blocks a stale desk resolve', async () => {
    const { db, open } = await setup();
    await send([lateMove(6)]);

    const after = await db.exception.findUniqueOrThrow({
      where: { id: open.id },
    });
    expect(after).toMatchObject({
      status: 'RESOLVED',
      resolution: 'SUPERSEDED',
      resolvedBy: 'system',
      version: 2,
      note: 'A later-arriving movement made this count consistent',
    });
    expect(after.resolvedAt).not.toBeNull();

    const res = await resolveExceptionCore(resolveDeps, session, WH, open.id, {
      action: 'accept',
      version: 1,
    });
    expect(res).toMatchObject({ ok: false, code: 'CONFLICT' });
  });

  it('replaces the exception with one LATE_MOVEMENT when the corrected variance is still over tolerance (D2)', async () => {
    const { db, open } = await setup();
    await send([lateMove(1)]);
    const after = await db.exception.findUniqueOrThrow({
      where: { id: open.id },
    });
    expect(after).toMatchObject({
      status: 'RESOLVED',
      resolution: 'SUPERSEDED',
      version: 2,
    });
    const openRows = await db.exception.findMany({
      where: {
        status: 'OPEN',
        type: { in: ['COUNT_VARIANCE', 'LATE_MOVEMENT'] },
      },
    });
    expect(openRows.map((e) => e.type)).toEqual(['LATE_MOVEMENT']);
  });

  it('supersedes an open LATE_MOVEMENT when a second late movement makes the count consistent', async () => {
    const { db } = await setup();
    await send([lateMove(1)]);
    const lm = await db.exception.findFirstOrThrow({
      where: { type: 'LATE_MOVEMENT', status: 'OPEN' },
    });
    await send([{ ...lateMove(5), occurredAt: '2026-03-01T10:05:00Z' }]);
    const after = await db.exception.findUniqueOrThrow({
      where: { id: lm.id },
    });
    expect(after).toMatchObject({
      status: 'RESOLVED',
      resolution: 'SUPERSEDED',
      resolvedBy: 'system',
      version: lm.version + 1,
    });
    expect(await db.exception.count({ where: { status: 'OPEN' } })).toBe(0);
  });

  it('leaves an already-RESOLVED exception untouched', async () => {
    const { db, open } = await setup();
    const res = await resolveExceptionCore(resolveDeps, session, WH, open.id, {
      action: 'accept',
      version: 1,
    });
    expect(res.ok).toBe(true);
    const resolved = await db.exception.findUniqueOrThrow({
      where: { id: open.id },
    });
    expect(resolved.status).toBe('RESOLVED');
    await send([lateMove(6)]);
    const after = await db.exception.findUniqueOrThrow({
      where: { id: open.id },
    });
    expect(after.version).toBe(resolved.version);
    expect(after.resolution).toBe(resolved.resolution);
    expect(after.resolvedBy).toBe(resolved.resolvedBy);
    expect(after.resolution).not.toBe('SUPERSEDED');
  });

  it('matches count ids exactly: superseding c1 leaves c10 open', async () => {
    const c1 = '00000000-0000-4000-8000-0000000000c1';
    const c10 = '00000000-0000-4000-8000-000000000c10';
    await send([
      {
        ...base,
        id: uuid(),
        type: 'ADJUST',
        occurredAt: '2026-03-01T00:00:00Z',
        locationId: 'L1',
        qty: 10,
        reasonCode: 'INITIAL',
      },
    ]);
    await send([
      {
        ...base,
        id: c1,
        type: 'COUNT',
        occurredAt: '2026-03-01T10:30:00Z',
        locationId: 'L1',
        qty: 4,
      },
      {
        ...base,
        id: c10,
        type: 'COUNT',
        occurredAt: '2026-03-01T10:30:00Z',
        locationId: 'L2',
        qty: 5,
      },
    ]);
    const db = await env.warehouse(WH);
    expect(await db.exception.count({ where: { status: 'OPEN' } })).toBe(2);
    // Moves to L3, so only c1's bin is affected.
    await send([{ ...lateMove(6), toLocationId: 'L3' }]);
    const rows = await db.exception.findMany({ orderBy: { createdAt: 'asc' } });
    const byCount = (id: string) =>
      rows.find((e) => (JSON.parse(e.movementIds) as string[])[0] === id);
    expect(byCount(c1)).toMatchObject({
      status: 'RESOLVED',
      resolution: 'SUPERSEDED',
    });
    expect(byCount(c10)).toMatchObject({ status: 'OPEN', version: 1 });
  });

  it('cascades: a late movement whose auto-adjust corrects a later count supersedes both', async () => {
    await send([
      {
        ...base,
        id: uuid(),
        type: 'ADJUST',
        occurredAt: '2026-03-01T00:00:00Z',
        locationId: 'L1',
        qty: 10,
        reasonCode: 'INITIAL',
      },
    ]);
    for (const [at, id] of [
      ['10:30', uuid()],
      ['11:00', uuid()],
    ] as const) {
      await send([
        {
          ...base,
          id,
          type: 'COUNT',
          occurredAt: `2026-03-01T${at}:00Z`,
          locationId: 'L1',
          qty: 4,
        },
      ]);
    }
    const db = await env.warehouse(WH);
    expect(
      await db.exception.count({
        where: { type: 'COUNT_VARIANCE', status: 'OPEN' },
      }),
    ).toBe(2);
    // Expected at the first count becomes 3 (variance +1, auto-adjusted), which
    // in turn makes the second count consistent.
    await send([lateMove(7)]);
    const rows = await db.exception.findMany();
    expect(rows).toHaveLength(2);
    for (const e of rows) {
      expect(e).toMatchObject({ status: 'RESOLVED', resolution: 'SUPERSEDED' });
    }
  });
});
