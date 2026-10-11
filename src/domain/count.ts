import { balanceKeyString, movementDeltas } from './balance';
import type { ExceptionDraft, Movement } from './types';

export type CountOutcome =
  | { kind: 'none' }
  | { kind: 'auto_adjust'; adjust: Movement }
  | { kind: 'exception'; exception: ExceptionDraft };

function countKey(count: Movement): string {
  if (count.toLocationId === null) {
    throw new Error(`COUNT ${count.id} has no toLocationId`);
  }
  return balanceKeyString({
    skuId: count.skuId,
    locationId: count.toLocationId,
  });
}

function isOwnAdjust(m: Movement, countId: string): boolean {
  return m.type === 'ADJUST' && m.source === 'system' && m.ref === countId;
}

export type OrderKey = [number, number, string];

/**
 * Total order over a bin's ledger: (occurredAt, rank, id). Non-count movements
 * rank 0 (so ties sort before a count), COUNTs rank 1 ordered by id, and a
 * count's auto-adjusts take their count's key.
 */
export function orderKey(m: Movement, ledger: Movement[]): OrderKey {
  if (m.type === 'COUNT') return [m.occurredAt.getTime(), 1, m.id];
  if (m.type === 'ADJUST' && m.source === 'system' && m.ref !== null) {
    const owner = ledger.find((x) => x.type === 'COUNT' && x.id === m.ref);
    if (owner) return [owner.occurredAt.getTime(), 1, owner.id];
  }
  return [m.occurredAt.getTime(), 0, ''];
}

function compareKeys(a: OrderKey, b: OrderKey): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0;
}

export function isBefore(
  a: Movement,
  b: Movement,
  ledger: Movement[],
): boolean {
  return compareKeys(orderKey(a, ledger), orderKey(b, ledger)) < 0;
}

/**
 * Expected balance at the count's (sku, toLocationId): the sum of deltas of
 * every movement strictly before the count by orderKey. Equal-time non-count
 * movements are before the count. The count's own auto-adjusts are excluded;
 * earlier counts' auto-adjusts are included.
 */
export function expectedAt(binLedger: Movement[], count: Movement): number {
  const key = countKey(count);
  let sum = 0;
  for (const m of binLedger) {
    if (m.id === count.id || isOwnAdjust(m, count.id)) continue;
    if (!isBefore(m, count, binLedger)) continue;
    for (const d of movementDeltas(m)) {
      if (balanceKeyString(d) === key) sum += d.delta;
    }
  }
  return sum;
}

function autoAdjust(
  count: Movement,
  qty: number,
  newId: () => string,
): Movement {
  return {
    id: newId(),
    type: 'ADJUST',
    skuId: count.skuId,
    fromLocationId: null,
    toLocationId: count.toLocationId,
    qty,
    reasonCode: 'COUNT_AUTO',
    ref: count.id,
    counterpartWarehouseId: null,
    userId: count.userId,
    deviceId: count.deviceId,
    occurredAt: count.occurredAt,
    source: 'system',
  };
}

export function reconcileCount(
  count: Movement,
  binLedger: Movement[],
  tolerance: number,
  newId: () => string,
): CountOutcome {
  const expected = expectedAt(binLedger, count);
  const variance = count.qty - expected;
  if (variance === 0) return { kind: 'none' };
  if (Math.abs(variance) <= tolerance) {
    return { kind: 'auto_adjust', adjust: autoAdjust(count, variance, newId) };
  }
  return {
    kind: 'exception',
    exception: {
      type: 'COUNT_VARIANCE',
      movementIds: [count.id],
      skuId: count.skuId,
      locationId: count.toLocationId,
      deviceId: count.deviceId,
      details: { observed: count.qty, expected, variance, tolerance },
    },
  };
}

/**
 * Earliest COUNT (by orderKey) on a key `late` touches that `late` is strictly
 * before. `ledger` is the bin ledger; `late` may be a count's own auto-adjust
 * (ordered with its count, which must be in `ledger`). A non-count movement
 * tied in time with a count is before it.
 */
export function findAffectedCount(
  late: Movement,
  ledger: Movement[],
): Movement | null {
  const keys = new Set(movementDeltas(late).map(balanceKeyString));
  let best: Movement | null = null;
  for (const c of ledger) {
    if (c.type !== 'COUNT' || !keys.has(countKey(c))) continue;
    if (!isBefore(late, c, ledger)) continue;
    if (best === null || isBefore(c, best, ledger)) best = c;
  }
  return best;
}

export function correctForLateMovement(
  count: Movement,
  binLedgerIncludingLate: Movement[],
  tolerance: number,
  newId: () => string,
  lateId: string,
): CountOutcome {
  const expected = expectedAt(binLedgerIncludingLate, count);
  const totalAdjust = count.qty - expected;
  const existing = binLedgerIncludingLate
    .filter((m) => isOwnAdjust(m, count.id))
    .reduce((s, m) => s + m.qty, 0);
  const correction = totalAdjust - existing;
  if (correction === 0) return { kind: 'none' };
  if (Math.abs(totalAdjust) <= tolerance) {
    return {
      kind: 'auto_adjust',
      adjust: autoAdjust(count, correction, newId),
    };
  }
  return {
    kind: 'exception',
    exception: {
      type: 'LATE_MOVEMENT',
      movementIds: [count.id, lateId],
      skuId: count.skuId,
      locationId: count.toLocationId,
      deviceId: count.deviceId,
      details: {
        observed: count.qty,
        expected,
        existingAdjust: existing,
        correction,
      },
    },
  };
}
