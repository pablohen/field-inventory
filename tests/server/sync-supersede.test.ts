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

  it('leaves the exception open when the corrected variance is still over tolerance', async () => {
    const { db, open } = await setup();
    await send([lateMove(1)]);
    const after = await db.exception.findUniqueOrThrow({
      where: { id: open.id },
    });
    expect(after).toMatchObject({ status: 'OPEN', version: 1 });
    expect(await db.exception.count({ where: { type: 'LATE_MOVEMENT' } })).toBe(
      1,
    );
  });
});
