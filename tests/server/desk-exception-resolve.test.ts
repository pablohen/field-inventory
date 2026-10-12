import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { movementDeltas } from '#/domain/balance';
import type { SessionClaims } from '#/server/auth/session';
import { SCHEMA_VERSIONS } from '#/server/db/migrate';
import {
  handleResolveException,
  type ResolveDeps,
  type ResolveInput,
  resolveExceptionCore,
  resolveInputSchema,
} from '#/server/desk/exceptions.server';
import type { DeskSession } from '#/server/desk/session';
import { type SyncDeps, syncMovementsCore } from '#/server/sync/sync-movements';
import { toDomain } from '#/server/sync/warehouse-repo';
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

describe('resolveExceptionCore', () => {
  let env: TestEnv;
  let syncDeps: SyncDeps;
  let deps: ResolveDeps;

  beforeEach(async () => {
    counter = 0;
    env = await createTestEnv();
    await env.seedDevice({ id: DEV, warehouses: [WH] });
    await env.seedUser({ id: 'u1', username: 'u1', pin: '1234' });
    await env.seedUser({
      id: 'sup1',
      username: 'sup1',
      pin: '1234',
      role: 'supervisor',
    });
    await env.seedProduct({ id: 'P1', sku: 'P1', countTolerance: 0 });
    await env.seedLocation(WH, { id: 'L1', code: 'L1' });
    await env.catalog.reasonCode.create({
      data: { code: 'FOUND', label: 'Found', appliesTo: '["ADJUST"]' },
    });
    await env.catalog.reasonCode.create({
      data: { code: 'DAMAGED', label: 'Damaged', appliesTo: '["PICK"]' },
    });
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
      now: () => NOW,
      newId: uuid,
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

  const pick = (qty: number, at = '2026-03-01T10:00:00Z') => ({
    ...base,
    id: uuid(),
    type: 'PICK',
    skuId: 'P1',
    occurredAt: at,
    fromLocationId: 'L1',
    qty,
  });

  /** Balance -3 at L1 plus an open NEGATIVE_BALANCE exception. */
  async function negativeException() {
    await send([pick(3)]);
    const db = await env.warehouse(WH);
    return db.exception.findFirstOrThrow({
      where: { type: 'NEGATIVE_BALANCE' },
    });
  }

  const balance = async () =>
    (
      await (
        await env.warehouse(WH)
      ).stockBalance.findUnique({
        where: { skuId_locationId: { skuId: 'P1', locationId: 'L1' } },
      })
    )?.qty;

  const adjust = (
    version: number,
    qty = 3,
  ): Extract<ResolveInput, { action: 'adjust' }> => ({
    action: 'adjust',
    version,
    qty,
    reasonCode: 'FOUND',
  });

  it('accepts', async () => {
    const ex = await negativeException();
    const res = await resolveExceptionCore(deps, session, WH, ex.id, {
      action: 'accept',
      version: ex.version,
    });
    expect(res).toMatchObject({ ok: true, version: ex.version + 1 });
    const after = await (await env.warehouse(WH)).exception.findUniqueOrThrow({
      where: { id: ex.id },
    });
    expect(after).toMatchObject({
      status: 'RESOLVED',
      resolution: 'ACCEPTED',
      version: ex.version + 1,
      resolvedBy: 'sup1',
      note: null,
    });
    expect(after.resolvedAt).toEqual(NOW);
  });

  it('adjusts through the ledger pipeline', async () => {
    const ex = await negativeException();
    expect(await balance()).toBe(-3);
    const res = await resolveExceptionCore(
      deps,
      session,
      WH,
      ex.id,
      adjust(ex.version),
    );
    if (!res.ok) throw new Error(res.message);
    expect(res.adjustmentId).toBeTruthy();
    const db = await env.warehouse(WH);
    const m = await db.movement.findUniqueOrThrow({
      where: { id: res.adjustmentId as string },
    });
    expect(m).toMatchObject({
      type: 'ADJUST',
      source: 'supervisor',
      deviceId: 'desk',
      userId: 'sup1',
      toLocationId: 'L1',
      fromLocationId: null,
      qty: 3,
      reasonCode: 'FOUND',
    });
    expect(await balance()).toBe(0);
    const after = await db.exception.findUniqueOrThrow({
      where: { id: ex.id },
    });
    expect(after.resolution).toBe('ADJUSTED');
  });

  it('recount creates an OPEN count task', async () => {
    const ex = await negativeException();
    const res = await resolveExceptionCore(deps, session, WH, ex.id, {
      action: 'recount',
      version: ex.version,
      assignedUserId: 'u1',
      note: 'check it',
    });
    if (!res.ok) throw new Error(res.message);
    const db = await env.warehouse(WH);
    const task = await db.countTask.findUniqueOrThrow({
      where: { id: res.countTaskId as string },
    });
    expect(JSON.parse(task.scope)).toEqual({
      locations: ['L1'],
      skus: ['P1'],
    });
    expect(task).toMatchObject({ status: 'OPEN', assignedUserId: 'u1' });
    const after = await db.exception.findUniqueOrThrow({
      where: { id: ex.id },
    });
    expect(after).toMatchObject({
      resolution: 'RECOUNT_REQUESTED',
      note: 'check it',
    });
  });

  it('recount with a non-worker assignee is INVALID and leaves the exception open', async () => {
    const ex = await negativeException();
    const res = await resolveExceptionCore(deps, session, WH, ex.id, {
      action: 'recount',
      version: ex.version,
      assignedUserId: 'sup1',
    });
    expect(res).toMatchObject({ ok: false, code: 'INVALID' });
    const res2 = await resolveExceptionCore(deps, session, WH, ex.id, {
      action: 'recount',
      version: ex.version,
      assignedUserId: 'nobody',
    });
    expect(res2).toMatchObject({ ok: false, code: 'INVALID' });
    const db = await env.warehouse(WH);
    expect(await db.countTask.count()).toBe(0);
    const after = await db.exception.findUniqueOrThrow({
      where: { id: ex.id },
    });
    expect(after).toMatchObject({ status: 'OPEN', version: ex.version });
  });

  it('dismiss requires a note', async () => {
    const ex = await negativeException();
    expect(
      resolveInputSchema.safeParse({ action: 'dismiss', version: 1 }).success,
    ).toBe(false);
    expect(
      resolveInputSchema.safeParse({
        action: 'adjust',
        version: 1,
        qty: 0,
        reasonCode: 'FOUND',
      }).success,
    ).toBe(false);
    const res = await resolveExceptionCore(deps, session, WH, ex.id, {
      action: 'dismiss',
      version: ex.version,
      note: 'noise',
    });
    expect(res.ok).toBe(true);
    const after = await (await env.warehouse(WH)).exception.findUniqueOrThrow({
      where: { id: ex.id },
    });
    expect(after).toMatchObject({ resolution: 'DISMISSED', note: 'noise' });
  });

  it('unknown or non-ADJUST reason code is INVALID and the exception stays open', async () => {
    const ex = await negativeException();
    for (const reasonCode of ['NOPE', 'DAMAGED']) {
      const res = await resolveExceptionCore(deps, session, WH, ex.id, {
        ...adjust(ex.version),
        reasonCode,
      });
      expect(res).toMatchObject({ ok: false, code: 'INVALID' });
    }
    const db = await env.warehouse(WH);
    const after = await db.exception.findUniqueOrThrow({
      where: { id: ex.id },
    });
    expect(after).toMatchObject({ status: 'OPEN', version: ex.version });
    expect(await db.movement.count({ where: { source: 'supervisor' } })).toBe(
      0,
    );
    expect(await balance()).toBe(-3);
  });

  it('unknown exception is NOT_FOUND; stale version is CONFLICT', async () => {
    const ex = await negativeException();
    expect(
      await resolveExceptionCore(deps, session, WH, 'missing', {
        action: 'accept',
        version: 1,
      }),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(
      await resolveExceptionCore(deps, session, WH, ex.id, {
        action: 'accept',
        version: ex.version + 5,
      }),
    ).toMatchObject({
      ok: false,
      code: 'CONFLICT',
      message: 'Resolved by someone else',
    });
    const after = await (await env.warehouse(WH)).exception.findUniqueOrThrow({
      where: { id: ex.id },
    });
    expect(after.status).toBe('OPEN');
  });

  it('a worker is forbidden (403)', async () => {
    const ex = await negativeException();
    const claims: SessionClaims = {
      userId: 'u1',
      role: 'worker',
      deviceId: DEV,
    } as SessionClaims;
    await expect(
      handleResolveException(
        claims,
        {
          warehouseId: WH,
          exceptionId: ex.id,
          input: { action: 'accept', version: ex.version },
        },
        deps,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      handleResolveException(
        null,
        {
          warehouseId: WH,
          exceptionId: ex.id,
          input: { action: 'accept', version: ex.version },
        },
        deps,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('Review Focus 1: concurrent same-version adjusts yield one ok, one CONFLICT, one movement', async () => {
    const ex = await negativeException();
    const results = await Promise.all([
      resolveExceptionCore(deps, session, WH, ex.id, adjust(ex.version)),
      resolveExceptionCore(deps, session, WH, ex.id, adjust(ex.version)),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === 'CONFLICT')).toHaveLength(
      1,
    );
    const db = await env.warehouse(WH);
    expect(await db.movement.count({ where: { source: 'supervisor' } })).toBe(
      1,
    );
    expect(await balance()).toBe(0);
  });

  it('Review Focus 2: concurrent adjust and handheld PICK keep balance equal to the ledger', async () => {
    const ex = await negativeException();
    const [resolved, synced] = await Promise.all([
      resolveExceptionCore(deps, session, WH, ex.id, adjust(ex.version, 2)),
      syncMovementsCore(syncDeps, {
        deviceId: DEV,
        schemaVersion: SCHEMA_VERSIONS.warehouse,
        sentAt: NOW.toISOString(),
        movements: [pick(1, '2026-03-01T11:00:00Z')],
      }),
    ]);
    expect(resolved.ok).toBe(true);
    expect(synced.status).toBe('ok');
    if (synced.status === 'ok') {
      expect(synced.results[0]?.status).toBe('accepted');
    }
    const db = await env.warehouse(WH);
    const rows = await db.movement.findMany({
      where: { skuId: 'P1' },
      orderBy: { seq: 'asc' },
    });
    let sum = 0;
    for (const r of rows) {
      for (const d of movementDeltas(toDomain(r))) {
        if (d.skuId === 'P1' && d.locationId === 'L1') sum += d.delta;
      }
    }
    expect(await balance()).toBe(sum);
    expect(sum).toBe(-2);
  });
});
