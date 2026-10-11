import { balanceKeyString, movementDeltas } from './balance';
import type { ExceptionDraft, Movement } from './types';

export type CountOutcome =
  | { kind: 'none' }
  | { kind: 'auto_adjust'; adjust: Movement }
  | { kind: 'exception'; exception: ExceptionDraft };

function countKey(count: Movement): string {
  return balanceKeyString({
    skuId: count.skuId,
    locationId: count.toLocationId ?? '',
  });
}

function isOwnAdjust(m: Movement, countId: string): boolean {
  return m.type === 'ADJUST' && m.source === 'system' && m.ref === countId;
}

/**
 * Expected balance at the count's (sku, toLocationId) as of count.occurredAt.
 * Ties on occurredAt count as before the count. The count's own auto-adjusts
 * are excluded; other counts' auto-adjusts are included.
 */
export function expectedAt(binLedger: Movement[], count: Movement): number {
  const key = countKey(count);
  const t = count.occurredAt.getTime();
  let sum = 0;
  for (const m of binLedger) {
    if (m.occurredAt.getTime() > t || isOwnAdjust(m, count.id)) continue;
    for (const d of movementDeltas(m)) {
      if (balanceKeyString(d) === key) sum += d.delta;
    }
  }
  return sum;
}

function autoAdjust(count: Movement, qty: number, newId: () => string): Movement {
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

/** Earliest COUNT (ties by id) strictly after `late` on a key `late` touches. */
export function findAffectedCount(
  late: Movement,
  binCounts: Movement[],
): Movement | null {
  const keys = new Set(movementDeltas(late).map(balanceKeyString));
  const t = late.occurredAt.getTime();
  let best: Movement | null = null;
  for (const c of binCounts) {
    if (c.type !== 'COUNT' || c.occurredAt.getTime() <= t) continue;
    if (!keys.has(countKey(c))) continue;
    if (
      best === null ||
      c.occurredAt.getTime() < best.occurredAt.getTime() ||
      (c.occurredAt.getTime() === best.occurredAt.getTime() && c.id < best.id)
    ) {
      best = c;
    }
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
