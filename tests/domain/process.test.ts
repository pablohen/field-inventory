import { describe, expect, it } from 'vitest';
import { balanceKeyString, computeBalances } from '#/domain/balance';
import type { Effects, ProcessContext } from '#/domain/process';
import { processMovement } from '#/domain/process';
import type { Movement } from '#/domain/types';

const at = (hhmm: string) => new Date(`2026-01-01T${hhmm}:00.000Z`);
const KEY = balanceKeyString({ skuId: 'S1', locationId: 'A' });

function mv(over: Partial<Movement>): Movement {
  return {
    id: 'm1',
    type: 'ADJUST',
    skuId: 'S1',
    fromLocationId: null,
    toLocationId: 'A',
    qty: 1,
    reasonCode: null,
    ref: null,
    counterpartWarehouseId: null,
    userId: 'u1',
    deviceId: 'dev1',
    occurredAt: at('10:00'),
    source: 'device',
    ...over,
  };
}

function idGen() {
  let n = 0;
  return () => `new${++n}`;
}

function ctxFor(
  ledger: Movement[],
  over: Partial<ProcessContext> = {},
): ProcessContext {
  return {
    balances: computeBalances(ledger),
    binLedgers: new Map([[KEY, ledger]]),
    openNegativeKeys: new Set(),
    tolerance: 5,
    pickLine: null,
    pickedBefore: 0,
    ...over,
  };
}

const netOn = (e: Effects, key: string) =>
  e.balanceDeltas
    .filter((d) => balanceKeyString(d) === key)
    .reduce((s, d) => s + d.delta, 0);

const receipt = mv({
  id: 'r1',
  type: 'TRANSFER_IN',
  qty: 10,
  occurredAt: at('08:00'),
});
const pick = (over: Partial<Movement> = {}) =>
  mv({
    id: 'p1',
    type: 'PICK',
    fromLocationId: 'A',
    toLocationId: null,
    qty: 3,
    occurredAt: at('11:00'),
    ...over,
  });

describe('processMovement', () => {
  it('raises NEGATIVE_BALANCE for a PICK below zero', () => {
    const e = processMovement(pick({ qty: 4 }), ctxFor([]), idGen());
    expect(e.movements).toHaveLength(1);
    expect(e.exceptions.map((x) => x.type)).toEqual(['NEGATIVE_BALANCE']);
    expect(netOn(e, KEY)).toBe(-4);
  });

  it('does not re-raise an already open negative key', () => {
    const e = processMovement(
      pick(),
      ctxFor([], { openNegativeKeys: new Set([KEY]) }),
      idGen(),
    );
    expect(e.exceptions).toEqual([]);
  });

  it('auto-adjusts a COUNT within tolerance', () => {
    const count = mv({
      id: 'c1',
      type: 'COUNT',
      qty: 8,
      occurredAt: at('10:00'),
    });
    const e = processMovement(count, ctxFor([receipt, count]), idGen());
    expect(e.movements).toHaveLength(2);
    expect(e.movements[1]).toMatchObject({
      type: 'ADJUST',
      qty: -2,
      ref: 'c1',
    });
    expect(e.balanceDeltas).toEqual([
      { skuId: 'S1', locationId: 'A', delta: -2 },
    ]);
    expect(e.exceptions).toEqual([]);
  });

  it('raises COUNT_VARIANCE beyond tolerance', () => {
    const count = mv({
      id: 'c1',
      type: 'COUNT',
      qty: 1,
      occurredAt: at('10:00'),
    });
    const e = processMovement(
      count,
      ctxFor([receipt], { tolerance: 2 }),
      idGen(),
    );
    expect(e.movements).toHaveLength(1);
    expect(e.exceptions.map((x) => x.type)).toEqual(['COUNT_VARIANCE']);
  });

  describe('late PICK before an adjusted count', () => {
    const count = mv({
      id: 'c1',
      type: 'COUNT',
      qty: 4,
      occurredAt: at('10:00'),
    });
    const adj = mv({
      id: 'a1',
      qty: -6,
      ref: 'c1',
      reasonCode: 'COUNT_AUTO',
      source: 'system',
      occurredAt: at('10:00'),
    });
    const late = pick({ occurredAt: at('09:00') });

    it('within tolerance: corrects with a compensating adjust', () => {
      const e = processMovement(late, ctxFor([receipt, count, adj]), idGen());
      expect(e.movements).toHaveLength(2);
      expect(e.movements[1]).toMatchObject({
        type: 'ADJUST',
        qty: 3,
        ref: 'c1',
      });
      expect(netOn(e, KEY)).toBe(0);
      expect(e.exceptions).toEqual([]);
    });

    it('beyond tolerance: LATE_MOVEMENT, delta stays -3', () => {
      const e = processMovement(
        late,
        ctxFor([receipt, count, adj], { tolerance: 2 }),
        idGen(),
      );
      expect(e.movements).toHaveLength(1);
      expect(e.exceptions.map((x) => x.type)).toEqual(['LATE_MOVEMENT']);
      expect(netOn(e, KEY)).toBe(-3);
    });
  });

  describe('transient negative netted out by the cascade', () => {
    const count0 = mv({
      id: 'c1',
      type: 'COUNT',
      qty: 0,
      occurredAt: at('10:00'),
    });
    const adj0 = mv({
      id: 'a1',
      qty: -10,
      ref: 'c1',
      reasonCode: 'COUNT_AUTO',
      source: 'system',
      occurredAt: at('10:00'),
    });
    const ledger = [receipt, count0, adj0];

    it('a fully compensated late PICK raises no NEGATIVE_BALANCE', () => {
      const e = processMovement(
        pick({ qty: 10, occurredAt: at('09:00') }),
        ctxFor(ledger),
        idGen(),
      );
      expect(e.movements).toHaveLength(2);
      expect(netOn(e, KEY)).toBe(0);
      expect(e.exceptions).toEqual([]);
    });

    it('a plain PICK below zero still raises exactly one', () => {
      const e = processMovement(
        pick({ qty: 4, occurredAt: at('09:00') }),
        ctxFor([receipt, pick({ id: 'p0', qty: 8, occurredAt: at('08:30') })]),
        idGen(),
      );
      expect(e.exceptions.map((x) => x.type)).toEqual(['NEGATIVE_BALANCE']);
      expect(e.exceptions[0]).toMatchObject({
        movementIds: ['p1'],
        details: { before: 2, after: -2 },
      });
    });
  });

  it('lists a count whose late-movement correction is within tolerance as superseded', () => {
    const count = mv({
      id: 'c1',
      type: 'COUNT',
      qty: 4,
      occurredAt: at('10:00'),
    });
    const first = processMovement(
      count,
      ctxFor([receipt], { tolerance: 2 }),
      idGen(),
    );
    expect(first.exceptions.map((x) => x.type)).toEqual(['COUNT_VARIANCE']);
    expect(first.supersededCountIds).toEqual([]);
    const late = mv({
      id: 'late1',
      type: 'MOVE',
      fromLocationId: 'A',
      toLocationId: 'B',
      qty: 6,
      occurredAt: at('09:30'),
    });
    const e = processMovement(
      late,
      ctxFor([receipt, count], { tolerance: 2 }),
      idGen(),
    );
    expect(e.supersededCountIds).toEqual(['c1']);
    expect(e.exceptions).toEqual([]);
  });

  it('raises OVER_PICK', () => {
    const e = processMovement(
      pick({ qty: 3 }),
      ctxFor([receipt], {
        pickLine: { id: 'l1', qtyRequested: 4 },
        pickedBefore: 2,
      }),
      idGen(),
    );
    expect(e.exceptions.map((x) => x.type)).toEqual(['OVER_PICK']);
  });

  it('I2: earlier COUNT arriving after a later adjusted COUNT converges', () => {
    const cLate = mv({
      id: 'cL',
      type: 'COUNT',
      qty: 6,
      occurredAt: at('10:00'),
    });
    const aLate = mv({
      id: 'aL',
      qty: -4,
      ref: 'cL',
      reasonCode: 'COUNT_AUTO',
      source: 'system',
      occurredAt: at('10:00'),
    });
    const cEarly = mv({
      id: 'cE',
      type: 'COUNT',
      qty: 7,
      occurredAt: at('09:00'),
    });
    const ledger = [receipt, cLate, aLate];
    const e = processMovement(
      cEarly,
      ctxFor(ledger, { tolerance: Infinity }),
      idGen(),
    );
    expect(e.movements).toHaveLength(3);
    expect(e.movements[1]).toMatchObject({ ref: 'cE', qty: -3 });
    expect(e.movements[2]).toMatchObject({ ref: 'cL' });
    expect(e.exceptions).toEqual([]);
    const final = computeBalances([...ledger, ...e.movements]).get(KEY);
    expect(final).toBe(6);
  });
});
