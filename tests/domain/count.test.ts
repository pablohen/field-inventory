import { describe, expect, it } from 'vitest';
import {
  correctForLateMovement,
  expectedAt,
  findAffectedCount,
  reconcileCount,
} from '#/domain/count';
import type { Movement } from '#/domain/types';

const at = (hhmm: string) => new Date(`2026-01-01T${hhmm}:00.000Z`);

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

const receipt = mv({
  id: 'r1',
  type: 'TRANSFER_IN',
  qty: 10,
  occurredAt: at('09:00'),
});
const count8 = mv({ id: 'c1', type: 'COUNT', qty: 8, occurredAt: at('10:00') });

function ids() {
  let n = 0;
  return () => `new${++n}`;
}

describe('reconcileCount', () => {
  it('auto-adjusts within tolerance', () => {
    const out = reconcileCount(count8, [receipt, count8], 5, ids());
    expect(out.kind).toBe('auto_adjust');
    if (out.kind !== 'auto_adjust') return;
    expect(out.adjust).toMatchObject({
      type: 'ADJUST',
      qty: -2,
      reasonCode: 'COUNT_AUTO',
      ref: 'c1',
      source: 'system',
      skuId: 'S1',
      toLocationId: 'A',
      fromLocationId: null,
      counterpartWarehouseId: null,
      userId: 'u1',
      deviceId: 'dev1',
      id: 'new1',
    });
    expect(out.adjust.occurredAt).toEqual(count8.occurredAt);
  });

  it('raises COUNT_VARIANCE beyond tolerance', () => {
    const out = reconcileCount(count8, [receipt, count8], 1, ids());
    expect(out.kind).toBe('exception');
    if (out.kind !== 'exception') return;
    expect(out.exception.type).toBe('COUNT_VARIANCE');
    expect(out.exception.movementIds).toEqual(['c1']);
    expect(out.exception.details).toMatchObject({
      observed: 8,
      expected: 10,
      variance: -2,
      tolerance: 1,
    });
  });

  it('returns none when count equals expected', () => {
    const c = { ...count8, qty: 10 };
    expect(reconcileCount(c, [receipt, c], 5, ids())).toEqual({ kind: 'none' });
  });

  it('treats a PICK tied with the count as before it', () => {
    const pick = mv({
      id: 'p1',
      type: 'PICK',
      fromLocationId: 'A',
      toLocationId: null,
      qty: 3,
      occurredAt: at('10:00'),
    });
    expect(expectedAt([receipt, pick], count8)).toBe(7);
  });
});

describe('expectedAt', () => {
  it("ignores this count's own auto-adjust but includes another count's", () => {
    const own = mv({
      id: 'a1',
      qty: -2,
      source: 'system',
      ref: 'c1',
      occurredAt: at('10:00'),
    });
    const other = mv({
      id: 'a0',
      qty: -1,
      source: 'system',
      ref: 'c0',
      occurredAt: at('09:30'),
    });
    expect(expectedAt([receipt, own], count8)).toBe(10);
    expect(expectedAt([receipt, other, own], count8)).toBe(9);
  });

  it('ignores other keys and later movements, counts MOVE sides', () => {
    const otherKey = mv({ id: 'x', type: 'TRANSFER_IN', toLocationId: 'B', qty: 99 });
    const later = mv({ id: 'y', type: 'TRANSFER_IN', qty: 99, occurredAt: at('10:01') });
    const moveOut = mv({
      id: 'mo',
      type: 'MOVE',
      fromLocationId: 'A',
      toLocationId: 'B',
      qty: 4,
      occurredAt: at('09:10'),
    });
    expect(expectedAt([receipt, otherKey, later, moveOut], count8)).toBe(6);
  });
});

describe('correctForLateMovement', () => {
  const adj = mv({
    id: 'a1',
    qty: -2,
    source: 'system',
    ref: 'c1',
    reasonCode: 'COUNT_AUTO',
    occurredAt: at('10:00'),
  });
  const latePick = mv({
    id: 'late1',
    type: 'PICK',
    fromLocationId: 'A',
    toLocationId: null,
    qty: 3,
    occurredAt: at('09:30'),
  });
  const ledger = [receipt, latePick, adj];

  it('emits an incremental auto-adjust within tolerance', () => {
    const out = correctForLateMovement(count8, ledger, 5, ids(), 'late1');
    expect(out.kind).toBe('auto_adjust');
    if (out.kind !== 'auto_adjust') return;
    expect(out.adjust.qty).toBe(3);
    expect(out.adjust.ref).toBe('c1');
  });

  it('raises LATE_MOVEMENT beyond tolerance', () => {
    const out = correctForLateMovement(count8, ledger, 0, ids(), 'late1');
    expect(out.kind).toBe('exception');
    if (out.kind !== 'exception') return;
    expect(out.exception.type).toBe('LATE_MOVEMENT');
    expect(out.exception.movementIds).toEqual(['c1', 'late1']);
    expect(out.exception.details).toMatchObject({
      observed: 8,
      expected: 7,
      existingAdjust: -2,
      correction: 3,
    });
  });

  it('returns none when already consistent', () => {
    const adj2 = { ...adj, qty: 1 };
    expect(
      correctForLateMovement(count8, [receipt, latePick, adj2], 5, ids(), 'late1'),
    ).toEqual({ kind: 'none' });
  });
});

describe('findAffectedCount', () => {
  const late = mv({
    id: 'late1',
    type: 'PICK',
    fromLocationId: 'A',
    toLocationId: null,
    occurredAt: at('09:30'),
  });
  it('picks the earliest later count and ignores earlier ones', () => {
    const before = mv({ id: 'c0', type: 'COUNT', occurredAt: at('09:00') });
    const c2 = mv({ id: 'c2', type: 'COUNT', occurredAt: at('11:00') });
    const c1 = mv({ id: 'c1', type: 'COUNT', occurredAt: at('10:00') });
    expect(findAffectedCount(late, [before, c2, c1])?.id).toBe('c1');
  });
  it('returns null when none apply (other key, equal time, non-COUNT)', () => {
    const otherKey = mv({ id: 'c3', type: 'COUNT', toLocationId: 'B', occurredAt: at('11:00') });
    const tie = mv({ id: 'c4', type: 'COUNT', occurredAt: at('09:30') });
    const notCount = mv({ id: 'm9', occurredAt: at('12:00') });
    expect(findAffectedCount(late, [otherKey, tie, notCount])).toBeNull();
  });
  it('breaks ties by id', () => {
    const b = mv({ id: 'b', type: 'COUNT', occurredAt: at('10:00') });
    const a = mv({ id: 'a', type: 'COUNT', occurredAt: at('10:00') });
    expect(findAffectedCount(late, [b, a])?.id).toBe('a');
  });
});
