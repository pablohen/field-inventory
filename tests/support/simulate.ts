import { balanceKeyString, movementDeltas } from '#/domain/balance';
import { type ProcessContext, processMovement } from '#/domain/process';
import type { ExceptionDraft, Movement } from '#/domain/types';

/** Keys a movement touches, including a COUNT's own (sku, toLocation) key. */
function keysOf(m: Movement): string[] {
  const keys = new Set(movementDeltas(m).map(balanceKeyString));
  if (m.type === 'COUNT' && m.toLocationId !== null) {
    keys.add(balanceKeyString({ skuId: m.skuId, locationId: m.toLocationId }));
  }
  return [...keys];
}

/**
 * In-memory server: keeps the ledger and balances, builds a ProcessContext per
 * arriving movement the way the DB-backed loadContext does, and applies the
 * resulting Effects. NEGATIVE_BALANCE exceptions are never resolved.
 */
export function simulate(
  arrivalOrder: Movement[],
  toleranceFor: (skuId: string) => number,
): { balances: Map<string, number>; exceptions: ExceptionDraft[] } {
  const ledger: Movement[] = [];
  const balances = new Map<string, number>();
  const exceptions: ExceptionDraft[] = [];
  let seq = 0;
  const newId = (): string => `sys-${seq++}`;

  for (const m of arrivalOrder) {
    const keys = keysOf(m);
    const ctx: ProcessContext = {
      balances: new Map(keys.map((k) => [k, balances.get(k) ?? 0])),
      binLedgers: new Map(
        keys.map((k) => [k, ledger.filter((x) => keysOf(x).includes(k))]),
      ),
      openNegativeKeys: new Set(
        exceptions.flatMap((e) =>
          e.type === 'NEGATIVE_BALANCE' &&
          e.skuId !== null &&
          e.locationId !== null
            ? [balanceKeyString({ skuId: e.skuId, locationId: e.locationId })]
            : [],
        ),
      ),
      tolerance: toleranceFor(m.skuId),
      pickLine: null,
      pickedBefore: 0,
    };
    const effects = processMovement(m, ctx, newId);
    ledger.push(...effects.movements);
    for (const d of effects.balanceDeltas) {
      const k = balanceKeyString(d);
      balances.set(k, (balances.get(k) ?? 0) + d.delta);
    }
    const superseded = new Set(effects.supersededCountIds);
    for (let i = exceptions.length - 1; i >= 0; i--) {
      const e = exceptions[i];
      if (
        e !== undefined &&
        (e.type === 'COUNT_VARIANCE' || e.type === 'LATE_MOVEMENT') &&
        superseded.has(e.movementIds[0] ?? '')
      ) {
        exceptions.splice(i, 1);
      }
    }
    exceptions.push(...effects.exceptions);
  }
  return { balances, exceptions };
}
