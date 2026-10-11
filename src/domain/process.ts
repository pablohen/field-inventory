import {
  balanceKeyString,
  movementDeltas,
} from '#/domain/balance';
import {
  correctForLateMovement,
  findAffectedCount,
  reconcileCount,
} from '#/domain/count';
import { detectOverPick } from '#/domain/detectors';
import type { BalanceDelta, ExceptionDraft, Movement } from '#/domain/types';

export interface ProcessContext {
  /** Current balances for the keys the movement touches. */
  balances: Map<string, number>;
  /** Full ledger per touched key (balanceKeyString), COUNTs and auto-adjusts included. */
  binLedgers: Map<string, Movement[]>;
  openNegativeKeys: Set<string>;
  /** Tolerance resolved for the movement's sku. */
  tolerance: number;
  pickLine: { id: string; qtyRequested: number } | null;
  pickedBefore: number;
}

export interface Effects {
  /** The input movement first, then any system ADJUSTs in production order. */
  movements: Movement[];
  /** Aggregated per key over all `movements`; zero-net keys are dropped. */
  balanceDeltas: BalanceDelta[];
  exceptions: ExceptionDraft[];
}

/** Keys a movement touches, including a COUNT's own (sku, toLocation) key. */
export function touchedKeys(m: Movement): string[] {
  const keys = new Set(movementDeltas(m).map(balanceKeyString));
  if (m.type === 'COUNT' && m.toLocationId !== null) {
    keys.add(balanceKeyString({ skuId: m.skuId, locationId: m.toLocationId }));
  }
  return [...keys];
}

/**
 * Pure orchestration of one incoming movement: negative detection, count
 * reconciliation, late-movement correction cascade and over-pick detection.
 * Each affected count is corrected at most once per call.
 */
export function processMovement(
  m: Movement,
  ctx: ProcessContext,
  newId: () => string,
): Effects {
  const movements: Movement[] = [m];
  const exceptions: ExceptionDraft[] = [];
  const ledgers = new Map<string, Movement[]>();

  const ledgerFor = (key: string): Movement[] => {
    let l = ledgers.get(key);
    if (!l) {
      l = [...(ctx.binLedgers.get(key) ?? [])];
      ledgers.set(key, l);
    }
    return l;
  };
  const record = (x: Movement): void => {
    for (const key of touchedKeys(x)) {
      const l = ledgerFor(key);
      if (!l.some((y) => y.id === x.id)) l.push(x);
    }
  };
  record(m);

  const queue: Movement[] = [];
  const produce = (adjust: Movement): void => {
    movements.push(adjust);
    record(adjust);
    queue.push(adjust);
  };

  if (m.type === 'COUNT') {
    const key = touchedKeys(m)[0];
    if (key !== undefined) {
      const outcome = reconcileCount(m, ledgerFor(key), ctx.tolerance, newId);
      if (outcome.kind === 'auto_adjust') produce(outcome.adjust);
      else if (outcome.kind === 'exception') exceptions.push(outcome.exception);
    }
  } else {
    queue.push(m);
  }

  const corrected = new Set<string>();
  for (let x = queue.shift(); x !== undefined; x = queue.shift()) {
    for (const key of touchedKeys(x)) {
      const ledger = ledgerFor(key);
      const count = findAffectedCount(x, ledger);
      if (count === null || corrected.has(count.id)) continue;
      corrected.add(count.id);
      const outcome = correctForLateMovement(
        count,
        ledger,
        ctx.tolerance,
        newId,
        x.id,
      );
      if (outcome.kind === 'auto_adjust') produce(outcome.adjust);
      else if (outcome.kind === 'exception') exceptions.push(outcome.exception);
    }
  }

  const totals = new Map<string, BalanceDelta>();
  for (const x of movements) {
    for (const d of movementDeltas(x)) {
      const key = balanceKeyString(d);
      const prev = totals.get(key);
      totals.set(key, { ...d, delta: (prev?.delta ?? 0) + d.delta });
    }
  }
  const balanceDeltas = [...totals.values()].filter((d) => d.delta !== 0);

  // Negativity is judged once, on the net result of the whole call.
  for (const d of balanceDeltas) {
    const key = balanceKeyString(d);
    const before = ctx.balances.get(key) ?? 0;
    const after = before + d.delta;
    if (after < 0 && !ctx.openNegativeKeys.has(key)) {
      exceptions.push({
        type: 'NEGATIVE_BALANCE',
        movementIds: movements
          .filter((x) => touchedKeys(x).includes(key))
          .map((x) => x.id),
        skuId: d.skuId,
        locationId: d.locationId,
        deviceId: m.deviceId,
        details: { before, after },
      });
    }
  }

  if (m.type === 'PICK') {
    exceptions.push(...detectOverPick(m, ctx.pickLine, ctx.pickedBefore));
  }

  return { movements, balanceDeltas, exceptions };
}
