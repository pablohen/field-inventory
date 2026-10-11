import { describe, expect, it } from 'vitest';
import {
  balanceKeyString,
  computeBalances,
  detectNegative,
  movementDeltas,
} from '#/domain/balance';
import type { Movement } from '#/domain/types';

function mv(over: Partial<Movement>): Movement {
  return {
    id: 'm1',
    type: 'PICK',
    skuId: 'S1',
    fromLocationId: null,
    toLocationId: null,
    qty: 1,
    reasonCode: null,
    ref: null,
    counterpartWarehouseId: null,
    userId: 'u1',
    deviceId: 'dev1',
    occurredAt: new Date('2026-10-11T10:00:00.000Z'),
    source: 'device',
    ...over,
  };
}

describe('movementDeltas', () => {
  it('PICK subtracts at from', () => {
    expect(
      movementDeltas(mv({ type: 'PICK', fromLocationId: 'A', qty: 3 })),
    ).toEqual([{ skuId: 'S1', locationId: 'A', delta: -3 }]);
  });
  it('TRANSFER_OUT subtracts at from', () => {
    expect(
      movementDeltas(mv({ type: 'TRANSFER_OUT', fromLocationId: 'A', qty: 4 })),
    ).toEqual([{ skuId: 'S1', locationId: 'A', delta: -4 }]);
  });
  it('TRANSFER_IN adds at to', () => {
    expect(
      movementDeltas(mv({ type: 'TRANSFER_IN', toLocationId: 'B', qty: 4 })),
    ).toEqual([{ skuId: 'S1', locationId: 'B', delta: 4 }]);
  });
  it('MOVE subtracts from and adds to', () => {
    expect(
      movementDeltas(
        mv({ type: 'MOVE', fromLocationId: 'A', toLocationId: 'B', qty: 5 }),
      ),
    ).toEqual([
      { skuId: 'S1', locationId: 'A', delta: -5 },
      { skuId: 'S1', locationId: 'B', delta: 5 },
    ]);
  });
  it('ADJUST applies signed qty at to', () => {
    expect(
      movementDeltas(mv({ type: 'ADJUST', toLocationId: 'A', qty: -2 })),
    ).toEqual([{ skuId: 'S1', locationId: 'A', delta: -2 }]);
  });
  it('COUNT has no deltas', () => {
    expect(
      movementDeltas(mv({ type: 'COUNT', toLocationId: 'A', qty: 9 })),
    ).toEqual([]);
  });
});

describe('balanceKeyString', () => {
  it('joins sku and location', () => {
    expect(balanceKeyString({ skuId: 'S1', locationId: 'A' })).toBe('S1|A');
  });
});

describe('computeBalances', () => {
  it('MOVE 5 A->B after ADJUST +3 at A gives A:-2, B:5', () => {
    const b = computeBalances([
      mv({ id: 'a', type: 'ADJUST', toLocationId: 'A', qty: 3 }),
      mv({
        id: 'b',
        type: 'MOVE',
        fromLocationId: 'A',
        toLocationId: 'B',
        qty: 5,
      }),
    ]);
    expect(b.get('S1|A')).toBe(-2);
    expect(b.get('S1|B')).toBe(5);
  });
});

describe('detectNegative', () => {
  const pick = mv({ id: 'p1', type: 'PICK', fromLocationId: 'A', qty: 3 });

  it('raises NEGATIVE_BALANCE when balance goes below zero', () => {
    expect(detectNegative(pick, new Map([['S1|A', 2]]), new Set())).toEqual([
      {
        type: 'NEGATIVE_BALANCE',
        movementIds: ['p1'],
        skuId: 'S1',
        locationId: 'A',
        deviceId: 'dev1',
        details: { before: 2, after: -1 },
      },
    ]);
  });
  it('treats a missing key as 0', () => {
    const [d] = detectNegative(pick, new Map(), new Set());
    expect(d?.details).toEqual({ before: 0, after: -3 });
  });
  it('suppresses when key already open', () => {
    expect(
      detectNegative(pick, new Map([['S1|A', 2]]), new Set(['S1|A'])),
    ).toEqual([]);
  });
  it('no draft when balance stays non-negative', () => {
    expect(detectNegative(pick, new Map([['S1|A', 5]]), new Set())).toEqual([]);
  });
  it('aggregates repeated keys within one movement', () => {
    const m = mv({
      type: 'MOVE',
      fromLocationId: 'A',
      toLocationId: 'A',
      qty: 3,
    });
    expect(detectNegative(m, new Map([['S1|A', 0]]), new Set())).toEqual([]);
  });
});
