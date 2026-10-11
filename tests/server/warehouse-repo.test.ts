import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Effects } from '#/domain/process';
import type { Movement } from '#/domain/types';
import type { WarehouseClient } from '#/server/db/clients';
import {
  loadContext,
  persistEffects,
  withMovementTx,
} from '#/server/sync/warehouse-repo';
import { createTestEnv, type TestEnv } from '../support/test-env';

const WH = 'wh1';

function mv(over: Partial<Movement> & Pick<Movement, 'id' | 'type'>): Movement {
  return {
    skuId: 'P1',
    fromLocationId: null,
    toLocationId: null,
    qty: 0,
    reasonCode: null,
    ref: null,
    counterpartWarehouseId: null,
    userId: 'u1',
    deviceId: 'd1',
    occurredAt: new Date('2026-01-01T10:00:00Z'),
    source: 'device',
    ...over,
  };
}

describe('warehouse repository', () => {
  let env: TestEnv;
  let db: WarehouseClient;

  beforeEach(async () => {
    env = await createTestEnv();
    await env.seedWarehouse(WH);
    db = await env.warehouse(WH);
    await env.seedLocation(WH, { id: 'L1', code: 'L1' });
    await env.seedLocation(WH, { id: 'L2', code: 'L2' });
  });
  afterEach(() => env.cleanup());

  const adjust = mv({
    id: 'a1',
    type: 'ADJUST',
    toLocationId: 'L1',
    qty: 10,
  });
  const count = mv({
    id: 'c1',
    type: 'COUNT',
    toLocationId: 'L1',
    qty: 9,
    occurredAt: new Date('2026-01-01T11:00:00Z'),
  });

  async function apply(m: Movement) {
    await withMovementTx(db, async (tx) => {
      await persistEffects(tx, {
        movements: [m],
        balanceDeltas: [],
        exceptions: [],
      });
    });
  }

  it('loads balances, tolerance and ledger for a COUNT', async () => {
    await env.seedProduct({ id: 'P1', sku: 'P1', countTolerance: 2 });
    await withMovementTx(db, (tx) =>
      persistEffects(tx, {
        movements: [adjust],
        balanceDeltas: [{ skuId: 'P1', locationId: 'L1', delta: 10 }],
        exceptions: [],
      }),
    );
    const ctx = await withMovementTx(db, (tx) =>
      loadContext(tx, env.catalog, count),
    );
    expect(ctx.balances.get('P1|L1')).toBe(10);
    expect(ctx.tolerance).toBe(2);
    const ledger = ctx.binLedgers.get('P1|L1') ?? [];
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.occurredAt).toBeInstanceOf(Date);
    expect(ledger[0]?.id).toBe('a1');
    expect(ctx.openNegativeKeys.size).toBe(0);
    expect(ctx.pickLine).toBeNull();
    expect(ctx.pickedBefore).toBe(0);
  });

  it('persists a COUNT with an auto-adjust and updates the balance', async () => {
    await withMovementTx(db, (tx) =>
      persistEffects(tx, {
        movements: [adjust],
        balanceDeltas: [{ skuId: 'P1', locationId: 'L1', delta: 10 }],
        exceptions: [],
      }),
    );
    const sysAdjust = mv({
      id: 'sys1',
      type: 'ADJUST',
      toLocationId: 'L1',
      qty: -1,
      source: 'system',
      occurredAt: count.occurredAt,
    });
    const effects: Effects = {
      movements: [count, sysAdjust],
      balanceDeltas: [{ skuId: 'P1', locationId: 'L1', delta: -1 }],
      exceptions: [
        {
          type: 'COUNT_VARIANCE',
          movementIds: ['c1'],
          skuId: 'P1',
          locationId: 'L1',
          deviceId: 'd1',
          details: { variance: -1 },
        },
      ],
    };
    await withMovementTx(db, (tx) => persistEffects(tx, effects));

    const bal = await db.stockBalance.findUnique({
      where: { skuId_locationId: { skuId: 'P1', locationId: 'L1' } },
    });
    expect(bal?.qty).toBe(9);
    const rows = await db.movement.findMany({ orderBy: { seq: 'asc' } });
    expect(rows.map((r) => r.id)).toEqual(['a1', 'c1', 'sys1']);
    expect(rows[2]?.source).toBe('system');
    const [ex] = await db.exception.findMany();
    expect(ex?.status).toBe('OPEN');
    expect(JSON.parse(ex?.movementIds ?? '')).toEqual(['c1']);
    expect(JSON.parse(ex?.details ?? '')).toEqual({ variance: -1 });
  });

  it('creates a balance row when missing', async () => {
    await withMovementTx(db, (tx) =>
      persistEffects(tx, {
        movements: [],
        balanceDeltas: [{ skuId: 'P1', locationId: 'L2', delta: -3 }],
        exceptions: [],
      }),
    );
    const bal = await db.stockBalance.findMany();
    expect(bal).toEqual([{ skuId: 'P1', locationId: 'L2', qty: -3 }]);
  });

  it('falls back to the category tolerance, then 0', async () => {
    await env.seedProduct({ id: 'P1', sku: 'P1', categoryTolerance: 4 });
    await env.seedProduct({ id: 'P2', sku: 'P2' });
    const ctx = await withMovementTx(db, (tx) =>
      loadContext(tx, env.catalog, count),
    );
    expect(ctx.tolerance).toBe(4);
    const ctx2 = await withMovementTx(db, (tx) =>
      loadContext(tx, env.catalog, { ...count, skuId: 'P2' }),
    );
    expect(ctx2.tolerance).toBe(0);
    const ctx3 = await withMovementTx(db, (tx) =>
      loadContext(tx, env.catalog, { ...count, skuId: 'nope' }),
    );
    expect(ctx3.tolerance).toBe(0);
  });

  it('loads open negative keys and ledgers of both move endpoints', async () => {
    await apply(adjust);
    await db.exception.create({
      data: {
        id: 'e1',
        type: 'NEGATIVE_BALANCE',
        movementIds: '[]',
        skuId: 'P1',
        locationId: 'L2',
        details: '{}',
      },
    });
    await db.exception.create({
      data: {
        id: 'e2',
        type: 'NEGATIVE_BALANCE',
        status: 'RESOLVED',
        movementIds: '[]',
        skuId: 'P1',
        locationId: 'L1',
        details: '{}',
      },
    });
    const move = mv({
      id: 'm1',
      type: 'MOVE',
      fromLocationId: 'L1',
      toLocationId: 'L2',
      qty: 2,
    });
    const ctx = await withMovementTx(db, (tx) =>
      loadContext(tx, env.catalog, move),
    );
    expect([...ctx.openNegativeKeys]).toEqual(['P1|L2']);
    expect(ctx.balances.get('P1|L2')).toBe(0);
    expect(ctx.balances.has('P1|L1')).toBe(true);
    expect(ctx.binLedgers.get('P1|L1')?.map((x) => x.id)).toEqual(['a1']);
    expect(ctx.binLedgers.get('P1|L2')).toEqual([]);
  });

  it('loads the pick line and prior picked quantity', async () => {
    await env.seedPickLine(WH, {
      id: 'line1',
      skuId: 'P1',
      locationId: 'L1',
      qtyRequested: 5,
    });
    await apply(
      mv({
        id: 'p1',
        type: 'PICK',
        fromLocationId: 'L1',
        qty: 3,
        ref: 'line1',
      }),
    );
    await apply(
      mv({
        id: 'p2',
        type: 'PICK',
        fromLocationId: 'L1',
        qty: 1,
        ref: 'other',
      }),
    );
    const pick = mv({
      id: 'p3',
      type: 'PICK',
      fromLocationId: 'L1',
      qty: 2,
      ref: 'line1',
    });
    const ctx = await withMovementTx(db, (tx) =>
      loadContext(tx, env.catalog, pick),
    );
    expect(ctx.pickLine).toEqual({ id: 'line1', qtyRequested: 5 });
    expect(ctx.pickedBefore).toBe(3);

    const noMatch = await withMovementTx(db, (tx) =>
      loadContext(tx, env.catalog, { ...pick, ref: 'other' }),
    );
    expect(noMatch.pickLine).toBeNull();
    expect(noMatch.pickedBefore).toBe(0);
  });
});
